#!/bin/sh
# Run as root on a NEW Ubuntu VM; no listeners enabled by installation.
set -eu
[ "$(id -u)" = 0 ] || { echo 'root required' >&2; exit 1; }
case "$(uname -m)" in
 x86_64) arch=amd64; checksum=f4c1255dc892a7014c0ad6e5f1c3573108f7bea4403f04f21873406ab58aa666 ;;
 aarch64) arch=arm64; checksum=4c704c92df6eeea8a3b08d0de4fd3c44343095a20136b3b6cf334f98d2f174ab ;;
 *) echo 'Unsupported architecture' >&2; exit 1 ;;
esac
artifact="gost_3.3.3_linux_${arch}.tar.gz"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "https://github.com/go-gost/gost/releases/download/v3.3.3/$artifact" -o "$work/$artifact"
printf '%s  %s\n' "$checksum" "$work/$artifact" | sha256sum -c -
tar -xzf "$work/$artifact" -C "$work" gost
install -m 0755 "$work/gost" /usr/local/bin/gost
id proxy >/dev/null 2>&1 || useradd --system --home /nonexistent --shell /usr/sbin/nologin proxy
install -d -m 0750 -o root -g proxy /etc/private-cloud-proxy
install -m 0644 /opt/private-cloud-proxy/deploy/*.service /etc/systemd/system/
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
install -m 0755 /opt/private-cloud-proxy/deploy/renew.sh /etc/letsencrypt/renewal-hooks/deploy/private-cloud-proxy
systemctl daemon-reload
# Activation requires credentials, public TLS certificates, firewall and a separate action.
echo 'Installed. Proxy remains disabled until activation.'
