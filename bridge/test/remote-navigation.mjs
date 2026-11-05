// Explicit low-volume performance acceptance; never runs in npm test/CI.
import fs from 'node:fs';import readline from 'node:readline';import https from 'node:https';import {createRequire} from 'node:module';
import {createLocalProxy,validateEndpoint} from '../client.mjs';import {Budget} from '../budget.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'/opt/codex/cua_node/lib/node_modules/playwright-core');
let proxy,browser;const agent=new https.Agent({proxyEnv:process.env});
const result={scope:'RENDER_CONSECUTIVE_NAVIGATION',resourcesEnabled:true,atUTC:new Date().toISOString(),pages:[],diagnostics:[],limit:24*1024*1024};
try{
 let secret=process.env.TUNNEL_TOKEN;
 if(!secret&&process.argv.includes('--secret-stdin')){const rl=readline.createInterface({input:process.stdin,terminal:false});console.log('READY_FOR_SECRET');secret=await new Promise(resolve=>rl.once('line',v=>{rl.close();resolve(v);}));}
 if(!secret)throw new Error('Secure secret required');
 const endpoint=validateEndpoint(process.env.TUNNEL_URL||'wss://private-cloud-proxy-free.onrender.com/tunnel');
 const inspect=path=>new Promise((resolve,reject)=>{const url=new URL(endpoint);url.protocol='https:';url.pathname=path;
  const req=https.get(url,{agent,rejectUnauthorized:true,headers:{Authorization:'Bearer '+secret},timeout:20000},res=>{let data='';res.on('data',chunk=>{data+=chunk;if(data.length>16384)req.destroy();});res.on('end',()=>{try{if(res.statusCode!==200)throw new Error('Inspection rejected');resolve({revision:res.headers['x-relay-revision'],body:path==='/health'?data:JSON.parse(data)});}catch(error){reject(error);}});});req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Timeout')));
 });
 result.revision=(await inspect('/health')).revision;
 const budget=new Budget({limit:result.limit});proxy=createLocalProxy({endpoint,secret,budget,diagnostic:e=>{if(result.diagnostics.length<500)result.diagnostics.push(e);}});
 result.before=await proxy.checkRelay();if(result.before.active!==0 || result.before.processLimit-result.before.bytes<32*1024*1024)throw new Error('Clean benchmark requires idle service and sufficient quota');
 const port=await proxy.listen();const env={...process.env};delete env.TUNNEL_TOKEN;delete env.RENDER_API_KEY;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN||'/usr/bin/chromium',headless:true,env,proxy:{server:`http://127.0.0.1:${port}`},args:['--disable-quic','--proxy-bypass-list=<-loopback>','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--autoplay-policy=document-user-activation-required']});
 const page=await browser.newPage();const owners=new Map();let current;
 page.on('request',request=>{if(current){current.requests++;current.pending++;owners.set(request,current);}});
 page.on('response',response=>{const owner=owners.get(response.request());if(owner&&!owner.closed&&response.status()>=400)owner.failures.push('HTTP_'+response.status());});
 page.on('requestfinished',request=>{const owner=owners.get(request);if(owner){owner.pending--;if(!owner.closed)owner.completed[request.resourceType()]=(owner.completed[request.resourceType()]||0)+1;owners.delete(request);}});
 page.on('requestfailed',request=>{const owner=owners.get(request);if(owner){owner.pending--;const code=request.failure()?.errorText||'';if(!owner.closed)owner.failures.push(/^net::[A-Z0-9_]+$/.test(code)?code:'NETWORK_ERROR');else owner.failuresAfterObservation=(owner.failuresAfterObservation||0)+1;owners.delete(request);}});
 for(const [name,url] of [['Steam','https://store.steampowered.com/'],['Wikipedia','https://www.wikipedia.org/'],['SteamReturn','https://store.steampowered.com/']]){
  const entry={name,requests:0,pending:0,completed:{},failures:[]};result.pages.push(entry);current=entry;const start=performance.now();
  try{const response=await page.goto(url,{waitUntil:'load',timeout:60000});entry.status=response.status();entry.loadMs=Math.round(performance.now()-start);entry.title=await page.title();await page.waitForTimeout(5000);}
  catch(error){entry.error=(String(error.message).match(/net::[A-Z0-9_]+/)||[error.name])[0];}
  entry.pendingAtObservationEnd=entry.pending;entry.closed=true;current=undefined;entry.clientBytes=budget.used;
  console.log(JSON.stringify({name:entry.name,status:entry.status,loadMs:entry.loadMs,failures:entry.failures.length,pending:entry.pendingAtObservationEnd,error:entry.error}));
  if(entry.error)break;
 }
 await browser.close();browser=undefined;await proxy.close();proxy=undefined;
 result.after=(await inspect('/usage')).body;
 result.clientBytes=budget.used;result.accepted=result.pages.length===3&&result.pages.every(p=>p.status===200&&!p.error&&!p.failures.length&&(p.name==='Wikipedia'?/Wikipedia/i:/Steam/i).test(p.title||''))&&result.after.active===0;
}catch(error){result.errorCode=error.code||error.name;}
finally{await browser?.close();await proxy?.close();agent.destroy();
 const out=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);if(out)fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify({accepted:result.accepted,errorCode:result.errorCode,clientBytes:result.clientBytes,after:result.after}));if(!result.accepted)process.exitCode=1;if(process.argv.includes('--secret-stdin'))process.stdin.destroy();}
