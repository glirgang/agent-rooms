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

type StorageDeps = {
  fsp: Fsp
  roomsDir: string
  validId: RegExp
}

function createStorage({ fsp, roomsDir, validId }: StorageDeps) {
  const roomDir = (room: string): string => path.join(roomsDir, room)

  const assertValidRoom = (room: string): string => {
    if (!validId.test(room)) throw new Error(`invalid room name: "${room}" (use letters, digits, - and _)`)
    return room
  }

  const ensureRoom = async (room: string): Promise<void> => {
    await fsp.mkdir(roomDir(room), { recursive: true })
  }

  const ensureDirs = async (rooms: string[]): Promise<void> => {
    await fsp.mkdir(roomsDir, { recursive: true })
    await Promise.all(rooms.map(assertValidRoom).map(ensureRoom))
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

  return { roomDir, assertValidRoom, ensureDirs, ensureRoom, listRoomNames, writeMessage, listMessageFiles, readMessage }
}

type Storage = ReturnType<typeof createStorage>

export { createStorage }
export type { Storage, Message }
