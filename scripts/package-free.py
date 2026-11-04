#!/usr/bin/env python3
"""Build a Windows x64 client bundle. Runtime downloads only after user starts it."""
from pathlib import Path
import zipfile
root=Path(__file__).resolve().parents[1]
target=Path('/workspace/private-cloud-proxy-free-windows.zip')
files=[root/p for p in ('Start-Private-Proxy.cmd','package.json','package-lock.json','README.md','bridge/README.md','bridge/start.mjs','bridge/client.mjs','bridge/budget.mjs','bridge/policy.mjs')]
for package in ('ws','ipaddr.js'):
    directory=root/'node_modules'/package
    if not directory.is_dir(): raise SystemExit('Run npm ci --ignore-scripts before packaging')
    files.extend(p for p in directory.rglob('*') if p.is_file())
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as archive:
    for p in files: archive.write(p,p.relative_to(root))
with zipfile.ZipFile(target) as archive:
    assert 'Start-Private-Proxy.cmd' in archive.namelist()
    assert not any(n.endswith(('.pem','.key','.env','.exe')) for n in archive.namelist())
print(target)
