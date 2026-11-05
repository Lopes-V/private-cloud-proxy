const dns = require('node:dns/promises')
const http = require('node:http')
const http2 = require('node:http2')
const https = require('node:https')
const net = require('node:net')
const tls = require('node:tls')

const CERTIFICATE_CODES = new Set([
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
])

function classifyError(error = {}, options = {}) {
  if (options.proxy && (error.statusCode === 407 || error.code === 'PROXY_AUTH_REQUIRED')) return 'PROXY_AUTH_REQUIRED'
  if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN' || error.code === 'ENODATA') return 'DNS_FAILURE'
  if (error.code === 'ETIMEDOUT' || error.code === 'ERR_SOCKET_TIMEOUT') return options.proxy ? 'PROXY_CONNECTION_FAILED' : 'TCP_TIMEOUT'
  if (error.code === 'ECONNREFUSED') return options.proxy ? 'PROXY_CONNECTION_FAILED' : 'CONNECTION_REFUSED'
  if (error.code === 'ECONNRESET' || error.code === 'EPIPE') return 'CONNECTION_RESET'
  if (options.tls && CERTIFICATE_CODES.has(error.code)) return 'CERTIFICATE_ERROR'
  if (options.tls) return 'TLS_HANDSHAKE_FAILED'
  if (options.proxy) return 'PROXY_CONNECTION_FAILED'
  return 'HTTP_ERROR'
}

function withTimeout(connect, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = connect()
    const timer = setTimeout(() => {
      const error = new Error('Tempo de conexao excedido.')
      error.code = 'ETIMEDOUT'
      socket.destroy(error)
    }, timeoutMs)
    socket.once('connect', () => { clearTimeout(timer); resolve(socket) })
    socket.once('secureConnect', () => { clearTimeout(timer); resolve(socket) })
    socket.once('error', error => { clearTimeout(timer); reject(error) })
  })
}

function defaultTcpConnect({ host, port, timeoutMs }) {
  return withTimeout(() => net.createConnection({ host, port }), timeoutMs)
}

function defaultTlsConnect({ host, port, socket, timeoutMs }) {
  return withTimeout(() => tls.connect({ host, port, socket, servername: host, rejectUnauthorized: true }), timeoutMs)
}

function defaultHttpRequest(target, timeoutMs) {
  return new Promise((resolve, reject) => {
    const client = new URL(target).protocol === 'https:' ? https : http
    const request = client.request(target, { method: 'GET', timeout: timeoutMs }, response => {
      response.resume()
      resolve({ statusCode: response.statusCode })
    })
    request.once('timeout', () => {
      const error = new Error('Tempo HTTP excedido.')
      error.code = 'ETIMEDOUT'
      request.destroy(error)
    })
    request.once('error', reject)
    request.end()
  })
}

function defaultHttp2Probe(target, timeoutMs) {
  return new Promise(resolve => {
    if (!target.startsWith('https:')) return resolve({ available: false, detail: 'HTTP/2 exige HTTPS neste diagnostico.' })
    const client = http2.connect(new URL(target).origin, { rejectUnauthorized: true })
    const timer = setTimeout(() => {
      client.destroy()
      resolve({ available: false, detail: 'HTTP/2 indisponivel ou excedeu o tempo.' })
    }, timeoutMs)
    client.once('connect', () => {
      clearTimeout(timer)
      client.close()
      resolve({ available: true, detail: 'Sessao HTTP/2 negociada.' })
    })
    client.once('error', error => {
      clearTimeout(timer)
      resolve({ available: false, detail: error.message })
    })
  })
}

function readSocketData(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      const error = new Error('Tempo de resposta do proxy excedido.')
      error.code = 'ETIMEDOUT'
      reject(error)
    }, timeoutMs)
    const onData = data => { cleanup(); resolve(data) }
    const onError = error => { cleanup(); reject(error) }
    const cleanup = () => {
      clearTimeout(timer)
      socket.removeListener('data', onData)
      socket.removeListener('error', onError)
    }
    socket.once('data', onData)
    socket.once('error', onError)
  })
}

