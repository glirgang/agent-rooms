#!/usr/bin/env node
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { loadConfig } from './src/config.mjs'
import { createStorage } from './src/storage.mjs'
import { createChannel, buildInstructions } from './src/channel.mjs'
import { createTools } from './src/tools.mjs'

let config
try {
  config = loadConfig(process.env)
} catch (err) {
  console.error(`agent-rooms: ${err.message}`)
  process.exit(1)
}

const baseDir = process.env.AGENT_ROOMS_DIR || path.join(os.homedir(), '.agent-rooms')
const roomsDir = path.join(baseDir, 'rooms')

const clock = { now: () => Date.now(), iso: () => new Date().toISOString() }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.error('agent-rooms', ...a)

const storage = createStorage({ fsp, path, crypto, clock, roomsDir, validId: config.validId })

const mcp = new Server(
  { name: 'agent-rooms', version: '1.0.0' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },
      tools: {},
    },
    instructions: buildInstructions(config.agentName),
  },
)

const notify = (content, meta) =>
  mcp.notification({ method: 'notifications/claude/channel', params: { content, meta } })

const channel = createChannel({ storage, watch: fs.watch, sleep, notify, log, config })

const tools = createTools({ storage, channel, clock, config })
mcp.setRequestHandler(ListToolsRequestSchema, tools.listTools)
mcp.setRequestHandler(CallToolRequestSchema, tools.callTool)

await storage.ensureDirs(config.myRooms)
channel.start(config.myRooms)
await mcp.connect(new StdioServerTransport())
console.error(`agent-rooms: "${config.agentName}" online, subscribed to: ${config.myRooms.join(', ')}`)
