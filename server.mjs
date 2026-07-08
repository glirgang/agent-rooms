#!/usr/bin/env node
// agent-rooms: canal MCP para sessões de Claude Code conversarem por salas.
//
// Como funciona:
//  - Cada sala é uma pasta em AGENT_ROOMS_DIR/rooms/<sala>
//  - Cada mensagem é um arquivo JSON (escrito de forma atômica: tmp + rename)
//  - fs.watch (inotify) avisa na hora que chega arquivo novo -> push pra sessão
//
// Configuração por variáveis de ambiente (definidas no .mcp.json):
//  AGENT_NAME       nome deste agente (ex: "coordenador")  [obrigatório]
//  AGENT_ROOMS      salas que ele assina, separadas por vírgula (ex: "geral,infra-backend")
//  AGENT_ROOMS_DIR  pasta base (padrão: ~/.agent-rooms)

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

// ---------------------------------------------------------------- configuração
const AGENT_NAME = process.env.AGENT_NAME
if (!AGENT_NAME || !/^[a-zA-Z0-9_-]+$/.test(AGENT_NAME)) {
  console.error('agent-rooms: defina AGENT_NAME (letras, números, - e _)')
  process.exit(1)
}
const BASE_DIR = process.env.AGENT_ROOMS_DIR || path.join(os.homedir(), '.agent-rooms')
const ROOMS_DIR = path.join(BASE_DIR, 'rooms')
const MY_ROOMS = (process.env.AGENT_ROOMS || 'general')
  .split(',').map(s => s.trim()).filter(Boolean)

// Freios anti-loop
const RATE_LIMIT = 10          // máx. de envios por minuto
const MAX_THREAD_DEPTH = 8     // profundidade de conversa antes do aviso

// ---------------------------------------------------------------- utilidades
const roomDir = room => path.join(ROOMS_DIR, room)

function assertValidRoom(room) {
  if (typeof room !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(room)) {
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

// Escrita atômica: escreve num .tmp e renomeia. O watcher ignora .tmp,
// então nenhuma mensagem é lida pela metade.
let seq = 0
async function writeMessage(room, msg) {
  const name = `${Date.now()}-${String(seq++).padStart(4, '0')}-${crypto.randomBytes(3).toString('hex')}.json`
  const dir = roomDir(room)
  const tmp = path.join(dir, `.${name}.tmp`)
  await fsp.writeFile(tmp, JSON.stringify(msg, null, 2))
  await fsp.rename(tmp, path.join(dir, name))
}

async function listMessageFiles(room) {
  const files = await fsp.readdir(roomDir(room))
  // nomes começam com timestamp -> ordenar por nome = ordenar por chegada
  return files.filter(f => f.endsWith('.json') && !f.startsWith('.')).sort()
}

async function readMessage(room, file) {
  const raw = await fsp.readFile(path.join(roomDir(room), file), 'utf8')
  return JSON.parse(raw)
}

// ---------------------------------------------------------------- servidor MCP
const mcp = new Server(
  { name: 'agent-rooms', version: '1.0.0' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} }, // isto torna o servidor um channel
      tools: {},                              // e isto expõe as ferramentas
    },
    // Vai para o system prompt do Claude: como tratar os eventos e as regras da casa.
    instructions:
      `You are agent "${AGENT_NAME}" in a multi-agent chat. Messages from other agents ` +
      `arrive as <channel source="agent-rooms" room="..." from="..." depth="...">text</channel>. ` +
      `Rules: (1) Only take action when the message mentions you as @${AGENT_NAME} or clearly ` +
      `addresses you; otherwise just take note silently. (2) Reply by calling send_message with ` +
      `the same room from the tag. (3) Never reply to messages that don't ask for anything ` +
      `(acknowledgements, thanks, status notes) — courtesy replies between agents create loops. ` +
      `(4) If depth is high, wind the thread down unless there is a real reason to continue.`,
  },
)

// ---- freio 1: limite de envios por minuto
const sendTimes = []
function rateLimited() {
  const now = Date.now()
  while (sendTimes.length && now - sendTimes[0] > 60_000) sendTimes.shift()
  if (sendTimes.length >= RATE_LIMIT) return true
  sendTimes.push(now)
  return false
}

// ---- freio 2: profundidade de thread por sala
// Guarda a profundidade da última mensagem recebida em cada sala.
// Ao enviar, a mensagem nasce com profundidade+1; enviar "do zero" nasce com 0.
const lastIncomingDepth = new Map()

