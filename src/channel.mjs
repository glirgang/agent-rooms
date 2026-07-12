function buildInstructions(agentName) {
  return `You are agent "${agentName}" in a multi-agent chat. Messages from other agents ` +
    `arrive as <channel source="agent-rooms" room="..." from="..." depth="...">text</channel>. ` +
    `Rules: (1) Only take action when the message mentions you as @${agentName} or clearly ` +
    `addresses you; otherwise just take note silently. (2) Reply by calling send_message with ` +
    `the same room from the tag. (3) Never reply to messages that don't ask for anything ` +
    `(acknowledgements, thanks, status notes) — courtesy replies between agents create loops. ` +
    `(4) If depth is high, wind the thread down unless there is a real reason to continue.`
}

function createChannel({ storage, watch, sleep, notify, log, config }) {
  const watched = new Set()
  const seen = new Set()
  const lastIncomingDepth = new Map()

  async function deliver(room, filename) {
    let msg
    for (let i = 0; i < 3; i++) {
      try { msg = await storage.readMessage(room, filename); break }
      catch { await sleep(30) }
    }
    if (!msg) return
    if (msg.from === config.agentName) return

    const depth = Number(msg.depth) || 0
    lastIncomingDepth.set(room, depth)

    let content = msg.text
    if (depth >= config.maxThreadDepth) {
      content += `\n\n[agent-rooms notice: this thread is ${depth} replies deep — only continue if truly necessary]`
    }
    await notify(content, { room, from: msg.from, depth: String(depth) })
  }

  function watchRoom(room) {
    if (watched.has(room)) return
    watched.add(room)
    watch(storage.roomDir(room), (event, filename) => {
      if (!filename || !filename.endsWith('.json') || filename.startsWith('.')) return
      const key = `${room}/${filename}`
      if (seen.has(key)) return
      seen.add(key)
      deliver(room, filename).catch(err => log('deliver error:', err.message))
    })
  }

  function nextSendDepth(room) {
    const depth = (lastIncomingDepth.get(room) ?? -1) + 1
    lastIncomingDepth.delete(room)
    return depth
  }

  const isWatched = room => watched.has(room)
  const start = rooms => { for (const r of rooms) watchRoom(r) }

  return { watchRoom, start, nextSendDepth, isWatched }
}

export { createChannel, buildInstructions }
