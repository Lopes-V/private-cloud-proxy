"""Optional real Chromium test. Temporarily trusts test CA in user's NSS database.
Restores the added certificate in finally. Requires network/socket permissions.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid
from test_https_integration import HTTPSIntegration

HTTPSIntegration.setUpClass()
t=HTTPSIntegration
nickname='private-proxy-test-'+uuid.uuid4().hex
db=Path.home()/'.pki/nssdb'
created=not db.exists()
added=False
try:
    db.mkdir(parents=True,exist_ok=True)
    if not (db/'cert9.db').exists():
        subprocess.run(['certutil','-N','--empty-password','-d','sql:'+str(db)],check=True)
    subprocess.run(['certutil','-A','-d','sql:'+str(db),'-n',nickname,'-t','C,,','-i',str(t.d/'ca.pem')],check=True)
    added=True
    js="""
const {chromium}=require('/opt/codex/cua_node/lib/node_modules/playwright-core');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,proxy:{server:process.env.TEST_PROXY,username:'test',password:'test-only-password-32-characters'},args:['--proxy-bypass-list=<-loopback>']});
 try {
 const page=await browser.newPage();
 await page.goto(process.env.TEST_ORIGIN,{timeout:15000});
 const text=await page.textContent('body');
 if(text.trim()!=='HTTPS via real CONNECT')throw Error('Unexpected body');
 console.log('Chromium: TLS proxy, authentication, CONNECT and origin TLS passed');
 }finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exit(1)});
"""
    env=dict(os.environ,TEST_PROXY=f'https://localhost:{t.port}',TEST_ORIGIN=f'https://localhost:{t.origin.server_port}/')
    subprocess.run(['node','-e',js],env=env,check=True,timeout=30)
finally:
    if added: subprocess.run(['certutil','-D','-d','sql:'+str(db),'-n',nickname],check=True)
    if created:
        import shutil
        shutil.rmtree(db)
    t.tearDownClass()
