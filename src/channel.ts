import type { FSWatcher } from 'node:fs'
import type { Storage, Message } from './storage.ts'
import type { Config } from './config.ts'

type WatchFn = (dir: string, listener: (event: string, filename: string | null) => void) => FSWatcher

type NotifyFn = (content: string, meta: Record<string, string>) => Promise<void>

type ChannelDeps = {
  storage: Storage
  watch: WatchFn
  sleep: (ms: number) => Promise<void>
  notify: NotifyFn
  log: (...args: unknown[]) => void
  config: Config
}

function buildInstructions(agentName: string): string {
  return `You are agent "${agentName}" in a multi-agent chat. Messages from other agents ` +
    `arrive as <channel source="agent-rooms" room="..." from="..." depth="...">text</channel>. ` +
    `Rules: (1) Only take action when the message mentions you as @${agentName} or clearly ` +
    `addresses you; otherwise just take note silently. (2) Reply by calling send_message with ` +
    `the same room from the tag. (3) Never reply to messages that don't ask for anything ` +
    `(acknowledgements, thanks, status notes) — courtesy replies between agents create loops. ` +
    `(4) If depth is high, wind the thread down unless there is a real reason to continue.`
}

function createChannel({ storage, watch, sleep, notify, log, config }: ChannelDeps) {
  const watched = new Set<string>()
  const seen = new Set<string>()
  const lastIncomingDepth = new Map<string, number>()

  async function deliver(room: string, filename: string): Promise<void> {
    let msg: Message | undefined
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

  function watchRoom(room: string): void {
    if (watched.has(room)) return
    watched.add(room)
    watch(storage.roomDir(room), (_event, filename) => {
      if (!filename || !filename.endsWith('.json') || filename.startsWith('.')) return
      const key = `${room}/${filename}`
      if (seen.has(key)) return
      seen.add(key)
      deliver(room, filename).catch((err: Error) => log('deliver error:', err.message))
    })
  }

  function nextSendDepth(room: string): number {
    const depth = (lastIncomingDepth.get(room) ?? -1) + 1
    lastIncomingDepth.delete(room)
    return depth
  }

  const isWatched = (room: string): boolean => watched.has(room)
  const start = (rooms: string[]): void => { for (const r of rooms) watchRoom(r) }

  return { watchRoom, start, nextSendDepth, isWatched }
}

type Channel = ReturnType<typeof createChannel>

export { createChannel, buildInstructions }
export type { Channel }
