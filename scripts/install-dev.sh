#!/bin/sh
# Installs only the verified development binary outside the checkout.
set -eu
case "$(uname -m)" in
 x86_64) arch=amd64; hash=f4c1255dc892a7014c0ad6e5f1c3573108f7bea4403f04f21873406ab58aa666 ;;
 aarch64) arch=arm64; hash=4c704c92df6eeea8a3b08d0de4fd3c44343095a20136b3b6cf334f98d2f174ab ;;
 *) exit 1 ;;
esac
dest=${GOST_DEV_DIR:-/workspace/.tools/private-cloud-proxy}
mkdir -p "$dest"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "https://github.com/go-gost/gost/releases/download/v3.3.3/gost_3.3.3_linux_${arch}.tar.gz" -o "$work/gost.tar.gz"
printf '%s  %s\n' "$hash" "$work/gost.tar.gz" | sha256sum -c -
tar -xzf "$work/gost.tar.gz" -C "$work" gost
install -m 0755 "$work/gost" "$dest/gost"
"$dest/gost" -V
