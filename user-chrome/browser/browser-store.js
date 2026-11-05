const { EventEmitter } = require('node:events')

function isWebURL(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}

class BrowserStore extends EventEmitter {
  constructor(storage) {
    super()
    this.storage = storage
    const saved = storage.get('browser-data') || {}
    const pages = (items, limit) => Array.isArray(items)
      ? items.filter(item => item && isWebURL(item.url)).slice(0, limit).map(item => ({ ...item, title: String(item.title || item.url) })) : []
    this.data = {
      favorites: pages(saved.favorites, 500),
      history: pages(saved.history, 1000),
      downloads: Array.isArray(saved.downloads) ? saved.downloads
        .filter(item => item && typeof item.filename === 'string').slice(0, 100)
        .map(item => ({ ...item, state: ['started', 'progressing'].includes(item.state) ? 'interrupted' : item.state })) : []
    }
  }
  save() {
    this.storage.set('browser-data', this.data)
    this.emit('change')
  }
  getSnapshot() { return structuredClone(this.data) }
  toggleFavorite(url, title) {
    if (!isWebURL(url)) return this.getSnapshot()
    const index = this.data.favorites.findIndex(item => item.url === url)
    if (index >= 0) this.data.favorites.splice(index, 1)
    else this.data.favorites.unshift({ url, title: title || url })
    this.data.favorites.splice(500)
    this.save(); return this.getSnapshot()
  }
  recordHistory(url, title) {
    if (!isWebURL(url)) return
    this.data.history = this.data.history.filter(item => item.url !== url)
    this.data.history.unshift({ url, title: title || url, visitedAt: new Date().toISOString() })
    this.data.history.splice(1000); this.save()
  }
  recordDownload(download) { this.data.downloads.unshift(download); this.data.downloads.splice(100); this.save() }
  updateDownload(id, update) {
    const download = this.data.downloads.find(item => item.id === id)
    if (!download) return
    Object.assign(download, update)
    this.save()
  }
}
module.exports = { BrowserStore }
