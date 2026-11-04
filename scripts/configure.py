#!/usr/bin/env python3
"""Read configuration secrets from a protected JSON file, not process arguments."""
import json
import os
import ssl
import sys
from pathlib import Path


def configuration(settings):
    for key in ('username','password','cert','key'):
        if not settings.get(key): raise ValueError('missing '+key)
    if len(settings['password']) < 24: raise ValueError('password must have at least 24 characters')
    ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(settings['cert'],settings['key'])
    return {
      'log': {'level':'error'},
      'services':[{'name':'private','addr':':8443','resolver':'safe','bypass':'ports','climiter':'connections',
        'metadata':{'dialTimeout':'5s'},
        'handler':{'type':'http','auth':{'username':settings['username'],'password':settings['password']},'metadata':{'readTimeout':'10s','idleTimeout':'60s'}},
        'listener':{'type':'tls','tls':{'certFile':settings['cert'],'keyFile':settings['key']}}}],
      'resolvers':[{'name':'safe','plugin':{'type':'http','addr':'http://127.0.0.1:18080/','timeout':3000000000}}],
      'bypasses':[{'name':'ports','whitelist':True,'matchers':['*:80','*:443']}],
      'climiters':[{'name':'connections','limits':['$ 32','$$ 16']}]
    }

if __name__=='__main__':
    result=configuration(json.loads(Path(sys.argv[1]).read_text()))
    fd=os.open(sys.argv[2],os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f: json.dump(result,f)
