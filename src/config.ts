import path from 'node:path'
import os from 'node:os'

type Config = {
  agentName: string
  myRooms: string[]
  roomsDir: string
  rateLimit: number
  maxThreadDepth: number
  validId: RegExp
}

const VALID_ID = /^[a-zA-Z0-9_-]+$/

function loadConfig(env: NodeJS.ProcessEnv): Config {
  const agentName = env.AGENT_NAME
  if (!agentName || !VALID_ID.test(agentName)) throw new Error('AGENT_NAME inválido (use letras, números, - e _)')

  const myRooms = (env.AGENT_ROOMS || 'general')
    .split(',').map(s => s.trim()).filter(Boolean)

  const baseDir = env.AGENT_ROOMS_DIR || path.join(os.homedir(), '.agent-rooms')
  const roomsDir = path.join(baseDir, 'rooms')

  return { agentName, myRooms, roomsDir, rateLimit: 10, maxThreadDepth: 8, validId: VALID_ID }
}

export { loadConfig }
export type { Config }
