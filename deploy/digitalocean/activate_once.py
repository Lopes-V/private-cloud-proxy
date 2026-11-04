#!/usr/bin/env python3
"""Run existing activator once after ExecCondition's DNS/IP verification."""
import json
import os
import subprocess
import sys
from pathlib import Path

if __name__=='__main__':
    with open(sys.argv[1]) as f: settings=json.load(f)
    # An interrupted activation needs diagnosis; never replay partial setup blindly.
    stamp=Path('/etc/private-cloud-proxy/ACTIVATION_ATTEMPTED')
    fd=os.open(stamp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    os.close(fd)
    subprocess.run(['/bin/sh','/opt/private-cloud-proxy/deploy/activate.sh',settings['domain'],settings['email'],settings['client_cidr']],check=True)
