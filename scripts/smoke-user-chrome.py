#!/usr/bin/env python3
"""Windows-only HTTP and real HTTPS CONNECT smoke with the supplied EXE and a temporary test-main ASAR."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

spec = importlib.util.spec_from_file_location('package_user_chrome', Path(__file__).with_name('package-user-chrome.py'))
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parents[1]
    parser.add_argument('--bundle', required=True, type=Path)
    parser.add_argument('--asar', type=Path, default=root / 'tools/user-chrome/node_modules/@electron/asar/bin/asar.js')
    parser.add_argument('--report', type=Path, default=root / 'dist/User-Chrome-Native-Smoke.json')
    args = parser.parse_args()
    if sys.platform != 'win32':
        parser.error('Native smoke requires Windows; do not execute the supplied EXE on Linux')
    with tempfile.TemporaryDirectory(prefix='private-proxy-native-') as temporary:
        runtime = Path(temporary) / 'ChromeProtegido'
        with zipfile.ZipFile(args.bundle) as bundle:
            provenance = json.loads(bundle.read('User-Chrome-Provenance.json'))
            if provenance['archiveSha256'] != pack.ARCHIVE_SHA256:
                raise ValueError('Bundle does not identify the pinned supplied archive')
            pack.extract_runtime(bundle, runtime, prefix='ChromeProtegido/')
        pack.verify_runtime(runtime, provenance['originalRuntimeSha256'])
        if pack.digest(runtime / 'resources/app.asar') != provenance['appAsarSha256']:
            raise ValueError('Packaged app.asar digest mismatch')
        pack.pack_asar(root, runtime / 'resources/app.asar', args.asar, smoke=True)
        # Verify only the ASAR changed, including after replacing its main for the smoke.
        pack.verify_runtime(runtime, provenance['originalRuntimeSha256'])
        report = Path(temporary) / 'report.json'
        environment = {key: value for key, value in os.environ.items() if key.upper() not in {'TUNNEL_TOKEN', 'ELECTRON_RUN_AS_NODE'}}
        environment.update(PCP_SMOKE_PROFILE=str(Path(temporary) / 'profile'), PCP_SMOKE_REPORT=str(report))
        result = subprocess.run([str(runtime / 'ChromeProtegido.exe')], cwd=runtime, env=environment, timeout=120, check=False)
        if not report.is_file():
            raise RuntimeError(f'Native smoke exited {result.returncode} without a result')
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_bytes(report.read_bytes())
        data = json.loads(report.read_text(encoding='utf-8'))
        if result.returncode != 0 or data.get('passed') is not True or data.get('nativeRuntime') != '31.7.7' or data.get('transport') != 'HTTP+HTTPS CONNECT':
            raise RuntimeError(f'Native HTTP/HTTPS CONNECT smoke failed: {data}')
        print(json.dumps(data, indent=2))


if __name__ == '__main__':
    main()
