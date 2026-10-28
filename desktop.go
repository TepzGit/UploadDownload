//go:build desktop

// desktop.go turns the server into an app for one computer (Windows and
// Linux). Build it with desktop/build.sh or desktop\build.bat:
//
//	go build -tags desktop -o Geek4u.exe UploadDownload.go desktop.go desktop_windows.go
//
// The site's files are inside the program. On start it unpacks them into its
// data folder, keeps the database, uploads and music there, serves only this
// computer (127.0.0.1) and opens the site in its own window (Edge, Chrome,
// Chromium or Brave in app mode, otherwise the default browser). Nothing
// needs the internet except PsychonautWiki lookups, which the pages already
// keep a copy of, and Spotify imports.
//
// `go run UploadDownload.go` leaves this file out, so the real server is unchanged.

package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

//go:embed html css js assets
var desktopFiles embed.FS

const desktopFirstPort = 42068

var (
	desktopDataDir    string
	desktopListener   net.Listener
	desktopURL        string
	desktopNoWindow   bool
	desktopImportFrom string
	desktopLastBeat   atomic.Int64
	desktopServer     = "http://87.61.252.240:42067"
	desktopSiteHash   string
	desktopServerFlag bool
	// desktopOnline is the website when it answered at start; the window
	// then shows the real site (its accounts, Files, Forum, Music) instead
	// of the offline copy. --offline or "offline" in data/mode.txt turns it off.
	desktopOnline  string
	desktopOffline bool
)

// desktopBuild is the build time (yyyyMMddHHmmss, UTC) that desktop/build.sh
// and build.bat set with -ldflags; the website's desktop/dist/build.txt has
// the time of the program it offers.
var desktopBuild = ""

func init() {
	desktopMode = true
	desktopServe = desktopRun

	port := desktopFirstPort
	dataFlag := os.Getenv("GEEK4U_DATA")
	args := os.Args[1:]
	for i := 0; i < len(args); i++ {
		switch a := args[i]; {
		case a == "--no-window":
			desktopNoWindow = true
		case a == "--offline":
			desktopOffline = true
		case a == "--data" && i+1 < len(args):
			i++
			dataFlag = args[i]
		case a == "--port" && i+1 < len(args):
			i++
			if n, err := strconv.Atoi(args[i]); err == nil && n > 0 && n < 65536 {
				port = n
			}
		case a == "--import" && i+1 < len(args):
			i++
			desktopImportFrom = args[i]
		case a == "--server" && i+1 < len(args):
			i++
			desktopServer = args[i]
			desktopServerFlag = true
		case a == "--help" || a == "-h":
			fmt.Println("Geek4u desktop app\n\n  --data DIR    keep the database, uploads and music in DIR\n  --port N      serve on 127.0.0.1:N (default 42068)\n  --no-window   only run the server and print its address\n  --import DIR  take the accounts and pictures from a server folder (only while the app has no accounts)\n  --server URL  website to take updates from and open, or \"off\" (default " + desktopServer + ")\n  --offline     use the app's own accounts and files instead of mirroring the website")
			os.Exit(0)
		}
	}

	desktopDataDir = desktopPickDataDir(dataFlag)
	if err := os.MkdirAll(desktopDataDir, 0755); err != nil {
		desktopFail("Can't create the data folder " + desktopDataDir + ": " + err.Error())
	}
	desktopLog()
	if b, err := os.ReadFile(filepath.Join(desktopDataDir, "mode.txt")); err == nil && strings.EqualFold(strings.TrimSpace(string(b)), "offline") {
		desktopOffline = true
	}

	// One copy at a time: if Geek4u already runs, open another window on it.
	for p := port; p < port+10; p++ {
		ln, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(p))
		if err == nil {
			desktopListener = ln
			desktopURL = "http://127.0.0.1:" + strconv.Itoa(p)
			break
		}
		if desktopIsOurs(p) {
			url := "http://127.0.0.1:" + strconv.Itoa(p)
			fmt.Println("Geek4u is already running at " + url)
			desktopAnnounce(url)
			if !desktopNoWindow {
				desktopOpenWindow(url + "/Main")
			}
			os.Exit(0)
		}
	}
	if desktopListener == nil {
		desktopFail(fmt.Sprintf("Ports %d to %d are all taken by other programs. Start Geek4u with --port and a free number.", port, port+9))
	}

	if err := desktopUnpack(); err != nil {
		desktopFail("Can't unpack the site into " + desktopDataDir + ": " + err.Error())
	}
	desktopUpdate()
	if err := os.Chdir(desktopDataDir); err != nil {
		desktopFail("Can't open the data folder: " + err.Error())
	}
	desktopImport()
	desktopMirrorStart()
	go desktopShortcut()
}

