import {test} from 'node:test';import assert from 'node:assert/strict';import https from 'node:https';import fs from 'node:fs';
import {fixture,SECRET,request} from './fixtures.mjs';
test('authenticated bounded diagnostic history matches emitted IDs without secrets or destinations',async()=>{
 const emitted=[];const f=await fixture({clientOptions:{diagnostic:()=>{}},relayOptions:{diagnostic:e=>emitted.push(e),resolve:async()=>{throw Object.assign(new Error('private destination detail'),{code:'ENOTFOUND'});}}});
 const read=authorized=>new Promise((resolve,reject)=>https.get({hostname:'localhost',port:f.relayPort,path:'/diagnostics',ca:fs.readFileSync(`${f.dir}/ca.pem`),headers:authorized?{Authorization:`Bearer ${SECRET}`}:{ }},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}));}).on('error',reject));
 try{
  assert.equal((await read(false)).status,401);
  for(let i=0;i<66;i++)assert.equal((await request(f)).status,502);
  const result=await read(true);assert.equal(result.status,200);const history=JSON.parse(result.body).events;
  assert.equal(history.length,64);assert.equal(history.at(-1).id,emitted.at(-1).id);
  assert.doesNotMatch(result.body,/private destination|remote-only|test-secret|Authorization/);
 }finally{await f.close();}
});
