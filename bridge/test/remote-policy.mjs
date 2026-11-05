// Explicit, low-volume remote policy/concurrency acceptance; never in npm test.
import assert from 'node:assert/strict';
import readline from 'node:readline';
import https from 'node:https';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {WebSocket} from 'ws';
import {createLocalProxy} from '../client.mjs';
import {Budget} from '../budget.mjs';
const run=promisify(execFile);let proxy;const agent=new https.Agent({proxyEnv:process.env});
try{
 let secret=process.env.TUNNEL_TOKEN;
 if(!secret&&process.argv.includes('--secret-stdin')){const rl=readline.createInterface({input:process.stdin,terminal:false});console.log('READY_FOR_SECRET');secret=await new Promise(resolve=>rl.once('line',value=>{rl.close();resolve(value);}));}
 if(!secret)throw new Error('Secure binding required');
 const endpoint=process.env.TUNNEL_URL||'wss://private-cloud-proxy-free.onrender.com/tunnel';
 for(const destination of [{host:'169.254.169.254',port:80},{host:'127.0.0.1',port:80},{host:'example.com',port:22}]){
  const verdict=await new Promise((resolve,reject)=>{
   const ws=new WebSocket(endpoint,{agent,headers:{Authorization:'Bearer '+secret},rejectUnauthorized:true,handshakeTimeout:10000});
   const timer=setTimeout(()=>{ws.terminate();reject(new Error('Missing rejection verdict'));},10000);
   ws.on('error',reject);ws.on('unexpected-response',(_req,res)=>{res.resume();clearTimeout(timer);ws.terminate();reject(new Error('Upgrade rejected'));});
   ws.once('open',()=>ws.send(JSON.stringify(destination)));
   ws.once('message',data=>{clearTimeout(timer);try{resolve(JSON.parse(data.toString()));}catch(error){reject(error);}finally{ws.terminate();}});
  });assert.equal(verdict.ready,false);assert.equal(verdict.failure,'DNS_REJECTED');assert.match(verdict.id,/^[a-f0-9-]{36}$/);console.log('Remote server destination restriction:',destination.host,destination.port,'PASS');
 }
 proxy=createLocalProxy({endpoint,secret,budget:new Budget({limit:1024*1024}),attempts:1});const port=await proxy.listen();
 const env={...process.env};delete env.TUNNEL_TOKEN;
 const responses=await Promise.all(Array.from({length:3},()=>run('curl',['-fsS','--max-time','30','--noproxy','','--proxy',`http://127.0.0.1:${port}`,'-o','/dev/null','-w','%{http_code}','https://example.com/'],{env})));
 assert.ok(responses.every(response=>response.stdout==='200'));console.log('Three concurrent remote HTTPS tunnels: PASS');
}catch(error){console.error(JSON.stringify({remotePolicy:'INCOMPLETE',errorCode:error.code||error.name}));process.exitCode=1;}
finally{await proxy?.close();agent.destroy();if(process.argv.includes('--secret-stdin'))process.stdin.destroy();}