// desktopImport brings the server's accounts along: while the app has no
// accounts yet, it copies Database.db and profiles from the server folder
// (--import DIR, or the folder the program sits in or above, which has
// UploadDownload.go and Database.db).
func desktopImport() {
	if n, err := desktopUserCount("Database.db"); err == nil && n > 0 {
		return
	}
	from := desktopImportFrom
	if from == "" {
		exe, err := os.Executable()
		if err != nil {
			return
		}
		for dir, i := filepath.Dir(exe), 0; i < 4; dir, i = filepath.Dir(dir), i+1 {
			if desktopIsServerFolder(dir) {
				from = dir
				break
			}
		}
	}
	if from == "" {
		return
	}
	src := filepath.Join(from, "Database.db")
	if n, err := desktopUserCount(src); err != nil || n == 0 {
		fmt.Println("Nothing to import from " + from)
		return
	}
	if _, err := os.Stat("Database.db"); err == nil {
		os.Rename("Database.db", "Database.db.before-import")
	}
	if err := desktopCopyFile(src, "Database.db"); err != nil {
		fmt.Println("Could not import the accounts: " + err.Error())
		os.Rename("Database.db.before-import", "Database.db")
		return
	}
	filepath.WalkDir(filepath.Join(from, "profiles"), func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(from, path)
		if d.IsDir() {
			os.MkdirAll(rel, 0755)
		} else if _, err := os.Stat(rel); err != nil {
			desktopCopyFile(path, rel)
		}
		return nil
	})
	fmt.Println("Imported the accounts and profile pictures from " + from)
}

func desktopIsServerFolder(dir string) bool {
	for _, name := range []string{"UploadDownload.go", "Database.db"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			return false
		}
	}
	return true
}

func desktopUserCount(path string) (int, error) {
	if _, err := os.Stat(path); err != nil {
		return 0, err
	}
	d, err := sql.Open("sqlite", path)
	if err != nil {
		return 0, err
	}
	defer d.Close()
	var n int
	err = d.QueryRow("SELECT COUNT(*) FROM users").Scan(&n)
	return n, err
}

func desktopCopyFile(from, to string) error {
	in, err := os.Open(from)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// desktopPickDataDir: --data or GEEK4U_DATA, else a "Geek4u-data" folder next
// to the program (a portable copy on a USB stick), else the usual per-user place.
func desktopPickDataDir(flagDir string) string {
	if flagDir != "" {
		if abs, err := filepath.Abs(flagDir); err == nil {
			return abs
		}
		return flagDir
	}
	if exe, err := os.Executable(); err == nil {
		portable := filepath.Join(filepath.Dir(exe), "Geek4u-data")
		if fi, err := os.Stat(portable); err == nil && fi.IsDir() {
			return portable
		}
	}
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "windows":
		if v := os.Getenv("LOCALAPPDATA"); v != "" {
			return filepath.Join(v, "Geek4u")
		}
		return filepath.Join(home, "AppData", "Local", "Geek4u")
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "Geek4u")
	default:
		if v := os.Getenv("XDG_DATA_HOME"); v != "" {
			return filepath.Join(v, "geek4u")
		}
		return filepath.Join(home, ".local", "share", "geek4u")
	}
}

// desktopLog sends the server's log to geek4u.log in the data folder, and
// also to the terminal when it was started from one.
// desktopAnnounce writes the address to the file the Electron window names
// in GEEK4U_ADDR_FILE, so it doesn't depend on reading our output.
func desktopAnnounce(url string) {
	if f := os.Getenv("GEEK4U_ADDR_FILE"); f != "" {
		os.WriteFile(f, []byte(url), 0644)
	}
}

func desktopLog() {
	name := filepath.Join(desktopDataDir, "geek4u.log")
	if fi, err := os.Stat(name); err == nil && fi.Size() > 5<<20 {
		os.Rename(name, name+".old")
	}
	f, err := os.OpenFile(name, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return
	}
	var out io.Writer = f
	// A terminal, or the Electron window reading the address from a pipe.
	if fi, err := os.Stdout.Stat(); err == nil && fi.Mode()&(os.ModeCharDevice|os.ModeNamedPipe|os.ModeSocket) != 0 {
		if null, err := os.Stat(os.DevNull); err != nil || !os.SameFile(fi, null) {
			out = io.MultiWriter(f, os.Stdout)
		}
	}
	r, w, err := os.Pipe()
	if err != nil {
		os.Stdout, os.Stderr = f, f
	} else {
		os.Stdout, os.Stderr = w, w
		go io.Copy(out, r)
	}
	fmt.Printf("\n[%s] Geek4u desktop starting, data in %s\n", time.Now().Format("2006-01-02 15:04:05"), desktopDataDir)
}

