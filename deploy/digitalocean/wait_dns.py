#!/usr/bin/env python3
"""ExecCondition on a NEW DigitalOcean VM only; never called by the proxy.
Checks the public IP metadata (no credentials) and DNS before requesting ACME.
"""
import http.client
import ipaddress
import json
import socket
import sys


def matches(domain, expected):
    try:
        address=ipaddress.ip_address(expected.strip())
        if address.version != 4 or not address.is_global:
            return False
        # Reject AAAA records pointing elsewhere as ACME could select them.
        answers={row[4][0] for row in socket.getaddrinfo(domain, None, type=socket.SOCK_STREAM)}
        return answers == {str(address)}
    except (ValueError,OSError):
        return False


def ready(settings):
    conn=http.client.HTTPConnection('169.254.169.254',timeout=3)
    try:
        conn.request('GET','/metadata/v1/interfaces/public/0/ipv4/address')
        response=conn.getresponse()
        if response.status!=200: return False
        expected=response.read(128).decode('ascii')
        return matches(settings['domain'],expected)
    except (OSError,ValueError,UnicodeError):
        return False
    finally:
        conn.close()


if __name__=='__main__':
    with open(sys.argv[1]) as f: settings=json.load(f)
    raise SystemExit(0 if ready(settings) else 1)
