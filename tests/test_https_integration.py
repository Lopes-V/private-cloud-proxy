"""Real local TLS/CONNECT tests. Requires GOST_BIN and openssl/curl."""
import concurrent.futures
import http.server
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]

@unittest.skipUnless(os.environ.get('GOST_BIN'), 'set GOST_BIN to verified GOST 3.3.3')
class HTTPSIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.d = Path(cls.tmp.name)
        def openssl(*args):
            subprocess.run(['openssl', *args], cwd=cls.d, check=True, capture_output=True)
        openssl('req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.pem','-days','1','-subj','/CN=Test CA')
        openssl('req','-newkey','rsa:2048','-nodes','-keyout','server.key','-out','server.csr','-subj','/CN=localhost')
        (cls.d/'ext').write_text('subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n')
        openssl('x509','-req','-in','server.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-out','server.pem','-days','1','-extfile','ext')
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200); self.end_headers(); self.wfile.write(b'HTTPS via real CONNECT')
            def log_message(self,*args): pass
        cls.origin = http.server.ThreadingHTTPServer(('127.0.0.1',0), Handler)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cls.d/'server.pem', cls.d/'server.key')
        cls.origin.socket = ctx.wrap_socket(cls.origin.socket, server_side=True)
        cls.thread = threading.Thread(target=cls.origin.serve_forever,daemon=True); cls.thread.start()
        with socket.socket() as s:
            s.bind(('127.0.0.1',0)); cls.port=s.getsockname()[1]
        # Test-only config allows loopback origin. Production config denies it.
        cls.config = dict(services=[dict(name='test',addr=f'127.0.0.1:{cls.port}',handler=dict(type='http',auth=dict(username='test',password='test-only-password-32-characters'),metadata=dict(idleTimeout='1s',readTimeout='2s')), listener=dict(type='tls',tls=dict(certFile=str(cls.d/'server.pem'),keyFile=str(cls.d/'server.key'))))], log=dict(level='error'))
        (cls.d/'config.json').write_text(json.dumps(cls.config))
        cls.process=subprocess.Popen([os.environ['GOST_BIN'],'-C',str(cls.d/'config.json')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                with socket.create_connection(('127.0.0.1',cls.port),timeout=.1): break
            except OSError: time.sleep(.1)
        else: raise RuntimeError('GOST failed to start')

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate(); cls.process.wait(timeout=5)
        cls.origin.shutdown(); cls.origin.server_close(); cls.thread.join(timeout=5)
        cls.tmp.cleanup()

    def curl(self, credentials='test:test-only-password-32-characters', trust=True):
        args=['curl','--silent','--show-error','--max-time','5','--noproxy','','--proxy',f'https://localhost:{self.port}','--cacert',str(self.d/'ca.pem')]
        if trust: args += ['--proxy-cacert',str(self.d/'ca.pem')]
        if credentials is not None: args += ['--proxy-user',credentials]
        args += [f'https://localhost:{self.origin.server_port}/']
        return subprocess.run(args,capture_output=True,text=True)

    def test_tls_connect_bidirectional(self):
        r=self.curl(); self.assertEqual(r.returncode,0,r.stderr); self.assertEqual(r.stdout,'HTTPS via real CONNECT')
    def test_invalid_authentication(self):
        r=self.curl('test:wrong'); self.assertNotEqual(r.returncode,0); self.assertIn('407',r.stderr)
    def test_missing_authentication(self):
        r=self.curl(None); self.assertNotEqual(r.returncode,0); self.assertIn('407',r.stderr)
    def test_untrusted_proxy_certificate(self):
        r=self.curl(trust=False); self.assertEqual(r.returncode,60)
    def test_concurrent_tunnels(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for r in pool.map(lambda _:self.curl(),range(8)):
                self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(r.stdout,'HTTPS via real CONNECT')
    def test_idle_tunnel_timeout(self):
        import base64
        import socketserver
        class Quiet(socketserver.BaseRequestHandler):
            def handle(self):
                self.request.settimeout(5)
                try:
                    while self.request.recv(1024): pass
                except OSError: pass
        origin=socketserver.TCPServer(('127.0.0.1',0),Quiet)
        thread=threading.Thread(target=origin.serve_forever,daemon=True);thread.start()
        try:
            ctx=ssl.create_default_context(cafile=str(self.d/'ca.pem'))
            with ctx.wrap_socket(socket.create_connection(('127.0.0.1',self.port)),server_hostname='localhost') as sock:
                sock.settimeout(4)
                auth=base64.b64encode(b'test:test-only-password-32-characters').decode()
                sock.sendall(f'CONNECT localhost:{origin.server_address[1]} HTTP/1.1\r\nHost: localhost\r\nProxy-Authorization: Basic {auth}\r\n\r\n'.encode())
                reply=b''
                while not reply.endswith(b'\r\n\r\n'):
                    chunk=sock.recv(1)
                    self.assertTrue(chunk,'closed before CONNECT response')
                    reply+=chunk
                self.assertIn(b'200',reply)
                started=time.monotonic()
                self.assertEqual(sock.recv(1),b'')
                self.assertGreater(time.monotonic()-started,.5)
        finally:
            origin.shutdown();origin.server_close();thread.join(timeout=5)

    def test_client_can_close_tls_connection(self):
        ctx=ssl.create_default_context(cafile=str(self.d/'ca.pem'))
        with ctx.wrap_socket(socket.create_connection(('127.0.0.1',self.port)),server_hostname='localhost') as s:
            s.settimeout(4)
            # An incomplete request is bounded by GOST's header read timeout, not idle tunnel timeout.
            s.sendall(b'CONNECT localhost:443 HTTP/1.1\r\n')
            # Verify the client can close cleanly; incomplete-header deadlines need separate verification.
            s.shutdown(socket.SHUT_RDWR)

class SecuredIntegration(HTTPSIntegration):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        import importlib.util
        spec=importlib.util.spec_from_file_location('policy',ROOT/'scripts/policy.py')
        policy=importlib.util.module_from_spec(spec);spec.loader.exec_module(policy)
        cls.policy=policy.Server(('127.0.0.1',0),policy.Handler)
        cls.policy_thread=threading.Thread(target=cls.policy.serve_forever,daemon=True);cls.policy_thread.start()
        cspec=importlib.util.spec_from_file_location('configure',ROOT/'scripts/configure.py')
        configure=importlib.util.module_from_spec(cspec);cspec.loader.exec_module(configure)
        config=configure.configuration(dict(username='test',password='test-only-password-32-characters',cert=str(cls.d/'server.pem'),key=str(cls.d/'server.key')))
        config['services'][0]['addr']=f'127.0.0.1:{cls.port}'
        config['resolvers'][0]['plugin']['addr']=f'http://127.0.0.1:{cls.policy.server_port}/'
        config['climiters'][0]['limits']=['$ 2','$$ 2']
        cls.process.terminate();cls.process.wait(timeout=5)
        (cls.d/'secure.json').write_text(json.dumps(config))
        cls.process=subprocess.Popen([os.environ['GOST_BIN'],'-C',str(cls.d/'secure.json')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        time.sleep(.3)

    @classmethod
    def tearDownClass(cls):
        cls.policy.shutdown();cls.policy.server_close();cls.policy_thread.join(timeout=5)
        super().tearDownClass()

    test_idle_tunnel_timeout = None
    test_tls_connect_bidirectional = None
    test_concurrent_tunnels = None

    def test_forbidden_destinations(self):
        for target in ['127.0.0.1','localhost','10.0.0.1','169.254.169.254','[::1]']:
            with self.subTest(target=target):
                r=subprocess.run(['curl','-sS','--max-time','3','--noproxy','','--proxy',f'https://localhost:{self.port}','--proxy-cacert',str(self.d/'ca.pem'),'--proxy-user','test:test-only-password-32-characters',f'https://{target}/'],capture_output=True,text=True)
                self.assertNotEqual(r.returncode,0)
                self.assertIn('503',r.stderr)
    def test_resolver_failure_blocks_connection(self):
        # Stop this suite's resolver and restore it after the request.
        self.policy.shutdown()
        self.policy.server_close()
        self.policy_thread.join(timeout=5)
        try:
            r=subprocess.run(['curl','-sS','--max-time','4','--noproxy','','--proxy',f'https://localhost:{self.port}','--proxy-cacert',str(self.d/'ca.pem'),'--proxy-user','test:test-only-password-32-characters','https://localhost/'],capture_output=True,text=True)
            self.assertNotEqual(r.returncode,0)
            self.assertIn('503',r.stderr)
        finally:
            cls=type(self)
            cls.policy=cls.policy.__class__(cls.policy.server_address,cls.policy.RequestHandlerClass)
            cls.policy_thread=threading.Thread(target=cls.policy.serve_forever,daemon=True);cls.policy_thread.start()

    def test_connection_limit(self):
        ctx=ssl.create_default_context(cafile=str(self.d/'ca.pem'))
        sockets=[]
        try:
            for _ in range(2):
                sockets.append(ctx.wrap_socket(socket.create_connection(('127.0.0.1',self.port)),server_hostname='localhost'))
            raw=socket.create_connection(('127.0.0.1',self.port),timeout=2)
            with raw:
                with self.assertRaises((OSError,ssl.SSLError)):
                    ctx.wrap_socket(raw,server_hostname='localhost')
        finally:
            for sock in sockets:sock.close()
            time.sleep(.1)

    def test_forbidden_port(self):
        # A live loopback HTTPS origin must not receive requests through the secured proxy.
        r=self.curl();self.assertNotEqual(r.returncode,0);self.assertIn('403',r.stderr)

if __name__=='__main__': unittest.main()
