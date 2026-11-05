const assert = require('node:assert/strict')
const test = require('node:test')

const {
  NetworkManager,
  normalizeConfig,
  proxyOptions
} = require('../network/network-manager')

function createSession() {
  const calls = []
  return {
    calls,
    setProxy: async config => calls.push(['setProxy', config]),
    closeAllConnections: async () => calls.push(['closeAllConnections']),
    webRequest: {
      onCompleted() {},
      onErrorOccurred() {}
    }
  }
}

test('normaliza conexao direta sem endpoint', () => {
  assert.deepEqual(normalizeConfig({ mode: 'direct' }), {
    mode: 'direct',
    routing: 'global',
    timeoutMs: 8000,
    retries: 0,
    bypassRules: ''
  })
})

test('aplica proxy HTTP em toda a sessao Chromium e fecha conexoes existentes', async () => {
  const session = createSession()
  const manager = new NetworkManager({ session, storage: new Map() })

  const state = await manager.apply({
    mode: 'http', host: 'proxy.example.test', port: 8080, timeoutMs: 3000, retries: 2
  })

  assert.equal(state.config.password, undefined)
  assert.deepEqual(session.calls, [
    ['setProxy', { proxyRules: 'http=proxy.example.test:8080;https=proxy.example.test:8080', proxyBypassRules: '' }],
    ['closeAllConnections']
  ])
})

test('aplica endpoint SOCKS5 de tunel autorizado pela sessao Chromium', async () => {
  const session = createSession()
  const manager = new NetworkManager({ session, storage: new Map() })

  await manager.apply({ mode: 'socks5', host: '127.0.0.1', port: 1080 })

  assert.deepEqual(session.calls[0], ['setProxy', {
    proxyRules: 'socks5://127.0.0.1:1080', proxyBypassRules: ''
  }])
})

test('gera PAC por dominio sem fallback direto para os destinos protegidos', () => {
  const config = normalizeConfig({
    mode: 'http',
    routing: 'domain',
    host: 'proxy.corporativo.test',
    port: 8080,
    proxyDomains: 'store.steampowered.com, .steamcommunity.com'
  })

  const options = proxyOptions(config)
  assert.ok(options.pacScript.startsWith('data:application/x-ns-proxy-autoconfig,'))
  const pac = decodeURIComponent(options.pacScript.split(',')[1])
  assert.match(pac, /host === "store\.steampowered\.com"/)
  assert.match(pac, /dnsDomainIs\(host, "\.steamcommunity\.com"\)/)
  assert.match(pac, /return "PROXY proxy\.corporativo\.test:8080";/)
  assert.match(pac, /return "DIRECT";/)
  assert.equal(pac.includes('PROXY proxy.corporativo.test:8080; DIRECT'), false)
})

test('rejeita roteamento por dominio sem regra explicita', () => {
  assert.throws(
    () => normalizeConfig({ mode: 'socks5', routing: 'domain', host: '127.0.0.1', port: 1080 }),
    /dominio/i
  )
})

test('roteia somente os dominios configurados e preserva conexao direta para os demais', async () => {
  const session = createSession()
  const manager = new NetworkManager({ session, storage: new Map() })
  await manager.apply({
    mode: 'socks5', routing: 'domain', host: '127.0.0.1', port: 1080,
    proxyDomains: ['store.steampowered.com', 'steamcommunity.com']
  })

  assert.equal(manager.isProxiedTarget('https://store.steampowered.com/app/'), true)
  assert.equal(manager.isProxiedTarget('https://api.steamcommunity.com/'), true)
  assert.equal(manager.isProxiedTarget('https://github.com/'), false)
  assert.equal(manager.getConfigForTarget('https://github.com/').mode, 'direct')
  assert.equal(await manager.resolveRoute('https://store.steampowered.com/'), 'SOCKS5 127.0.0.1:1080')
  assert.equal(await manager.resolveRoute('https://github.com/'), 'DIRECT')
})

test('rejeita endpoint invalido antes de alterar a sessao', async () => {
  const session = createSession()
  const manager = new NetworkManager({ session, storage: new Map() })

  await assert.rejects(
    manager.apply({ mode: 'http', host: '', port: 70000 }),
    /host valido/i
  )
  assert.deepEqual(session.calls, [])
})

