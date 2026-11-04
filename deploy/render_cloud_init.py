#!/usr/bin/env python3
"""Render self-contained cloud-init for a new Ubuntu VM. No secrets included."""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
files=['scripts/policy.py','scripts/configure.py','deploy/install.sh','deploy/renew.sh','deploy/activate.sh','deploy/private-cloud-proxy.service','deploy/private-cloud-policy.service']
config={'package_update':True,'packages':['curl','ca-certificates','python3','certbot','iptables','iptables-persistent'], 'write_files':[{'path':'/opt/private-cloud-proxy/'+p,'permissions':'0755' if p.endswith(('.sh','.py')) else '0644','content':(root/p).read_text()} for p in files], 'runcmd':[['/bin/sh','/opt/private-cloud-proxy/deploy/install.sh']]}
(root/'deploy/cloud-init.yaml').write_text('#cloud-config\n'+json.dumps(config,indent=2)+'\n')
