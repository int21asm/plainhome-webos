#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_ID="com.github.int21asm.plainhome"
TV_HOST="${TV_HOST:-}"
TV_USER="${TV_USER:-root}"
TV_PASSWORD="${TV_PASSWORD:-}"
REMOTE_DIR="/tmp"

if ! command -v sshpass >/dev/null 2>&1; then
  echo "sshpass is required. On macOS: brew install hudochenkov/sshpass/sshpass" >&2
  exit 1
fi

if [[ -z "$TV_HOST" ]]; then
  read -r -p "TV IP address or hostname: " TV_HOST
fi
if [[ -z "$TV_HOST" || ! "$TV_HOST" =~ ^[A-Za-z0-9._:-]+$ ]]; then
  echo "Invalid TV address: $TV_HOST" >&2
  exit 1
fi
if [[ -z "$TV_PASSWORD" ]]; then
  read -r -s -p "SSH password for $TV_USER@$TV_HOST: " TV_PASSWORD
  echo
fi

read -r -p "PlainHome version to install (for example 0.1.14): " VERSION
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid version: $VERSION" >&2
  exit 1
fi

IPK_NAME="${PACKAGE_ID}_${VERSION}_all.ipk"
LOCAL_IPK="$PROJECT_DIR/dist/$IPK_NAME"
REMOTE_IPK="$REMOTE_DIR/$IPK_NAME"
INSTALL_LOG="$REMOTE_DIR/${PACKAGE_ID}-install-${VERSION}.log"

if [[ ! -f "$LOCAL_IPK" ]]; then
  echo "Package not found: $LOCAL_IPK" >&2
  exit 1
fi

SSH_OPTIONS=(
  -o PreferredAuthentications=password
  -o PubkeyAuthentication=no
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=10
)

run_ssh() {
  SSHPASS="$TV_PASSWORD" sshpass -e ssh "${SSH_OPTIONS[@]}" "$TV_USER@$TV_HOST" "$@"
}

echo "Uploading $IPK_NAME to $TV_USER@$TV_HOST:$REMOTE_DIR/"
SSHPASS="$TV_PASSWORD" sshpass -e scp "${SSH_OPTIONS[@]}" \
  "$LOCAL_IPK" "$TV_USER@$TV_HOST:$REMOTE_IPK"

echo "Starting installation"
INSTALL_COMMAND="rm -f '$INSTALL_LOG'; luna-send-pub -w 90000 -i \
'luna://com.webos.appInstallService/dev/install' \
'{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"$REMOTE_IPK\",\"subscribe\":true}' \
>'$INSTALL_LOG' 2>&1 </dev/null &"
run_ssh "$INSTALL_COMMAND"

INSTALLED=false
for _ in {1..45}; do
  if run_ssh "grep -q '\"state\":\"installed\"' '$INSTALL_LOG'" >/dev/null 2>&1; then
    INSTALLED=true
    break
  fi
  if run_ssh "grep -q '\"returnValue\":false' '$INSTALL_LOG'" >/dev/null 2>&1; then
    echo "Installation failed:" >&2
    run_ssh "sed -n '1,240p' '$INSTALL_LOG'" >&2
    exit 1
  fi
  sleep 2
done

if [[ "$INSTALLED" != true ]]; then
  echo "Installation did not finish within 90 seconds:" >&2
  run_ssh "sed -n '1,240p' '$INSTALL_LOG'" >&2 || true
  exit 1
fi

echo "Installed $PACKAGE_ID $VERSION"
run_ssh "rm -f '$INSTALL_LOG'"

echo "Removing old IPKs while keeping the two highest versions"
REMOTE_FILES=$(run_ssh \
  "find '$REMOTE_DIR' -maxdepth 1 -type f -name '${PACKAGE_ID}_*_all.ipk' -print" || true)

OLD_FILES=$(
  printf '%s\n' "$REMOTE_FILES" |
    while IFS= read -r remote_file; do
      [[ "$remote_file" =~ ^/tmp/com\.github\.int21asm\.plainhome_([0-9]+\.[0-9]+\.[0-9]+)_all\.ipk$ ]] || continue
      printf '%s %s\n' "${BASH_REMATCH[1]}" "$remote_file"
    done |
    sort -t. -k1,1nr -k2,2nr -k3,3nr |
    awk 'NR > 2 { print $2 }'
)

if [[ -n "$OLD_FILES" ]]; then
  while IFS= read -r old_file; do
    [[ "$old_file" =~ ^/tmp/com\.github\.int21asm\.plainhome_[0-9]+\.[0-9]+\.[0-9]+_all\.ipk$ ]] || continue
    echo "Deleting $old_file"
    run_ssh "rm -f '$old_file'"
  done <<< "$OLD_FILES"
fi

echo "IPKs kept on the TV:"
run_ssh "find '$REMOTE_DIR' -maxdepth 1 -type f -name '${PACKAGE_ID}_*_all.ipk' -print | sort"