test('persiste senha cifrada sem expo-la no estado publico', async () => {
  const session = createSession()
  const storage = new Map()
  const secureStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`encrypted:${value}`),
    decryptString: value => Buffer.from(value).toString().replace('encrypted:', '')
  }
  const manager = new NetworkManager({ session, storage, secureStorage })

  await manager.apply({
    mode: 'http', host: 'proxy.example.test', port: 8080, username: 'ana', password: 'segredo'
  })

  assert.equal(JSON.stringify(storage.get('network-config')).includes('segredo'), false)
  assert.equal(manager.getPublicState().config.hasPassword, true)
  assert.equal(manager.getPublicState().config.password, undefined)
})

test('restaura regras por dominio na proxima sessao', async () => {
  const storage = new Map()
  const firstSession = createSession()
  const manager = new NetworkManager({ session: firstSession, storage })
  await manager.apply({
    mode: 'http', routing: 'domain', host: 'proxy.example.test', port: 8080,
    proxyDomains: 'store.steampowered.com, steamcommunity.com'
  })

  const secondSession = createSession()
  const restored = new NetworkManager({ session: secondSession, storage })
  await restored.restore()

  assert.deepEqual(restored.getPublicState().config.proxyDomains, ['store.steampowered.com', 'steamcommunity.com'])
  assert.ok(secondSession.calls[0][1].pacScript.includes('store.steampowered.com'))
})

test('fornece credencial somente ao desafio do proxy configurado', async () => {
  const session = createSession()
  const manager = new NetworkManager({ session, storage: new Map() })
  await manager.apply({
    mode: 'http', host: 'proxy.example.test', port: 8080, username: 'ana', password: 'segredo'
  })

  let accepted
  assert.equal(manager.handleLogin({ preventDefault() {} }, { host: 'proxy.example.test' }, { isProxy: true }, (...args) => { accepted = args }), true)
  assert.deepEqual(accepted, ['ana', 'segredo'])
  assert.equal(manager.handleLogin({ preventDefault() {} }, { host: 'origin.example.test' }, { isProxy: false }, () => {}), false)
})

test('fornece credencial para proxy de regra por dominio e registra a rota da requisicao', async () => {
  const session = createSession()
  session.resolveProxy = async url => url.includes('steampowered.com') ? 'PROXY proxy.example.test:8080' : 'DIRECT'
  const manager = new NetworkManager({ session, storage: new Map() })
  await manager.apply({
    mode: 'http', routing: 'domain', host: 'proxy.example.test', port: 8080,
    proxyDomains: 'store.steampowered.com', username: 'ana', password: 'segredo'
  })

  let accepted
  assert.equal(manager.handleLogin({ preventDefault() {} }, {}, { isProxy: true, host: 'proxy.example.test', port: 8080 }, (...args) => { accepted = args }), true)
  assert.deepEqual(accepted, ['ana', 'segredo'])

  await manager.recordRequestEvent('request-error', { url: 'https://store.steampowered.com/', error: 'net::ERR_PROXY_CONNECTION_FAILED' })
  const event = manager.getPublicState().events.at(-1)
  assert.equal(event.route, 'PROXY proxy.example.test:8080')
  assert.equal(event.transport, 'proxy')
})

test('usa o host de authInfo no desafio de proxy emitido pelo Electron', async () => {
  const session = createSession()
  const manager = new NetworkManager({ session, storage: new Map() })
  await manager.apply({ mode: 'http', host: 'proxy.example.test', port: 8080, username: 'ana', password: 'segredo' })
  let accepted

  const handled = manager.handleLogin(
    { preventDefault() {} },
    { url: 'https://origin.example.test/' },
    { isProxy: true, host: 'proxy.example.test', port: 8080 },
    (...args) => { accepted = args }
  )

  assert.equal(handled, true)
  assert.deepEqual(accepted, ['ana', 'segredo'])
})

test('preserva a credencial quando a configuracao e salva sem campo de senha', async () => {
  const session = createSession()
  const manager = new NetworkManager({ session, storage: new Map() })
  await manager.apply({ mode: 'http', host: 'proxy.example.test', port: 8080, username: 'ana', password: 'segredo' })

  await manager.apply({ mode: 'http', host: 'proxy.example.test', port: 8080, username: 'ana', timeoutMs: 5000 })
  let accepted
  manager.handleLogin({ preventDefault() {} }, { host: 'proxy.example.test' }, { isProxy: true }, (...args) => { accepted = args })

  assert.deepEqual(accepted, ['ana', 'segredo'])
})
