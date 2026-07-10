import path from 'node:path'
import os from 'node:os'

const VALID_ID = /^[a-zA-Z0-9_-]+$/

const AGENT_NAME = process.env.AGENT_NAME
if (!AGENT_NAME || !VALID_ID.test(AGENT_NAME)) {
  console.error('agent-rooms: defina AGENT_NAME (letras, números, - e _)')
  process.exit(1)
}

const BASE_DIR = process.env.AGENT_ROOMS_DIR || path.join(os.homedir(), '.agent-rooms')
const ROOMS_DIR = path.join(BASE_DIR, 'rooms')
const MY_ROOMS = (process.env.AGENT_ROOMS || 'general')
  .split(',').map(s => s.trim()).filter(Boolean)

const RATE_LIMIT = 10
const MAX_THREAD_DEPTH = 8

export { AGENT_NAME, BASE_DIR, ROOMS_DIR, MY_ROOMS, RATE_LIMIT, MAX_THREAD_DEPTH, VALID_ID }
