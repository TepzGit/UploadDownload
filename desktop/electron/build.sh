#!/usr/bin/env bash
# Builds the Electron version of the desktop app into desktop/dist:
#   Geek4u-windows/   (Geek4u.exe + Electron files)  and Geek4u-windows.zip
#   Geek4u-linux/     (geek4u + Electron files)      and Geek4u-linux.tar.gz
# The Go program from desktop/build.sh runs inside as resources/engine.
# Needs Go, curl, unzip, zip; go-winres (go install github.com/tc-hib/go-winres@latest) for the Windows icon.
set -euo pipefail
cd "$(dirname "$0")/../.."
ELECTRON=33.2.1
dist="$PWD/desktop/dist"
cache="${ELECTRON_CACHE:-$HOME/.cache/geek4u-electron}"
mkdir -p "$cache"

bash desktop/build.sh

for plat in win32-x64 linux-x64; do
  zipf="$cache/electron-v$ELECTRON-$plat.zip"
  if [ ! -s "$zipf" ]; then
    curl -fL -o "$zipf.part" "https://github.com/electron/electron/releases/download/v$ELECTRON/electron-v$ELECTRON-$plat.zip"
    curl -fsL -o "$cache/SHASUMS256-$ELECTRON.txt" "https://github.com/electron/electron/releases/download/v$ELECTRON/SHASUMS256.txt"
    want=$(grep " \*\?electron-v$ELECTRON-$plat.zip$" "$cache/SHASUMS256-$ELECTRON.txt" | awk '{print $1}')
    got=$(sha256sum "$zipf.part" | awk '{print $1}')
    [ "$want" = "$got" ] || { echo "Electron download checksum mismatch for $plat"; exit 1; }
    mv "$zipf.part" "$zipf"
  fi
done

# Windows
out="$dist/Geek4u-windows"
rm -rf "$out" && mkdir -p "$out"
unzip -q "$cache/electron-v$ELECTRON-win32-x64.zip" -d "$out"
mv "$out/electron.exe" "$out/Geek4u.exe"
rm -f "$out/resources/default_app.asar"
mkdir -p "$out/resources/app" "$out/resources/engine"
cp desktop/electron/app/* "$out/resources/app/"
cp "$dist/Geek4u.exe" "$out/resources/engine/Geek4u-engine.exe"
if command -v go-winres >/dev/null || [ -x "$HOME/go/bin/go-winres" ]; then
  winres="$(command -v go-winres || echo "$HOME/go/bin/go-winres")"
  (cd desktop/winres && "$winres" patch --no-backup --in winres.json "$out/Geek4u.exe")
fi
(cd "$dist" && rm -f Geek4u-windows.zip && zip -qr Geek4u-windows.zip Geek4u-windows)

# Linux
out="$dist/Geek4u-linux"
rm -rf "$out" && mkdir -p "$out"
unzip -q "$cache/electron-v$ELECTRON-linux-x64.zip" -d "$out"
mv "$out/electron" "$out/geek4u"
rm -f "$out/resources/default_app.asar"
mkdir -p "$out/resources/app" "$out/resources/engine"
cp desktop/electron/app/* "$out/resources/app/"
cp "$dist/Geek4u-linux-x64" "$out/resources/engine/geek4u-engine"
chmod +x "$out/geek4u" "$out/resources/engine/geek4u-engine"
(cd "$dist" && rm -f Geek4u-linux.tar.gz && tar czf Geek4u-linux.tar.gz Geek4u-linux)
ls -lh "$dist"