func desktopFail(msg string) {
	fmt.Println("Geek4u: " + msg)
	desktopAlert(msg)
	os.Exit(1)
}

// desktopIsOurs reports whether Geek4u answers on that port.
func desktopIsOurs(port int) bool {
	client := http.Client{Timeout: 2 * time.Second}
	res, err := client.Get("http://127.0.0.1:" + strconv.Itoa(port) + "/desktop/ping")
	if err != nil {
		return false
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 64))
	return string(b) == "geek4u"
}

// desktopUnpack writes the site's files (html, css, js, assets) into the data
// folder when this build's copy differs from what is there.
func desktopUnpack() error {
	sum := sha256.New()
	fs.WalkDir(desktopFiles, ".", func(path string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			b, _ := desktopFiles.ReadFile(path)
			sum.Write([]byte(path + "\x00"))
			sum.Write(b)
		}
		return nil
	})
	version := hex.EncodeToString(sum.Sum(nil))
	desktopSiteHash = version
	stamp := filepath.Join(desktopDataDir, "site-version.txt")
	if b, err := os.ReadFile(stamp); err == nil && strings.TrimSpace(string(b)) == version {
		return nil
	}
	// These folders only ever hold the unpacked site, never anyone's data.
	for _, dir := range []string{"html", "css", "js", "assets"} {
		os.RemoveAll(filepath.Join(desktopDataDir, dir))
	}
	err := fs.WalkDir(desktopFiles, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		target := filepath.Join(desktopDataDir, filepath.FromSlash(path))
		if d.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		b, err := desktopFiles.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, b, 0644)
	})
	if err != nil {
		return err
	}
	// The files from the website (desktopUpdate) were just replaced.
	os.Remove(filepath.Join(desktopDataDir, "server-version.txt"))
	return os.WriteFile(stamp, []byte(version+"\n"), 0644)
}

// desktopRun is called by main once the database is ready.
func desktopRun(handler http.Handler) {
	host := desktopListener.Addr().String()
	wrapped := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Only pages on this computer's own address: a web page that points
		// its own domain at 127.0.0.1 can't reach the app.
		if h := r.Host; h != host && h != strings.Replace(host, "127.0.0.1", "localhost", 1) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		switch r.URL.Path {
		case "/desktop/ping":
			io.WriteString(w, "geek4u")
			return
		case "/desktop/alive":
			desktopLastBeat.Store(time.Now().UnixMilli())
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if desktopMirror {
			if !strings.HasPrefix(r.URL.Path, "/desktop/") {
				if c, err := r.Cookie("xn_local"); err != nil || c.Value != "1" {
					http.SetCookie(w, &http.Cookie{Name: "xn_local", Value: "1", Path: "/", MaxAge: 10 * 365 * 24 * 3600, SameSite: http.SameSiteLaxMode})
				}
				desktopMirrorServe(w, r, desktopServerURL())
				return
			}
		}
		// Tells the pages the server is on this computer, so they never send
		// people away with "You need internet" (nav.js, offline.js).
		if c, err := r.Cookie("xn_local"); err != nil || c.Value != "1" {
			http.SetCookie(w, &http.Cookie{Name: "xn_local", Value: "1", Path: "/", MaxAge: 10 * 365 * 24 * 3600, SameSite: http.SameSiteLaxMode})
		}
		// The site's files only change with a new version of the app, so the
		// window shows its saved copy at once and checks for a newer one after.
		if r.Method == http.MethodGet {
			switch strings.ToLower(filepath.Ext(r.URL.Path)) {
			case ".css", ".js", ".woff2", ".woff", ".ttf", ".png", ".svg", ".jpg", ".jpeg", ".webp", ".gif", ".ico":
				if !strings.HasPrefix(r.URL.Path, "/Files/") && !strings.HasPrefix(r.URL.Path, "/profiles/") {
					w.Header().Set("Cache-Control", "max-age=300, stale-while-revalidate=604800")
				}
			}
		}
		handler.ServeHTTP(w, r)
	})

	go func() {
		err := http.Serve(desktopListener, wrapped)
		desktopFail("The server stopped: " + fmt.Sprint(err))
	}()
	fmt.Println("Geek4u is running at " + desktopURL + " (data in " + desktopDataDir + ")")
	desktopAnnounce(desktopURL)

	if desktopNoWindow {
		select {}
	}
	started := time.Now()
	desktopLastBeat.Store(started.UnixMilli())
	if cmd := desktopOpenWindow(desktopURL + "/Main"); cmd != nil {
		cmd.Wait()
		// Our own window was open a while and is now closed: quit with it.
		if time.Since(started) > 8*time.Second {
			desktopQuit()
		}
	}
	// The default browser, or a browser that handed the window to one that
	// was already open: keep going while any page still checks in (nav.js
	// does every 30 seconds), and quit three minutes after the last one.
	for {
		time.Sleep(30 * time.Second)
		if time.Since(time.UnixMilli(desktopLastBeat.Load())) > 3*time.Minute {
			desktopQuit()
		}
	}
}

