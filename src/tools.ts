import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Storage } from './storage.ts'
import type { Channel } from './channel.ts'
import type { Identity } from './identity.ts'
import type { Config } from './config.ts'

type RegisterTool = McpServer['registerTool']

type ToolsDeps = {
  register: RegisterTool
  storage: Storage
  channel: Channel
  identity: Identity
  isAlive: (pid: number) => boolean
  config: Config
}

function createTools({ register, storage, channel, identity, isAlive, config }: ToolsDeps): void {
  const sendTimes: number[] = []

  function rateLimited(): boolean {
    const now = Date.now()
    while (sendTimes.length && now - sendTimes[0] > 60_000) sendTimes.shift()
    if (sendTimes.length >= config.rateLimit) return true
    sendTimes.push(now)
    return false
  }

  const needsRegister = (): { content: { type: 'text', text: string }[], isError: true } =>
    ({ content: [{ type: 'text', text: 'Register this session first with register_name.' }], isError: true })

  register('register_name', {
    description: 'Register or reassume this session under a name. The name is a per-room badge: it only conflicts inside a room (checked on join_room). Rejoins the rooms this name previously held from this directory.',
    inputSchema: { name: z.string().min(1).describe('Agent name, e.g. "backend"') },
  }, async ({ name }) => {
    const outcome = await identity.register(name).catch((err: Error) => err)
    if (outcome instanceof Error) return { content: [{ type: 'text', text: outcome.message }], isError: true }
    channel.watchedRooms().filter(r => !outcome.rooms.includes(r)).forEach(r => channel.unwatchRoom(r))
    await Promise.all(outcome.rooms.map(r => storage.ensureRoom(r)))
    outcome.rooms.forEach(r => channel.watchRoom(r))
    const rejoined = outcome.rooms.length ? `Rejoined rooms: ${outcome.rooms.join(', ')}.` : 'No rooms yet — use join_room.'
    return { content: [{ type: 'text', text: `You are now @${outcome.name}. Only act when a message mentions @${outcome.name}; reply in the same room; never send courtesy replies. ${rejoined}` }] }
  })

  register('join_room', {
    description: 'Join a room to start receiving its messages. Requires a registered name. Blocks if a live session already holds this name in that room.',
    inputSchema: { room: z.string().min(1).describe('Room name, e.g. "general"') },
  }, async ({ room }) => {
    if (!identity.current()) return needsRegister()
    storage.assertValidRoom(room)
    await storage.ensureRoom(room)
    const outcome = await identity.addRoom(room).catch((err: Error) => err)
    if (outcome instanceof Error) return { content: [{ type: 'text', text: outcome.message }], isError: true }
    channel.watchRoom(room)
    return { content: [{ type: 'text', text: `joined #${room}` }] }
  })

  register('leave_room', {
    description: 'Leave a room to stop receiving its messages.',
    inputSchema: { room: z.string().min(1).describe('Room name') },
  }, async ({ room }) => {
    if (!identity.current()) return needsRegister()
    storage.assertValidRoom(room)
    await identity.removeRoom(room)
    channel.unwatchRoom(room)
    return { content: [{ type: 'text', text: `left #${room}` }] }
  })

  register('send_message', {
    description: 'Post a message to a room. Everyone in that room receives it immediately. Mention an agent as @name to request action. Pass "to" to deliver only to specific agents (direct message).',
    inputSchema: {
      room: z.string().min(1).describe('Room name, e.g. "general"'),
      text: z.string().min(1).describe('The message to post'),
      to: z.array(z.string().min(1)).optional().describe('Agent names that should receive this message; other agents in the room will not see it. Omit to broadcast to the whole room.'),
    },
  }, async ({ room, text, to }) => {
    const me = identity.current()
    if (!me) return needsRegister()
    storage.assertValidRoom(room)
    if (rateLimited()) return { content: [{ type: 'text', text: `Rate limit reached (${config.rateLimit}/min). Wait before sending again.` }], isError: true }
    await storage.ensureRoom(room)
    const joined = await identity.addRoom(room).catch((err: Error) => err)
    if (joined instanceof Error) return { content: [{ type: 'text', text: joined.message }], isError: true }
    channel.watchRoom(room)
    const depth = channel.nextSendDepth(room)
    await storage.writeMessage(room, { from: me, room, text, ...(to?.length ? { to } : {}), depth, ts: new Date().toISOString() })
    return { content: [{ type: 'text', text: to?.length ? `sent to ${to.map(n => `@${n}`).join(', ')} in #${room}` : `sent to #${room}` }] }
  })

  register('read_history', {
    description: 'Read the most recent messages of a room.',
    inputSchema: {
      room: z.string().min(1).describe('Room name'),
      count: z.number().optional().describe('How many messages (default 20)'),
    },
  }, async ({ room, count = 20 }) => {
    storage.assertValidRoom(room)
    const files = await storage.listMessageFiles(room).catch(() => null)
    if (!files) return { content: [{ type: 'text', text: `room "${room}" does not exist` }], isError: true }
    const recent = files.slice(-Math.max(1, Math.min(200, count)))
    const me = identity.current()
    const lines: string[] = []
    for (const f of recent) {
      const m = await storage.readMessage(room, f).catch(() => null)
      if (!m) continue
      if (m.to?.length && m.from !== me && !(me && m.to.includes(me))) continue
      const dm = m.to?.length ? ` (dm: ${m.to.map(n => `@${n}`).join(', ')})` : ''
      lines.push(`[${m.ts}] ${m.from}${dm}: ${m.text}`)
    }
    return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : `#${room} is empty` }] }
  })

  register('list_rooms', {
    description: 'List all rooms that exist and which ones this session is subscribed to.',
    inputSchema: {},
  }, async () => {
    const all = await storage.listRoomNames()
    const lines = all.map(r => `#${r}${channel.isWatched(r) ? ' (subscribed)' : ''}`)
    return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : 'no rooms yet' }] }
  })

  register('clear_room', {
    description: 'Delete all messages in a room (the room itself stays).',
    inputSchema: { room: z.string().min(1).describe('Room name') },
  }, async ({ room }) => {
    storage.assertValidRoom(room)
    await storage.clearRoom(room)
    return { content: [{ type: 'text', text: `cleared #${room}` }] }
  })

  register('list_agents', {
    description: 'List agents per room, whether their session is alive, and the directory each one works from.',
    inputSchema: {},
  }, async () => {
    const rooms = await storage.listRoomNames()
    const lines: string[] = []
    for (const room of rooms) {
      const members = await storage.listMembers(room)
      members.forEach(m => lines.push(`#${room} @${m.name} (${isAlive(m.pid) ? 'alive' : 'offline'}) — ${m.cwd}`))
    }
    return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : 'no agents in any room' }] }
  })
}

export { createTools }
export type { RegisterTool }
