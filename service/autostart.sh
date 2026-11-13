#!/bin/sh

CONFIG=/var/lib/webosbrew/plainhome.conf
CAPTURE_REQUEST=/tmp/plainhome-shortcut-capture.request
BOOT_ENABLED=0
HOME_ENABLED=0
SHORTCUT_CODE=0
grep -q '^boot=1$' "$CONFIG" && BOOT_ENABLED=1
grep -q '^home=1$' "$CONFIG" && HOME_ENABLED=1
SHORTCUT_CODE=$(sed -n 's/^shortcut=\([0-9][0-9]*\)$/\1/p' "$CONFIG" 2>/dev/null | head -n 1)
case "$SHORTCUT_CODE" in
  ''|0|*[!0-9]*) SHORTCUT_CODE=0 ;;
esac
[ "$BOOT_ENABLED" = 1 ] || [ "$HOME_ENABLED" = 1 ] || [ "$SHORTCUT_CODE" -gt 0 ] || [ -f "$CAPTURE_REQUEST" ] || exit 0

# Cold boot draws LG Home before this hook is scheduled. Launch PlainHome as soon as
# Application Manager answers, then keep closing the stock home. PlainHome's first
# frame is black, so that window replaces the LG menu instead of sitting behind it.
if [ "$BOOT_ENABLED" = 1 ]; then
  (
    i=0
    launched=0
    while [ "$i" -lt 40 ]; do
      out=$(luna-send -n 1 luna://com.webos.applicationManager/launch \
        '{"id":"com.github.int21asm.plainhome"}' 2>/dev/null || true)
      if echo "$out" | grep -q '"returnValue":true'; then
        launched=1
        break
      fi
      usleep 250000
      i=$((i + 1))
    done
    if [ "$launched" = 1 ]; then
      j=0
      while [ "$j" -lt 20 ]; do
        luna-send -n 1 luna://com.webos.applicationManager/closeByAppId \
          '{"id":"com.webos.app.home"}' >/dev/null 2>&1 || true
        usleep 200000
        j=$((j + 1))
      done
    fi
  ) >/tmp/plainhome-boot-cover.log 2>&1 &
fi
if [ "$HOME_ENABLED" = 1 ]; then
  luna-send -n 1 luna://com.webos.service.config/setConfigs \
    '{"configs":{"com.webos.surfacemanager.disableHome":true}}' >/dev/null 2>&1 || true
fi

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
if [ -L /var/lib/webosbrew/init.d/60-plainhome ]; then
  mkdir -p /var/lib/webosbrew/init.d
  ln -sf "$SVCDIR/autostart.sh" /var/lib/webosbrew/init.d/00-plainhome
  rm -f /var/lib/webosbrew/init.d/60-plainhome
fi

export NODE_PATH=/usr/lib/node_modules:/usr/lib/nodejs
cd "$SVCDIR"
for PID_FILE in /tmp/plainhome-service.pid /tmp/plainhome-power.pid; do
  if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    case "$OLD_PID" in
      ''|*[!0-9]*) ;;
      *)
        kill "$OLD_PID" 2>/dev/null || true
        # Wait up to 3 s, so the old watcher's exit handler (which re-enables LG Home)
        # cannot run after the new watcher has disabled it.
        WAITED=0
        while kill -0 "$OLD_PID" 2>/dev/null && [ "$WAITED" -lt 80 ]; do
          usleep 100000
          WAITED=$((WAITED + 1))
        done
        ;;
    esac
    rm -f "$PID_FILE"
  fi
done
# After the previous watcher has exited. Its exit handler restores LG Home only if it still owns the key.
if [ "$HOME_ENABLED" != 1 ]; then
  luna-send -n 1 luna://com.webos.service.config/setConfigs \
    '{"configs":{"com.webos.surfacemanager.disableHome":false}}' >/dev/null 2>&1 </dev/null || true
fi
SERVICE_ARGS=
[ "$BOOT_ENABLED" = 1 ] && SERVICE_ARGS="$SERVICE_ARGS --boot"
[ "$HOME_ENABLED" = 1 ] && SERVICE_ARGS="$SERVICE_ARGS --home"
[ "$SHORTCUT_CODE" -gt 0 ] && SERVICE_ARGS="$SERVICE_ARGS --shortcut"
[ -f "$CAPTURE_REQUEST" ] && SERVICE_ARGS="$SERVICE_ARGS --capture"
nohup /usr/bin/node service.js $SERVICE_ARGS >/tmp/plainhome-service.stdout 2>&1 &
exit 0
