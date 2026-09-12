#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR="$PROJECT_DIR/app"
SERVICE_DIR="$PROJECT_DIR/service"
DIST_DIR="$PROJECT_DIR/dist"
PACKAGE_ID="com.github.int21asm.plainhome"
SERVICE_ID="com.github.int21asm.plainhome.service"
VERSION="0.1.40"
OUTPUT="$DIST_DIR/${PACKAGE_ID}_${VERSION}_all.ipk"

for file in appinfo.json index.html style.css app.js icon-copy.js input-reader.js icon80.png icon130.png; do
  if [ ! -f "$APP_DIR/$file" ]; then
    echo "Missing required file: $APP_DIR/$file" >&2
    exit 1
  fi
done

for file in service.js autostart.sh package.json services.json; do
  if [ ! -f "$SERVICE_DIR/$file" ]; then
    echo "Missing required file: $SERVICE_DIR/$file" >&2
    exit 1
  fi
done

mkdir -p "$DIST_DIR"

if ! command -v ares-package >/dev/null 2>&1; then
  echo "ares-package is required. Install it with: npm install -g @webos-tools/cli" >&2
  exit 1
fi

rm -f "$OUTPUT"
ares-package --no-minify "$APP_DIR" "$SERVICE_DIR" -o "$DIST_DIR"

if [ ! -f "$OUTPUT" ]; then
  echo "ares-package did not create the expected file: $OUTPUT" >&2
  exit 1
fi

echo "Built: $OUTPUT"
ar -t "$OUTPUT"

IPK_HASH=$(shasum -a 256 "$OUTPUT" | awk '{print $1}')
IPK_SIZE=$(wc -c < "$OUTPUT" | tr -d ' ')
MANIFEST="$DIST_DIR/${PACKAGE_ID}.manifest.json"

printf '%s\n' \
  '{' \
  "  \"id\": \"$PACKAGE_ID\"," \
  "  \"version\": \"$VERSION\"," \
  '  "type": "web",' \
  '  "title": "PlainHome",' \
  '  "appDescription": "Minimal customizable home launcher for rooted webOS TVs",' \
  '  "iconUri": "https://raw.githubusercontent.com/int21asm/plainhome-webos/main/app/icon512.png",' \
  '  "sourceUrl": "https://github.com/int21asm/plainhome-webos",' \
  '  "rootRequired": true,' \
  "  \"ipkUrl\": \"https://github.com/int21asm/plainhome-webos/releases/download/v$VERSION/${PACKAGE_ID}_${VERSION}_all.ipk\"," \
  '  "ipkHash": {' \
  "    \"sha256\": \"$IPK_HASH\"" \
  '  },' \
  "  \"ipkSize\": $IPK_SIZE" \
  '}' \
  > "$MANIFEST"

echo "Manifest: $MANIFEST"