func desktopQuit() {
	fmt.Printf("[%s] Geek4u window closed, stopping\n", time.Now().Format("2006-01-02 15:04:05"))
	if db != nil {
		db.Close()
	}
	time.Sleep(100 * time.Millisecond) // let the log catch up
	os.Exit(0)
}

// desktopOpenWindow opens url in an app window of a Chromium browser with its
// own profile in the data folder. It returns the browser process, or nil when
// it fell back to the default browser.
func desktopOpenWindow(url string) *exec.Cmd {
	if browser := desktopFindBrowser(); browser != "" {
		cmd := exec.Command(browser,
			"--app="+url,
			"--user-data-dir="+filepath.Join(desktopDataDir, "window"),
			"--no-first-run",
			"--no-default-browser-check",
			"--window-size=1280,860",
			"--autoplay-policy=no-user-gesture-required",
		)
		if err := cmd.Start(); err == nil {
			return cmd
		}
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		fmt.Println("Open " + url + " in a browser.")
		desktopAlert("Open " + url + " in your browser.")
	}
	return nil
}

func desktopFindBrowser() string {
	if v := os.Getenv("GEEK4U_BROWSER"); v != "" {
		return v
	}
	if runtime.GOOS == "windows" {
		var dirs []string
		for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
			if v := os.Getenv(env); v != "" {
				dirs = append(dirs, v)
			}
		}
		for _, rel := range []string{
			`Microsoft\Edge\Application\msedge.exe`,
			`Google\Chrome\Application\chrome.exe`,
			`BraveSoftware\Brave-Browser\Application\brave.exe`,
			`Chromium\Application\chrome.exe`,
		} {
			for _, dir := range dirs {
				p := filepath.Join(dir, rel)
				if _, err := os.Stat(p); err == nil {
					return p
				}
			}
		}
		return ""
	}
	if runtime.GOOS == "darwin" {
		for _, p := range []string{
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
		} {
			if _, err := os.Stat(p); err == nil {
				return p
			}
		}
		return ""
	}
	for _, name := range []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave-browser", "brave"} {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	// Flatpak installs
	for _, id := range []string{"com.google.Chrome", "org.chromium.Chromium", "com.microsoft.Edge", "com.brave.Browser"} {
		for _, dir := range []string{"/var/lib/flatpak/exports/bin", filepath.Join(os.Getenv("HOME"), ".local/share/flatpak/exports/bin")} {
			p := filepath.Join(dir, id)
			if _, err := os.Stat(p); err == nil {
				return p
			}
		}
	}
	return ""
}

// desktopIcon is the app icon, for the Linux menu entry.
func desktopIcon() []byte {
	b, _ := desktopFiles.ReadFile("assets/brand/icon-512.png")
	return b
}

// desktopUpdate asks the website (desktopServer, or GEEK4U_SERVER, or
// server.txt in the data folder) for newer site files and a newer program.
// Without internet it gives up after a few seconds and the app starts as is.
// New site files are used right away; a new program is put in place of this
// one and runs from the next start.
// desktopServerURL is the website the app talks to ("" when turned off).
func desktopServerURL() string {
	server := desktopServer
	if !desktopServerFlag {
		if env := strings.TrimSpace(os.Getenv("GEEK4U_SERVER")); env != "" {
			server = env
		} else if b, err := os.ReadFile(filepath.Join(desktopDataDir, "server.txt")); err == nil && strings.TrimSpace(string(b)) != "" {
			server = strings.TrimSpace(string(b))
		}
	}
	server = strings.TrimRight(strings.TrimSpace(server), "/")
	if strings.EqualFold(server, "off") {
		return ""
	}
	return server
}

func desktopUpdate() {
	server := desktopServerURL()
	if server == "" {
		return
	}
	client := &http.Client{Timeout: 4 * time.Second}
	res, err := client.Get(server + "/app-update/version")
	if err != nil {
		fmt.Println("Update check skipped:", err)
		return
	}
	// It answered, so it's up: open it even if it's too old to offer updates.
	if res.StatusCode < 500 {
		desktopOnline = server
	}
	var info struct {
		Site     string   `json:"site"`
		SiteTime int64    `json:"siteTime"`
		Build    string   `json:"build"`
		Programs []string `json:"programs"`
	}
	err = json.NewDecoder(io.LimitReader(res.Body, 1<<16)).Decode(&info)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || err != nil {
		fmt.Println("Update check skipped: the website answered", res.Status)
		return
	}
	go desktopUpdateProgram(server, info.Build, info.Programs)
	if err := desktopUpdateSite(server, info.Site, info.SiteTime); err != nil {
		fmt.Println("Site update failed:", err)
	}
}

