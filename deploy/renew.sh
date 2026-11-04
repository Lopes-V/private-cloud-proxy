#!/bin/sh
# Certbot deploy hook; RENEWED_LINEAGE is supplied by certbot.
set -eu
root=/etc/private-cloud-proxy
[ -f "$root/READY" ] || exit 0
openssl x509 -in "$RENEWED_LINEAGE/fullchain.pem" -noout -checkend 86400
# Only update the certificate with the same subject as the currently deployed cert.
old=$(openssl x509 -in "$root/fullchain.pem" -noout -subject)
new=$(openssl x509 -in "$RENEWED_LINEAGE/fullchain.pem" -noout -subject)
[ "$old" = "$new" ] || exit 0
install -m 0640 -o root -g proxy "$RENEWED_LINEAGE/fullchain.pem" "$root/fullchain.pem"
install -m 0640 -o root -g proxy "$RENEWED_LINEAGE/privkey.pem" "$root/privkey.pem"
systemctl restart private-cloud-proxy.service
