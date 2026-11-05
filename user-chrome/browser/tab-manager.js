const { randomUUID } = require('node:crypto')
const { normalizeAddress } = require('./address')

const NEW_TAB = 'browser://newtab'
const TOOLBAR_HEIGHT = 128
const PANEL_WIDTH = 340

class TabManager {
  constructor({ BrowserView, window, store, notify }) {
    Object.assign(this, { BrowserView, window, store, notify })
    this.tabs = []
    this.closedTabs = []
    this.activeId = null
    this.panel = null
    this.disposed = false
  }

  get activeTab() { return this.tabs.find(tab => tab.id === this.activeId) }

  snapshot() {
    return {
      activeId: this.activeId,
      panel: this.panel,
      tabs: this.tabs.map(tab => ({
        id: tab.id, title: tab.title, url: tab.url, loading: tab.loading, error: tab.error,
        canGoBack: tab.url !== NEW_TAB && tab.view.webContents.canGoBack(),
        canGoForward: tab.url !== NEW_TAB && tab.view.webContents.canGoForward()
      })),
      ...this.store.getSnapshot()
    }
  }

  emit() { if (!this.disposed) this.notify(this.snapshot()) }

  createTab(input = NEW_TAB) {
    const url = normalizeAddress(input)
    const view = new this.BrowserView({ webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
    const tab = { id: randomUUID(), view, title: 'Nova aba', url: NEW_TAB, loading: false, error: null, navigation: 0 }
    const wc = view.webContents
    const live = () => !this.disposed && this.tabs.includes(tab)
    wc.setWindowOpenHandler(({ url }) => {
      try { this.createTab(url) } catch { /* Untrusted schemes never open a tab. */ }
      return { action: 'deny' }
    })
    const guardNavigation = (event, target) => {
      try { if (!['http:', 'https:'].includes(new URL(target).protocol)) event.preventDefault() }
      catch { event.preventDefault() }
    }
    wc.on('will-navigate', guardNavigation)
    wc.on('will-redirect', guardNavigation)
    wc.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      if (!live() || !isMainFrame || tab.url === NEW_TAB) return
      if (!/^https?:\/\//i.test(url)) return
      if (url !== tab.url) tab.navigation++
      tab.url = url
      tab.error = null
      if (!isInPlace) tab.loading = true
      this.layout()
      this.emit()
    })
    wc.on('page-title-updated', (_event, title) => {
      if (!live() || tab.url === NEW_TAB) return
      tab.title = title || tab.url
      this.store.recordHistory(tab.url, tab.title)
      this.emit()
    })
    const navigated = (_event, url) => {
      if (!live() || tab.url === NEW_TAB) return
      tab.url = url
      tab.error = null
      this.store.recordHistory(url, tab.title)
      this.layout()
      this.emit()
    }
    wc.on('did-navigate', navigated)
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) navigated(_event, url)
    })
    wc.on('did-start-loading', () => {
      if (!live() || tab.url === NEW_TAB) return
      tab.loading = true
      this.emit()
    })
    wc.on('did-stop-loading', () => {
      if (!live()) return
      tab.loading = false
      this.emit()
    })
    wc.on('did-fail-load', (_event, code, message, url, isMainFrame) => {
      if (!live() || !isMainFrame || code === -3 || tab.url === NEW_TAB || url !== tab.url) return
      this.fail(tab, code, message)
    })
    wc.on('render-process-gone', () => {
      if (live() && tab.url !== NEW_TAB) this.fail(tab, 'PROCESS_GONE', 'A página parou de responder. Recarregue para continuar.')
    })
    this.tabs.push(tab)
    this.activateTab(tab.id)
    this.navigate(url)
    return tab.id
  }

  fail(tab, code, message) {
    tab.loading = false
    tab.error = { code, message }
    this.layout()
    this.emit()
  }

  activateTab(id) {
    if (!this.tabs.some(tab => tab.id === id)) return
    this.activeId = id
    this.layout()
    this.emit()
  }

  closeTab(id) {
    const index = this.tabs.findIndex(tab => tab.id === id)
    if (index < 0) return
    const [tab] = this.tabs.splice(index, 1)
    this.closedTabs.unshift(tab.url)
    this.closedTabs.splice(10)
    if (id === this.activeId) this.attach(null)
    tab.view.webContents.close()
    if (!this.tabs.length) return this.createTab()
    if (id === this.activeId) this.activateTab(this.tabs[Math.min(index, this.tabs.length - 1)].id)
    else this.emit()
  }

  setPanel(panel) {
    if (panel !== null && !['favorites', 'history', 'downloads'].includes(panel)) throw new Error('Painel inválido.')
    this.panel = panel
    this.layout()
    this.emit()
  }

  attach(view) {
    if (this.attachedView === view) return
    this.window.setBrowserView(view)
    this.attachedView = view
  }

  layout() {
    const tab = this.activeTab
    if (!tab || tab.url === NEW_TAB || tab.error) {
      this.attach(null)
      return
    }
    this.attach(tab.view)
    const [width, height] = this.window.getContentSize()
    tab.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: Math.max(0, width - (this.panel ? PANEL_WIDTH : 0)), height: Math.max(0, height - TOOLBAR_HEIGHT) })
  }

  navigate(input) {
    const tab = this.activeTab
    if (!tab) return
    const url = normalizeAddress(input)
    const navigation = ++tab.navigation
    tab.url = url
    tab.error = null
    tab.loading = url !== NEW_TAB
    tab.title = url === NEW_TAB ? 'Nova aba' : new URL(url).hostname
    if (url === NEW_TAB) tab.view.webContents.stop()
    else {
      Promise.resolve(tab.view.webContents.loadURL(url)).catch(error => {
        if (this.disposed || !this.tabs.includes(tab) || tab.navigation !== navigation || error.code === 'ERR_ABORTED' || error.errno === -3) return
        this.fail(tab, error.errno || error.code || 'LOAD_FAILED', error.message)
      })
    }
    this.layout()
    this.emit()
    return url
  }

  command(command) {
    const tab = this.activeTab
    if (!tab) return
    const wc = tab.view.webContents
    if (command === 'reopen') { const url = this.closedTabs.shift(); if (url) this.createTab(url) }
    else if (command === 'next' || command === 'previous') {
      const index = this.tabs.indexOf(tab)
      this.activateTab(this.tabs[(index + (command === 'next' ? 1 : this.tabs.length - 1)) % this.tabs.length].id)
    } else if (command === 'home') this.navigate(NEW_TAB)
    else if (command === 'reload' && tab.url !== NEW_TAB) this.navigate(tab.url)
    else if (command === 'stop') { wc.stop(); tab.loading = false; this.emit() }
    else if (command === 'back' && tab.url !== NEW_TAB && wc.canGoBack()) wc.goBack()
    else if (command === 'forward' && tab.url !== NEW_TAB && wc.canGoForward()) wc.goForward()
  }

  dispose() {
    this.disposed = true
    this.attach(null)
    for (const tab of this.tabs.splice(0)) tab.view.webContents.close()
  }
}

module.exports = { TabManager }