// desktopBuildTime is when this program was built (zero if unknown).
func desktopBuildTime() time.Time {
	t, _ := time.Parse("20060102150405", desktopBuild)
	return t
}

// desktopUpdateSite swaps in the website's html, css, js and assets when they
// differ from what the app has and are newer than this program.
func desktopUpdateSite(server, version string, siteTime int64) error {
	if version == "" || version == desktopSiteHash {
		return nil
	}
	stampFile := filepath.Join(desktopDataDir, "server-version.txt")
	if b, err := os.ReadFile(stampFile); err == nil && strings.TrimSpace(string(b)) == version {
		return nil
	}
	// Never trade this program's own files for older ones from the website.
	if built := desktopBuildTime(); !built.IsZero() && time.Unix(siteTime, 0).Before(built) {
		return nil
	}
	client := &http.Client{Timeout: 3 * time.Minute}
	res, err := client.Get(server + "/app-update/site.zip")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("the website answered %s", res.Status)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 500<<20))
	if err != nil {
		return err
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}

	// Unpack next to the live files, checking the version on the way.
	tmp := filepath.Join(desktopDataDir, "site-update")
	os.RemoveAll(tmp)
	defer os.RemoveAll(tmp)
	allowed := map[string]bool{"assets": true, "css": true, "html": true, "js": true}
	sum := sha256.New()
	hasHTML := false
	for _, f := range zr.File {
		name := f.Name
		top, _, _ := strings.Cut(name, "/")
		if !allowed[top] || strings.Contains(name, "..") || strings.Contains(name, "\\") || strings.HasSuffix(name, "/") {
			return fmt.Errorf("unexpected file %q in the update", name)
		}
		hasHTML = hasHTML || top == "html"
		rc, err := f.Open()
		if err != nil {
			return err
		}
		b, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return err
		}
		sum.Write([]byte(name + "\x00"))
		sum.Write(b)
		target := filepath.Join(tmp, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(target, b, 0644); err != nil {
			return err
		}
	}
	if !hasHTML || hex.EncodeToString(sum.Sum(nil)) != version {
		return fmt.Errorf("the update was incomplete")
	}

	for dir := range allowed {
		os.MkdirAll(filepath.Join(tmp, dir), 0755)
		live := filepath.Join(desktopDataDir, dir)
		os.RemoveAll(live)
		if err := os.Rename(filepath.Join(tmp, dir), live); err != nil {
			// Put this program's own files back.
			os.Remove(filepath.Join(desktopDataDir, "site-version.txt"))
			desktopUnpack()
			return err
		}
	}
	fmt.Println("Site files updated from", server)
	return os.WriteFile(stampFile, []byte(version+"\n"), 0644)
}

// desktopUpdateProgram downloads a newer program from the website and puts it
// in place of this one (the running copy is kept as .old until next time).
func desktopUpdateProgram(server, build string, programs []string) {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	os.Remove(exe + ".old")
	key := runtime.GOOS + "-" + runtime.GOARCH
	offered := false
	for _, p := range programs {
		offered = offered || p == key
	}
	// Build times are yyyyMMddHHmmss, so newer sorts later.
	if !offered || desktopBuild == "" || len(build) != len(desktopBuild) || build <= desktopBuild {
		return
	}
	client := &http.Client{Timeout: 15 * time.Minute}
	res, err := client.Get(server + "/app-update/program/" + key)
	if err != nil {
		fmt.Println("Program update failed:", err)
		return
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		fmt.Println("Program update failed: the website answered", res.Status)
		return
	}
	next := exe + ".new"
	f, err := os.OpenFile(next, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0755)
	if err != nil {
		fmt.Println("Program update failed:", err)
		return
	}
	n, err := io.Copy(f, io.LimitReader(res.Body, 300<<20))
	f.Close()
	if err != nil || n < 1<<20 || (res.ContentLength > 0 && n != res.ContentLength) {
		os.Remove(next)
		fmt.Println("Program update failed: the download was incomplete")
		return
	}
	// A running program can be renamed (also on Windows), not overwritten.
	if err := os.Rename(exe, exe+".old"); err != nil {
		os.Remove(next)
		fmt.Println("Program update failed:", err)
		return
	}
	if err := os.Rename(next, exe); err != nil {
		os.Rename(exe+".old", exe)
		fmt.Println("Program update failed:", err)
		return
	}
	fmt.Println("Program updated to build", build, "- it is used from the next start")
}

