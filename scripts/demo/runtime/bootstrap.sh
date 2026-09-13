#!/usr/bin/env bash
set -euo pipefail
SOMA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOMA_ACTION="${1:-start}"
shift || true
case "$SOMA_ACTION" in install|start|verify) ;; *) echo 'Expected install, start or verify.' >&2; exit 2;; esac
case "$(uname -s)" in
 Darwin)
  SOMA_PLATFORM=darwin
  SOMA_OS_VERSION="$(sw_vers -productVersion)"
  if ! awk -v v="$SOMA_OS_VERSION" 'BEGIN{split(v,a,".");exit !(a[1]>13 || (a[1]==13 && a[2]>=5))}'; then
   echo 'SOMA requires macOS 13.5 or newer.' >&2; exit 1
  fi;;
 Linux)
  SOMA_PLATFORM=linux
  SOMA_LIBC="$(getconf GNU_LIBC_VERSION 2>/dev/null || true)"
  if ! awk -v v="$SOMA_LIBC" 'BEGIN{split(v,b," ");split(b[2],a,".");exit !(a[1]>2 || (a[1]==2 && a[2]>=35))}'; then
   echo 'SOMA requires glibc 2.35+ (for example Ubuntu 22.04+). Alpine/musl is unsupported.' >&2; exit 1
  fi
  if ! command -v curl >/dev/null || ! command -v tar >/dev/null || ! command -v gzip >/dev/null; then
   SOMA_SUDO=(); if [ "$(id -u)" -ne 0 ]; then SOMA_SUDO=(sudo); fi
   if command -v apt-get >/dev/null; then "${SOMA_SUDO[@]}" apt-get update; "${SOMA_SUDO[@]}" apt-get install -y ca-certificates curl tar gzip
   elif command -v dnf >/dev/null; then "${SOMA_SUDO[@]}" dnf install -y ca-certificates curl tar gzip
   elif command -v zypper >/dev/null; then "${SOMA_SUDO[@]}" zypper --non-interactive install ca-certificates curl tar gzip
   elif command -v pacman >/dev/null; then "${SOMA_SUDO[@]}" pacman -S --needed --noconfirm ca-certificates curl tar gzip
   else echo 'Install ca-certificates, curl, tar and gzip, then retry.' >&2; exit 1; fi
  fi;;
 *) echo 'Use the Windows launchers on Windows.' >&2; exit 1;;
esac
case "$(uname -m)" in arm64|aarch64) SOMA_ARCH=arm64;; x86_64|amd64) SOMA_ARCH=x64;; *) echo 'Only x64 and ARM64 are supported.' >&2; exit 1;; esac
SOMA_VERSION="$(tr -d '\r\n' < "$SOMA_ROOT/runtime/node-version.txt")"
SOMA_NAME="node-$SOMA_VERSION-$SOMA_PLATFORM-$SOMA_ARCH"
SOMA_NODE="$SOMA_ROOT/.runtime/$SOMA_NAME/bin/node"
if [ ! -x "$SOMA_NODE" ] || [ "$("$SOMA_NODE" --version)" != "$SOMA_VERSION" ]; then
 mkdir -p "$SOMA_ROOT/.runtime"
 SOMA_TEMP="$(mktemp -d "$SOMA_ROOT/.runtime/download.XXXXXX")"
 trap 'rm -rf "$SOMA_TEMP"' EXIT
 SOMA_FILE="$SOMA_NAME.tar.gz"
 echo "Installing isolated Node.js $SOMA_VERSION ($SOMA_PLATFORM/$SOMA_ARCH)..."
 curl --fail --location --retry 3 --connect-timeout 20 --max-time 600 "https://nodejs.org/download/release/$SOMA_VERSION/$SOMA_FILE" -o "$SOMA_TEMP/$SOMA_FILE"
 SOMA_EXPECTED="$(awk -v f="$SOMA_FILE" '$2==f{print $1}' "$SOMA_ROOT/runtime/node-shasums.txt")"
 if command -v sha256sum >/dev/null; then SOMA_ACTUAL="$(sha256sum "$SOMA_TEMP/$SOMA_FILE" | awk '{print $1}')"
 else SOMA_ACTUAL="$(shasum -a 256 "$SOMA_TEMP/$SOMA_FILE" | awk '{print $1}')"; fi
 if [ -z "$SOMA_EXPECTED" ] || [ "$SOMA_ACTUAL" != "$SOMA_EXPECTED" ]; then echo 'Node.js SHA-256 mismatch; installation stopped.' >&2; exit 1; fi
 tar -xzf "$SOMA_TEMP/$SOMA_FILE" -C "$SOMA_TEMP"
 "$SOMA_TEMP/$SOMA_NAME/bin/node" --version
 rm -rf "$SOMA_ROOT/.runtime/$SOMA_NAME"
 mv "$SOMA_TEMP/$SOMA_NAME" "$SOMA_ROOT/.runtime/$SOMA_NAME"
 rm -rf "$SOMA_TEMP"; trap - EXIT
fi
export PATH="$(dirname "$SOMA_NODE"):$PATH"
exec "$SOMA_NODE" "$SOMA_ROOT/runtime/runner.mjs" "$SOMA_ACTION" "$@"
