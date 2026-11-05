'use strict';

const path = require('node:path');
const { app, BaseWindow, WebContentsView, Menu, ipcMain, session } = require('electron');
const { normalizeAddress, proxyPort } = require('./navigation.cjs');

// Explicitly avoid unproxied real-time UDP and browser background network traffic.
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');

const HOME = 'https://example.com/';
let protectedWindow = null;
let toolbarView = null;
let pageView = null;

function sendState() {
  if (!toolbarView || toolbarView.webContents.isDestroyed() ||
      !pageView || pageView.webContents.isDestroyed()) return;
  const page = pageView.webContents;
  const history = page.navigationHistory;
  toolbarView.webContents.send('protected:state', {
    url: page.getURL(),
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward()
  });
}

function isAllowed(address) {
  try { return normalizeAddress(address) === address; }
  catch { return false; }
}

async function navigate(address) {
  let url;
  try { url = normalizeAddress(address); }
  catch { return { error: 'Apenas endereços HTTP/HTTPS são permitidos.' }; }
  if (!pageView || pageView.webContents.isDestroyed()) return { error: 'Navegador indisponível.' };
  try { await pageView.webContents.loadURL(url); return { ok: true }; }
  catch { return { error: 'Não foi possível carregar o endereço pelo proxy.' }; }
}

function allowedSender(event) {
  return toolbarView && !toolbarView.webContents.isDestroyed() &&
    event.sender === toolbarView.webContents;
}
function installNavigationHandlers() {
  ipcMain.handle('protected:navigate', (event, address) =>
    allowedSender(event) ? navigate(address) : { error: 'Origem inválida.' });
  ipcMain.handle('protected:back', event => {
    if (allowedSender(event) && pageView.webContents.navigationHistory.canGoBack())
      pageView.webContents.navigationHistory.goBack();
  });
  ipcMain.handle('protected:forward', event => {
    if (allowedSender(event) && pageView.webContents.navigationHistory.canGoForward())
      pageView.webContents.navigationHistory.goForward();
  });
  ipcMain.handle('protected:reload', event => {
    if (allowedSender(event)) pageView.webContents.reload();
  });
  ipcMain.handle('protected:home', event => {
    if (allowedSender(event)) return navigate(HOME);
  });
}

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: 'Navegação',
    submenu: [
      { label: 'Endereço', accelerator: 'CmdOrCtrl+L',
        click: () => toolbarView?.webContents.send('protected:focus-address') },
      { label: 'Voltar', accelerator: 'Alt+Left',
        click: () => pageView?.webContents.navigationHistory.canGoBack() &&
          pageView.webContents.navigationHistory.goBack() },
      { label: 'Avançar', accelerator: 'Alt+Right',
        click: () => pageView?.webContents.navigationHistory.canGoForward() &&
          pageView.webContents.navigationHistory.goForward() },
      { label: 'Atualizar', accelerator: 'CmdOrCtrl+R', click: () => pageView?.webContents.reload() },
      { type: 'separator' },
      { role: 'quit', label: 'Sair' }
    ]
  }]));
}

async function createProtectedBrowser() {
  const port = proxyPort(process.env.PCP_PROXY_PORT || '17831');
  const protectedSession = session.fromPartition('persist:private-cloud-proxy-protected');
  await protectedSession.setProxy({
    mode: 'fixed_servers',
    proxyRules: 'http=127.0.0.1:' + port + ';https=127.0.0.1:' + port,
    proxyBypassRules: '<-loopback>'
  });

  const win = new BaseWindow({
    width: 1280, height: 850, minWidth: 640, minHeight: 400,
    show: false, title: 'Private Cloud Chromium | captura protegida',
    backgroundColor: '#171b22'
  });
  protectedWindow = win;
  win.setContentProtection(true);
  if (!win.isContentProtected()) {
    win.destroy();
    throw new Error('A proteção de captura não foi ativada; navegador não iniciado.');
  }

  toolbarView = new WebContentsView({ webPreferences: {
    preload: path.join(__dirname, 'toolbar-preload.cjs'),
    contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true
  }});
  pageView = new WebContentsView({ webPreferences: {
    partition: 'persist:private-cloud-proxy-protected',
    contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true
  }});

  win.contentView.addChildView(toolbarView);
  win.contentView.addChildView(pageView);

  const arrange = () => {
    const { width, height } = win.getContentBounds();
    toolbarView.setBounds({ x: 0, y: 0, width, height: 52 });
    pageView.setBounds({ x: 0, y: 52, width, height: Math.max(0, height - 52) });
  };
  win.on('resize', arrange);
  arrange();

  const page = pageView.webContents;
  page.on('did-navigate', sendState);
  page.on('did-navigate-in-page', sendState);
  page.on('did-finish-load', sendState);
  page.on('did-fail-load', sendState);
  page.on('will-navigate', (event, url) => {
    if (!isAllowed(url)) event.preventDefault();
  });
  page.setWindowOpenHandler(({ url }) => {
    // No unprotected popup windows; only navigate the protected top-level view.
    if (isAllowed(url)) queueMicrotask(() => void navigate(url));
    return { action: 'deny' };
  });

  win.on('closed', () => {
    // BaseWindow does not own WebContentsView lifecycle.
    toolbarView?.webContents.close();
    pageView?.webContents.close();
    toolbarView = null;
    pageView = null;
    protectedWindow = null;
  });

  installNavigationHandlers();
  installMenu();
  await toolbarView.webContents.loadFile(path.join(__dirname, 'toolbar.html'));
  // The first page is loaded only through the configured local HTTP proxy.
  void navigate(HOME);
  win.show();
  sendState();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (protectedWindow) { protectedWindow.show(); protectedWindow.focus(); }
  });
  app.whenReady().then(createProtectedBrowser).catch(error => {
    // Never silently launch an unprotected or directly connected browser.
    process.stderr.write('[PROTECTED_BROWSER_UNAVAILABLE] ' + String(error?.message || 'Failed to start') + '\n');
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
}
