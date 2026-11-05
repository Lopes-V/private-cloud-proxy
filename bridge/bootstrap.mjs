// Built-ins only: this runs before start.mjs can import third-party packages.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const required=['ws','ipaddr.js'];
try{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 const require=createRequire(path.join(root,'package.json'));
 const ready=()=>{
  try{
   for(const name of required){
    const installed=JSON.parse(fs.readFileSync(path.join(root,'node_modules',name,'package.json'),'utf8'));
    if(installed.version!==manifest.dependencies[name])return false;
    require(name);
   }
   return true;
  }catch{return false;}
 };
 if(!ready()){
  console.log('Dependencias ausentes ou incompletas. Instalando as versoes fixadas no projeto...');
  const nodeDirectory=path.dirname(process.execPath);
  const npm=[path.join(nodeDirectory,'node_modules','npm','bin','npm-cli.js'),path.join(nodeDirectory,'..','lib','node_modules','npm','bin','npm-cli.js')].find(file=>fs.existsSync(file));
  if(!npm || !fs.existsSync(path.join(root,'package-lock.json')))throw new Error('Installer unavailable');
  const installed=spawnSync(process.execPath,[npm,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:root,stdio:'inherit',windowsHide:true,timeout:120000,env:Object.fromEntries(Object.entries(process.env).filter(([name])=>name!=='TUNNEL_TOKEN'))});
  if(installed.error || installed.status!==0 || !ready())throw new Error('Dependency install failed');
 }
}catch{
 console.error('Falha [DEPENDENCIES_UNAVAILABLE]: nao foi possivel preparar ws e ipaddr.js. Verifique a conexao e use a pasta completa, gravavel, com package-lock.json.');
 console.error('Alternativa: extraia o ZIP pronto de downloads/windows. Nao sao necessarios privilegios de administrador.');
 process.exitCode=1;
}
