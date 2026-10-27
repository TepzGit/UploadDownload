# Geek4u desktop app (Windows and Linux)

The whole site as one program that runs on your own computer, without the
server and without internet. It is the same server code (`UploadDownload.go`)
with the site's files built in, serving only this computer, and it opens the
site in its own window.

## The files

| File | For |
| --- | --- |
| `dist/Geek4u.exe` | Windows 10 and 11 (64-bit) |
| `dist/Geek4u-linux-x64` | Linux on normal 64-bit PCs |
| `dist/Geek4u-linux-arm64` | Linux on ARM (Raspberry Pi 4/5, ARM laptops) |

Each one is a single file. Copy it anywhere and start it.

- **Windows:** double-click `Geek4u.exe`. If SmartScreen says "Windows protected your PC", click
  *More info* then *Run anyway* (the program isn't signed). It adds Geek4u to the Start menu.
- **Linux:** `chmod +x Geek4u-linux-x64` once, then start it. It adds Geek4u to the app menu.

The window is Edge, Chrome, Chromium or Brave in app mode (no address bar). Without
any of those it opens in the default browser. Closing the window stops Geek4u.

## Accounts and data

The app has its own database, separate from the server. The **first account you
sign up is the admin** (Files, Admin page, Substances Importer); later ones are
normal accounts.

Everything is kept in one folder:

- Windows: `%LOCALAPPDATA%\Geek4u`
- Linux: `~/.local/share/geek4u`

It holds `Database.db`, `UploadedFiles`, `profiles`, `MusicCache`, `geek4u.log`
and the unpacked site.

**Your server accounts:** while the app has no accounts, it copies `Database.db`
and `profiles` from the server folder, so the same usernames and passwords work.
It finds that folder when the program sits inside it (like
`X:\UploadDownload\desktop\dist\Geek4u.exe`), or start it with
`--import X:\UploadDownload`. It's a copy: accounts made later on the server
don't show up in the app, and the other way round.

Portable copy (USB stick): make a folder named `Geek4u-data` next to the program
and the app keeps everything there instead.

Options: `--data DIR` (data folder), `--port N` (default 42068), `--no-window`
(just the server; open http://127.0.0.1:42068 yourself), `--server URL`.

## Updates from the website

On start the app asks the website (default http://87.61.252.240:42067; change
it with `--server URL`, `GEEK4U_SERVER` or a `server.txt` in the data folder,
`off` turns it off) for `/app-update/version`:

- Newer site files (html, css, js, assets) are downloaded and used right away.
- A newer program from the website's `desktop/dist` (its `build.txt` holds the
  build time) replaces this one and runs from the next start; the old copy is
  kept as `.old` until then.

Without internet it gives up after 4 seconds. So the website hands out new
versions, run `bash desktop/build.sh` (or `desktop\build.bat`) before
`updateServer.sh`. Accounts and data are not synced; each app keeps its own.

## What needs internet

Everything runs offline except:

- PsychonautWiki lookups. The Graph saves the whole substance list the first
  time it opens with internet, and the Graph, Journal and Drug info use that
  copy offline. Open the Graph once while online after installing.
  Custom substances from the Substances Importer always work.
- Spotify playlist imports ("Paste a list" works offline).
- Backing up PsychonautWiki replications.

Music plays mp3, m4a, aac, wav, flac and aiff directly. Other formats (ogg,
opus, wma) need ffmpeg installed.

## Building

Needs Go only. From the repository folder:

- Windows: `desktop\build.bat`
- Linux or macOS: `bash desktop/build.sh`

Both build all three files into `desktop/dist`. The code is `desktop.go`,
`desktop_windows.go` and `desktop_other.go` in the repository root. They only
build with `-tags desktop`, so `go run UploadDownload.go` and the server build
ignore them. The icon and version info for the exe come from
`desktop/rsrc_windows_*.syso`, made from `desktop/winres` with
[go-winres](https://github.com/tc-hib/go-winres):
`go-winres make --in desktop/winres/winres.json --arch amd64,arm64 --out desktop/rsrc`.
