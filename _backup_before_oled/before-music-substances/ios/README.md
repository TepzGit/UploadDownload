# Geek⁴u for iPhone and iPad

The Geek⁴u site in an iOS app, with the same look and every page and feature. The app shows your
server's real pages, so anything you change on the site shows up in the app with no rebuild.
It runs on iOS 15 and newer.

## Install it (sideloading)

`Geek4u.ipa` is meant for a sideloading tool, which signs it with your Apple ID as it installs:

- **Sideloadly** (Windows or Mac): plug in the iPhone, drop `Geek4u.ipa` in, type your Apple ID, Start.
- **AltStore**: open AltStore on the iPhone, My Apps, **+**, pick `Geek4u.ipa`.

Then, on the iPhone:

1. Settings, General, VPN & Device Management: tap your Apple ID and **Trust** it.
2. On iOS 16 and newer, turn on Settings, Privacy & Security, **Developer Mode**, and restart.
3. On first launch, type the address you open Geek⁴u at in your browser, like `example.com` or
   `192.168.1.20:42067`. Allow "find devices on your local network" if your server is at home.

With a free Apple ID the app stops opening after 7 days until it's installed again (AltStore can
refresh it for you over Wi-Fi). A paid developer account makes that a year.

## What the app adds

- Uploads take pictures from the photo library or straight from the camera.
- Downloads open the share sheet, so you can Save to Files or send them on.
- Swipe from the left edge to go back, and pull down to refresh.
- Links to other sites (PsychonautWiki, TripSit, ...) open in Safari.
- Long-press the app icon for Graph, Journal, Forum and Change server.
- It reopens the page you were on, and shows a "Can't reach Geek⁴u" screen with Try again when the
  server is down.

## Build it

No Mac is needed. On Linux or WSL (Ubuntu or Debian):

    sudo apt install clang lld llvm python3 zip
    cargo install apple-codesign     # optional: gives the app a full ad-hoc signature
    bash build.sh

That makes `build/Geek4u.ipa`. The first build fetches the parts of the iOS 15.6 SDK it needs
(about 11 MB) from github.com/theos/sdks into `sdk/`.

For an update: `VERSION=1.1 BUILD=2 bash build.sh`.

To skip the address question, put your server in `kDefaultServer` in `src/main.m`, like
`@"http://example.com:42067"`.

The setup and error screens are `res/panel.html`; the app talks to it through
`window.webkit.messageHandlers.geek4u`.
