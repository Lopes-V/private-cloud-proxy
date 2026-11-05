// Private Cloud Proxy edition: preserve the browser, lock only its network route.
const { NetworkManager, normalizeConfig } = require('./network-manager')

function bridgePort(value = 17831) {
  if (!/^\d+$/.test(String(value))) throw new Error('Porta local do proxy invalida.')
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Porta local do proxy invalida.')
  return port
}
function httpTarget(value) {
  let target
  try { target = new URL(value) } catch { throw new Error('Informe uma URL HTTP ou HTTPS valida.') }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Informe uma URL HTTP ou HTTPS sem credenciais.')
  return target
}
function originOnly(value) {
  try { return new URL(value).origin } catch { return 'invalid-origin' }
}
function networkCode(value) {
  return String(value || '').match(/(?:net::)?(ERR_[A-Z0-9_]+)/)?.[1] || 'NETWORK_ERROR'
}

class PrivateCloudNetworkManager extends NetworkManager {
  constructor(options) {
    super(options)
    this.port = bridgePort(options.port)
    this.config = normalizeConfig({ mode: 'http', host: '127.0.0.1', port: this.port, routing: 'global', bypassRules: '<-loopback>' })
    this.managedReady = false
    this.initializing = null
  }
  async restore() {
    if (this.managedReady) return this.getPublicState()
    if (this.initializing) return this.initializing
    const operation = (async () => {
      await this.session.setProxy({ mode: 'fixed_servers', proxyRules: `http=127.0.0.1:${this.port};https=127.0.0.1:${this.port}`, proxyBypassRules: '<-loopback>' })
      await this.session.closeAllConnections()
      this.managedReady = true
      this.recordEvent({ type: 'private-proxy-ready', route: `PROXY 127.0.0.1:${this.port}` })
      return this.getPublicState()
    })()
    this.initializing = operation
    try { return await operation } finally { this.initializing = null }
  }
  async apply() {
    throw new Error('A conexao e gerenciada pelo Private Cloud Proxy. Use o iniciador para conectar.')
  }
  getPublicState() { return { ...super.getPublicState(), managed: true } }
  async recordRequestEvent(type, details) {
    const url = originOnly(details.url)
    this.recordEvent({ type, url, statusCode: details.statusCode, error: details.error ? networkCode(details.error) : undefined, route: await this.resolveRoute(url), transport: 'proxy' })
  }
  async diagnose(target) {
    if (!this.managedReady) throw new Error('A conexao gerenciada ainda nao esta pronta.')
    const url = httpTarget(target)
    this.recordEvent({ type: 'diagnostic-started', target: url.origin })
    const result = await this.diagnostics.run(url.href, this.getConfig())
    this.recordEvent({ type: 'diagnostic-completed', target: url.origin, ok: result.ok, route: await this.resolveRoute(url.origin) })
    return result
  }
}

class PrivateCloudDiagnostics {
  constructor({ chromiumFetch }) {
    if (typeof chromiumFetch !== 'function') throw new Error('A sessao Chromium e obrigatoria para o diagnostico.')
    this.chromiumFetch = chromiumFetch
  }
  async run(target, config = {}) {
    const url = httpTarget(target)
    const timeoutMs = Number(config.timeoutMs || 8000)
    if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 120000) throw new Error('Timeout de diagnostico invalido.')
    const stages = [{ name: 'proxy', ok: true, detail: 'Diagnostico pela mesma sessao gerenciada do navegador.' }]
    try {
      const response = await this.chromiumFetch(url.href, timeoutMs)
      const status = response.status
      try { await response.body?.cancel() } catch { /* No navigation contents are read or retained. */ }
      const ok = Number.isInteger(status) && status >= 200 && status < 400
      stages.push({ name: 'http', ok, ...(ok ? {} : { code: 'HTTP_ERROR' }), detail: Number.isInteger(status) ? `HTTP ${status}` : 'Resposta HTTP invalida.' })
      return { target: url.origin, ok, stages }
    } catch (error) {
      const code = networkCode(error.code || error.message)
      stages.push({ name: 'http', ok: false, code: /CERT/.test(code) ? 'CERTIFICATE_ERROR' : 'PROXY_CONNECTION_FAILED', detail: 'Falha na conexao pela sessao gerenciada. Verifique se o cliente do proxy esta ativo.' })
      return { target: url.origin, ok: false, stages }
    }
  }
}
module.exports = { PrivateCloudNetworkManager, PrivateCloudDiagnostics, bridgePort }
