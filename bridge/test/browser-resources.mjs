// Offline full-resource Chromium acceptance: scripts, styles and 12 image hosts.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';
import {fixture} from './fixtures.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'/opt/codex/cua_node/lib/node_modules/playwright-core');
let port,browser,active=0,peak=0;
const f=await fixture({clientOptions:{maxSessions:2,maxQueued:32,queueWaitMs:3000},originHandler:(req,res)=>{
 if(req.url==='/burst'){
  const images=Array.from({length:12},(_,i)=>`<img src="http://r${i}.lab.invalid:${port}/pixel">`).join('');
  res.setHeader('Content-Type','text/html');res.end(`<html><head><title>Resource queue</title><link rel="stylesheet" href="http://css.lab.invalid:${port}/style"><script src="http://js.lab.invalid:${port}/script"></script></head><body class="queue-ok">${images}</body></html>`);return true;
 }
 if(['/pixel','/script','/style'].includes(req.url)){
  active++;peak=Math.max(peak,active);res.once('close',()=>active--);
  setTimeout(()=>{if(req.url==='/pixel'){res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64'));}else if(req.url==='/script'){res.setHeader('Content-Type','application/javascript');res.end('window.bridgeScriptLoaded=true;');}else{res.setHeader('Content-Type','text/css');res.end('.queue-ok {color:rgb(0,128,0)}');}},40);return true;
 }return false;
}});port=f.httpPort;
const db=path.join(os.homedir(),'.pki','nssdb'),existed=fs.existsSync(db),nickname='resource-queue-'+crypto.randomBytes(12).toString('hex');let added=false;
try{
 fs.mkdirSync(db,{recursive:true});if(!fs.existsSync(path.join(db,'cert9.db')))execFileSync('certutil',['-N','--empty-password','-d',`sql:${db}`]);
 execFileSync('certutil',['-A','-d',`sql:${db}`,'-n',nickname,'-t','C,,','-i',path.join(f.dir,'ca.pem')]);added=true;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN||'/usr/bin/chromium',headless:true,proxy:{server:`http://127.0.0.1:${f.clientPort}`},args:['--proxy-bypass-list=<-loopback>','--disable-quic']});
 const page=await browser.newPage();const errors=[];page.on('requestfailed',req=>errors.push(req.resourceType()));
 await page.goto(`http://main.lab.invalid:${port}/burst`,{waitUntil:'load',timeout:15000});
 assert.equal(await page.evaluate(()=>window.bridgeScriptLoaded),true);
 assert.equal(await page.locator('img').evaluateAll(images=>images.filter(i=>i.complete&&i.naturalWidth>0).length),12);
 assert.equal(await page.locator('body').evaluate(body=>getComputedStyle(body).color),'rgb(0, 128, 0)');
 assert.deepEqual(errors,[]);assert.ok(peak<=2,`peak ${peak} exceeded client session limit`);
 console.log('Chromium full resources: 12 image hosts + CSS + JS completed; concurrency <= 2; no resource blocking: PASS');
}finally{await browser?.close();await f.close();if(added)execFileSync('certutil',['-D','-d',`sql:${db}`,'-n',nickname]);if(!existed)fs.rmSync(db,{recursive:true,force:true});}
