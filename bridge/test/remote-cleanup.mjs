// Explicit remote cleanup observation. Close other clients before running.
// Waits locally without keep-alive traffic; never included in npm test/CI.
import assert from 'node:assert/strict';
import https from 'node:https';
import readline from 'node:readline';
import {validateEndpoint} from '../client.mjs';
const agent=new https.Agent({proxyEnv:process.env});
try{
 let secret=process.env.TUNNEL_TOKEN;
 if(!secret&&process.argv.includes('--secret-stdin')){
  const rl=readline.createInterface({input:process.stdin,terminal:false});console.log('READY_FOR_SECRET');
  secret=await new Promise(resolve=>rl.once('line',v=>{rl.close();resolve(v);}));
 }
 if(!secret)throw new Error('Secure credential required');
 const url=new URL(validateEndpoint(process.env.TUNNEL_URL||'wss://private-cloud-proxy-free.onrender.com/tunnel'));url.protocol='https:';url.pathname='/usage';
 const inspect=()=>new Promise((resolve,reject)=>{
  const req=https.get(url,{agent,rejectUnauthorized:true,headers:{Authorization:'Bearer '+secret},timeout:15000},res=>{
   let body='';res.on('data',c=>body+=c);res.on('end',()=>{try{assert.equal(res.statusCode,200);resolve(JSON.parse(body));}catch(error){reject(error);}});
  });req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Timeout')));
 });
 const before=await inspect();
 await new Promise(resolve=>setTimeout(resolve,50000));
 const after=await inspect();assert.equal(after.active,0,'remote sessions remain after idle deadline; check for other active clients');
 console.log(JSON.stringify({remoteCleanup:'PASS',waitMs:50000,beforeActive:before.active,afterActive:after.active,bytesBefore:before.bytes,bytesAfter:after.bytes}));
}catch(error){console.error(JSON.stringify({remoteCleanup:'INCOMPLETE',errorCode:error.code||error.name}));process.exitCode=1;}
finally{agent.destroy();if(process.argv.includes('--secret-stdin'))process.stdin.destroy();}
