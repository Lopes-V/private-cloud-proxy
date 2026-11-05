const api = window.browserShell
const $ = selector => document.querySelector(selector)
const address = $('#address')
const tabNodes = new Map()
const titles = { favorites: 'Favoritos', history: 'Histórico', downloads: 'Downloads' }
let state = { tabs: [], favorites: [], history: [], downloads: [], panel: null }
let favoritesKey = ''
let listKey = ''
let addressDirty = false
let messageTimer

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
  use.setAttribute('href', `#i-${name}`)
  svg.append(use)
  svg.setAttribute('aria-hidden', 'true')
  return svg
}

function text(tag, className, value) {
  const element = document.createElement(tag)
  element.className = className
  element.textContent = value
  return element
}

function showMessage(message) {
  clearTimeout(messageTimer)
  $('#message-text').textContent = message
  $('#message').hidden = false
  messageTimer = setTimeout(() => { $('#message').hidden = true }, 7000)
}

async function act(operation) {
  try { return await operation() }
  catch (error) { showMessage(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')) }
}

function focusAddress() {
  address.focus()
  address.select()
}

function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function navigate(url, newTab = false) {
  addressDirty = false
  address.blur()
  return act(() => newTab ? api.newTab(url) : api.navigate(url))
}

function renderTabs() {
  const live = new Set(state.tabs.map(tab => tab.id))
  for (const [id, node] of tabNodes) {
    if (!live.has(id)) { node.remove(); tabNodes.delete(id) }
  }
  for (const tab of state.tabs) {
    let node = tabNodes.get(tab.id)
    if (!node) {
      node = document.createElement('div')
      node.className = 'tab'
      node.dataset.id = tab.id
      const select = document.createElement('button')
      select.type = 'button'
      select.className = 'tab-select'
      select.setAttribute('role', 'tab')
      select.append(text('span', 'tab-icon', '◉'), text('span', 'tab-title', ''))
      select.onclick = () => act(() => api.activate(tab.id))
      const close = document.createElement('button')
      close.type = 'button'
      close.className = 'tab-close'
      close.title = 'Fechar aba'
      close.append(icon('close'))
      close.onclick = () => act(() => api.close(tab.id))
      node.onauxclick = event => {
        if (event.button === 1) { event.preventDefault(); act(() => api.close(tab.id)) }
      }
      node.append(select, close)
      $('#tabs').append(node)
      tabNodes.set(tab.id, node)
    }
    node.classList.toggle('active', tab.id === state.activeId)
    node.classList.toggle('loading', tab.loading)
    node.querySelector('.tab-title').textContent = tab.title || 'Nova aba'
    node.querySelector('.tab-icon').textContent = tab.loading ? '' : tab.error ? '!' : tab.url === 'browser://newtab' ? '◇' : '◉'
    const select = node.querySelector('.tab-select')
    select.title = `${tab.title}\n${tab.url === 'browser://newtab' ? 'Nova aba local' : tab.url}`
    select.setAttribute('aria-selected', String(tab.id === state.activeId))
    select.tabIndex = tab.id === state.activeId ? 0 : -1
    node.querySelector('.tab-close').setAttribute('aria-label', `Fechar ${tab.title || 'aba'}`)
  }
}

function renderFavorites() {
  const key = JSON.stringify(state.favorites)
  if (key === favoritesKey) return
  favoritesKey = key
  $('#bookmarks-hint').hidden = state.favorites.length > 0
  $('#home-empty').hidden = state.favorites.length > 0
  $('#bookmarks').replaceChildren(...state.favorites.slice(0, 12).map(item => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'bookmark'
    button.title = `${item.title}\n${item.url}`
    button.append(text('span', 'bookmark-dot', hostname(item.url).slice(0, 1).toUpperCase()), text('span', '', item.title))
    button.onclick = event => navigate(item.url, event.ctrlKey || event.metaKey)
    return button
  }))
  $('#shortcuts').replaceChildren(...state.favorites.slice(0, 8).map(item => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'shortcut'
    button.title = item.url
    button.append(text('span', 'shortcut-icon', hostname(item.url).slice(0, 1).toUpperCase()), text('span', 'shortcut-name', item.title))
    button.onclick = event => navigate(item.url, event.ctrlKey || event.metaKey)
    return button
  }))
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function renderLibrary() {
  if (!state.panel) return
  const query = $('#library-filter').value.trim().toLocaleLowerCase('pt-BR')
  const items = state[state.panel].filter(item => `${item.title || item.filename} ${item.url || ''}`.toLocaleLowerCase('pt-BR').includes(query))
  const key = JSON.stringify([state.panel, query, items])
  if (key === listKey) return
  listKey = key
  $('#library-title').textContent = titles[state.panel]
  $('#library-count').textContent = `${items.length} ${items.length === 1 ? 'item' : 'itens'}`
  $('#library-note').textContent = state.panel === 'downloads' ? 'Arquivos concluídos podem ser encontrados na pasta em que foram salvos.' : state.panel === 'history' ? 'Até 1.000 páginas recentes, armazenadas neste dispositivo.' : 'Use a estrela na barra de endereço para adicionar ou remover o site atual.'
  if (!items.length) {
    const empty = query ? 'Nenhum resultado. Tente outro termo.' : state.panel === 'downloads' ? 'Seus downloads aparecerão aqui, com o progresso e o estado de cada arquivo.' : state.panel === 'history' ? 'As páginas que você visitar aparecerão aqui.' : 'Seus favoritos aparecerão aqui. Abra um site e clique na estrela.'
    $('#library-list').replaceChildren(text('p', 'library-empty', empty))
    return
  }
  $('#library-list').replaceChildren(...items.map(item => {
    const row = document.createElement('article')
    row.className = 'library-item'
    if (state.panel === 'downloads') {
      const heading = document.createElement('div')
      heading.className = 'download-top'
      heading.append(icon('download'), text('span', 'item-title', item.filename))
      heading.title = item.filename
      const labels = { started: 'Iniciando', progressing: 'Baixando', completed: 'Concluído', cancelled: 'Cancelado', interrupted: 'Interrompido' }
      row.append(heading, text('p', 'download-status', `${labels[item.state] || 'Interrompido'} · ${formatBytes(item.receivedBytes)}${item.totalBytes > 0 ? ` de ${formatBytes(item.totalBytes)}` : ''}`))
      if (['started', 'progressing'].includes(item.state)) {
        const progress = document.createElement('progress')
        progress.className = 'download-progress'
        progress.setAttribute('aria-label', `Progresso de ${item.filename}`)
        if (item.totalBytes > 0) { progress.max = item.totalBytes; progress.value = item.receivedBytes || 0 }
        row.append(progress)
      }
      if (item.state === 'completed') {
        const show = text('button', 'show-download', 'Mostrar na pasta')
        show.type = 'button'
        show.onclick = () => act(() => api.showDownload(item.id))
        row.append(show)
      }
    } else {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'library-link'
      const copy = document.createElement('span')
      copy.className = 'item-copy'
      copy.append(text('span', 'item-title', item.title), text('span', 'item-url', item.url))
      button.append(text('span', 'bookmark-dot', hostname(item.url).slice(0, 1).toUpperCase()), copy)
      button.title = item.url
      button.onclick = event => navigate(item.url, event.ctrlKey || event.metaKey)
      row.append(button)
      if (item.visitedAt) {
        const date = new Date(item.visitedAt)
        if (!Number.isNaN(date.getTime())) row.append(text('div', 'item-date', date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })))
      }
    }
    return row
  }))
}

