#!/usr/bin/env bash
# Builds the Geek4u desktop app into desktop/dist:
#   Geek4u.exe            Windows (64-bit)
#   Geek4u-linux-x64      Linux (64-bit PCs)
#   Geek4u-linux-arm64    Linux on ARM (Raspberry Pi 4/5, ARM laptops)
# Needs only Go. Run from anywhere: bash desktop/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."
out="$PWD/desktop/dist"
mkdir -p "$out"

# A clean copy with just what the app needs (the folder also has
# CreateBcryptPass.go, a second main, and the phone apps).
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp go.mod go.sum UploadDownload.go desktop.go desktop_windows.go desktop_other.go "$work/"
cp -r html css js assets "$work/"
cp desktop/rsrc_windows_*.syso "$work/"

cd "$work"
flags=(-tags desktop -trimpath)
GOOS=windows GOARCH=amd64 go build "${flags[@]}" -ldflags "-s -w -H windowsgui" -o "$out/Geek4u.exe" .
GOOS=linux   GOARCH=amd64 go build "${flags[@]}" -ldflags "-s -w" -o "$out/Geek4u-linux-x64" .
GOOS=linux   GOARCH=arm64 go build "${flags[@]}" -ldflags "-s -w" -o "$out/Geek4u-linux-arm64" .
ls -lh "$out"