// ---- Mirror of the website ----
// While the website answers, the window still shows this app's own address,
// and every request is passed on to the website. Each page, picture, file and
// answer that comes back is kept in data/mirror, so with no internet the app
// shows the website exactly as it was the last time it was online. Things
// saved offline (a dose, say) can't reach the website, so the connection is
// closed and the pages keep them in their outbox (offline.js) until it's back.

var (
	desktopMirror       bool // the window shows the website through this app
	desktopMirrorDir    string
	desktopMirrorUp     atomic.Bool // the website answered the last request
	desktopMirrorDown   atomic.Int64 // when it last failed (ms)
	desktopMirrorCookie atomic.Value // the window's last Cookie header, for refreshing pages
)

const desktopMirrorMax = 4 << 30       // keep at most 4 GB
const desktopMirrorFileMax = 300 << 20 // bigger answers aren't kept

func desktopMirrorStart() {
	server := desktopServerURL()
	if server == "" || desktopOffline {
		return
	}
	desktopMirrorDir = filepath.Join(desktopDataDir, "mirror")
	entries, _ := os.ReadDir(desktopMirrorDir)
	if desktopOnline == "" && len(entries) == 0 {
		return // never been online: use the app's own copy
	}
	os.MkdirAll(desktopMirrorDir, 0755)
	desktopMirror = true
	desktopMirrorUp.Store(desktopOnline != "")
	if b, err := os.ReadFile(filepath.Join(desktopMirrorDir, "cookie.txt")); err == nil {
		desktopMirrorCookie.Store(string(b))
	}
	fmt.Println("Mirroring " + server + " (offline copy in " + desktopMirrorDir + ")")
	go desktopMirrorRefresh(server)
	go desktopMirrorTrim()
}

type desktopMirrorMeta struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Saved   int64             `json:"saved"`
}

// Kept headers of a saved answer.
var desktopMirrorKeep = []string{"Content-Type", "Content-Disposition", "Last-Modified", "Content-Language"}

func desktopMirrorKey(r *http.Request) string {
	sum := sha256.Sum256([]byte(r.URL.Path + "?" + r.URL.RawQuery))
	return hex.EncodeToString(sum[:16])
}

// Requests that make no sense to keep or to answer from the copy.
func desktopMirrorSkip(p string) bool {
	for _, pre := range []string{"/logout", "/login", "/desktop/", "/app-update/", "/upload/link"} {
		if strings.HasPrefix(p, pre) {
			return true
		}
	}
	return false
}

func desktopMirrorServe(w http.ResponseWriter, r *http.Request, server string) {
	if c := r.Header.Get("Cookie"); c != "" {
		if old, _ := desktopMirrorCookie.Load().(string); old != c {
			desktopMirrorCookie.Store(c)
			os.WriteFile(filepath.Join(desktopMirrorDir, "cookie.txt"), []byte(c), 0600)
		}
	}
	// After a failure, wait 20 s before trying the website again so offline pages stay fast.
	tryOnline := desktopMirrorUp.Load() || time.Since(time.UnixMilli(desktopMirrorDown.Load())) > 20*time.Second
	if tryOnline && desktopMirrorForward(w, r, server) {
		return
	}
	desktopMirrorOffline(w, r)
}

var desktopMirrorClient = &http.Client{
	Timeout: 0,
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	Transport: &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
		ResponseHeaderTimeout: 60 * time.Second,
		MaxIdleConnsPerHost:   8,
	},
}

