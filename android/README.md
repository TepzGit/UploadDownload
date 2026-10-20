# Geek⁴u for Android

The Geek⁴u site in an Android app, with the same look and every page and feature. The app shows your
server's real pages, so anything you change on the site shows up in the app with no rebuild.
It runs on Android 6 and newer.

## Install it

1. Copy `Geek4u.apk` to the phone (or download it there) and tap it.
2. Android asks to allow installing apps from that source (Files, Chrome, ...). Allow it and go back.
3. If Play Protect warns that it doesn't know the app, tap **More details**, then **Install anyway**.
4. On first launch, type the address you open Geek⁴u at in your browser, like `example.com` or
   `192.168.1.20:42067`. The app checks it and remembers it.

## What the app adds

- Uploads take pictures from the gallery or straight from the camera.
- Downloads go to the phone's Downloads folder, logged in as you. Long-press a picture to save it.
- The back button closes a popup or the menu first, then goes back a page.
- Links to other sites (PsychonautWiki, TripSit, ...) open in the phone's browser.
- Long-press the app icon for Graph, Journal, Forum and Change server.
- It reopens the page you were on, and shows a "Can't reach Geek⁴u" screen with Try again when the
  server is down.

## Build it

On Linux or WSL (Ubuntu or Debian), with no Android Studio needed:

    sudo apt install openjdk-21-jdk-headless aapt zipalign apksigner dalvik-exchange curl zip unzip
    bash build.sh

That makes `build/Geek4u.apk`. The first build downloads the Android 14 framework (about 140 MB,
from Maven Central) into `~/.cache/geek4u-android`.

For an update, raise the version so phones take it over the old one:

    VERSION_CODE=2 VERSION_NAME=1.1 bash build.sh

To skip the address question, put your server in `DEFAULT_SERVER` in
`src/com/geek4u/app/MainActivity.java`, like `"http://example.com:42067"`.

## The signing key

`signing/geek4u.keystore` and `signing/keystore-password.txt` sign the app. A phone only installs an
update over the app when it's signed with the same key, so keep a copy of that folder somewhere safe.
It is left out of git on purpose. If it's missing, `build.sh` makes a new key, and phones then need
the old app uninstalled first.
