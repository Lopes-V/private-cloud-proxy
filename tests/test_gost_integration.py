"""Local GOST integration; set GOST_BIN to an independently verified binary."""
import http.server
import os
import shutil
import socket
import subprocess
import threading
import time
import unittest


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'local integration ok')

    def log_message(self, *args):
        pass


@unittest.skipUnless(os.environ.get('GOST_BIN') and shutil.which('curl'), 'GOST_BIN and curl required')
class GostIntegration(unittest.TestCase):
    def test_http_authentication(self):
        server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        process = subprocess.Popen([os.environ['GOST_BIN'], '-L', f'http://testuser:testpass@127.0.0.1:{port}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(50):
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.1):
                        break
                except OSError:
                    time.sleep(.1)
            else:
                self.fail('GOST did not start')
            for password, expected in [('wrong', '407'), ('testpass', '200')]:
                with self.subTest(password=password):
                    result = subprocess.run(['curl', '-sS', '--noproxy', '', '--proxy', f'http://127.0.0.1:{port}', '--proxy-user', f'testuser:{password}', '-o', '/dev/null', '-w', '%{http_code}', f'http://127.0.0.1:{server.server_port}/'], capture_output=True, text=True, timeout=5, check=True)
                    self.assertEqual(result.stdout, expected)
        finally:
            process.terminate()
            process.wait(timeout=5)
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
        self.assertEqual(process.returncode, 0)
