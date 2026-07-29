#!/usr/bin/env node
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { loadConfig } from './src/config.ts'
import { createStorage } from './src/storage.ts'
import { createIdentity } from './src/identity.ts'
import { createChannel, buildInstructions } from './src/channel.ts'
import { createTools } from './src/tools.ts'
import type { RegisterTool } from './src/tools.ts'

const config = loadConfig(process.env)

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const log = (...args: unknown[]): void => console.error('agent-rooms', ...args)
const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const storage = createStorage({ fsp, roomsDir: config.roomsDir, agentsDir: config.agentsDir, validId: config.validId })
const identity = createIdentity({ storage, pid: process.pid, cwd: process.cwd(), isAlive, validId: config.validId })

const mcp = new McpServer(
  { name: 'agent-rooms', version: '1.0.0' },
  {
    capabilities: { experimental: { 'claude/channel': {} } },
    instructions: buildInstructions(),
  },
)

const notify = (content: string, meta: Record<string, string>): Promise<void> =>
  mcp.server.notification({ method: 'notifications/claude/channel', params: { content, meta } })

const register: RegisterTool = (name, toolConfig, handler) =>
  mcp.registerTool(name, toolConfig, handler)

const channel = createChannel({ storage, watch: fs.watch, sleep, notify, log, config, identity })
createTools({ register, storage, channel, identity, isAlive, config })

await storage.ensureBaseDirs()
await mcp.connect(new StdioServerTransport())
console.error('agent-rooms: online — register this session with register_name')
