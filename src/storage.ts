import path from 'node:path'
import crypto from 'node:crypto'

type Fsp = typeof import('node:fs/promises')

type Message = {
  from: string
  room: string
  text: string
  depth: number
  ts: string
}

type Agent = {
  name: string
  pid: number
  rooms: string[]
  registeredAt: string
}

type StorageDeps = {
  fsp: Fsp
  roomsDir: string
  agentsDir: string
  validId: RegExp
}

function createStorage({ fsp, roomsDir, agentsDir, validId }: StorageDeps) {
  const roomDir = (room: string): string => path.join(roomsDir, room)
  const agentFile = (name: string): string => path.join(agentsDir, `${name}.json`)

  const assertValidRoom = (room: string): string => {
    if (!validId.test(room)) throw new Error(`invalid room name: "${room}" (use letters, digits, - and _)`)
    return room
  }

  const ensureBaseDirs = async (): Promise<void> => {
    await Promise.all([
      fsp.mkdir(roomsDir, { recursive: true }),
      fsp.mkdir(agentsDir, { recursive: true }),
    ])
  }

  const ensureRoom = async (room: string): Promise<void> => {
    await fsp.mkdir(roomDir(room), { recursive: true })
  }

  function listRoomNames(): Promise<string[]> {
    return fsp.readdir(roomsDir, { withFileTypes: true })
      .then(entries => entries.filter(d => d.isDirectory()).map(d => d.name))
      .catch(() => [])
  }

  async function writeMessage(room: string, msg: Message): Promise<void> {
    const name = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.json`
    const dir = roomDir(room)
    const tmp = path.join(dir, `.${name}.tmp`)
    await fsp.writeFile(tmp, JSON.stringify(msg, null, 2))
    await fsp.rename(tmp, path.join(dir, name))
  }

  async function listMessageFiles(room: string): Promise<string[]> {
    const files = await fsp.readdir(roomDir(room))
    return files.filter(f => f.endsWith('.json') && !f.startsWith('.')).sort()
  }

  async function readMessage(room: string, file: string): Promise<Message> {
    const raw = await fsp.readFile(path.join(roomDir(room), file), 'utf8')
    return JSON.parse(raw) as Message
  }

  async function clearRoom(room: string): Promise<void> {
    const files = await listMessageFiles(room).catch(() => [])
    await Promise.all(files.map(f => fsp.rm(path.join(roomDir(room), f), { force: true })))
  }

  function readAgent(name: string): Promise<Agent | null> {
    return fsp.readFile(agentFile(name), 'utf8')
      .then(raw => JSON.parse(raw) as Agent)
      .catch(() => null)
  }

  async function writeAgent(agent: Agent): Promise<void> {
    const tmp = path.join(agentsDir, `.${agent.name}.json.tmp`)
    await fsp.writeFile(tmp, JSON.stringify(agent, null, 2))
    await fsp.rename(tmp, agentFile(agent.name))
  }

  function listAgents(): Promise<Agent[]> {
    return fsp.readdir(agentsDir)
      .then(files => Promise.all(files
        .filter(f => f.endsWith('.json') && !f.startsWith('.'))
        .map(f => fsp.readFile(path.join(agentsDir, f), 'utf8').then(raw => JSON.parse(raw) as Agent).catch(() => null))))
      .then(agents => agents.filter((a): a is Agent => a !== null))
      .catch(() => [])
  }

  function deleteAgent(name: string): Promise<void> {
    return fsp.rm(agentFile(name), { force: true })
  }

  return {
    roomDir, assertValidRoom, ensureBaseDirs, ensureRoom, listRoomNames,
    writeMessage, listMessageFiles, readMessage, clearRoom,
    readAgent, writeAgent, listAgents, deleteAgent,
  }
}

type Storage = ReturnType<typeof createStorage>

export { createStorage }
export type { Storage, Message, Agent }
