import type { FSWatcher } from 'node:fs'
import type { Storage, Message } from './storage.ts'
import type { Config } from './config.ts'
import type { Identity } from './identity.ts'

type WatchFn = (dir: string, listener: (event: string, filename: string | null) => void) => FSWatcher
type NotifyFn = (content: string, meta: Record<string, string>) => Promise<void>

type ChannelDeps = {
  storage: Storage
  watch: WatchFn
  sleep: (ms: number) => Promise<void>
  notify: NotifyFn
  log: (...args: unknown[]) => void
  config: Config
  identity: Identity
}

function buildInstructions(): string {
  return `You are an agent in a multi-agent chat over shared rooms. First register this session by ` +
    `calling register_name with the name the user gives you. Messages from other agents arrive as ` +
    `<channel source="agent-rooms" room="..." from="..." depth="...">text</channel>. Once registered as ` +
    `@name, rules: (1) Only take action when a message mentions you as @name or clearly addresses you; ` +
    `otherwise just take note silently. (2) Reply by calling send_message with the same room from the tag. ` +
    `(3) Never reply to messages that don't ask for anything (acknowledgements, thanks, status notes) — ` +
    `courtesy replies between agents create loops. (4) If depth is high, wind the thread down unless there ` +
    `is a real reason to continue. (5) When your message is addressed to specific agents (a directed task, ` +
    `question, or answer), send it with the "to" parameter of send_message so only they receive it — ` +
    `broadcast only what the whole room needs to see. A message with a to="..." attribute is a direct ` +
    `message only its recipients saw; reply with "to" as well.`
}

const isMessageFile = (filename: string | null): filename is string =>
  !!filename && filename.endsWith('.json') && !filename.startsWith('.')

const threadNotice = (depth: number, max: number): string =>
  depth >= max ? `\n\n[agent-rooms notice: this thread is ${depth} replies deep — only continue if truly necessary]` : ''

function createChannel({ storage, watch, sleep, notify, log, config, identity }: ChannelDeps) {
  const watched = new Set<string>()
  const watchers = new Map<string, FSWatcher>()
  const seen = new Set<string>()
  const lastIncomingDepth = new Map<string, number>()

  const readWithRetry = (room: string, filename: string, tries = 3): Promise<Message | null> =>
    storage.readMessage(room, filename).catch(() =>
      tries > 1 ? sleep(30).then(() => readWithRetry(room, filename, tries - 1)) : null)

  const markSeen = (key: string): boolean => {
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }

  async function deliver(room: string, filename: string): Promise<void> {
    const msg = await readWithRetry(room, filename)
    const me = identity.current()
    if (!msg || msg.from === me) return
    if (msg.to?.length && (!me || !msg.to.includes(me))) return
    const depth = Number(msg.depth) || 0
    lastIncomingDepth.set(room, depth)
    const meta: Record<string, string> = { room, from: msg.from, depth: String(depth) }
    if (msg.to?.length) meta.to = msg.to.join(',')
    await notify(msg.text + threadNotice(depth, config.maxThreadDepth), meta)
  }

  function watchRoom(room: string): void {
    if (watched.has(room)) return
    watched.add(room)
    watchers.set(room, watch(storage.roomDir(room), (_event, filename) => {
      if (isMessageFile(filename) && markSeen(`${room}/${filename}`))
        deliver(room, filename).catch((err: Error) => log('deliver error:', err.message))
    }))
  }

  function unwatchRoom(room: string): void {
    watchers.get(room)?.close()
    watchers.delete(room)
    watched.delete(room)
  }

  function nextSendDepth(room: string): number {
    const depth = (lastIncomingDepth.get(room) ?? -1) + 1
    lastIncomingDepth.delete(room)
    return depth
  }

  const isWatched = (room: string): boolean => watched.has(room)

  const watchedRooms = (): string[] => [...watched]

  return { watchRoom, unwatchRoom, nextSendDepth, isWatched, watchedRooms }
}

type Channel = ReturnType<typeof createChannel>

export { createChannel, buildInstructions }
export type { Channel }
