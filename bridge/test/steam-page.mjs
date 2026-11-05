// Explicit bounded production acceptance. All resource types remain enabled.
import fs from 'node:fs';
import readline from 'node:readline';
import https from 'node:https';
import {createRequire} from 'node:module';
import {createLocalProxy} from '../client.mjs';
import {Budget} from '../budget.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/cua_node/lib/node_modules/playwright-core');
const endpoint=process.env.TUNNEL_URL||'wss://private-cloud-proxy-free.onrender.com/tunnel';
let proxy,browser;const agent=new https.Agent({proxyEnv:process.env});
const result={scope:'REMOTE_RENDER_FULL_STEAM_INITIAL_PAGE',resourcesEnabled:true,limits:{clientBytes:24*1024*1024},responses:{},completed:{},failures:[],diagnostics:[]};
try{
 let secret=process.env.TUNNEL_TOKEN;
 if(!secret&&process.argv.includes('--secret-stdin')){const rl=readline.createInterface({input:process.stdin,terminal:false});console.log('READY_FOR_SECRET');secret=await new Promise(resolve=>rl.once('line',v=>{rl.close();resolve(v);}));}
 if(!secret)throw new Error('Secure credential required');
 async function inspect(path){return new Promise((resolve,reject)=>{const url=new URL(endpoint);url.protocol='https:';url.pathname=path;const req=https.get(url,{agent,rejectUnauthorized:true,headers:{Authorization:'Bearer '+secret},timeout:15000},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,revision:res.headers['x-relay-revision'],body}));});req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Timeout')));});}
 const health=await inspect('/health');result.revision=health.revision;const before=await inspect('/usage');if(before.status!==200)throw new Error('Authentication rejected');result.before=JSON.parse(before.body);
 if(result.before.processLimit-result.before.bytes<28*1024*1024)throw new Error('Insufficient remaining process budget');
 const budget=new Budget({limit:result.limits.clientBytes});
 proxy=createLocalProxy({endpoint,secret,budget,diagnostic:e=>{if(result.diagnostics.length<500)result.diagnostics.push(e);}});const port=await proxy.listen();
 const env={...process.env};delete env.TUNNEL_TOKEN;delete env.RENDER_API_KEY;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN||'/usr/bin/chromium',headless:true,env,proxy:{server:`http://127.0.0.1:${port}`},args:['--disable-quic','--proxy-bypass-list=<-loopback>','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--autoplay-policy=document-user-activation-required']});
 const page=await browser.newPage();let collecting=true,requests=0;const pending=new Set();
 const host=req=>{try{return new URL(req.url()).hostname;}catch{return 'invalid';}};
 page.on('request',req=>{if(collecting){requests++;pending.add(req);}});
 page.on('response',res=>{if(!collecting)return;const type=res.request().resourceType();const key=type+':'+res.status();result.responses[key]=(result.responses[key]||0)+1;if(res.status()>=400&&result.failures.length<300)result.failures.push({host:host(res.request()),type,status:res.status()});});
 page.on('requestfinished',req=>{pending.delete(req);if(collecting){const t=req.resourceType();result.completed[t]=(result.completed[t]||0)+1;}});
 page.on('requestfailed',req=>{pending.delete(req);if(collecting&&result.failures.length<300){const err=req.failure()?.errorText||'';result.failures.push({host:host(req),type:req.resourceType(),error:/^net::[A-Z0-9_]+$/.test(err)?err:'NETWORK_ERROR'});}});
 const started=performance.now();result.loadEvent=false;page.on('load',()=>{if(collecting){result.loadEvent=true;result.loadMs=Math.round(performance.now()-started);}});
 try{const response=await page.goto('https://store.steampowered.com/',{waitUntil:'domcontentloaded',timeout:60000});result.mainStatus=response.status();result.domContentLoadedMs=Math.round(performance.now()-started);try{await page.waitForLoadState('load',{timeout:60000});}catch{result.loadDeadlineExpired=true;}await page.waitForTimeout(8000);result.title=await page.title();result.documentReadyState=await page.evaluate(()=>document.readyState);}catch(error){result.navigationError=(String(error.message).match(/net::[A-Z0-9_]+/)||[error.name])[0];}
 collecting=false;result.durationMs=Math.round(performance.now()-started);result.requests=requests;result.pending=[...pending].map(req=>({type:req.resourceType(),host:host(req)}));result.clientBytes=budget.used;
 await browser.close();browser=undefined;await proxy.close();proxy=undefined;
 await new Promise(resolve=>setTimeout(resolve,1000));const after=await inspect('/usage');if(after.status===200)result.after=JSON.parse(after.body);
  const logs=await inspect('/diagnostics');if(logs.status===200){result.serverEvents=JSON.parse(logs.body).events;const byId=new Map(result.serverEvents.map(e=>[e.id,e]));result.correlated=result.diagnostics.filter(e=>byId.has(e.id)).map(e=>({id:e.id,clientFailure:e.failure,serverFailure:byId.get(e.id).failure}));}
 result.accepted=result.mainStatus===200&&/Steam/i.test(result.title||'')&&result.loadEvent&&result.failures.length===0&&['script','stylesheet','image'].every(t=>result.completed[t]>0);
 console.log(JSON.stringify({revision:result.revision,mainStatus:result.mainStatus,loadEvent:result.loadEvent,loadMs:result.loadMs,documentReadyState:result.documentReadyState,requests:result.requests,completed:result.completed,failedRequests:result.failures.length,pending:result.pending.length,clientBytes:result.clientBytes,correlated:result.correlated?.length,accepted:result.accepted},null,2));
 const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);if(output)fs.writeFileSync(output,JSON.stringify(result,null,2));
 if(!result.accepted)process.exitCode=1;
}catch(error){console.error(JSON.stringify({steamAcceptance:'INCOMPLETE',errorCode:error.code||error.name}));process.exitCode=1;}
finally{await browser?.close();await proxy?.close();agent.destroy();if(process.argv.includes('--secret-stdin'))process.stdin.destroy();}
