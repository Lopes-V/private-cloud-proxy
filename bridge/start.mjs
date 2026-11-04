import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { createLocalProxy, validateEndpoint } from './client.mjs';
import { Budget } from './budget.mjs';

class HiddenOutput extends Writable {
  hidden = false;
  _write(chunk, _encoding, done) { if (!this.hidden) process.stdout.write(chunk); done(); }
}
async function ask(prompt, hidden = false) {
  if (!process.stdin.isTTY) throw new Error('Use an interactive terminal or secure environment bindings');
  const output = new HiddenOutput();
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  try {
    const promise = rl.question(prompt);
    output.hidden = hidden;
    const result = await promise;
    if (hidden) process.stdout.write('\n');
    return result.trim();
  } finally { output.hidden = false; rl.close(); }
}
function findBrowser() {
  const candidates = [
    ...[process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean)
      .flatMap(base => [path.join(base,'Google','Chrome','Application','chrome.exe'), path.join(base,'Chromium','Application','chrome.exe')]),
    '/usr/bin/chromium', '/usr/bin/google-chrome'
  ];
  const browser = candidates.find(p => fs.existsSync(p));
  if (!browser) throw new Error('Chrome or Chromium not found');
  return browser;
}
let proxy; let lock;
function releaseLock() { if (lock) { try { fs.unlinkSync(lock); } catch {} lock = undefined; } }
process.once('exit', releaseLock);
try {
  const browser = findBrowser();
  const directory = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'.local','share'), 'PrivateCloudProxy');
  fs.mkdirSync(directory,{recursive:true});
  const lockFile = path.join(directory,'bridge.lock');
  if (fs.existsSync(lockFile)) {
    const pid = Number(fs.readFileSync(lockFile,'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid client lock');
    try { process.kill(pid,0); throw new Error('Client already active'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; fs.unlinkSync(lockFile); }
  }
  fs.writeFileSync(lockFile,String(process.pid),{flag:'wx',mode:0o600});lock=lockFile;
  const settingsFile = path.join(directory,'bridge-endpoint.json');
  let endpoint = process.env.TUNNEL_URL;
  if (!endpoint && fs.existsSync(settingsFile)) endpoint = JSON.parse(fs.readFileSync(settingsFile,'utf8')).endpoint;
  if (!endpoint) {
    const value = await ask('URL gratuita do Render (https://NOME.onrender.com): ');
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'wss:') throw new Error('HTTPS/WSS required');
    parsed.protocol = 'wss:'; parsed.pathname = '/tunnel'; endpoint = parsed.href;
  }
  endpoint = validateEndpoint(endpoint);
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(settingsFile,JSON.stringify({endpoint}),{mode:0o600});
  const secret = process.env.TUNNEL_TOKEN || await ask('Segredo do serviço (entrada oculta; não será salvo): ',true);
  proxy = createLocalProxy({ endpoint, secret, budget:new Budget({file:path.join(directory,'bridge-usage.json')}) });
  const port = await proxy.listen();
  const child = spawn(browser,[`--user-data-dir=${path.join(directory,'ChromiumBridge')}`,
    `--proxy-server=http://127.0.0.1:${port}`, '--proxy-bypass-list=<-loopback>',
    '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--dns-prefetch-disable', '--no-first-run', 'https://example.com'], {stdio:'ignore',env:Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'TUNNEL_TOKEN'))});
  child.once('error',()=>{console.error('Não foi possível abrir o navegador');proxy.close();process.exitCode=1;});
  console.log('Proxy local ativo. Mantenha esta janela aberta; Ctrl+C encerra o túnel.');
  console.log('Sem túnel, a navegação pelo proxy falha. A primeira conexão após suspensão pode demorar.');
  for (const sig of ['SIGINT','SIGTERM']) process.once(sig,()=>proxy.close().then(()=>process.exit(0)));
} catch {
  console.error('Não foi possível iniciar. Verifique navegador, URL WSS, segredo e arquivo de consumo. Nenhuma validação TLS foi desativada.');
  await proxy?.close();process.exitCode=1;
}
