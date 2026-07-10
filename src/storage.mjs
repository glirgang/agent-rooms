import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { ROOMS_DIR, MY_ROOMS, VALID_ID } from './config.mjs'

let seq = 0

const roomDir = room => path.join(ROOMS_DIR, room)

function assertValidRoom(room) {
  if (typeof room !== 'string' || !VALID_ID.test(room)) {
    throw new Error(`invalid room name: "${room}" (use letters, digits, - and _)`)
  }
}

async function ensureDirs() {
  await fsp.mkdir(ROOMS_DIR, { recursive: true })
  for (const r of MY_ROOMS) {
    assertValidRoom(r)
    await fsp.mkdir(roomDir(r), { recursive: true })
  }
}

async function writeMessage(room, msg) {
  const name = `${Date.now()}-${String(seq++).padStart(4, '0')}-${crypto.randomBytes(3).toString('hex')}.json`
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

export { roomDir, assertValidRoom, ensureDirs, writeMessage, listMessageFiles, readMessage }
