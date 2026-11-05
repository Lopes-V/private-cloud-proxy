// Native Windows smoke: runs as the main entry of a temporary test-only ASAR.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const { app } = require('electron')

assert.ok(process.env.PCP_SMOKE_PROFILE, 'The smoke launcher must supply an isolated profile')
assert.ok(process.env.PCP_SMOKE_REPORT, 'The smoke launcher must supply a result path')
assert.equal(Object.keys(process.env).some(name => name.toUpperCase() === 'TUNNEL_TOKEN'), false, 'Tunnel credentials must never reach Electron')
fs.mkdirSync(process.env.PCP_SMOKE_PROFILE, { recursive: true })
app.setPath('userData', process.env.PCP_SMOKE_PROFILE)
let originHits = 0
const proxyRequests = []
const connectAuthorities = []
const sockets = new Set()
const origin = http.createServer((_request, response) => {
  originHits++
  response.end('DIRECT_ORIGIN_MUST_NOT_BE_REACHED')
})
const proxy = http.createServer((request, response) => {
  proxyRequests.push(request.url)
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' })
  response.end('<!doctype html><title>Private proxy smoke</title><body>PROXIED</body>')
})
proxy.on('connection', socket => {
  sockets.add(socket)
  socket.on('close', () => sockets.delete(socket))
})
proxy.on('connect', (request, socket, head) => {
  if (request.url !== 'example.com:443') {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    return
  }
  connectAuthorities.push(request.url)
  // Forward encrypted bytes only: Chromium validates the real site's certificate.
  const upstream = net.connect({ host: 'example.com', port: 443 })
  sockets.add(upstream)
  upstream.setTimeout(30000, () => upstream.destroy())
  upstream.on('error', () => socket.destroy())
  upstream.on('close', () => { sockets.delete(upstream); socket.destroy() })
  socket.on('error', () => upstream.destroy())
  socket.on('close', () => upstream.destroy())
  upstream.once('connect', () => {
    if (socket.destroyed) { upstream.destroy(); return }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length) upstream.write(head)
    socket.pipe(upstream)
    upstream.pipe(socket)
  })
})
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const close = server => new Promise(resolve => server.close(resolve))
async function waitFor(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 60))
  }
  throw new Error(`Timed out: ${label}`)
}

async function smoke() {
  await Promise.all([listen(origin), listen(proxy)])
  process.env.PCP_PROXY_PORT = String(proxy.address().port)
  const target = `http://127.0.0.1:${origin.address().port}`
  const window = await require('../main.js').ready
  const run = code => window.webContents.executeJavaScript(code, true)
  await waitFor(() => run('Boolean(window.browserShell && document.querySelector("#tabs button"))'), 'browser shell/preload')

  await run(`window.browserShell.navigate(${JSON.stringify(target + '/proxied')})`)
  await waitFor(async () => {
    const view = window.getBrowserView()
    return Boolean(view && !view.webContents.isLoading() && await view.webContents.executeJavaScript('document.body.textContent === "PROXIED"'))
  }, 'BrowserView receives the proxy response')
  assert.ok(proxyRequests.includes(target + '/proxied'), 'The native session must send the absolute loopback URL to the proxy')
  assert.equal(originHits, 0, 'Loopback must not bypass the proxy')
  assert.equal(await window.getBrowserView().webContents.executeJavaScript('typeof require'), 'undefined')

  await run('window.browserShell.navigate("https://example.com/")')
  await waitFor(() => {
    const view = window.getBrowserView()
    return Boolean(view && !view.webContents.isLoading() && view.webContents.getTitle() === 'Example Domain')
  }, 'real HTTPS page through CONNECT with Chromium certificate verification', 30000)
  assert.ok(connectAuthorities.includes('example.com:443'), 'HTTPS must use the local proxy CONNECT tunnel')
  assert.equal(await window.getBrowserView().webContents.executeJavaScript('location.origin'), 'https://example.com')
  assert.equal(originHits, 0)

  for (const socket of sockets) socket.destroy()
  await close(proxy)
  const failedTarget = target + '/proxy-stopped-' + Date.now()
  await run(`window.browserShell.navigate(${JSON.stringify(failedTarget)})`)
  await waitFor(() => run('!document.querySelector("#error-page").hidden'), 'visible navigation failure after proxy stops')
  assert.equal(originHits, 0, 'There must be no direct fallback when the proxy stops')
  assert.equal(await run('document.querySelector("#error-url").textContent'), failedTarget)
  await close(origin)
  return { passed: true, transport: 'HTTP+HTTPS CONNECT', nativeRuntime: process.versions.electron,
    assertions: ['renderer preload navigation', 'real BrowserView proxy response', 'real HTTPS through CONNECT with default TLS validation', 'no implicit loopback bypass', 'proxy unavailable fails closed', 'no tunnel token in Electron'],
    proxyRequests, connectAuthorities, originHits }
}

function finish(result, status) {
  clearTimeout(watchdog)
  fs.writeFileSync(process.env.PCP_SMOKE_REPORT, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
  for (const socket of sockets) socket.destroy()
  proxy.close()
  origin.close()
  app.exit(status)
}
const watchdog = setTimeout(() => finish({ passed: false, error: 'Native smoke timeout' }, 1), 90000)
smoke().then(result => finish(result, 0), error => finish({ passed: false, error: error.stack, originHits, proxyRequests, connectAuthorities }, 1))
