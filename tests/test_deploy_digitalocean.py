"""Offline tests for new deployment helpers, not remote acceptance tests."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]

def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'deploy/digitalocean'/f'{name}.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

class DeploymentTests(unittest.TestCase):
    def test_price_and_region_must_match(self):
        m=load('preflight')
        size=dict(slug=m.SIZE,available=True,regions=['nyc3'],memory=512,disk=10,vcpus=1,price_monthly=4,transfer=.5)
        self.assertTrue(m.approved_size(size,'nyc3'))
        self.assertFalse(m.approved_size(dict(size,price_monthly=6),'nyc3'))
        self.assertFalse(m.approved_size(size,'other-region'))
        self.assertFalse(m.approved_size(dict(size,available=False),'nyc3'))
    def test_reject_token_destination_change(self):
        m=load('preflight')
        with self.assertRaises(ValueError):m.get('https://other.example/api','test-token')
    def test_dns_gate(self):
        m=load('wait_dns')
        def rows(*ips):return [(2,1,6,'',(ip,0)) for ip in ips]
        with patch.object(m.socket,'getaddrinfo',return_value=rows('8.8.8.8')):
            self.assertTrue(m.matches('proxy.example','8.8.8.8'))
        with patch.object(m.socket,'getaddrinfo',return_value=rows('8.8.8.8','::1')):
            self.assertFalse(m.matches('proxy.example','8.8.8.8'))
        self.assertFalse(m.matches('proxy.example','127.0.0.1'))