async function defaultHttpProxyHandshake(socket, target, timeoutMs, credentials = {}) {
  const authority = `${target.hostname}:${target.port || (target.protocol === 'https:' ? 443 : 80)}`
  const authorization = credentials.username
    ? `Proxy-Authorization: Basic ${Buffer.from(`${credentials.username}:${credentials.password || ''}`).toString('base64')}\r\n`
    : ''
  socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${authorization}Connection: keep-alive\r\n\r\n`)
  const response = (await readSocketData(socket, timeoutMs)).toString('latin1')
  const match = response.match(/^HTTP\/1\.[01] (\d{3})/)
  const statusCode = Number(match?.[1])
  if (statusCode !== 200) {
    const error = new Error(match ? `Proxy CONNECT respondeu ${statusCode}.` : 'Resposta CONNECT invalida do proxy.')
    error.statusCode = statusCode
    error.code = statusCode === 407 ? 'PROXY_AUTH_REQUIRED' : 'PROXY_CONNECT_FAILED'
    throw error
  }
  return socket
}

async function defaultSocks5Handshake(socket, target, timeoutMs, credentials = {}) {
  const username = String(credentials.username || '')
  const password = String(credentials.password || '')
  const usesCredentials = Boolean(username)
  socket.write(Buffer.from(usesCredentials ? [5, 2, 0, 2] : [5, 1, 0]))
  const greeting = await readSocketData(socket, timeoutMs)
  if (greeting[0] !== 5 || ![0, 2].includes(greeting[1])) {
    const error = new Error('O proxy SOCKS5 recusou autenticacao.')
    error.code = 'PROXY_AUTH_REQUIRED'
    throw error
  }
  if (greeting[1] === 2) {
    if (!usesCredentials || Buffer.byteLength(username) > 255 || Buffer.byteLength(password) > 255) {
      const error = new Error('O proxy SOCKS5 exige credenciais validas.')
      error.code = 'PROXY_AUTH_REQUIRED'
      throw error
    }
    const user = Buffer.from(username, 'utf8')
    const pass = Buffer.from(password, 'utf8')
    socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]))
    const authentication = await readSocketData(socket, timeoutMs)
    if (authentication[0] !== 1 || authentication[1] !== 0) {
      const error = new Error('O proxy SOCKS5 recusou usuario ou senha.')
      error.code = 'PROXY_AUTH_REQUIRED'
      throw error
    }
  }
  const host = Buffer.from(target.hostname, 'utf8')
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80))
  const request = Buffer.alloc(7 + host.length)
  request.set([5, 1, 0, 3, host.length], 0)
  host.copy(request, 5)
  request.writeUInt16BE(port, 5 + host.length)
  socket.write(request)
  const response = await readSocketData(socket, timeoutMs)
  if (response[0] !== 5 || response[1] !== 0) {
    const error = new Error(`O proxy SOCKS5 recusou o destino (codigo ${response[1]}).`)
    error.code = 'PROXY_CONNECT_FAILED'
    throw error
  }
  return socket
}

class NetworkDiagnostics {
  constructor(adapters = {}) {
    this.lookup = adapters.lookup || (host => dns.lookup(host))
    this.tcpConnect = adapters.tcpConnect || defaultTcpConnect
    this.tlsConnect = adapters.tlsConnect || defaultTlsConnect
    this.httpRequest = adapters.httpRequest || defaultHttpRequest
    this.http2Probe = adapters.http2Probe || defaultHttp2Probe
    this.socks5Handshake = adapters.socks5Handshake || defaultSocks5Handshake
    this.httpProxyHandshake = adapters.httpProxyHandshake || defaultHttpProxyHandshake
    this.chromiumFetch = adapters.chromiumFetch
    this.http3Probe = adapters.http3Probe || (async () => ({ available: false, detail: 'Electron nao expoe etapas do handshake QUIC/HTTP/3.' }))
  }

  async run(target, config = {}) {
    const url = new URL(target)
    const timeoutMs = Number(config.timeoutMs || 8000)
    const stages = []
    const add = stage => { stages.push(stage); return stage }
    const proxy = config.mode === 'http' || config.mode === 'socks5'

    let address
    try {
      address = await this.lookup(proxy ? config.host : url.hostname)
      add({ name: 'dns', ok: true, detail: address.address })
    } catch (error) {
      add({ name: 'dns', ok: false, code: classifyError(error), detail: error.message })
      return { target, ok: false, stages }
    }

    let socket
    try {
      socket = await this.tcpConnect({
        host: address.address,
        port: proxy ? config.port : Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
        timeoutMs
      })
      add({ name: proxy ? 'proxy' : 'tcp', ok: true, detail: proxy ? `${config.mode} endpoint alcançado.` : 'TCP estabelecido.' })
    } catch (error) {
      add({ name: proxy ? 'proxy' : 'tcp', ok: false, code: classifyError(error, { proxy }), detail: error.message })
      return { target, ok: false, stages }
    }

    if (proxy) {
      try {
        socket = config.mode === 'socks5'
          ? await this.socks5Handshake(socket, url, timeoutMs, config)
          : await this.httpProxyHandshake(socket, url, timeoutMs, config)
      } catch (error) {
        add({ name: 'proxy-handshake', ok: false, code: classifyError(error, { proxy: true }), detail: error.message })
        return { target, ok: false, stages }
      }
    }

    if (url.protocol === 'https:') {
      try {
        const tlsSocket = await this.tlsConnect({ host: url.hostname, port: Number(url.port || 443), socket: proxy ? socket : undefined, timeoutMs })
        tlsSocket.destroy?.()
        add({ name: 'tls', ok: true, detail: 'TLS validado.' })
      } catch (error) {
        socket.destroy?.()
        add({ name: 'tls', ok: false, code: classifyError(error, { tls: true }), detail: error.message })
        return { target, ok: false, stages }
      }
    }
    socket.destroy?.()

    if (proxy && !this.chromiumFetch) {
      add({
        name: 'http1', ok: false, code: 'PROXY_CONNECTION_FAILED',
        detail: 'Nao foi possivel verificar HTTP pelo proxy sem a sessao Chromium.'
      })
      return { target, ok: false, stages }
    }

    try {
      const response = proxy && this.chromiumFetch
        ? await this.chromiumFetch(target, timeoutMs)
        : await this.httpRequest(target, timeoutMs)
      const statusCode = response.status || response.statusCode
      if (statusCode >= 400) {
        add({ name: 'http1', ok: false, code: 'HTTP_ERROR', detail: `HTTP ${statusCode}`, statusCode })
        return { target, ok: false, stages }
      }
      add({ name: 'http1', ok: true, detail: `HTTP ${statusCode}`, statusCode })
    } catch (error) {
      add({ name: 'http1', ok: false, code: classifyError(error, { proxy }), detail: error.message })
      return { target, ok: false, stages }
    }

    const http2 = await this.http2Probe(target, timeoutMs)
    add({ name: 'http2', ok: Boolean(http2.available), detail: http2.detail })
    const http3 = await this.http3Probe(target, timeoutMs)
    add({ name: 'http3', ok: Boolean(http3.available), detail: http3.detail })
    return { target, ok: true, stages }
  }
}

module.exports = { NetworkDiagnostics, classifyError, defaultHttpRequest }
