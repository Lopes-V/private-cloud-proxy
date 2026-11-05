const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { app, Menu } = require('electron')

const profile = process.argv[2]
assert.ok(profile, 'Execute pelo comando npm run test:browser para isolar e limpar o perfil.')
app.setPath('userData', profile)
const server = http.createServer((request, response) => {
  if (request.url === '/arquivo.txt') {
    response.writeHead(200, { 'Content-Disposition': 'attachment; filename="arquivo.txt"', 'Content-Type': 'application/octet-stream' })
    response.end('download local de teste')
  } else {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(`<title>Página ${request.url === '/segunda' ? 'dois' : 'um'}</title><h1>Servidor local</h1><a href="/segunda">Segunda página</a>`)
  }
})

async function waitFor(check, label) {
  const end = Date.now() + 10000
  while (Date.now() < end) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 60))
  }
  throw new Error(`Timeout: ${label}`)
}

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const window = await require('../main').ready
  const run = source => window.webContents.executeJavaScript(source, true)
  await waitFor(() => run('Boolean(window.browserShell && document.querySelector("#tabs button"))'), 'inicialização')
  assert.equal(await run('Boolean(document.querySelector("#home"))'), true, 'nova aba precisa da tela local')
  assert.equal(await run('document.querySelector("#home").hidden'), false)
  assert.equal(window.getBrowserView(), null)

  await run(`document.querySelector('#address').value = ${JSON.stringify(origin)}; document.querySelector('#nav').requestSubmit()`)
  await waitFor(() => run('window.browserShell.state().then(s => s.tabs.some(t => t.title === "Página um" && !t.loading))'), 'navegação pela barra')
  assert.ok(window.getBrowserView())
  assert.equal(await window.getBrowserView().webContents.executeJavaScript('typeof require'), 'undefined')

  await run('document.querySelector("#star").click()')
  await waitFor(() => run('document.querySelector("#star").getAttribute("aria-pressed") === "true"'), 'favorito')
  await run('document.querySelector("#address").focus(); document.querySelector("#address").value = "pesquisa ainda digitando"; document.querySelector("#address").dispatchEvent(new Event("input")); window.browserShell.favorite()')
  await waitFor(() => run('window.browserShell.state().then(s => s.favorites.length === 0)'), 'remover favorito')
  assert.equal(await run('document.querySelector("#address").value'), 'pesquisa ainda digitando')
  await run('document.querySelector("#address").blur(); window.browserShell.favorite()')

  await window.getBrowserView().webContents.executeJavaScript('document.querySelector("a").click()', true)
  await waitFor(() => run('window.browserShell.state().then(s => s.tabs.some(t => t.title === "Página dois" && !t.loading))'), 'segunda página')
  await run('document.querySelector("[data-c=back]").click()')
  await waitFor(() => run('window.browserShell.state().then(s => s.tabs.some(t => t.title === "Página um" && !t.loading))'), 'voltar sem enviar busca').catch(async error => {
    console.error('Estado após voltar:', await run('window.browserShell.state()'))
    console.error('Página Chromium:', window.getBrowserView()?.webContents.getURL(), window.getBrowserView()?.webContents.getTitle())
    throw error
  })
  assert.equal(await run('window.browserShell.state().then(s => s.tabs.length)'), 1)

  await window.getBrowserView().webContents.executeJavaScript('history.pushState({}, "", "#secao")', true)
  await waitFor(() => run('window.browserShell.state().then(s => s.tabs.some(t => t.url.endsWith("#secao")))'), 'navegação no mesmo documento')
  assert.equal(await run('window.browserShell.state().then(s => s.tabs.find(t => t.id === s.activeId).loading)'), false, 'pushState nao deve deixar carregamento permanente')

  const listenerCount = window.listenerCount('closed')
  for (let index = 0; index < 15; index++) {
    await run('window.browserShell.panel("history")')
    await run('window.browserShell.panel(null)')
  }
  assert.equal(window.listenerCount('closed'), listenerCount, 'alterar painel nao deve acumular listeners da BrowserView')

  await run('document.querySelector("[data-panel=history]").click()')
  await waitFor(() => run('!document.querySelector("#library").hidden'), 'painel de histórico')
  assert.equal(window.getBrowserView().getBounds().width, window.getContentSize()[0] - 340)
  assert.equal(await run('document.querySelectorAll("#library-list .library-item").length >= 2'), true)
  await run('document.querySelector("#close-panel").click()')
  await waitFor(() => run('document.querySelector("#library").hidden'), 'fechar painel')

  const badServer = http.createServer()
  await new Promise(resolve => badServer.listen(0, '127.0.0.1', resolve))
  const badPort = badServer.address().port
  await new Promise(resolve => badServer.close(resolve))
  await window.getBrowserView().webContents.executeJavaScript(`document.querySelector('a').href = 'http://127.0.0.1:${badPort}/falha'; document.querySelector('a').click()`, true)
  await waitFor(() => run('!document.querySelector("#error-page").hidden'), 'erro ao seguir link')
  assert.match(await run('document.querySelector("#error-url").textContent'), /\/falha$/)
  await run('window.browserShell.command("back")')
  await waitFor(() => run('document.querySelector("#error-page").hidden && window.browserShell.state().then(s => s.tabs.some(t => t.title === "Página um" && !t.loading))'), 'recuperação após falha de link')
  assert.ok(window.getBrowserView(), 'a página precisa reaparecer após Voltar')

  await run('document.querySelector("#new").click()')
  await waitFor(() => run('document.querySelectorAll(".tab").length === 2'), 'criar aba')
  await run('document.querySelector(".tab.active .tab-close").click()')
  await waitFor(() => run('document.querySelectorAll(".tab").length === 1'), 'fechar pelo ×')
  await run('window.browserShell.command("reopen")')
  await waitFor(() => run('document.querySelectorAll(".tab").length === 2'), 'reabrir aba')

  const browserMenu = Menu.getApplicationMenu().items.find(item => item.label === 'Navegador').submenu
  browserMenu.items.find(item => item.label === 'Barra de endereço').click()
  await waitFor(() => run('document.activeElement.id === "address"'), 'foco pelo menu nativo')
  browserMenu.items.find(item => item.label === 'Nova aba').click()
  await waitFor(() => run('document.querySelectorAll(".tab").length === 3'), 'nova aba pelo menu nativo')

  await run('window.browserShell.navigate("javascript:alert(1)").then(() => false, () => true)').then(rejected => assert.equal(rejected, true))
  await run(`window.browserShell.navigate('http://127.0.0.1:${badPort}')`)
  await waitFor(() => run('!document.querySelector("#error-page").hidden'), 'falha visível')
  assert.equal(window.getBrowserView(), null)

  await run('window.browserShell.command("home")')
  await waitFor(() => run('!document.querySelector("#home").hidden'), 'voltar ao início')
  await run('window.browserShell.panel("downloads")')
  const { session } = require('electron')
  session.defaultSession.once('will-download', (_event, item) => item.setSavePath(path.join(profile, 'arquivo.txt')))
  session.defaultSession.downloadURL(`${origin}/arquivo.txt`)
  await waitFor(() => run('window.browserShell.state().then(s => s.downloads.some(d => d.state === "completed"))'), 'download concluído')
  assert.equal(fs.readFileSync(path.join(profile, 'arquivo.txt'), 'utf8'), 'download local de teste')
  assert.match(await run('document.querySelector("#library-list").textContent'), /Concluído/)

  await run('window.browserShell.panel(null)')
  await waitFor(() => run('document.querySelector("#library").hidden'), 'fechar biblioteca')
  assert.equal(await run('document.documentElement.scrollWidth <= innerWidth'), true)
  assert.equal(await run('document.querySelector("#chrome").getBoundingClientRect().height'), 128)
  window.setSize(800, 600)
  await run('window.browserShell.panel("favorites")')
  await waitFor(() => run('!document.querySelector("#library").hidden'), 'painel em janela menor')
  assert.equal(await run('document.documentElement.scrollWidth <= innerWidth'), true)
  console.log('PASS browser UI: local home, address navigation, isolated pages, favorites, preserved input, back, history panel, close/reopen tabs, native menu actions, visible errors, real local download, compact layout')
}

main().then(() => {
  server.close()
  app.quit()
}).catch(error => {
  console.error(error)
  server.close()
  app.exit(1)
})
