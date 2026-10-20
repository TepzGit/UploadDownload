#!/usr/bin/env bash
# Builds build/Geek4u.apk without Android Studio, on Linux or WSL (Ubuntu/Debian):
#   sudo apt install openjdk-21-jdk-headless aapt zipalign apksigner dalvik-exchange curl zip unzip
#   ./build.sh                                  (or: VERSION_CODE=2 VERSION_NAME=1.1 ./build.sh)
# The first run downloads the Android 14 framework (about 140 MB, from Maven Central) into
# ~/.cache/geek4u-android, and makes signing/geek4u.keystore when there isn't one yet.
# Keep signing/ safe and out of git: a phone only takes an update signed with the same key.
set -euo pipefail
cd "$(dirname "$0")"

VERSION_CODE=${VERSION_CODE:-1}
VERSION_NAME=${VERSION_NAME:-1.0}
CACHE=${GEEK4U_CACHE:-$HOME/.cache/geek4u-android}
FW_URL=https://repo1.maven.org/maven2/org/robolectric/android-all/14-robolectric-10818077/android-all-14-robolectric-10818077.jar
FW_SHA256=6be2218c6a53fe3c57bc22ebdc723edcb7270a8a6f187545708aa5c0ed813977
FW_JAR=$CACHE/android-all-14.jar
FW_RES=$CACHE/android-res-34.apk
AAPT2=$(command -v aapt2 || echo /usr/lib/android-sdk/build-tools/debian/aapt2)
DX=$(command -v dalvik-exchange || command -v dx)

# The Android 14 classes and resources to build against (the Debian packages stop at Android 6).
mkdir -p "$CACHE"
if [ ! -f "$FW_JAR" ]; then
  echo "Downloading the Android 14 framework..."
  curl -fL -o "$FW_JAR.part" "$FW_URL"
  echo "$FW_SHA256  $FW_JAR.part" | sha256sum -c --quiet
  mv "$FW_JAR.part" "$FW_JAR"
fi
if [ ! -f "$FW_RES" ]; then
  tmp=$(mktemp -d)
  unzip -q -o "$FW_JAR" resources.arsc AndroidManifest.xml -d "$tmp"
  (cd "$tmp" && zip -q -0 "$FW_RES" resources.arsc AndroidManifest.xml)
  rm -rf "$tmp"
fi

rm -rf build
mkdir -p build/gen build/classes

echo "Resources..."
"$AAPT2" compile --dir res -o build/res.zip
"$AAPT2" link -I "$FW_RES" --manifest AndroidManifest.xml \
  --min-sdk-version 23 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  --java build/gen -A assets -o build/unsigned.apk build/res.zip

echo "Code..."
javac --release 8 -Xlint:-options -encoding UTF-8 -classpath "$FW_JAR" -d build/classes \
  $(find build/gen src -name '*.java')
"$DX" --dex --min-sdk-version=23 --output=build/classes.dex build/classes
(cd build && zip -q unsigned.apk classes.dex)
zipalign -f -p 4 build/unsigned.apk build/aligned.apk

echo "Signing..."
mkdir -p signing
if [ ! -f signing/geek4u.keystore ]; then
  head -c 24 /dev/urandom | base64 | tr -d '/+=\n' > signing/keystore-password.txt
  keytool -genkeypair -keystore signing/geek4u.keystore -storetype PKCS12 -alias geek4u \
    -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=Geek4u" \
    -storepass:file signing/keystore-password.txt -keypass:file signing/keystore-password.txt
fi
apksigner sign --ks signing/geek4u.keystore --ks-key-alias geek4u \
  --ks-pass file:signing/keystore-password.txt \
  --v4-signing-enabled false --out build/Geek4u.apk build/aligned.apk
apksigner verify build/Geek4u.apk
echo "Done: build/Geek4u.apk"