function render(next) {
  const activeChanged = next.activeId !== state.activeId
  const panelChanged = next.panel !== state.panel
  state = next
  const active = state.tabs.find(tab => tab.id === state.activeId)
  if (activeChanged) addressDirty = false
  if (!addressDirty || activeChanged) address.value = active?.url === 'browser://newtab' ? '' : active?.url || ''
  renderTabs()
  renderFavorites()
  $('#home').hidden = !active || active.url !== 'browser://newtab'
  $('#error-page').hidden = !active?.error
  if (active?.error) {
    $('#error-url').textContent = active.url
    $('#error-detail').textContent = active.error.message
  }
  document.querySelector('[data-c="back"]').disabled = !active?.canGoBack
  document.querySelector('[data-c="forward"]').disabled = !active?.canGoForward
  const reload = $('#reload')
  reload.disabled = !active || active.url === 'browser://newtab'
  reload.dataset.c = active?.loading ? 'stop' : 'reload'
  reload.title = active?.loading ? 'Parar carregamento' : 'Recarregar (Ctrl+R)'
  reload.setAttribute('aria-label', active?.loading ? 'Parar carregamento' : 'Recarregar')
  reload.replaceChildren(icon(active?.loading ? 'stop' : 'reload'))
  const favorite = state.favorites.some(item => item.url === active?.url)
  $('#star').disabled = !active || active.url === 'browser://newtab'
  $('#star').setAttribute('aria-pressed', String(favorite))
  $('#star').title = favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'
  $('#star').setAttribute('aria-label', $('#star').title)
  const local = active?.url === 'browser://newtab'
  $('#site-info').title = local ? 'Nova aba local' : active?.url.startsWith('https:') ? 'Conexão HTTPS' : 'Conexão HTTP'
  $('#site-info').replaceChildren(icon(local ? 'search' : 'info'))
  document.body.classList.toggle('panel-open', Boolean(state.panel))
  $('#library').hidden = !state.panel
  document.querySelectorAll('[data-panel]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.panel === state.panel)))
  if (panelChanged) { $('#library-filter').value = ''; listKey = '' }
  renderLibrary()
  if (activeChanged) tabNodes.get(state.activeId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

address.addEventListener('input', () => { addressDirty = true })
address.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    addressDirty = false
    const active = state.tabs.find(tab => tab.id === state.activeId)
    address.value = active?.url === 'browser://newtab' ? '' : active?.url || ''
    address.select()
    $('#message').hidden = true
  }
})
$('#nav').onsubmit = event => { event.preventDefault(); navigate(address.value) }
$('#home-search').onsubmit = event => { event.preventDefault(); navigate($('#search').value) }
document.querySelectorAll('[data-c]').forEach(button => { button.onclick = () => act(() => api.command(button.dataset.c)) })
document.querySelectorAll('[data-panel]').forEach(button => {
  button.onclick = () => act(() => api.panel(state.panel === button.dataset.panel ? null : button.dataset.panel))
})
$('#tabs').addEventListener('keydown', event => {
  if (event.target.getAttribute('role') !== 'tab') return
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault()
    act(async () => {
      await api.command(event.key === 'ArrowRight' ? 'next' : 'previous')
      document.querySelector('.tab.active .tab-select')?.focus()
    })
  }
})
$('#new').onclick = () => act(async () => { await api.newTab(); focusAddress() })
$('#star').onclick = () => act(() => api.favorite())
$('#network').onclick = $('#error-network').onclick = () => act(() => api.networkSettings())
$('#close-panel').onclick = () => act(() => api.panel(null))
$('#library-filter').addEventListener('input', renderLibrary)
$('#dismiss-message').onclick = () => { $('#message').hidden = true }
api.onAction(action => { if (action === 'focus-address') focusAddress() })
api.onState(render)
act(async () => { render(await api.state()); focusAddress() })
