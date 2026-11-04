// Explicit remote acceptance check. No background polling or keep-alive.
import https from 'node:https';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLocalProxy, validateEndpoint } from './client.mjs';
import { Budget } from './budget.mjs';
const run=promisify(execFile);
let local;
let phase="configuration";
const results={};
const childEnv={...process.env};delete childEnv.TUNNEL_TOKEN;
const agent=new https.Agent({proxyEnv:process.env});
try {
  const endpoint=validateEndpoint(process.env.TUNNEL_URL || '');
  const base=new URL(endpoint);
  if(!base.hostname.endsWith('.onrender.com'))throw new Error('Use the actual free onrender.com endpoint');
  base.protocol='https:';
  async function inspect(path,authenticated=false){
    const url=new URL(path,base);
    return new Promise((resolve,reject)=>{
      const request=https.get(url,{agent,rejectUnauthorized:true,headers:authenticated?{Authorization:`Bearer ${process.env.TUNNEL_TOKEN}`}:{},timeout:90000},res=>{
        let body='';res.on('data',chunk=>{body+=chunk;if(body.length>65536)request.destroy();});res.on('end',()=>resolve({status:res.statusCode,body}));
      });
      request.on('timeout',()=>request.destroy(new Error('Endpoint timeout')));request.on('error',reject);
    });
  }
  phase='health';const health=await inspect('/health');if(health.status!==200 || health.body!=='ok')throw new Error('Endpoint not ready');
  const unauth=await inspect('/usage');if(unauth.status!==401)throw new Error('Anonymous usage endpoint accepted');
  console.log('Remote TLS, /health and unauthenticated rejection: PASS');
  if(!process.env.TUNNEL_TOKEN){console.log('Authenticated tunnel, egress IP and browser NOT tested: provide token through secure environment, never chat.');process.exitCode=2;}
  else {
    local=createLocalProxy({endpoint,secret:process.env.TUNNEL_TOKEN,budget:new Budget({limit:4*1024*1024})});
    const port=await local.listen();
    console.log('Authenticated acceptance started');
    async function via(url){return run('curl',['-sS','--fail-with-body','--location','--max-redirs','5','--max-time','110','--noproxy','','--proxy',`http://127.0.0.1:${port}`,url],{maxBuffer:1024*1024,env:childEnv});}
    phase='HTTP';const http=await via('http://example.com/');if(!http.stdout.length)throw new Error('HTTP empty response');
    results.HTTP='PASS';console.log('Remote HTTP through WSS: PASS');
    phase='HTTPS_CONNECT';const encrypted=await via('https://example.com/');if(!encrypted.stdout.includes('Example Domain'))throw new Error('HTTPS failed');
    results.HTTPS_CONNECT='PASS';console.log('Remote HTTPS CONNECT: PASS');
    phase='egress_IP';const ip=JSON.parse((await via('https://api.ipify.org?format=json')).stdout).ip;if(!net.isIP(ip))throw new Error('Missing egress IP');
    results.observedEgressIP=ip;console.log('Observed remote egress IP:',ip);
    phase='metadata_block';const blocked=await run('curl',['-sS','--max-time','10','--noproxy','','--proxy',`http://127.0.0.1:${port}`,'-o',process.platform==='win32'?'NUL':'/dev/null','-w','%{http_code}','http://169.254.169.254/'],{env:childEnv});
    if(blocked.stdout!=='502')throw new Error('Metadata was not blocked');
    results.metadataBlock='PASS';console.log('Remote metadata destination denied: PASS');
    phase='counters';const counters=await inspect('/usage',true);if(counters.status!==200)throw new Error('Counters unavailable');
    console.log(JSON.stringify({HTTP:'PASS',HTTPS_CONNECT:'PASS',metadataBlock:'PASS',observedEgressIP:ip,counters:JSON.parse(counters.body),billing:'NOT VERIFIED',coldStartAfterInactivity:'NOT VERIFIED',browser:'run the Windows launcher'},null,2));
  }
} catch(error) {console.error(JSON.stringify({acceptance:'INCOMPLETE',phase,errorCode:error.code||error.name,passed:results}));process.exitCode=1;}
finally{await local?.close();agent.destroy();}
