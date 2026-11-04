// Explicit acceptance against the user's deployed Render service. Never in npm test.
import assert from 'node:assert/strict';
import readline from 'node:readline';
import net from 'node:net';
import { createRequire } from 'node:module';
import { createLocalProxy, validateEndpoint } from '../client.mjs';
import { Budget } from '../budget.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('/opt/codex/cua_node/lib/node_modules/playwright-core');
let proxy,browser,phase='configuration';
try {
  let secret=process.env.TUNNEL_TOKEN;
  if(!secret && process.argv.includes('--secret-stdin')) {
    const rl=readline.createInterface({input:process.stdin,terminal:false});
    console.log('READY_FOR_SECRET');
    secret=await new Promise(resolve=>rl.once('line',value=>{rl.close();resolve(value);}));
  }
  if(!secret)throw new Error('Secure secret binding required');
  const endpoint=validateEndpoint(process.env.TUNNEL_URL || 'wss://private-cloud-proxy-free.onrender.com/tunnel');
  proxy=createLocalProxy({endpoint,secret,budget:new Budget({limit:4*1024*1024})});
  const port=await proxy.listen();
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,
    env:Object.fromEntries(Object.entries(process.env).filter(([key])=>key!=='TUNNEL_TOKEN')),
    proxy:{server:`http://127.0.0.1:${port}`},args:['--proxy-bypass-list=<-loopback>','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
  const page=await browser.newPage();
  for(const url of ['http://example.com/','https://example.com/']) {
    phase=new URL(url).protocol;
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:90000});
    assert.equal(await page.title(),'Example Domain');
    console.log(`Chromium real via remote Render WSS: ${phase} PASS`);
  }
  phase='egress-IP';
  await page.goto('https://api.ipify.org?format=json',{waitUntil:'domcontentloaded',timeout:90000});
  const ip=JSON.parse(await page.textContent('body')).ip;assert.ok(net.isIP(ip));
  console.log('Chromium observed remote egress IP:',ip);
  phase='no-direct-fallback';await proxy.close();
  await assert.rejects(page.goto('https://example.com/?proxy-stopped=1',{timeout:10000}));
  console.log('Chromium remote acceptance: authenticated WSS, HTTP, HTTPS, IP and fail-closed navigation PASS');
}catch(error){console.error(JSON.stringify({remoteBrowser:'INCOMPLETE',phase,errorCode:error.code||error.name}));process.exitCode=1;}
finally {await browser?.close();await proxy?.close();if(process.argv.includes('--secret-stdin'))process.stdin.destroy();}
