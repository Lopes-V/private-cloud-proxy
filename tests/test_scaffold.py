import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class ScaffoldTests(unittest.TestCase):
    def test_cloud_init_does_not_open_or_start_proxy(self):
        text = (ROOT / 'deploy/cloud-init.yaml').read_text()
        self.assertTrue(text.startswith('#cloud-config'))
        import json
        config=json.loads(text.split('\n',1)[1])
        self.assertEqual(config['runcmd'],[['/bin/sh','/opt/private-cloud-proxy/deploy/install.sh']])
        self.assertNotIn('activate.sh',str(config['runcmd']))

    def test_service_requires_explicit_gate(self):
        text = (ROOT / 'deploy/private-cloud-proxy.service').read_text()
        self.assertIn('ConditionPathExists=/etc/private-cloud-proxy/READY', text)
        self.assertIn('NoNewPrivileges=true', text)

    def test_browser_does_not_disable_tls(self):
        text = (ROOT / 'Open-ProxyBrowser.ps1').read_text()
        self.assertIn('--proxy-server=https://', text)
        self.assertNotIn('--ignore-certificate-errors', text)
        self.assertIn('--user-data-dir=', text)

if __name__ == '__main__':
    unittest.main()