// desktopMirrorForward passes r on to the website; false when it can't be reached.
func desktopMirrorForward(w http.ResponseWriter, r *http.Request, server string) bool {
	var body io.Reader
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		// Kept in memory so the request can still be answered offline if the website is gone.
		b, err := io.ReadAll(io.LimitReader(r.Body, 8<<30))
		if err != nil {
			return false
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(r.Context(), r.Method, server+r.URL.RequestURI(), body)
	if err != nil {
		return false
	}
	for k, vs := range r.Header {
		switch k {
		case "Host", "Accept-Encoding", "Connection", "Origin", "Referer":
			continue
		}
		req.Header[k] = vs
	}
	if ref := r.Header.Get("Referer"); ref != "" {
		req.Header.Set("Referer", strings.Replace(ref, desktopURL, server, 1))
	}
	if r.Header.Get("Origin") != "" {
		req.Header.Set("Origin", server)
	}
	res, err := desktopMirrorClient.Do(req)
	if err != nil {
		if r.Context().Err() != nil {
			return true // the window gave up on it; nothing to answer
		}
		desktopMirrorUp.Store(false)
		desktopMirrorDown.Store(time.Now().UnixMilli())
		return false
	}
	defer res.Body.Close()
	desktopMirrorUp.Store(true)

	h := w.Header()
	for k, vs := range res.Header {
		switch k {
		case "Set-Cookie", "Location", "Content-Length", "Connection", "Transfer-Encoding":
			continue
		}
		h[k] = vs
	}
	for _, c := range res.Header.Values("Set-Cookie") {
		h.Add("Set-Cookie", desktopMirrorCookieFix(c))
	}
	if loc := res.Header.Get("Location"); loc != "" {
		h.Set("Location", strings.Replace(loc, server, "", 1))
	}
	if res.ContentLength >= 0 && res.Header.Get("Content-Encoding") == "" {
		h.Set("Content-Length", strconv.FormatInt(res.ContentLength, 10))
	}

	keep := r.Method == http.MethodGet && res.StatusCode == http.StatusOK && r.Header.Get("Range") == "" &&
		!desktopMirrorSkip(r.URL.Path) && res.ContentLength <= desktopMirrorFileMax
	if r.Method == http.MethodGet && res.StatusCode == http.StatusPartialContent {
		// A song or video played in pieces: keep a whole copy in the background.
		go desktopMirrorFetchWhole(server, r)
	}
	w.WriteHeader(res.StatusCode)
	if !keep {
		io.Copy(w, res.Body)
		return true
	}
	key := desktopMirrorKey(r)
	tmp, err := os.CreateTemp(desktopMirrorDir, key+"-*.part")
	if err != nil {
		io.Copy(w, res.Body)
		return true
	}
	n, copyErr := io.Copy(io.MultiWriter(w, desktopLimitWriter{tmp, desktopMirrorFileMax}), res.Body)
	tmp.Close()
	if copyErr != nil || n > desktopMirrorFileMax || (res.ContentLength >= 0 && n != res.ContentLength) {
		os.Remove(tmp.Name())
		return true
	}
	desktopMirrorSave(key, tmp.Name(), res)
	return true
}

type desktopLimitWriter struct {
	f   *os.File
	max int64
}

func (l desktopLimitWriter) Write(p []byte) (int, error) {
	if st, _ := l.f.Stat(); st != nil && st.Size()+int64(len(p)) > l.max {
		return len(p), nil // stop keeping, but don't break the answer
	}
	return l.f.Write(p)
}

func desktopMirrorSave(key, tmpName string, res *http.Response) {
	meta := desktopMirrorMeta{Status: res.StatusCode, Headers: map[string]string{}, Saved: time.Now().UnixMilli()}
	for _, k := range desktopMirrorKeep {
		if v := res.Header.Get(k); v != "" {
			meta.Headers[k] = v
		}
	}
	b, _ := json.Marshal(meta)
	body := filepath.Join(desktopMirrorDir, key)
	os.Remove(body)
	if err := os.Rename(tmpName, body); err != nil {
		os.Remove(tmpName)
		return
	}
	os.WriteFile(body+".json", b, 0644)
}

// The website's cookies, set on this app's address instead.
func desktopMirrorCookieFix(c string) string {
	parts := strings.Split(c, ";")
	out := parts[:1]
	for _, p := range parts[1:] {
		k := strings.ToLower(strings.TrimSpace(strings.SplitN(p, "=", 2)[0]))
		if k == "domain" || k == "secure" {
			continue
		}
		out = append(out, p)
	}
	return strings.Join(out, ";")
}

var desktopMirrorWhole sync.Map

func desktopMirrorFetchWhole(server string, r *http.Request) {
	key := desktopMirrorKey(r)
	if _, busy := desktopMirrorWhole.LoadOrStore(key, true); busy {
		return
	}
	defer desktopMirrorWhole.Delete(key)
	if _, err := os.Stat(filepath.Join(desktopMirrorDir, key)); err == nil {
		return
	}
	req, err := http.NewRequest(http.MethodGet, server+r.URL.RequestURI(), nil)
	if err != nil {
		return
	}
	if c := r.Header.Get("Cookie"); c != "" {
		req.Header.Set("Cookie", c)
	}
	res, err := desktopMirrorClient.Do(req)
	if err != nil {
		return
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK || res.ContentLength > desktopMirrorFileMax {
		return
	}
	tmp, err := os.CreateTemp(desktopMirrorDir, key+"-*.part")
	if err != nil {
		return
	}
	n, err := io.Copy(tmp, io.LimitReader(res.Body, desktopMirrorFileMax+1))
	tmp.Close()
	if err != nil || n > desktopMirrorFileMax || (res.ContentLength >= 0 && n != res.ContentLength) {
		os.Remove(tmp.Name())
		return
	}
	desktopMirrorSave(key, tmp.Name(), res)
}

func desktopMirrorOffline(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		key := desktopMirrorKey(r)
		body := filepath.Join(desktopMirrorDir, key)
		var meta desktopMirrorMeta
		if b, err := os.ReadFile(body + ".json"); err == nil && json.Unmarshal(b, &meta) == nil {
			if f, err := os.Open(body); err == nil {
				defer f.Close()
				for k, v := range meta.Headers {
					w.Header().Set(k, v)
				}
				w.Header().Set("X-Geek4u-Offline", "1")
				w.Header().Set("Cache-Control", "no-store")
				http.ServeContent(w, r, "", time.UnixMilli(meta.Saved), f)
				now := time.Now()
				os.Chtimes(body, now, now) // recently used, so it's kept longest
				return
			}
		}
		if strings.Contains(r.Header.Get("Accept"), "text/html") {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusServiceUnavailable)
			io.WriteString(w, desktopOfflinePage)
			return
		}
		http.Error(w, "You're offline and this wasn't saved while online.", http.StatusServiceUnavailable)
		return
	}
	// A change made offline: drop the connection so the page treats it as
	// "no internet" and keeps it in its outbox to send later.
	if hj, ok := w.(http.Hijacker); ok {
		if conn, _, err := hj.Hijack(); err == nil {
			conn.Close()
			return
		}
	}
	http.Error(w, "You're offline, so this can't be saved on the website right now.", http.StatusServiceUnavailable)
}

