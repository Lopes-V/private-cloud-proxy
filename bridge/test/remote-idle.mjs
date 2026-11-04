// Explicit idle/resume experiment. During the quiet window this makes NO requests.
import readline from 'node:readline';
import https from 'node:https';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const agent=new https.Agent({proxyEnv:process.env});
let phase='configuration';
try{
 let secret=process.env.TUNNEL_TOKEN;
 if(!secret&&process.argv.includes('--secret-stdin')){const rl=readline.createInterface({input:process.stdin,terminal:false});console.log('READY_FOR_SECRET');secret=await new Promise(resolve=>rl.once('line',value=>{rl.close();resolve(value);}));}
 if(!secret)throw new Error('Secure secret required');
 const root=new URL(process.env.TUNNEL_URL||'wss://private-cloud-proxy-free.onrender.com/tunnel');root.protocol='https:';
 if(!root.hostname.endsWith('.onrender.com'))throw new Error('Actual Render endpoint required');
 async function get(path,auth=false){return new Promise((resolve,reject)=>{
  const request=https.get(new URL(path,root),{agent,rejectUnauthorized:true,headers:auth?{Authorization:'Bearer '+secret}:{},timeout:90000},res=>{
   let body='';res.on('data',c=>{body+=c;if(body.length>65536)request.destroy();});res.on('end',()=>resolve({status:res.statusCode,body}));
  });request.on('timeout',()=>request.destroy(new Error('Timeout')));request.on('error',reject);
 });}
 phase='baseline';const baseline=await get('/usage',true);
 if(baseline.status!==200)throw new Error('Authentication failed');
 const before=JSON.parse(baseline.body);if(before.active!==0)throw new Error('Close active clients before idle experiment');
 console.log('IDLE_BASELINE',JSON.stringify(before));console.log('QUIET_WINDOW_STARTED: 17 minutes; no HTTP, WSS, health probes or keepalive during this window');
 phase='quiet-window';
 for(let minute=1;minute<=17;minute++){await wait(60000);console.log(`QUIET_WINDOW_LOCAL_TIMER: ${minute}/17 minutes; no remote requests sent`);}
 phase='resume';const start=Date.now();let health;
 for(let attempt=0;attempt<10;attempt++){
  health=await get('/health');
  if(health.status===200&&health.body==='ok')break;
  console.log('Resume status',health.status);await wait(5000);
 }
 if(health.status!==200||health.body!=='ok')throw new Error('Service did not resume');
 const afterResponse=await get('/usage',true);if(afterResponse.status!==200)throw new Error('Usage unavailable');
 const after=JSON.parse(afterResponse.body);
 console.log('IDLE_RESUME_RESULT',JSON.stringify({quietWindowMinutes:17,resumeLatencyMs:Date.now()-start,before,after,processRestartObserved:before.bytes>0&&after.bytes===0&&after.sessions===0,billing:'NOT VERIFIED'}));
 phase='authenticated-resume';process.env.TUNNEL_TOKEN=secret;process.env.TUNNEL_URL=root.href.replace('https:','wss:');
 await import('../check-remote.mjs');
} catch(error){console.error(JSON.stringify({idleAcceptance:'INCOMPLETE',phase,errorCode:error.code||error.name}));process.exitCode=1;}
finally{delete process.env.TUNNEL_TOKEN;agent.destroy();if(process.argv.includes('--secret-stdin'))process.stdin.destroy();}
