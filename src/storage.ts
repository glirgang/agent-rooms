import path from 'node:path'
import crypto from 'node:crypto'

type Fsp = typeof import('node:fs/promises')

type Message = {
  from: string
  room: string
  text: string
  to?: string[]
  depth: number
  ts: string
}

type Member = {
  name: string
  room: string
  pid: number
  cwd: string
  joinedAt: string
}

type StorageDeps = {
  fsp: Fsp
  roomsDir: string
  agentsDir: string
  validId: RegExp
}

function createStorage({ fsp, roomsDir, agentsDir, validId }: StorageDeps) {
  const roomDir = (room: string): string => path.join(roomsDir, room)
  const memberDir = (room: string): string => path.join(agentsDir, room)
  const memberFile = (room: string, name: string): string => path.join(memberDir(room), `${name}.json`)

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

  function readMember(room: string, name: string): Promise<Member | null> {
    return fsp.readFile(memberFile(room, name), 'utf8')
      .then(raw => JSON.parse(raw) as Member)
      .catch(() => null)
  }

  async function writeMember(member: Member): Promise<void> {
    await fsp.mkdir(memberDir(member.room), { recursive: true })
    const tmp = path.join(memberDir(member.room), `.${member.name}.json.tmp`)
    await fsp.writeFile(tmp, JSON.stringify(member, null, 2))
    await fsp.rename(tmp, memberFile(member.room, member.name))
  }

  function deleteMember(room: string, name: string): Promise<void> {
    return fsp.rm(memberFile(room, name), { force: true })
  }

  function listMembers(room: string): Promise<Member[]> {
    return fsp.readdir(memberDir(room))
      .then(files => Promise.all(files
        .filter(f => f.endsWith('.json') && !f.startsWith('.'))
        .map(f => fsp.readFile(path.join(memberDir(room), f), 'utf8').then(raw => JSON.parse(raw) as Member).catch(() => null))))
      .then(members => members.filter((m): m is Member => m !== null))
      .catch(() => [])
  }

  async function listMemberships(name: string): Promise<Member[]> {
    const rooms = await fsp.readdir(agentsDir, { withFileTypes: true })
      .then(entries => entries.filter(d => d.isDirectory()).map(d => d.name))
      .catch(() => [] as string[])
    const members = await Promise.all(rooms.map(r => readMember(r, name)))
    return members.filter((m): m is Member => m !== null)
  }

  return {
    roomDir, assertValidRoom, ensureBaseDirs, ensureRoom, listRoomNames,
    writeMessage, listMessageFiles, readMessage, clearRoom,
    readMember, writeMember, deleteMember, listMembers, listMemberships,
  }
}

type Storage = ReturnType<typeof createStorage>

export { createStorage }
export type { Storage, Message, Member }
