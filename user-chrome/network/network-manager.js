const NetworkErrorCode = Object.freeze({
  DNS_FAILURE: 'DNS_FAILURE',
  TCP_TIMEOUT: 'TCP_TIMEOUT',
  CONNECTION_REFUSED: 'CONNECTION_REFUSED',
  CONNECTION_RESET: 'CONNECTION_RESET',
  TLS_HANDSHAKE_FAILED: 'TLS_HANDSHAKE_FAILED',
  CERTIFICATE_ERROR: 'CERTIFICATE_ERROR',
  PROXY_CONNECTION_FAILED: 'PROXY_CONNECTION_FAILED',
  PROXY_AUTH_REQUIRED: 'PROXY_AUTH_REQUIRED',
  HTTP_ERROR: 'HTTP_ERROR'
})

const DEFAULT_TIMEOUT_MS = 8000
const EVENT_LIMIT = 100

function normalizeProxyDomains(value) {
  const entries = Array.isArray(value) ? value : String(value || '').split(',')
  const domains = [...new Set(entries
    .map(domain => String(domain).trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean))]

  for (const domain of domains) {
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
      throw new Error(`Dominio de proxy invalido: ${domain}`)
    }
  }
  return domains
}

function domainMatches(host, domain) {
  const normalizedHost = String(host || '').trim().toLowerCase().replace(/\.$/, '')
  const normalizedDomain = String(domain || '').trim().toLowerCase().replace(/^\./, '').replace(/\.$/, '')
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`)
}

function createPacScript(config) {
  const endpoint = `${config.host}:${config.port}`
  const directive = config.mode === 'http' ? `PROXY ${endpoint}` : `SOCKS5 ${endpoint}`
  const conditions = config.proxyDomains.map(domain =>
    `host === ${JSON.stringify(domain)} || dnsDomainIs(host, ${JSON.stringify(`.${domain}`)})`
  ).join(' || ')

  return `function FindProxyForURL(url, host) {\n  host = host.toLowerCase();\n  if (${conditions}) return ${JSON.stringify(directive)};\n  return "DIRECT";\n}`
}

function normalizeConfig(input = {}) {
  const mode = input.mode || 'direct'
  if (!['direct', 'http', 'socks5'].includes(mode)) {
    throw new Error('Modo de conexao invalido.')
  }

  const timeoutMs = Number(input.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const retries = Number(input.retries ?? 0)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 120000) {
    throw new Error('Timeout deve estar entre 250 e 120000 ms.')
  }
  if (!Number.isInteger(retries) || retries < 0 || retries > 3) {
    throw new Error('Tentativas deve estar entre 0 e 3.')
  }

  const routing = input.routing || 'global'
  if (!['global', 'domain'].includes(routing)) {
    throw new Error('Estrategia de roteamento invalida.')
  }

  const config = { mode, routing, timeoutMs, retries, bypassRules: String(input.bypassRules || '') }
  if (mode === 'direct') return config

  const host = String(input.host || '').trim()
  const port = Number(input.port)
  if (!host || /[\s/:@]/.test(host)) throw new Error('Informe um host valido para o proxy.')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Informe uma porta valida para o proxy.')

  const proxyDomains = normalizeProxyDomains(input.proxyDomains)
  if (routing === 'domain' && proxyDomains.length === 0) {
    throw new Error('Informe ao menos um dominio para o roteamento por dominio.')
  }

  return {
    ...config,
    host,
    port,
    username: String(input.username || '').trim(),
    password: input.password === undefined ? undefined : String(input.password),
    proxyDomains
  }
}

function proxyOptions(config) {
  if (config.mode === 'direct') return { mode: 'direct' }
  if (config.routing === 'domain') {
    return {
      pacScript: `data:application/x-ns-proxy-autoconfig,${encodeURIComponent(createPacScript(config))}`
    }
  }
  const endpoint = `${config.host}:${config.port}`
  return {
    proxyRules: config.mode === 'http'
      ? `http=${endpoint};https=${endpoint}`
      : `socks5://${endpoint}`,
    proxyBypassRules: config.bypassRules
  }
}

class NetworkManager {
  constructor({ session, storage, secureStorage, diagnostics }) {
    if (!session) throw new Error('Uma sessao Electron e obrigatoria.')
    this.session = session
    this.storage = storage || new Map()
    this.secureStorage = secureStorage
    this.diagnostics = diagnostics
    this.config = normalizeConfig({ mode: 'direct' })
    this.password = undefined
    this.events = []
    this.attachSessionEvents()
  }

