#!/bin/sh
# Root only, NEW dedicated VM only. Arguments: domain email authorized-client-CIDR
set -eu
trap 'result=$?; if [ "$result" -ne 0 ]; then rm -f /etc/private-cloud-proxy/READY; systemctl stop private-cloud-proxy.service 2>/dev/null || true; fi' EXIT
[ "$(id -u)" = 0 ] || exit 1
[ "$#" = 3 ] || { echo 'Usage: activate.sh DOMAIN EMAIL CLIENT_CIDR' >&2; exit 1; }
domain=$1
email=$2
client=$3
python3 - "$domain" "$client" <<'PY'
import ipaddress,re,sys
assert re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?',sys.argv[1])
a=ipaddress.ip_network(sys.argv[2],strict=False)
assert a.version==4 and a.prefixlen>=24, 'Use a narrow public IPv4 client CIDR'
assert a.network_address.is_global
PY
# DNS A record must already point here. Port 80 must be allowed in the provider network.
certbot certonly --standalone --non-interactive --agree-tos --email "$email" -d "$domain"
root=/etc/private-cloud-proxy
install -m 0640 -o root -g proxy "/etc/letsencrypt/live/$domain/fullchain.pem" "$root/fullchain.pem"
install -m 0640 -o root -g proxy "/etc/letsencrypt/live/$domain/privkey.pem" "$root/privkey.pem"
openssl x509 -in "$root/fullchain.pem" -noout -checkhost "$domain"
openssl x509 -in "$root/fullchain.pem" -noout -checkend 86400
# Generate the password locally; never emit it into cloud-init logs.
python3 - "$root" <<'PY'
import json,secrets,os,sys
from pathlib import Path
root=Path(sys.argv[1]); p=root/'settings.json'
if not p.exists():
 fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,'w') as f: json.dump(dict(username='owner',password=secrets.token_urlsafe(32),cert=str(root/'fullchain.pem'),key=str(root/'privkey.pem')),f)
PY
[ ! -e "$root/gost.json" ] || { echo 'Existing configuration; refusing overwrite' >&2; exit 1; }
python3 /opt/private-cloud-proxy/scripts/configure.py "$root/settings.json" "$root/gost.json"
chgrp proxy "$root/gost.json"
chmod 0640 "$root/gost.json"
# Add only a dedicated chain; preserve all other rules. Bind service port is 8443.
iptables -N PRIVATE_PROXY_IN
iptables -A PRIVATE_PROXY_IN -s "$client" -j ACCEPT
iptables -A PRIVATE_PROXY_IN -j DROP
iptables -I INPUT 1 -p tcp --dport 8443 -j PRIVATE_PROXY_IN
ip6tables -I INPUT 1 -p tcp --dport 8443 -j DROP
# Persist rules via Ubuntu netfilter-persistent.
netfilter-persistent save
touch "$root/READY"
systemctl enable --now private-cloud-policy.service private-cloud-proxy.service
systemctl is-active --quiet private-cloud-policy.service private-cloud-proxy.service
# A verified TLS handshake on loopback; credentials are not placed in arguments.
openssl s_client -connect 127.0.0.1:8443 -servername "$domain" -verify_hostname "$domain" -verify_return_error -CApath /etc/ssl/certs </dev/null >/dev/null
printf 'Active on https://%s:8443. Read root-only settings.json through an authorized web console.\n' "$domain"
