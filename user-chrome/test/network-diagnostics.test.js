const assert = require('node:assert/strict')
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')
const { EventEmitter } = require('node:events')
const test = require('node:test')

const { NetworkDiagnostics, classifyError, defaultHttpRequest } = require('../network/network-diagnostics')

test('classifica falhas de DNS, TCP, certificado e proxy sem inferir sucesso de protocolo', () => {
  assert.equal(classifyError({ code: 'ENOTFOUND' }), 'DNS_FAILURE')
  assert.equal(classifyError({ code: 'ECONNREFUSED' }), 'CONNECTION_REFUSED')
  assert.equal(classifyError({ code: 'ECONNRESET' }), 'CONNECTION_RESET')
  assert.equal(classifyError({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }, { tls: true }), 'CERTIFICATE_ERROR')
  assert.equal(classifyError({ statusCode: 407 }, { proxy: true }), 'PROXY_AUTH_REQUIRED')
})

test('usa o cliente HTTPS para a etapa HTTP/1.1 de uma URL segura', async () => {
  const originalRequest = https.request
  let wasCalled = false
  https.request = (_target, _options, callback) => {
    wasCalled = true
    const request = new EventEmitter()
    request.end = () => {
      const response = new EventEmitter()
      response.statusCode = 204
      response.resume = () => {}
      callback(response)
    }
    return request
  }
  try {
    const result = await defaultHttpRequest('https://origin.test/', 1000)
    assert.equal(result.statusCode, 204)
    assert.equal(wasCalled, true)
  } finally {
    https.request = originalRequest
  }
})

