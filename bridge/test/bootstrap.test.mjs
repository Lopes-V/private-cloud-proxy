import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const project=fileURLToPath(new URL('../../',import.meta.url));
test('bootstrap installs missing locked packages without lifecycle scripts and accepts ready packages offline',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'proxy-bootstrap-'));
 try{
  fs.mkdirSync(path.join(directory,'bridge'));
  const source=path.join(project,'bridge','bootstrap.mjs'),entry=path.join(directory,'bridge','bootstrap.mjs');
  if(fs.existsSync(source))fs.copyFileSync(source,entry);
  const manifest=JSON.parse(fs.readFileSync(path.join(project,'package.json'),'utf8'));
  manifest.scripts.preinstall='node -e "require(\'fs\').writeFileSync(\'install-script-ran\',\'bad\')"';
  fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify(manifest));
  fs.copyFileSync(path.join(project,'package-lock.json'),path.join(directory,'package-lock.json'));
  const env={...process.env,npm_config_offline:'true'};
  let result;
  try{result=await run(process.execPath,[entry],{cwd:directory,env,timeout:30000});}
  catch(error){assert.fail(`bootstrap must install the real cached packages: ${error.stderr}`);}
  const loaded=await run(process.execPath,['--input-type=module','-e',"await import('ws');await import('ipaddr.js');console.log('loaded')"],{cwd:directory});
  assert.equal(loaded.stdout.trim(),'loaded');
  assert.equal(fs.existsSync(path.join(directory,'install-script-ran')),false);
  assert.equal(fs.existsSync(path.join(directory,'node_modules','playwright')),false,'only production packages belong in the client');
  // A ready bundle must work without npm ci or any network access.
  fs.unlinkSync(path.join(directory,'package-lock.json'));
  await run(process.execPath,[entry],{cwd:directory,env,timeout:5000});
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
