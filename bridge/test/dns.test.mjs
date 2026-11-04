import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { Resolver } from 'node:dns/promises';
import { resolvePublic } from '../policy.mjs';

test('real DNS server changes public answer to loopback; second resolution is denied', async () => {
  const dns=dgram.createSocket('udp4');let queries=0;
  dns.on('message',(query,peer)=>{
    let end=12;while(query[end])end+=query[end]+1;end+=5;
    const header=Buffer.alloc(12);query.copy(header,0,0,2);header.writeUInt16BE(0x8180,2);header.writeUInt16BE(1,4);header.writeUInt16BE(1,6);
    const answer=Buffer.from([0xc0,0x0c,0,1,0,1,0,0,0,0,0,4,...(++queries===1?[8,8,8,8]:[127,0,0,1])]);
    dns.send(Buffer.concat([header,query.subarray(12,end),answer]),peer.port,peer.address);
  });
  await new Promise(resolve=>dns.bind(0,'127.0.0.1',resolve));
  try {
    const resolver=new Resolver({timeout:500,tries:1});resolver.setServers([`127.0.0.1:${dns.address().port}`]);
    const lookup=async host=>(await resolver.resolve4(host)).map(address=>({address}));
    assert.equal(await resolvePublic('changing.example',lookup),'8.8.8.8');
    await assert.rejects(resolvePublic('changing.example',lookup));
    assert.equal(queries,2);
  } finally {await new Promise(resolve=>dns.close(resolve));}
});
