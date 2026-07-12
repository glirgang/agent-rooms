// Teste: sobe dois agentes (alfa e beta), alfa envia em #general,
// beta deve receber a notificação de channel na hora.
import { spawn } from 'node:child_process'

function startAgent(name) {
  const proc = spawn('node', ['server.ts'], {
    env: { ...process.env, AGENT_NAME: name, AGENT_ROOMS: 'general', AGENT_ROOMS_DIR: '/tmp/agent-rooms-test' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const pending = new Map()
  const notifications = []
  let buf = ''
  proc.stdout.on('data', d => {
    buf += d.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      if (!line.trim()) continue
      const msg = JSON.parse(line)
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
      else if (msg.method) notifications.push(msg)
    }
  })
  proc.stderr.on('data', d => console.log(`  [${name} stderr] ${d.toString().trim()}`))
  let nextId = 1
  const call = (method, params) => new Promise(res => {
    const id = nextId++
    pending.set(id, res)
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  const notify = (method, params) =>
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  return { proc, call, notify, notifications, name }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const initParams = { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } }

console.log('1. subindo agentes alfa e beta...')
const alfa = startAgent('alfa')
const beta = startAgent('beta')
await sleep(300)

const initA = await alfa.call('initialize', initParams)
await beta.call('initialize', initParams)
alfa.notify('notifications/initialized', {})
beta.notify('notifications/initialized', {})
console.log('   capability channel declarada?',
  JSON.stringify(initA.result.capabilities.experimental))
console.log('   instructions presente?', typeof initA.result.instructions === 'string' ? 'sim' : 'NAO')

console.log('2. listando ferramentas do alfa...')
const tools = await alfa.call('tools/list', {})
console.log('   tools:', tools.result.tools.map(t => t.name).join(', '))

console.log('3. alfa envia mensagem em #general...')
const send = await alfa.call('tools/call', { name: 'send_message', arguments: { room: 'general', text: '@beta preciso que voce rode os testes' } })
console.log('   resposta:', send.result.content[0].text)

await sleep(500)
console.log('4. beta recebeu push?')
const pushB = beta.notifications.filter(n => n.method === 'notifications/claude/channel')
console.log('   notificacoes no beta:', pushB.length)
if (pushB.length) console.log('   payload:', JSON.stringify(pushB[0].params))

console.log('5. alfa NAO deve receber a propria mensagem...')
const pushA = alfa.notifications.filter(n => n.method === 'notifications/claude/channel')
console.log('   notificacoes no alfa:', pushA.length, pushA.length === 0 ? '(correto)' : '(ERRO!)')

console.log('6. beta responde; profundidade deve ser 1...')
await beta.call('tools/call', { name: 'send_message', arguments: { room: 'general', text: 'feito @alfa, testes passaram' } })
await sleep(500)
const pushA2 = alfa.notifications.filter(n => n.method === 'notifications/claude/channel')
console.log('   alfa recebeu:', pushA2.length ? JSON.stringify(pushA2[0].params.meta) : 'NADA (ERRO)')

console.log('7. historico...')
const hist = await beta.call('tools/call', { name: 'read_history', arguments: { room: 'general' } })
console.log(hist.result.content[0].text.split('\n').map(l => '   ' + l).join('\n'))

console.log('8. rate limit (mandando 12 seguidas)...')
let blocked = 0
for (let i = 0; i < 12; i++) {
  const r = await alfa.call('tools/call', { name: 'send_message', arguments: { room: 'general', text: `spam ${i}` } })
  if (r.result.isError) blocked++
}
console.log(`   bloqueadas: ${blocked} (esperado: >= 3, pois ja tinha enviado antes)`)

alfa.proc.kill(); beta.proc.kill()
console.log('\nTESTE CONCLUIDO')
