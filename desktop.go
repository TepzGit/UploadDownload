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
	"strconv"
	"strings"
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
			fmt.Println("Geek4u desktop app\n\n  --data DIR    keep the database, uploads and music in DIR\n  --port N      serve on 127.0.0.1:N (default 42068)\n  --no-window   only run the server and print its address\n  --import DIR  take the accounts and pictures from a server folder (only while the app has no accounts)\n  --server URL  website to take updates from, or \"off\" (default " + desktopServer + ")")
			os.Exit(0)
		}
	}

	desktopDataDir = desktopPickDataDir(dataFlag)
	if err := os.MkdirAll(desktopDataDir, 0755); err != nil {
		desktopFail("Can't create the data folder " + desktopDataDir + ": " + err.Error())
	}
	desktopLog()

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
	if fi, err := os.Stdout.Stat(); err == nil && fi.Mode()&os.ModeCharDevice != 0 {
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
func desktopUpdate() {
	server := desktopServer
	if !desktopServerFlag {
		if env := strings.TrimSpace(os.Getenv("GEEK4U_SERVER")); env != "" {
			server = env
		} else if b, err := os.ReadFile(filepath.Join(desktopDataDir, "server.txt")); err == nil && strings.TrimSpace(string(b)) != "" {
			server = strings.TrimSpace(string(b))
		}
	}
	server = strings.TrimRight(strings.TrimSpace(server), "/")
	if server == "" || strings.EqualFold(server, "off") {
		return
	}
	client := &http.Client{Timeout: 4 * time.Second}
	res, err := client.Get(server + "/app-update/version")
	if err != nil {
		fmt.Println("Update check skipped:", err)
		return
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