test('marca resposta HTTP de erro como HTTP_ERROR mesmo apos DNS e TCP bem sucedidos', async t => {
  const server = http.createServer((request, response) => {
    response.writeHead(503)
    response.end('indisponivel')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const { port } = server.address()
  const diagnostics = new NetworkDiagnostics({ http2Probe: async () => ({ available: false, detail: 'not-supported' }) })

  const result = await diagnostics.run(`http://127.0.0.1:${port}/status`, { timeoutMs: 1000 })

  assert.equal(result.ok, false)
  assert.equal(result.stages.find(stage => stage.name === 'dns').ok, true)
  assert.equal(result.stages.find(stage => stage.name === 'tcp').ok, true)
  assert.deepEqual(result.stages.find(stage => stage.name === 'http1'), {
    name: 'http1', ok: false, code: 'HTTP_ERROR', detail: 'HTTP 503', statusCode: 503
  })
})

test('identifica falha TLS de certificado na etapa TLS', async () => {
  const diagnostics = new NetworkDiagnostics({
    lookup: async () => ({ address: '127.0.0.1' }),
    tcpConnect: async () => ({ destroy() {} }),
    tlsConnect: async () => { const error = new Error('self signed'); error.code = 'DEPTH_ZERO_SELF_SIGNED_CERT'; throw error }
  })

  const result = await diagnostics.run('https://example.test', { timeoutMs: 1000 })

  assert.equal(result.ok, false)
  assert.deepEqual(result.stages.at(-1), {
    name: 'tls', ok: false, code: 'CERTIFICATE_ERROR', detail: 'self signed'
  })
})

test('diagnostica endpoint SOCKS5 autorizado como etapa de proxy', async () => {
  const calls = []
  const diagnostics = new NetworkDiagnostics({
    lookup: async host => ({ address: host === 'tunnel.test' ? '127.0.0.1' : '127.0.0.2' }),
    tcpConnect: async options => { calls.push(options); return { destroy() {} } },
    socks5Handshake: async () => ({ destroy() {} }),
    chromiumFetch: async () => ({ status: 204 }),
    http2Probe: async () => ({ available: false, detail: 'not-supported' })
  })

  const result = await diagnostics.run('http://origin.test/health', {
    mode: 'socks5', host: 'tunnel.test', port: 1080, timeoutMs: 1000
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls[0], { host: '127.0.0.1', port: 1080, timeoutMs: 1000 })
  assert.equal(result.stages.find(stage => stage.name === 'proxy').ok, true)
})

test('nao declara HTTP funcional por proxy quando o transporte Chromium nao esta disponivel', async () => {
  const diagnostics = new NetworkDiagnostics({
    lookup: async () => ({ address: '127.0.0.1' }),
    tcpConnect: async () => ({ destroy() {} }),
    socks5Handshake: async () => ({ destroy() {} }),
    httpRequest: async () => ({ statusCode: 204 })
  })

  const result = await diagnostics.run('http://origin.test', { mode: 'socks5', host: 'tunnel.test', port: 1080, timeoutMs: 1000 })

  assert.equal(result.ok, false)
  assert.deepEqual(result.stages.at(-1), {
    name: 'http1', ok: false, code: 'PROXY_CONNECTION_FAILED',
    detail: 'Nao foi possivel verificar HTTP pelo proxy sem a sessao Chromium.'
  })
})

test('negocia CONNECT com proxy HTTP antes de declarar o tunel utilizavel', async t => {
  let received = ''
  const server = net.createServer(socket => {
    socket.once('data', data => {
      received = data.toString()
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const socket = await new Promise((resolve, reject) => {
    const connection = net.createConnection(server.address().port, '127.0.0.1')
    connection.once('connect', () => resolve(connection))
    connection.once('error', reject)
  })

  const result = await new NetworkDiagnostics().httpProxyHandshake(socket, new URL('https://origin.test/path'), 1000)

  assert.equal(result, socket)
  assert.match(received, /^CONNECT origin\.test:443 HTTP\/1\.1\r\nHost: origin\.test:443/m)
  socket.destroy()
})

test('envia credencial HTTP ao validar o tunel CONNECT', async t => {
  let received = ''
  const server = net.createServer(socket => {
    socket.once('data', data => {
      received = data.toString()
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const socket = await new Promise((resolve, reject) => {
    const connection = net.createConnection(server.address().port, '127.0.0.1')
    connection.once('connect', () => resolve(connection))
    connection.once('error', reject)
  })

  await new NetworkDiagnostics().httpProxyHandshake(socket, new URL('https://origin.test/'), 1000, { username: 'ana', password: 'segredo' })

  assert.match(received, /Proxy-Authorization: Basic YW5hOnNlZ3JlZG8=/)
  socket.destroy()
})

test('negocia SOCKS5 CONNECT com o destino autorizado', async t => {
  const frames = []
  let phase = 0
  const server = net.createServer(socket => {
    socket.on('data', data => {
      frames.push(data)
      if (phase++ === 0) socket.write(Buffer.from([5, 0]))
      else socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const socket = await new Promise((resolve, reject) => {
    const connection = net.createConnection(server.address().port, '127.0.0.1')
    connection.once('connect', () => resolve(connection))
    connection.once('error', reject)
  })

  await new NetworkDiagnostics().socks5Handshake(socket, new URL('http://origin.test/'), 1000)

  assert.deepEqual([...frames[0]], [5, 1, 0])
  assert.equal(frames[1][0], 5)
  assert.equal(frames[1][1], 1)
  socket.destroy()
})

test('negocia autenticacao SOCKS5 antes do CONNECT', async t => {
  const frames = []
  let phase = 0
  const server = net.createServer(socket => {
    socket.on('data', data => {
      frames.push(data)
      if (phase++ === 0) socket.write(Buffer.from([5, 2]))
      else if (phase === 2) socket.write(Buffer.from([1, 0]))
      else socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const socket = await new Promise((resolve, reject) => {
    const connection = net.createConnection(server.address().port, '127.0.0.1')
    connection.once('connect', () => resolve(connection))
    connection.once('error', reject)
  })

  await new NetworkDiagnostics().socks5Handshake(socket, new URL('http://origin.test/'), 1000, { username: 'ana', password: 'segredo' })

  assert.deepEqual([...frames[0]], [5, 2, 0, 2])
  assert.equal(frames[1].toString('hex'), '0103616e61077365677265646f')
  socket.destroy()
})
