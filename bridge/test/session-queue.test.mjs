import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('bounded FIFO queue grants a slot only after release',async()=>{
 assert.ok(fs.existsSync(new URL('../session-queue.mjs',import.meta.url)),'Session queue missing');
 const {SessionQueue}=await import('../session-queue.mjs');const q=new SessionQueue({limit:1,maxPending:2,waitMs:500});
 try{
  const release=await q.acquire();const order=[];
  const second=q.acquire().then(done=>{order.push(2);return done;});
  const third=q.acquire().then(done=>{order.push(3);return done;});
  await assert.rejects(q.acquire(),e=>e.failure==='QUEUE_FULL');assert.deepEqual(order,[]);
  release();release();const secondRelease=await second;assert.deepEqual(order,[2]);secondRelease();const thirdRelease=await third;assert.deepEqual(order,[2,3]);thirdRelease();
  assert.deepEqual(q.stats(),{active:0,waiting:0});
 }finally{q.close();}
});
test('queue timeout, abort and shutdown release waiters without granting',async()=>{
 const {SessionQueue}=await import('../session-queue.mjs');const q=new SessionQueue({limit:1,maxPending:2,waitMs:20});const held=await q.acquire();
 try{
  await assert.rejects(q.acquire(),e=>e.failure==='QUEUE_TIMEOUT');
  const c=new AbortController();const cancelled=q.acquire({signal:c.signal});c.abort();await assert.rejects(cancelled,e=>e.failure==='QUEUE_CANCELLED');
  const pending=q.acquire();q.close();await assert.rejects(pending,e=>e.failure==='QUEUE_CANCELLED');held();assert.deepEqual(q.stats(),{active:0,waiting:0});
 }finally{q.close();}
});