  attachSessionEvents() {
    const webRequest = this.session.webRequest
    if (!webRequest) return
    webRequest.onCompleted?.(details => this.recordRequestEvent('request-completed', details))
    webRequest.onErrorOccurred?.(details => this.recordRequestEvent('request-error', details))
  }

  async apply(input) {
    const config = normalizeConfig(input)
    const passwordWasProvided = Object.prototype.hasOwnProperty.call(input, 'password')
    const sameProxy = config.mode !== 'direct' && config.host === this.config.host &&
      config.port === this.config.port && config.username === this.config.username
    if (!passwordWasProvided && sameProxy) config.password = this.password
    this.password = config.password
    this.config = { ...config }
    await this.session.setProxy(proxyOptions(config))
    await this.session.closeAllConnections()
    this.persist()
    this.recordEvent({ type: 'configuration-applied', mode: config.mode, routing: config.routing, host: config.host, port: config.port, proxyDomains: config.proxyDomains })
    return this.getPublicState()
  }

  async restore() {
    const stored = this.storage.get('network-config')
    if (!stored) return this.getPublicState()
    let password
    if (stored.passwordEncrypted && this.secureStorage?.isEncryptionAvailable?.()) {
      password = this.secureStorage.decryptString(Buffer.from(stored.passwordEncrypted, 'base64'))
    }
    return this.apply({ ...stored, password })
  }

  persist() {
    const { password, ...persistable } = this.config
    if (password && this.secureStorage?.isEncryptionAvailable?.()) {
      persistable.passwordEncrypted = this.secureStorage.encryptString(password).toString('base64')
    }
    this.storage.set('network-config', persistable)
  }

  getPublicState() {
    const { password, ...config } = this.config
    return {
      config: { ...config, hasPassword: Boolean(password) },
      eventCount: this.events.length,
      events: this.events.slice(-25)
    }
  }

  getConfig() {
    return { ...this.config, password: this.password }
  }

  async diagnose(target) {
    if (!this.diagnostics) throw new Error('Diagnostico indisponivel.')
    const config = this.getConfigForTarget(target)
    this.recordEvent({ type: 'diagnostic-started', target, route: await this.resolveRoute(target) })
    const result = await this.diagnostics.run(target, config)
    this.recordEvent({ type: 'diagnostic-completed', target: result.target, ok: result.ok, route: await this.resolveRoute(target) })
    return result
  }

  getConfigForTarget(target) {
    if (this.config.routing !== 'domain' || this.isProxiedTarget(target)) return this.getConfig()
    return normalizeConfig({ mode: 'direct', timeoutMs: this.config.timeoutMs, retries: this.config.retries })
  }

  isProxiedTarget(target) {
    try {
      const host = new URL(target).hostname
      return this.config.routing === 'domain' && this.config.proxyDomains.some(domain => domainMatches(host, domain))
    } catch {
      return false
    }
  }

  async resolveRoute(target) {
    if (typeof this.session.resolveProxy === 'function') {
      try {
        return await this.session.resolveProxy(target)
      } catch (error) {
        return `UNRESOLVED: ${error.message}`
      }
    }
    if (this.config.mode === 'direct' || (this.config.routing === 'domain' && !this.isProxiedTarget(target))) return 'DIRECT'
    return this.config.mode === 'http' ? `PROXY ${this.config.host}:${this.config.port}` : `SOCKS5 ${this.config.host}:${this.config.port}`
  }

  async recordRequestEvent(type, details) {
    const route = await this.resolveRoute(details.url)
    this.recordEvent({
      type,
      url: details.url,
      statusCode: details.statusCode,
      error: details.error,
      route,
      transport: route === 'DIRECT' ? 'direct' : 'proxy'
    })
  }

  handleLogin(event, request, authInfo, callback) {
    if (!authInfo?.isProxy || !this.config.username || !this.password) return false
    const proxyHost = String(authInfo.host || request?.host || '')
    const proxyPort = authInfo.port === undefined ? this.config.port : Number(authInfo.port)
    if (proxyHost !== this.config.host || proxyPort !== this.config.port) return false
    event.preventDefault?.()
    callback(this.config.username, this.password)
    return true
  }

  recordEvent(event) {
    this.events.push({ timestamp: new Date().toISOString(), ...event })
    if (this.events.length > EVENT_LIMIT) this.events.splice(0, this.events.length - EVENT_LIMIT)
  }
}

module.exports = { NetworkManager, NetworkErrorCode, normalizeConfig, proxyOptions, createPacScript, domainMatches }
