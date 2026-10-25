#!/usr/bin/env bash
# Builds build/Geek4u.ipa for sideloading (Sideloadly, AltStore and the like sign it with your
# Apple ID when they install it). Runs on Linux or WSL without a Mac:
#   sudo apt install clang lld llvm python3 zip
# The first run fetches the parts of the iOS 15.6 SDK it needs from github.com/theos/sdks into
# sdk/ (about 11 MB). The optional rcodesign tool (cargo install apple-codesign) gives the app a
# full ad-hoc signature; without it the linker's simpler ad-hoc signature is used.
#   VERSION=1.1 BUILD=2 ./build.sh
set -euo pipefail
cd "$(dirname "$0")"

VERSION=${VERSION:-1.0}
BUILD=${BUILD:-1}
SDK=$PWD/sdk/iPhoneOS15.6.sdk
LLVM=$(ls -d /usr/lib/llvm-*/bin 2>/dev/null | sort -V | tail -1)
LD64=$(command -v ld64.lld || echo "$LLVM/ld64.lld")
RCODESIGN=$(command -v rcodesign || true)
LINK=(-arch arm64 -platform_version ios 15.0 15.6 -syslibroot "$SDK" -L"$SDK/usr/lib" -F"$SDK/System/Library/Frameworks"
      -lSystem -lobjc -framework Foundation -framework CoreGraphics -framework UIKit -framework WebKit -dead_strip -adhoc_codesign)

if [ ! -f "$SDK/System/Library/Frameworks/WebKit.framework/Headers/WebKit.h" ]; then
  echo "Fetching iOS SDK headers..."
  python3 tools/fetch_sdk.py "$SDK" SDKSettings.json SDKSettings.plist \
    System/Library/Frameworks/UIKit.framework/Headers/UIKit.h System/Library/Frameworks/WebKit.framework/Headers/WebKit.h \
    System/Library/Frameworks/Foundation.framework/Headers/Foundation.h \
    usr/lib/libSystem.tbd usr/lib/libSystem.B.tbd usr/lib/libobjc.tbd usr/lib/libobjc.A.tbd \
    System/Library/Frameworks/UIKit.framework/UIKit.tbd System/Library/Frameworks/WebKit.framework/WebKit.tbd \
    System/Library/Frameworks/Foundation.framework/Foundation.tbd System/Library/Frameworks/CoreFoundation.framework/CoreFoundation.tbd \
    System/Library/Frameworks/CoreGraphics.framework/CoreGraphics.tbd
fi
if [ ! -f "$SDK/usr/include/arpa/inet.h" ]; then
  echo "Fetching the C headers the offline proxy uses..."
  python3 tools/fetch_sdk.py "$SDK" $(for h in arpa/inet.h dirent.h errno.h fcntl.h netdb.h netinet/in.h netinet/tcp.h \
    poll.h pthread.h signal.h stdint.h stdio.h stdlib.h string.h strings.h sys/socket.h sys/stat.h sys/time.h time.h unistd.h; do
    echo usr/include/$h; done)
fi

rm -rf build
APP=build/Payload/Geek4u.app
mkdir -p "$APP"

echo "Code..."
clang -target arm64-apple-ios15.0 -isysroot "$SDK" -fobjc-arc -O2 -Wall -Wextra -Wno-unused-parameter \
  -Wunguarded-availability -c src/main.m -o build/main.o
clang -target arm64-apple-ios15.0 -isysroot "$SDK" -O2 -Wall -Wextra -c src/gkproxy.c -o build/gkproxy.o
# The first link fetches any framework stubs UIKit pulls in that aren't here yet.
python3 tools/fetch_reexports.py "$SDK" "$LD64" "${LINK[@]}" -o "$APP/Geek4u" build/main.o build/gkproxy.o > build/link.log
"$LD64" "${LINK[@]}" -o "$APP/Geek4u" build/main.o build/gkproxy.o

echo "Bundle..."
python3 tools/make_plist.py "$APP/Info.plist" "$VERSION" "$BUILD"
printf 'APPL????' > "$APP/PkgInfo"
cp res/panel.html res/logo.svg res/RobotoMono-Regular.ttf res/RobotoMono-SemiBold.ttf res/RobotoMono-LICENSE.txt "$APP/"
cp res/icons/AppIcon60x60@2x.png res/icons/AppIcon60x60@3x.png res/icons/AppIcon76x76~ipad.png \
   res/icons/AppIcon76x76@2x~ipad.png res/icons/AppIcon83.5x83.5@2x~ipad.png res/icons/Logo@2x.png res/icons/Logo@3x.png "$APP/"

if [ -n "$RCODESIGN" ]; then
  echo "Signing..."
  "$RCODESIGN" sign "$APP" > build/sign.log 2>&1
fi

(cd build && zip -q -r -X Geek4u.ipa Payload)
echo "Done: build/Geek4u.ipa"
