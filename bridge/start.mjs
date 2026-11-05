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
  if (!process.stdin.isTTY) throw Object.assign(new Error('Interactive terminal required'),{code:'INTERACTIVE_REQUIRED'});
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
function startupFailure(stage,error) {
  if(error?.code==='INTERACTIVE_REQUIRED')return ['INTERACTIVE_REQUIRED','Abra Start-Private-Proxy.cmd em um terminal interativo para informar o segredo com entrada oculta.'];
  if(stage==='secret')return ['SECRET_INVALID','Copie o valor completo de TUNNEL_TOKEN no painel Render. O segredo precisa ter pelo menos 32 caracteres.'];
  if(stage==='usage')return ['USAGE_INVALID','Nao foi possivel ler ou validar bridge-usage.json em %LOCALAPPDATA%\\PrivateCloudProxy. Preserve esse arquivo de consumo e informe somente este codigo de erro.'];
  if(stage==='listen' && error?.code==='EADDRINUSE')return ['LOCAL_PORT_BUSY','A porta 127.0.0.1:17831 esta ocupada. Feche a janela anterior do cliente; se persistir, informe este codigo.'];
  if(stage==='listen')return ['LOCAL_LISTEN_FAILED','Nao foi possivel abrir 127.0.0.1:17831. Informe este codigo; nao altere as protecoes do Windows.'];
  if(stage==='browser_launch')return ['BROWSER_LAUNCH_FAILED','Nao foi possivel abrir o navegador.'];
  if(stage==='browser')return ['BROWSER_NOT_FOUND','Chrome ou Chromium nao foi encontrado nos locais usuais.'];
  if(stage==='directory')return ['DATA_DIRECTORY_UNAVAILABLE','Nao foi possivel acessar a pasta de dados em %LOCALAPPDATA%\\PrivateCloudProxy.'];
  if(stage==='lock')return ['CLIENT_LOCK_UNAVAILABLE','Outro cliente pode estar aberto ou seu arquivo de controle esta inacessivel. Feche a janela anterior e tente novamente.'];
  if(stage==='endpoint')return ['ENDPOINT_INVALID','Use a URL WSS completa do servico, terminada em /tunnel.'];
  return ['CLIENT_START_FAILED','Nao foi possivel iniciar o cliente. Informe somente este codigo de erro.'];
}
let proxy; let lock;let stage='browser';
function releaseLock() { if (lock) { try { fs.unlinkSync(lock); } catch {} lock = undefined; } }
process.once('exit', releaseLock);
try {
  const browser = findBrowser();
  stage='directory';
  const directory = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'.local','share'), 'PrivateCloudProxy');
  fs.mkdirSync(directory,{recursive:true});
  stage='lock';
  const lockFile = path.join(directory,'bridge.lock');
  if (fs.existsSync(lockFile)) {
    const pid = Number(fs.readFileSync(lockFile,'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid client lock');
    try { process.kill(pid,0); throw new Error('Client already active'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; fs.unlinkSync(lockFile); }
  }
  fs.writeFileSync(lockFile,String(process.pid),{flag:'wx',mode:0o600});lock=lockFile;
  stage='endpoint';
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
  stage='secret';
  const secret = process.env.TUNNEL_TOKEN || await ask('Segredo do serviço (entrada oculta; não será salvo): ',true);
  if(typeof secret!=='string' || secret.length<32)throw new Error('Invalid secret');
  stage='usage';
  const budget=new Budget({file:path.join(directory,'bridge-usage.json')});
  stage='proxy';
  proxy = createLocalProxy({ endpoint, secret, budget });
  stage='listen';
  const port = await proxy.listen(17831);
  stage='browser_launch';
  const child = spawn(browser,[`--user-data-dir=${path.join(directory,'ChromiumBridge')}`,
    `--proxy-server=http://127.0.0.1:${port}`, '--proxy-bypass-list=<-loopback>',
    '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--dns-prefetch-disable', '--no-first-run', 'https://example.com'], {stdio:'ignore',env:Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'TUNNEL_TOKEN'))});
  child.once('error',()=>{console.error('Falha [BROWSER_LAUNCH_FAILED]: Nao foi possivel abrir o navegador');proxy.close();process.exitCode=1;});
  console.log('Proxy local ativo. Mantenha esta janela aberta; Ctrl+C encerra o túnel.');
  console.log('Sem túnel, a navegação pelo proxy falha. A primeira conexão após suspensão pode demorar.');
  for (const sig of ['SIGINT','SIGTERM']) process.once(sig,()=>proxy.close().then(()=>process.exit(0)));
} catch(error) {
  const [code,message]=startupFailure(stage,error);
  console.error(`Falha de inicializacao [${code}]: ${message}`);
  console.error('Nenhuma validacao TLS foi desativada. O segredo nao foi exibido nem salvo.');
  await proxy?.close();process.exitCode=1;
}
