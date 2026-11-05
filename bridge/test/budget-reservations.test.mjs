import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Budget } from '../budget.mjs';

function sandbox(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-reserved-budget-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return path.join(dir,'usage.json');
}

test('durably reserves high-water usage before forwarding and avoids writes per chunk',t=>{
  const file=sandbox(t);
  const budget=new Budget({limit:1024*1024,file,month:'2026-11'});
  budget.consume(8192);
  assert.equal(budget.used,8192);
  assert.equal(JSON.parse(fs.readFileSync(file)).used,256*1024);
  for(let i=0;i<50;i++)budget.consume(1024);
  assert.equal(budget.used,8192+50*1024);
  assert.equal(JSON.parse(fs.readFileSync(file)).used,256*1024);
  budget.consume(200*1024);
  assert.equal(JSON.parse(fs.readFileSync(file)).used,512*1024);
  assert.ok(budget.used <= budget.reserved);
});

test('restart charges unspent reservation instead of undercounting bytes',t=>{
  const file=sandbox(t);
  const first=new Budget({limit:1024*1024,file,month:'2026-11'});
  first.consume(1);
  const restarted=new Budget({limit:1024*1024,file,month:'2026-11'});
  assert.equal(restarted.used,256*1024);
  restarted.consume(1024);
  assert.equal(JSON.parse(fs.readFileSync(file)).used,512*1024);
});

test('small configured budgets preserve exact accounting and never exceed quota',t=>{
  const file=sandbox(t);
  const b=new Budget({limit:100,file,month:'2026-11'});
  b.consume(60);
  assert.equal(JSON.parse(fs.readFileSync(file)).used,60);
  assert.throws(()=>b.consume(41),/Traffic limit reached/);
  assert.equal(b.used,60);
  assert.equal(new Budget({limit:100,file,month:'2026-11'}).used,60);
});

test('reservation is clamped to remaining quota and is fail closed',t=>{
  const file=sandbox(t);
  const b=new Budget({limit:600*1024,file,month:'2026-11'});
  b.consume(550*1024);
  assert.equal(JSON.parse(fs.readFileSync(file)).used,600*1024);
  b.consume(50*1024);
  assert.throws(()=>b.consume(1),/Traffic limit reached/);
  assert.equal(b.used,600*1024);
});

test('failed persistence never increments in-memory usage',t=>{
  const file=sandbox(t), dir=path.dirname(file), obstacle=path.join(dir,'not-a-directory');
  fs.writeFileSync(obstacle,'block');
  const b=new Budget({limit:1024*1024,file:path.join(obstacle,'usage.json'),month:'2026-11'});
  assert.throws(()=>b.consume(8192));
  assert.equal(b.used,0);
  assert.equal(b.reserved,0);
});

test('corrupt or impossible persisted usage is rejected',t=>{
  const file=sandbox(t);
  fs.writeFileSync(file,JSON.stringify({month:'2026-11',used:200}));
  assert.throws(()=>new Budget({limit:100,file,month:'2026-11'}),/Invalid usage ledger/);
  fs.writeFileSync(file,'corrupt');
  assert.throws(()=>new Budget({limit:100,file,month:'2026-11'}));
});

test('no-file budgets keep exact usage with no reservation overhead',()=>{
  const b=new Budget({limit:1024*1024});
  b.consume(1024);
  assert.equal(b.used,1024);
  assert.equal(b.reserved,0);
});
