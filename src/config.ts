import path from 'node:path'
import os from 'node:os'

type Config = {
  roomsDir: string
  agentsDir: string
  rateLimit: number
  maxThreadDepth: number
  validId: RegExp
}

const VALID_ID = /^[a-zA-Z0-9_-]+$/

function loadConfig(env: NodeJS.ProcessEnv): Config {
  const baseDir = env.AGENT_ROOMS_DIR || path.join(os.homedir(), '.agent-rooms')
  const roomsDir = path.join(baseDir, 'rooms')
  const agentsDir = path.join(baseDir, 'agents')

  return { roomsDir, agentsDir, rateLimit: 10, maxThreadDepth: 8, validId: VALID_ID }
}

export { loadConfig }
export type { Config }
