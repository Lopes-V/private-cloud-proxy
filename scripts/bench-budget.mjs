#!/usr/bin/env node
// Reproducible microbenchmark of the ledger hot path, not a browser latency claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Budget } from '../bridge/budget.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-budget-bench-'));
const blocks=Number(process.env.BENCH_BLOCKS || 8192);
const blockSize=4096;
const limit=128*1024*1024;
if(!Number.isSafeInteger(blocks)||blocks<1||blocks*blockSize>limit)throw new Error('Invalid BENCH_BLOCKS');

function benchmark(mode) {
  const file=path.join(dir,`${mode}.json`);
  let writes=0,used=0;
  const start=performance.now();
  if(mode==='before') {
    // Original Budget.consume implementation, reproduced here for comparison.
    for(let i=0;i<blocks;i++) {
      used+=blockSize;
      const tmp=`${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp,JSON.stringify({month:'2026-11',used}),{mode:0o600});
      fs.renameSync(tmp,file);
      writes++;
    }
  } else {
    const budget=new Budget({file,limit,month:'2026-11'});
    // Count durable watermark changes without replacing global filesystem methods.
    let last=0;
    for(let i=0;i<blocks;i++) {
      budget.consume(blockSize);
      if(budget.reserved!==last){writes++;last=budget.reserved;}
    }
    used=budget.used;
    assert.ok(budget.reserved>=used);
  }
  const durationMs=Math.round((performance.now()-start)*10)/10;
  const persisted=JSON.parse(fs.readFileSync(file,'utf8')).used;
  assert.equal(used,blocks*blockSize);
  assert.ok(persisted>=used&&persisted<=limit);
  return {method:mode,blocks,bytes:used,persistentWrites:writes,durationMs};
}
try {
  const before=benchmark('before'),after=benchmark('after');
  console.log(JSON.stringify({before,after,writeReductionFactor:Math.round(before.persistentWrites/after.persistentWrites)},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
