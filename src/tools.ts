import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Storage } from './storage.ts'
import type { Channel } from './channel.ts'
import type { Config } from './config.ts'

type RegisterTool = McpServer['registerTool']

type ToolsDeps = {
  register: RegisterTool
  storage: Storage
  channel: Channel
  config: Config
}

function createTools({ register, storage, channel, config }: ToolsDeps): void {
  const sendTimes: number[] = []
  function rateLimited(): boolean {
    const now = Date.now()
    while (sendTimes.length && now - sendTimes[0] > 60_000) sendTimes.shift()
    if (sendTimes.length >= config.rateLimit) return true
    sendTimes.push(now)
    return false
  }

  register('send_message', {
    description: 'Post a message to a room. All agents subscribed to that room receive it immediately. Mention an agent as @name to request action from it.',
    inputSchema: {
      room: z.string().describe('Room name, e.g. "general"'),
      text: z.string().min(1).describe('The message to post'),
    },
  }, async ({ room, text }) => {
    storage.assertValidRoom(room)
    if (rateLimited()) {
      return { content: [{ type: 'text', text: `Rate limit reached (${config.rateLimit}/min). Wait before sending again.` }], isError: true }
    }
    await storage.ensureRoom(room)
    channel.watchRoom(room)
    const depth = channel.nextSendDepth(room)
    await storage.writeMessage(room, { from: config.agentName, room, text, depth, ts: new Date().toISOString() })
    return { content: [{ type: 'text', text: `sent to #${room}` }] }
  })

  register('read_history', {
    description: 'Read the most recent messages of a room (useful for context on demand).',
    inputSchema: {
      room: z.string().describe('Room name'),
      count: z.number().optional().describe('How many messages (default 20)'),
    },
  }, async ({ room, count = 20 }) => {
    storage.assertValidRoom(room)
    const files = await storage.listMessageFiles(room).catch(() => null)
    if (!files) return { content: [{ type: 'text', text: `room "${room}" does not exist` }], isError: true }
    const recent = files.slice(-Math.max(1, Math.min(200, count)))
    const lines: string[] = []
    for (const f of recent) {
      const m = await storage.readMessage(room, f).catch(() => null)
      if (m) lines.push(`[${m.ts}] ${m.from}: ${m.text}`)
    }
    return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : `#${room} is empty` }] }
  })

  register('list_rooms', {
    description: 'List all rooms that exist and which ones this agent is subscribed to.',
    inputSchema: {},
  }, async () => {
    const all = await storage.listRoomNames()
    const lines = all.map(r => `#${r}${config.myRooms.includes(r) || channel.isWatched(r) ? ' (subscribed)' : ''}`)
    return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : 'no rooms yet' }] }
  })
}

export { createTools }
export type { RegisterTool }
