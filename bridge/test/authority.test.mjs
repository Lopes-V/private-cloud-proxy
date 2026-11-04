import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../client.mjs';
test('CONNECT authorities preserve explicit port 80 and reject credential/path injection',()=>{
  assert.equal(typeof client.parseConnectAuthority,'function');
  assert.deepEqual(client.parseConnectAuthority('example.com:80'),{host:'example.com',port:80});
  assert.deepEqual(client.parseConnectAuthority('[2606:4700:4700::1111]:443'),{host:'2606:4700:4700::1111',port:443});
  for(const authority of ['user@example.com:443','example.com:443/path','example.com','example.com:443?secret=1'])assert.throws(()=>client.parseConnectAuthority(authority));
});
