// Real Linux Chromium test. Adds one temporary test CA to NSS and removes it in finally.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fixture, SECRET } from './fixtures.mjs';
import { createLocalProxy } from '../client.mjs';
const require=createRequire(import.meta.url);
const { chromium }=require(process.env.PLAYWRIGHT_MODULE || '/opt/codex/cua_node/lib/node_modules/playwright-core');
const f=await fixture();
const db=path.join(os.homedir(),'.pki','nssdb');const existed=fs.existsSync(db);
const nickname=`private-bridge-test-${crypto.randomBytes(12).toString('hex')}`;
let added=false,browser,restartedClient;
try {
  fs.mkdirSync(db,{recursive:true});
  if(!fs.existsSync(path.join(db,'cert9.db')))execFileSync('certutil',['-N','--empty-password','-d',`sql:${db}`]);
  execFileSync('certutil',['-A','-d',`sql:${db}`,'-n',nickname,'-t','C,,','-i',path.join(f.dir,'ca.pem')]);added=true;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN || '/usr/bin/chromium',headless:true,
    proxy:{server:`http://127.0.0.1:${f.clientPort}`},args:['--proxy-bypass-list=<-loopback>','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
  const page=await browser.newPage();
  await page.goto(`http://localhost:${f.httpPort}/redirect`,{waitUntil:'networkidle'});
  assert.equal((await page.textContent('body')).trim(),'bridge-origin-ok');
  await page.goto(`https://localhost:${f.httpsPort}/hello`,{waitUntil:'networkidle'});
  assert.equal((await page.textContent('body')).trim(),'bridge-origin-ok');
  assert.ok(f.relay.usage().bytes>0);
  // A persistent Chromium profile retains its proxy address between launches.
  // Rebinding the same local port lets a restarted client restore that profile.
  await f.client.close();
  restartedClient=createLocalProxy({endpoint:`wss://localhost:${f.relayPort}/tunnel`,secret:SECRET,ca:fs.readFileSync(path.join(f.dir,'ca.pem')),ports:new Set([80,443,f.httpPort,f.httpsPort]),attempts:1});
  await restartedClient.listen(f.clientPort);
  await page.goto(`https://localhost:${f.httpsPort}/after-client-restart`,{waitUntil:'networkidle'});
  assert.equal((await page.textContent('body')).trim(),'bridge-origin-ok');
  await f.relay.close();const before=f.hits();
  await assert.rejects(page.goto(`https://localhost:${f.httpsPort}/after-down`,{timeout:5000}));
  assert.equal(f.hits(),before,'Chromium must not silently retry the destination directly');
  console.log('Chromium real: HTTP + HTTPS/CONNECT + authenticated WSS + trusted CA + client restart on same port + no direct fallback: PASS');
} finally {
  await browser?.close();await restartedClient?.close();await f.close();
  if(added)execFileSync('certutil',['-D','-d',`sql:${db}`,'-n',nickname]);
  if(!existed)fs.rmSync(db,{recursive:true,force:true});
}