// ---------------------------------------------------------------- ferramentas
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'send_message',
      description:
        'Post a message to a room. All agents subscribed to that room receive it ' +
        'immediately. Mention an agent as @name to request action from it.',
      inputSchema: {
        type: 'object',
        properties: {
          room: { type: 'string', description: 'Room name, e.g. "general"' },
          text: { type: 'string', description: 'The message to post' },
        },
        required: ['room', 'text'],
      },
    },
    {
      name: 'read_history',
      description: 'Read the most recent messages of a room (useful for context on demand).',
      inputSchema: {
        type: 'object',
        properties: {
          room: { type: 'string', description: 'Room name' },
          count: { type: 'number', description: 'How many messages (default 20)' },
        },
        required: ['room'],
      },
    },
    {
      name: 'list_rooms',
      description: 'List all rooms that exist and which ones this agent is subscribed to.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const { name, arguments: args = {} } = req.params

  if (name === 'send_message') {
    const { room, text } = args
    assertValidRoom(room)
    if (typeof text !== 'string' || !text.trim()) throw new Error('text must be a non-empty string')
    if (rateLimited()) {
      return { content: [{ type: 'text', text: `Rate limit reached (${RATE_LIMIT}/min). Wait before sending again.` }], isError: true }
    }
    await fsp.mkdir(roomDir(room), { recursive: true }) // cria a sala se não existir
    watchRoom(room)                                     // e passa a escutá-la também
    const depth = (lastIncomingDepth.get(room) ?? -1) + 1
    lastIncomingDepth.delete(room) // enviou: a próxima iniciativa própria volta à profundidade 0
    await writeMessage(room, { from: AGENT_NAME, room, text, depth, ts: new Date().toISOString() })
    return { content: [{ type: 'text', text: `sent to #${room}` }] }
  }

  if (name === 'read_history') {
    const { room, count = 20 } = args
    assertValidRoom(room)
    let files
    try { files = await listMessageFiles(room) }
    catch { return { content: [{ type: 'text', text: `room "${room}" does not exist` }], isError: true } }
    const recent = files.slice(-Math.max(1, Math.min(200, count)))
    const lines = []
    for (const f of recent) {
      try { const m = await readMessage(room, f); lines.push(`[${m.ts}] ${m.from}: ${m.text}`) } catch {}
    }
    return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : `#${room} is empty` }] }
  }

  if (name === 'list_rooms') {
    let all = []
    try { all = (await fsp.readdir(ROOMS_DIR, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name) } catch {}
    const lines = all.map(r => `#${r}${MY_ROOMS.includes(r) || watched.has(r) ? ' (subscribed)' : ''}`)
    return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : 'no rooms yet' }] }
  }

  throw new Error(`unknown tool: ${name}`)
})

// ---------------------------------------------------------------- o ouvido (push)
// fs.watch usa notificação do próprio sistema (inotify no Linux): zero polling.
// Só reage a arquivos criados a partir de agora -> nenhum backlog é empurrado.
const watched = new Set()
const seen = new Set()

function watchRoom(room) {
  if (watched.has(room)) return
  watched.add(room)
  fs.watch(roomDir(room), (event, filename) => {
    if (!filename || !filename.endsWith('.json') || filename.startsWith('.')) return
    const key = `${room}/${filename}`
    if (seen.has(key)) return
    seen.add(key)
    deliver(room, filename).catch(err => console.error('agent-rooms deliver error:', err.message))
  })
}

async function deliver(room, filename) {
  // pequena espera + retry: cobre qualquer corrida rara entre rename e leitura
  let msg
  for (let i = 0; i < 3; i++) {
    try { msg = await readMessage(room, filename); break }
    catch { await new Promise(r => setTimeout(r, 30)) }
  }
  if (!msg) return
  if (msg.from === AGENT_NAME) return // sempre ignora as próprias mensagens

  const depth = Number(msg.depth) || 0
  lastIncomingDepth.set(room, depth)

  let content = msg.text
  if (depth >= MAX_THREAD_DEPTH) {
    content += `\n\n[agent-rooms notice: this thread is ${depth} replies deep — only continue if truly necessary]`
  }
  await mcp.notification({
    method: 'notifications/claude/channel',
    params: {
      content,
      // cada chave vira atributo da tag <channel>; só letras/dígitos/underscore
      meta: { room, from: msg.from, depth: String(depth) },
    },
  })
}

// ---------------------------------------------------------------- inicialização
await ensureDirs()
for (const r of MY_ROOMS) watchRoom(r)
await mcp.connect(new StdioServerTransport())
console.error(`agent-rooms: "${AGENT_NAME}" online, subscribed to: ${MY_ROOMS.join(', ')}`)
