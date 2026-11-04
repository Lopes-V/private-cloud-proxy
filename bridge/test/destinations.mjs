// Explicit, bounded live comparison. Local mode is NOT production validation.
import fs from 'node:fs';
import net from 'node:net';
import dns from 'node:dns/promises';
import { createRequire } from 'node:module';
import { fixture, run } from './fixtures.mjs';
import { createLocalProxy } from '../client.mjs';
const hosts=['api.ipify.org','www.wikipedia.org','store.steampowered.com'];
const remote=process.argv.includes('--remote');
let f,proxy,browser;
const env={...process.env};delete env.TUNNEL_TOKEN;delete env.RENDER_API_KEY;
try {
  if(remote && !process.env.TUNNEL_TOKEN) throw new Error('Remote secure binding unavailable');
  if(remote) {proxy=createLocalProxy({endpoint:'wss://private-cloud-proxy-free.onrender.com/tunnel',secret:process.env.TUNNEL_TOKEN,attempts:1});await proxy.listen();}
  else {f=await fixture({secured:true});proxy=f.client;}
  const port=proxy.server.address().port;
  console.log(JSON.stringify({mode:remote?'REMOTE_RENDER':'LOCAL_RELAY_PUBLIC_DNS',node:process.version}));
  for(const host of hosts) {
    // This DNS/TCP observation always describes the machine running this checker.
    try {
      const rows=await dns.lookup(host,{all:true});
      console.log(JSON.stringify({host,stage:'runner_dns',families:rows.map(r=>r.family)}));
      for(const row of rows) {
        const start=performance.now();
        await new Promise(resolve=>{
          const socket=net.connect({host:row.address,port:443,family:row.family});
          const done=code=>{console.log(JSON.stringify({host,stage:'runner_tcp',family:row.family,code,durationMs:Math.round(performance.now()-start)}));socket.destroy();resolve();};
          socket.once('connect',()=>done('CONNECTED'));socket.once('error',e=>done(e.code));socket.setTimeout(3000,()=>done('TIMEOUT'));
        });
      }
    } catch(e) {console.log(JSON.stringify({host,stage:'runner_dns',code:e.code}));}
    for(const protocol of ['http','https']) {
      try {
        const result=await run('curl',['-sS','--max-time','25','--noproxy','','--proxy',`http://127.0.0.1:${port}`,'-o','/dev/null','-w','%{http_code} %{http_connect} %{ssl_verify_result}',`${protocol}://${host}/`],{env});
        console.log(JSON.stringify({host,protocol,result:result.stdout}));
      } catch(e) {console.log(JSON.stringify({host,protocol,exit:e.code}));process.exitCode=1;}
    }
  }
  if(process.env.PLAYWRIGHT_MODULE) {
    const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN || '/usr/bin/chromium',headless:true,env,proxy:{server:`http://127.0.0.1:${port}`},args:['--disable-quic','--proxy-bypass-list=<-loopback>']});
    const page=await browser.newPage();
    // Bound traffic to top-level documents; rendering assets are outside this diagnostic.
    await page.route('**/*',route=>route.request().isNavigationRequest()?route.continue():route.abort());
    for(const host of hosts) {
      try {const response=await page.goto(`https://${host}/`,{waitUntil:'domcontentloaded',timeout:30000});console.log(JSON.stringify({host,stage:'chromium_document',status:response.status()}));}
      catch {console.log(JSON.stringify({host,stage:'chromium_document',result:'FAILED'}));process.exitCode=1;}
    }
    await proxy.close();
    try {await page.goto('https://api.ipify.org/?proxy-stopped=1',{timeout:5000});throw new Error('Direct fallback');}
    catch(e) {if(e.message==='Direct fallback')throw e;console.log('Chromium no direct fallback: PASS');}
  }
} finally {await browser?.close();if(f)await f.close();else await proxy?.close();}
