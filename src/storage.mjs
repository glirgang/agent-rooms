function createStorage({ fsp, path, crypto, clock, roomsDir, validId }) {
  let seq = 0
  const roomDir = room => path.join(roomsDir, room)

  function assertValidRoom(room) {
    if (typeof room !== 'string' || !validId.test(room)) {
      throw new Error(`invalid room name: "${room}" (use letters, digits, - and _)`)
    }
  }

  async function ensureDirs(rooms) {
    await fsp.mkdir(roomsDir, { recursive: true })
    for (const r of rooms) {
      assertValidRoom(r)
      await fsp.mkdir(roomDir(r), { recursive: true })
    }
  }

  async function ensureRoom(room) {
    await fsp.mkdir(roomDir(room), { recursive: true })
  }

  async function listRoomNames() {
    try {
      const entries = await fsp.readdir(roomsDir, { withFileTypes: true })
      return entries.filter(d => d.isDirectory()).map(d => d.name)
    } catch {
      return []
    }
  }

  async function writeMessage(room, msg) {
    const name = `${clock.now()}-${String(seq++).padStart(4, '0')}-${crypto.randomBytes(3).toString('hex')}.json`
    const dir = roomDir(room)
    const tmp = path.join(dir, `.${name}.tmp`)
    await fsp.writeFile(tmp, JSON.stringify(msg, null, 2))
    await fsp.rename(tmp, path.join(dir, name))
  }

  async function listMessageFiles(room) {
    const files = await fsp.readdir(roomDir(room))
    return files.filter(f => f.endsWith('.json') && !f.startsWith('.')).sort()
  }

  async function readMessage(room, file) {
    const raw = await fsp.readFile(path.join(roomDir(room), file), 'utf8')
    return JSON.parse(raw)
  }

  return {
    roomDir, assertValidRoom, ensureDirs, ensureRoom,
    listRoomNames, writeMessage, listMessageFiles, readMessage,
  }
}

export { createStorage }
