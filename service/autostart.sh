#!/bin/sh

CONFIG=/var/lib/webosbrew/plainhome.conf
[ -f "$CONFIG" ] || exit 0
BOOT_ENABLED=0
HOME_ENABLED=0
grep -q '^boot=1$' "$CONFIG" && BOOT_ENABLED=1
grep -q '^home=1$' "$CONFIG" && HOME_ENABLED=1
[ "$BOOT_ENABLED" = 1 ] || [ "$HOME_ENABLED" = 1 ] || exit 0

PERMISSION_FILE=/var/luna-service2-dev/client-permissions.d/com.github.int21asm.plainhome.app.json
PERMISSION_JSON='{"com.github.int21asm.plainhome-*":["public","applications.launch","applications.internal","com.github.int21asm.plainhome.service.group"]}'
if [ -d /var/luna-service2-dev/client-permissions.d ] && [ "$(cat "$PERMISSION_FILE" 2>/dev/null)" != "$PERMISSION_JSON" ]; then
  printf '%s\n' "$PERMISSION_JSON" > "$PERMISSION_FILE"
  ls-control scan-services >/tmp/plainhome-permission-scan.log 2>&1
  sleep 2
fi

SVCDIR=/media/developer/apps/usr/palm/services/com.github.int21asm.plainhome.service
if [ ! -f "$SVCDIR/service.js" ]; then
  SVCDIR=/media/cryptofs/apps/usr/palm/services/com.github.int21asm.plainhome.service
fi
[ -f "$SVCDIR/service.js" ] || exit 0

export NODE_PATH=/usr/lib/node_modules:/usr/lib/nodejs
cd "$SVCDIR"
for PID_FILE in /tmp/plainhome-service.pid /tmp/plainhome-power.pid; do
  if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    case "$OLD_PID" in
      ''|*[!0-9]*) ;;
      *) kill "$OLD_PID" 2>/dev/null || true ;;
    esac
    rm -f "$PID_FILE"
  fi
done
SERVICE_ARGS=
[ "$BOOT_ENABLED" = 1 ] && SERVICE_ARGS="$SERVICE_ARGS --boot"
[ "$HOME_ENABLED" = 1 ] && SERVICE_ARGS="$SERVICE_ARGS --watch"
nohup /usr/bin/node service.js $SERVICE_ARGS >/tmp/plainhome-service.stdout 2>&1 &
exit 0
