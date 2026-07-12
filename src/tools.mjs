const TOOL_DEFS = [
  {
    name: 'send_message',
    description:
      'Post a message to a room. All agents subscribed to that room receive it ' +
      'immediately. Mention an agent as @name to request action from it.',
    inputSchema: {
      type: 'object',
      properties: {
        room: { type: 'string', description: 'Room name, e.g. "general"' },
        text: { type: 'string', description: 'The message to post' },
      },
      required: ['room', 'text'],
    },
  },
  {
    name: 'read_history',
    description: 'Read the most recent messages of a room (useful for context on demand).',
    inputSchema: {
      type: 'object',
      properties: {
        room: { type: 'string', description: 'Room name' },
        count: { type: 'number', description: 'How many messages (default 20)' },
      },
      required: ['room'],
    },
  },
  {
    name: 'list_rooms',
    description: 'List all rooms that exist and which ones this agent is subscribed to.',
    inputSchema: { type: 'object', properties: {} },
  },
]

function createTools({ storage, channel, clock, config }) {
  const sendTimes = []
  function rateLimited() {
    const now = clock.now()
    while (sendTimes.length && now - sendTimes[0] > 60_000) sendTimes.shift()
    if (sendTimes.length >= config.rateLimit) return true
    sendTimes.push(now)
    return false
  }

  async function listTools() {
    return { tools: TOOL_DEFS }
  }

  async function callTool(req) {
    const { name, arguments: args = {} } = req.params

    if (name === 'send_message') {
      const { room, text } = args
      storage.assertValidRoom(room)
      if (typeof text !== 'string' || !text.trim()) throw new Error('text must be a non-empty string')
      if (rateLimited()) {
        return { content: [{ type: 'text', text: `Rate limit reached (${config.rateLimit}/min). Wait before sending again.` }], isError: true }
      }
      await storage.ensureRoom(room)
      channel.watchRoom(room)
      const depth = channel.nextSendDepth(room)
      await storage.writeMessage(room, { from: config.agentName, room, text, depth, ts: clock.iso() })
      return { content: [{ type: 'text', text: `sent to #${room}` }] }
    }

    if (name === 'read_history') {
      const { room, count = 20 } = args
      storage.assertValidRoom(room)
      let files
      try { files = await storage.listMessageFiles(room) }
      catch { return { content: [{ type: 'text', text: `room "${room}" does not exist` }], isError: true } }
      const recent = files.slice(-Math.max(1, Math.min(200, count)))
      const lines = []
      for (const f of recent) {
        try { const m = await storage.readMessage(room, f); lines.push(`[${m.ts}] ${m.from}: ${m.text}`) } catch {}
      }
      return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : `#${room} is empty` }] }
    }

    if (name === 'list_rooms') {
      const all = await storage.listRoomNames()
      const lines = all.map(r => `#${r}${config.myRooms.includes(r) || channel.isWatched(r) ? ' (subscribed)' : ''}`)
      return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : 'no rooms yet' }] }
    }

    throw new Error(`unknown tool: ${name}`)
  }

  return { listTools, callTool }
}

export { createTools }
