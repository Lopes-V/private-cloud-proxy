const form = document.querySelector('#network-form')
const status = document.querySelector('#connection-status')
const history = document.querySelector('#event-history')
const output = document.querySelector('#diagnostic-output')
let managed = false

function render(state) {
  const { config, events } = state
  managed = state.managed === true
  for (const field of form.elements) field.disabled = managed
  for (const [key, value] of Object.entries(config)) {
    const field = form.elements.namedItem(key)
    if (field && key !== 'hasPassword') field.value = value ?? ''
  }
  status.textContent = config.mode === 'direct' ? 'Conexão direta ativa.' : `Proxy ${config.mode} ativo em ${config.host}:${config.port}.`
  if (config.mode !== 'direct' && config.routing === 'domain') {
    status.textContent = `Proxy ${config.mode} exclusivo para: ${(config.proxyDomains || []).join(', ')}.`
  }
  if (managed) form.querySelector('p').textContent = 'A configuracao desta edicao e gerenciada pelo Private Cloud Proxy. Toda a navegacao usa o tunel.'
  if (managed) status.textContent = 'Conexao gerenciada pelo Private Cloud Proxy. Use o iniciador para conectar; sem o tunel, a navegacao e interrompida.'
  history.replaceChildren(...events.slice().reverse().map(event => {
    const item = document.createElement('li')
    item.textContent = `${event.timestamp} — ${event.type}${event.error ? `: ${event.error}` : ''}`
    if (event.route) item.textContent += ` [${event.route}]`
    return item
  }))
}

function getConfig() {
  const config = Object.fromEntries(new FormData(form))
  if (config.clearPassword === 'on') config.password = ''
  else if (!config.password) delete config.password
  delete config.clearPassword
  config.port = Number(config.port)
  config.timeoutMs = Number(config.timeoutMs)
  config.retries = Number(config.retries)
  return config
}

form.addEventListener('submit', async event => {
  event.preventDefault()
  if (managed) return
  const config = getConfig()
  try {
    render(await window.networkSettings.apply(config))
  } catch (error) {
    status.textContent = `Erro de configuração: ${error.message}`
  }
})

window.addEventListener('pagehide', () => { if (!managed) window.networkSettings.saveOnClose(getConfig()) })

document.querySelector('#diagnostic-form').addEventListener('submit', async event => {
  event.preventDefault()
  output.textContent = 'Executando diagnóstico…'
  try {
    const result = await window.networkSettings.diagnose(new FormData(event.currentTarget).get('target'))
    output.textContent = result.stages.map(stage => `${stage.name}: ${stage.ok ? 'OK' : stage.code} — ${stage.detail}`).join('\n')
    render(await window.networkSettings.getState())
  } catch (error) {
    output.textContent = `Falha ao iniciar diagnóstico: ${error.message}`
  }
})

window.networkSettings.getState().then(render).catch(error => { status.textContent = `Erro: ${error.message}` })
