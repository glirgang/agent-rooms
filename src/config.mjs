const VALID_ID = /^[a-zA-Z0-9_-]+$/

function loadConfig(env) {
  const agentName = env.AGENT_NAME
  if (!agentName || !VALID_ID.test(agentName)) {
    throw new Error('AGENT_NAME inválido (use letras, números, - e _)')
  }
  const myRooms = (env.AGENT_ROOMS || 'general')
    .split(',').map(s => s.trim()).filter(Boolean)
  return { agentName, myRooms, rateLimit: 10, maxThreadDepth: 8, validId: VALID_ID }
}

export { loadConfig }
