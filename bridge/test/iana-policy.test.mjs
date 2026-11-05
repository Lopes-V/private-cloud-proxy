import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ipaddr from 'ipaddr.js';
import {isPublic,resolvePublicAddresses} from '../policy.mjs';
const snapshot=JSON.parse(fs.readFileSync(new URL('../data/iana-special.json',import.meta.url),'utf8'));
test('every IANA special-purpose range is denied at its boundaries',()=>{
 for(const entry of snapshot.entries)for(const cidr of entry.prefixes){
  const [ip,bits]=ipaddr.parseCIDR(cidr);const first=ip.toByteArray();
  for(let bit=bits;bit<first.length*8;bit++)first[Math.floor(bit/8)]&=~(1<<(7-bit%8));
  const last=[...first];for(let bit=bits;bit<last.length*8;bit++)last[Math.floor(bit/8)]|=1<<(7-bit%8);
  for(const bytes of [first,last]){const address=ipaddr.fromByteArray(bytes).toString();assert.equal(isPublic(address),false,`${cidr}: ${address} must be denied (${entry.name})`);}
 }
});
test('IPv6 translation/transition and mixed DNS answers stay blocked',async()=>{
 for(const ip of ['64:ff9b::a00:1','64:ff9b:1::1','2002:7f00:1::','::ffff:8.8.8.8','::8.8.8.8','2001::1','fe80::1%eth0','4000::1','8000::1','fec0::1'])assert.equal(isPublic(ip),false,ip);
 await assert.rejects(resolvePublicAddresses('mixed.example',async()=>[{address:'8.8.8.8'},{address:'100.64.0.1'}]));
 assert.equal(isPublic('8.8.8.8'),true);assert.equal(isPublic('2606:4700:4700::1111'),true);
});