const desktopOfflinePage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline · Geek⁴u</title>
<style>html,body{margin:0;height:100%;background:#000;color:#eee;font-family:ui-monospace,Consolas,monospace}main{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:14px;padding:24px;text-align:center}h1{font-size:20px;margin:0}p{margin:0;color:#9c96aa;font-size:13px;line-height:1.6;max-width:30rem}a{color:#a67cff}</style></head>
<body><main><h1>You're offline</h1><p>This page wasn't opened while you were online, so there's no copy of it yet. Pages you've opened before still work.</p><p><a href="/Main">Main</a> · <a href="/">Graph</a> · <a href="javascript:history.back()">Back</a> · <a href="javascript:location.reload()">Try again</a></p></main></body></html>`

// desktopMirrorRefresh fetches the main pages and their data again on every
// online start, so the offline copy is the latest even for pages not opened.
func desktopMirrorRefresh(server string) {
	if desktopOnline == "" {
		return
	}
	// Let the window load first, and wait for someone to be signed in.
	var cookie string
	for i := 0; i < 80 && !strings.Contains(cookie, "SessionID="); i++ {
		time.Sleep(15 * time.Second)
		cookie, _ = desktopMirrorCookie.Load().(string)
	}
	if !strings.Contains(cookie, "SessionID=") {
		return
	}
	paths := []string{"/Main", "/", "/journal", "/Notes", "/Forum", "/Music", "/Profile", "/Utility", "/Files/",
		"/forum/posts", "/forum/members", "/friends", "/notifications", "/profile/appearance", "/experiences",
		"/graphColors", "/likes", "/substances/custom", "/music/library", "/music/playlists", "/notes/reports", "/notes/notepad"}
	for _, p := range paths {
		req, _ := http.NewRequest(http.MethodGet, desktopURL+p, nil)
		req.Header.Set("Cookie", cookie)
		req.Header.Set("Accept", "text/html,application/json,*/*")
		rec := &desktopDiscard{h: http.Header{}}
		desktopMirrorForward(rec, req, server)
		time.Sleep(200 * time.Millisecond)
	}
}

type desktopDiscard struct{ h http.Header }

func (d *desktopDiscard) Header() http.Header         { return d.h }
func (d *desktopDiscard) Write(p []byte) (int, error) { return len(p), nil }
func (d *desktopDiscard) WriteHeader(int)             {}

// desktopMirrorTrim keeps the copy under desktopMirrorMax, dropping what was used least recently.
func desktopMirrorTrim() {
	for {
		entries, _ := os.ReadDir(desktopMirrorDir)
		type item struct {
			path string
			size int64
			mod  time.Time
		}
		var items []item
		var total int64
		for _, e := range entries {
			name := e.Name()
			if e.IsDir() || strings.HasSuffix(name, ".json") || name == "cookie.txt" {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			if strings.HasSuffix(name, ".part") {
				if time.Since(info.ModTime()) > time.Hour {
					os.Remove(filepath.Join(desktopMirrorDir, name))
				}
				continue
			}
			items = append(items, item{filepath.Join(desktopMirrorDir, name), info.Size(), info.ModTime()})
			total += info.Size()
		}
		if total > desktopMirrorMax {
			sort.Slice(items, func(a, b int) bool { return items[a].mod.Before(items[b].mod) })
			for _, it := range items {
				if total <= desktopMirrorMax*9/10 {
					break
				}
				os.Remove(it.path)
				os.Remove(it.path + ".json")
				total -= it.size
			}
		}
		time.Sleep(10 * time.Minute)
	}
}
