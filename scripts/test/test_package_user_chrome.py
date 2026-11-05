import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'package-user-chrome.py'
spec = importlib.util.spec_from_file_location('package_user_chrome', SCRIPT)
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)


class PackageUserChromeTests(unittest.TestCase):
    def test_rejects_unverified_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'fake.zip'
            archive.write_bytes(b'not the supplied Chrome')
            with self.assertRaisesRegex(ValueError, 'size|SHA256'):
                pack.verify_archive(archive)

    def test_rejects_wrong_hash_even_with_the_pinned_size(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'same-size.zip'
            with archive.open('wb') as stream:
                stream.truncate(pack.ARCHIVE_SIZE)
            with self.assertRaisesRegex(ValueError, 'SHA256'):
                pack.verify_archive(archive)

    def test_rejects_traversal_duplicate_symlink_and_oversized_members(self):
        for name, mode, duplicate, size_limit in [
            ('dist/win-unpacked/../escape', 0, False, None),
            ('dist/win-unpacked/C:/escape', 0, False, None),
            ('dist/win-unpacked/folder/./aliased', 0, False, None),
            ('dist/win-unpacked/folder//aliased', 0, False, None),
            ('dist/win-unpacked/NUL.txt', 0, False, None),
            ('dist/win-unpacked/linked', 0o120777, False, None),
            ('dist/win-unpacked/duplicate', 0, True, None),
            ('dist/win-unpacked/oversized', 0, False, 2),
        ]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                archive = Path(directory) / 'fake.zip'
                with zipfile.ZipFile(archive, 'w') as zipped:
                    info = zipfile.ZipInfo(name)
                    info.external_attr = mode << 16
                    zipped.writestr(info, 'payload')
                    for required in ['ChromeProtegido.exe', 'LICENSE.electron.txt', 'LICENSES.chromium.html', 'resources/app.asar']:
                        zipped.writestr('dist/win-unpacked/' + required, required)
                    if duplicate:
                        import warnings
                        with warnings.catch_warnings():
                            warnings.simplefilter('ignore')
                            zipped.writestr(name, 'again')
                with zipfile.ZipFile(archive) as zipped:
                    with self.assertRaises(ValueError):
                        pack.extract_runtime(zipped, Path(directory) / 'runtime', max_size=size_limit or pack.MAX_RUNTIME_SIZE)
                self.assertFalse((Path(directory) / 'escape').exists())

    def test_preserves_runtime_licenses_and_detects_binary_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory) / 'runtime'
            archive = Path(directory) / 'fake.zip'
            with zipfile.ZipFile(archive, 'w') as zipped:
                for name in ['ChromeProtegido.exe', 'LICENSE.electron.txt', 'LICENSES.chromium.html', 'resources/app.asar']:
                    zipped.writestr('dist/win-unpacked/' + name, name)
            with zipfile.ZipFile(archive) as zipped:
                hashes = pack.extract_runtime(zipped, runtime)
            (runtime / 'resources/app.asar').write_text('replacement from sources')
            pack.verify_runtime(runtime, hashes)
            self.assertTrue((runtime / 'LICENSE.electron.txt').is_file())
            (runtime / 'ChromeProtegido.exe').write_text('changed')
            with self.assertRaisesRegex(ValueError, 'ChromeProtegido.exe'):
                pack.verify_runtime(runtime, hashes)

    def test_packaging_rejects_private_key_files_and_complete_pem_blocks(self):
        with tempfile.TemporaryDirectory() as directory:
            bundle = Path(directory)
            for name in ('accidental.key', '.ENV.local', 'accidental.PFX'):
                secret = bundle / name
                secret.write_text('placeholder')
                with self.assertRaisesRegex(ValueError, 'key|credential'):
                    pack.validate_bundle_secrets(bundle)
                secret.unlink()
            # Synthetic marker, never a usable key: verifies the packaging guard.
            source = bundle / 'source.js'
            source.write_bytes(b'-----BEGIN PRIVATE KEY-----\n' + b'A' * 64 + b'\n-----END PRIVATE KEY-----')
            with self.assertRaisesRegex(ValueError, 'key|credential'):
                pack.validate_bundle_secrets(bundle)
            source.write_text('process.env.TUNNEL_TOKEN is read by the bridge only')
            pack.validate_bundle_secrets(bundle)

    def test_launcher_selects_supplied_executable_and_public_endpoint(self):
        launcher = pack.launcher_bytes(Path(__file__).resolve().parents[2], pack.DEFAULT_ENDPOINT)
        self.assertIn(b'set "PCP_PROTECTED_BROWSER_EXE=%~dp0ChromeProtegido\\ChromeProtegido.exe"', launcher)
        self.assertIn(pack.DEFAULT_ENDPOINT.encode(), launcher)
        self.assertNotIn(b'TUNNEL_TOKEN=', launcher)

    def test_confirm_form_accepts_only_public_google_https_download(self):
        html = '<form action="https://drive.usercontent.google.com/download"><input type="hidden" name="id" value="public-id"><input type="hidden" name="confirm" value="t"></form>'
        self.assertIn('confirm=t', pack.confirm_url(html))
        for action in ['http://drive.usercontent.google.com/download', 'https://evil.example/download']:
            with self.assertRaises(ValueError):
                pack.confirm_url(html.replace('https://drive.usercontent.google.com/download', action))

if __name__ == '__main__':
    unittest.main()
