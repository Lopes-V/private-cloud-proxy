const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const temporaryRoot = path.resolve(os.tmpdir())
const profile = fs.mkdtempSync(path.join(temporaryRoot, 'chrome-shell-test-'))
let status = 1
try {
  const result = spawnSync(require('electron'), [path.join(__dirname, 'browser-shell.electron.js'), profile], {
    stdio: 'inherit', timeout: 90000, windowsHide: true
  })
  if (result.error) console.error(result.error.message)
  status = result.status ?? 1
} finally {
  // Resolve and check before deleting: only this run's temporary profile.
  assert.equal(path.dirname(path.resolve(profile)), temporaryRoot)
  assert.equal(path.basename(profile).startsWith('chrome-shell-test-'), true)
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
  catch (error) { console.error(`Não foi possível remover o perfil temporário ${profile}: ${error.message}`); status = 1 }
}
process.exitCode = status
