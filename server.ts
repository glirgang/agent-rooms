#!/usr/bin/env node
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { loadConfig } from './src/config.ts'
import type { Config } from './src/config.ts'
import { createStorage } from './src/storage.ts'
import { createChannel, buildInstructions } from './src/channel.ts'
import { createTools } from './src/tools.ts'
import type { RegisterTool } from './src/tools.ts'

let config: Config
try {
  config = loadConfig(process.env)
} catch (err) {
  console.error(`agent-rooms: ${(err as Error).message}`)
  process.exit(1)
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const log = (...args: unknown[]): void => console.error('agent-rooms', ...args)

const storage = createStorage({ fsp, roomsDir: config.roomsDir, validId: config.validId })

const mcp = new McpServer(
  { name: 'agent-rooms', version: '1.0.0' },
  {
    capabilities: { experimental: { 'claude/channel': {} } },
    instructions: buildInstructions(config.agentName),
  },
)

const notify = (content: string, meta: Record<string, string>): Promise<void> =>
  mcp.server.notification({ method: 'notifications/claude/channel', params: { content, meta } })

const channel = createChannel({ storage, watch: fs.watch, sleep, notify, log, config })

const register: RegisterTool = (name, toolConfig, handler) =>
  mcp.registerTool(name, toolConfig, handler)
createTools({ register, storage, channel, config })

await storage.ensureDirs(config.myRooms)
channel.start(config.myRooms)
await mcp.connect(new StdioServerTransport())
console.error(`agent-rooms: "${config.agentName}" online, subscribed to: ${config.myRooms.join(', ')}`)
