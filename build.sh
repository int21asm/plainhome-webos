#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR="$PROJECT_DIR/app"
SERVICE_DIR="$PROJECT_DIR/service"
DIST_DIR="$PROJECT_DIR/dist"
PACKAGE_ID="com.github.int21asm.plainhome"
SERVICE_ID="com.github.int21asm.plainhome.service"
VERSION="0.1.34"
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
BUILD_TMP=$(mktemp -d "${TMPDIR:-/tmp}/plainhome-build.XXXXXX")
trap 'rm -rf "$BUILD_TMP"' EXIT HUP INT TERM

mkdir -p "$BUILD_TMP/data/usr/palm/applications/$PACKAGE_ID"
cp -R "$APP_DIR"/. "$BUILD_TMP/data/usr/palm/applications/$PACKAGE_ID/"
mkdir -p "$BUILD_TMP/data/usr/palm/services/$SERVICE_ID"
cp -R "$SERVICE_DIR"/. "$BUILD_TMP/data/usr/palm/services/$SERVICE_ID/"
chmod 755 "$BUILD_TMP/data/usr/palm/services/$SERVICE_ID/autostart.sh"
mkdir -p "$BUILD_TMP/data/usr/palm/packages/$PACKAGE_ID"
printf '%s\n' \
  '{' \
  "  \"id\": \"$PACKAGE_ID\"," \
  "  \"version\": \"$VERSION\"," \
  "  \"app\": \"$PACKAGE_ID\"," \
  '  "services": [' \
  "    \"$SERVICE_ID\"" \
  '  ]' \
  '}' \
  > "$BUILD_TMP/data/usr/palm/packages/$PACKAGE_ID/packageinfo.json"

INSTALLED_SIZE=$(du -sk "$BUILD_TMP/data" | awk '{print $1}')
printf '%s\n' \
  "Package: $PACKAGE_ID" \
  "Version: $VERSION" \
  "Section: misc" \
  "Priority: optional" \
  "Architecture: all" \
  "Maintainer: int21asm" \
  "Installed-Size: $INSTALLED_SIZE" \
  "Description: Minimal installed-app launcher for LG webOS" \
  > "$BUILD_TMP/control"

printf '2.0\n' > "$BUILD_TMP/debian-binary"

COPYFILE_DISABLE=1 tar -C "$BUILD_TMP" -czf "$BUILD_TMP/control.tar.gz" control
COPYFILE_DISABLE=1 tar -C "$BUILD_TMP/data" -czf "$BUILD_TMP/data.tar.gz" .

rm -f "$OUTPUT"
(cd "$BUILD_TMP" && ar -rc "$OUTPUT" debian-binary control.tar.gz data.tar.gz)

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
