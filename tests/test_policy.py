import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

P=Path(__file__).resolve().parents[1]/'scripts/policy.py'

class PolicyTests(unittest.TestCase):
    def load(self):
        self.assertTrue(P.exists(), 'policy resolver must exist')
        spec=importlib.util.spec_from_file_location('policy',P); m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
    def test_forbidden_addresses(self):
        m=self.load()
        for ip in ['127.0.0.1','10.0.0.1','172.16.1.1','192.168.1.1','169.254.169.254','100.100.100.200','::1','fc00::1','fe80::1','::ffff:127.0.0.1','224.0.0.1']:
            with self.subTest(ip=ip):self.assertEqual(m.resolve(ip),[])
    def test_dns_rebinding_and_mixed_answers(self):
        m=self.load()
        def rows(*ips):return [(2,1,6,'',(ip,0)) for ip in ips]
        with patch.object(m.socket,'getaddrinfo',side_effect=[rows('8.8.8.8'),rows('127.0.0.1'),rows('8.8.8.8','10.0.0.1')]):
            self.assertEqual(m.resolve('test.example'),['8.8.8.8'])
            self.assertEqual(m.resolve('test.example'),[])
            self.assertEqual(m.resolve('test.example'),[])
