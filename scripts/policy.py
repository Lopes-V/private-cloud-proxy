#!/usr/bin/env python3
"""GOST HTTP resolver extension. Return only validated numeric IPs, never hostnames.
No DNS cache: each new dial evaluates the current answer. Mixed answers fail closed.
"""
import http.server
import ipaddress
import json
import socket
import threading


def public(ip):
    a = ipaddress.ip_address(ip)
    # Reject mapped/transition formats to avoid cross-family policy ambiguity.
    return a.is_global and not a.is_multicast and not a.is_reserved and not (
        isinstance(a, ipaddress.IPv6Address) and (a.ipv4_mapped or a.sixtofour or a.teredo))


def resolve(host):
    try:
        try:
            addresses = [str(ipaddress.ip_address(host))]
        except ValueError:
            addresses = sorted({r[4][0] for r in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)})
        return addresses if addresses and all(public(a) for a in addresses) else []
    except (OSError, ValueError):
        return []


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        self.connection.settimeout(3)
        try:
            size = int(self.headers.get('Content-Length','0'))
            if not 0 < size <= 4096: raise ValueError()
            data = json.loads(self.rfile.read(size))
            host = data['host']
            if not isinstance(host,str) or len(host)>253: raise ValueError()
            ips = resolve(host)
            body = json.dumps({'ok':bool(ips),'ips':ips}).encode()
            self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        except (ValueError,KeyError,TypeError,OSError):
            self.send_error(400)
    def log_message(self,*args): pass


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    slots = threading.BoundedSemaphore(32)
    def process_request(self, request, client_address):
        if not self.slots.acquire(False): request.close();return
        try: super().process_request(request,client_address)
        except BaseException: self.slots.release();raise
    def process_request_thread(self,request,client_address):
        try: super().process_request_thread(request,client_address)
        finally: self.slots.release()


if __name__ == '__main__':
    Server(('127.0.0.1',18080),Handler).serve_forever()
