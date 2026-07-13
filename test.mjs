import { spawn } from 'node:child_process'

function startAgent(label) {
  const proc = spawn('node', ['server.ts'], {
    env: { ...process.env, AGENT_ROOMS_DIR: '/tmp/agent-rooms-test' },
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
  proc.stderr.on('data', d => console.log(`  [${label} stderr] ${d.toString().trim()}`))
  let nextId = 1
  const call = (method, params) => new Promise(res => {
    const id = nextId++
    pending.set(id, res)
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  const notify = (method, params) => proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  const tool = (name, args = {}) => call('tools/call', { name, arguments: args }).then(r => r.result)
  return { proc, call, notify, tool, notifications, label }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const initParams = { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } }
const pushes = a => a.notifications.filter(n => n.method === 'notifications/claude/channel')

console.log('1. subindo alfa e beta (sem nome no env)...')
const alfa = startAgent('alfa')
const beta = startAgent('beta')
await sleep(300)
const initA = await alfa.call('initialize', initParams); alfa.notify('notifications/initialized', {})
await beta.call('initialize', initParams); beta.notify('notifications/initialized', {})
console.log('   channel declarado?', JSON.stringify(initA.result.capabilities.experimental))

console.log('2. tools disponiveis...')
const tools = await alfa.call('tools/list', {})
console.log('   ', tools.result.tools.map(t => t.name).join(', '))

console.log('3. enviar SEM registrar deve falhar...')
const noReg = await alfa.tool('send_message', { room: 'general', text: 'oi' })
console.log('   bloqueado?', noReg.isError === true ? 'SIM (correto)' : 'NAO (ERRO)')

console.log('4. registrar alfa e beta + entrar em #general...')
console.log('   ', (await alfa.tool('register_name', { name: 'alfa' })).content[0].text.slice(0, 55), '...')
await alfa.tool('join_room', { room: 'general' })
await beta.tool('register_name', { name: 'beta' })
await beta.tool('join_room', { room: 'general' })

console.log('5. alfa envia, beta recebe push...')
await alfa.tool('send_message', { room: 'general', text: '@beta roda os testes' })
await sleep(400)
const pB = pushes(beta)
console.log('   beta recebeu:', pB.length, pB.length ? JSON.stringify(pB[0].params.meta) : '(NADA)')

console.log('6. alfa NAO recebe a propria...')
console.log('   alfa notifs:', pushes(alfa).length, pushes(alfa).length === 0 ? '(correto)' : '(ERRO)')

console.log('7. beta responde, depth deve ser 1...')
await beta.tool('send_message', { room: 'general', text: 'feito @alfa' })
await sleep(400)
const pA = pushes(alfa)
console.log('   alfa recebeu:', pA.length ? JSON.stringify(pA[0].params.meta) : '(NADA)')

console.log('8. duplicata: gamma tenta registrar "alfa" (viva)...')
const gamma = startAgent('gamma')
await sleep(200)
await gamma.call('initialize', initParams); gamma.notify('notifications/initialized', {})
const dup = await gamma.tool('register_name', { name: 'alfa' })
console.log('   bloqueado?', dup.isError === true ? 'SIM (correto)' : 'NAO (ERRO)', '—', dup.content[0].text)

console.log('9. list_agents...')
const agents = await alfa.tool('list_agents')
console.log(agents.content[0].text.split('\n').map(l => '   ' + l).join('\n'))

console.log('10. leave_room: beta sai, nao recebe mais...')
await beta.tool('leave_room', { room: 'general' })
await sleep(100)
const before = beta.notifications.length
await alfa.tool('send_message', { room: 'general', text: 'ainda ai @beta?' })
await sleep(400)
console.log('   beta recebeu apos sair?', beta.notifications.length === before ? 'NAO (correto)' : 'SIM (ERRO)')

console.log('11. clear_room + read_history...')
await alfa.tool('clear_room', { room: 'general' })
const hist = await alfa.tool('read_history', { room: 'general' })
console.log('   historico apos clear:', JSON.stringify(hist.content[0].text))

alfa.proc.kill(); beta.proc.kill(); gamma.proc.kill()
console.log('\nTESTE CONCLUIDO')
