package main

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	cryptorand "crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"html/template"
	"io"
	"io/fs"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	// Time zone data built in, so the calendar can use the visitor's zone on Windows too.
	_ "time/tzdata"
	"unicode"
	"unicode/utf8"

	// Pure-Go SQLite driver: builds on Windows without a C compiler (mattn/go-sqlite3 needs cgo + gcc).
	_ "modernc.org/sqlite"

	"golang.org/x/crypto/bcrypt"
)

var schema string = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
	originalUsername TEXT NOT NULL,
    password_hash TEXT NOT NULL,
	pathToProfilePic TEXT NOT NULL,
	authority TEXT NOT NULL
);

CREATE TABLE drugs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT UNIQUE NOT NULL
);

CREATE TABLE drug_method_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drug_id INTEGER NOT NULL,
    method_way STRING NOT NULL,
    unit TEXT NOT NULL,

    UNIQUE(drug_id, method_way),

    FOREIGN KEY(drug_id) REFERENCES drugs(id)
);

CREATE TABLE IF NOT EXISTS doses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    drug_id INTEGER NOT NULL,
    amount REAL NOT NULL,
	unit TEXT NOT NULL,
	method_way STRING NOT NULL, 
    taken_at DATETIME NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(drug_id) REFERENCES drugs(id),
	UNIQUE(user_id, drug_id, taken_at)
);

CREATE TABLE IF NOT EXISTS user_drug_color_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    drug_id INTEGER NOT NULL,
    color TEXT NOT NULL,

    UNIQUE(user_id, drug_id),

    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(drug_id) REFERENCES drugs(id)
);
`

type FileFolderInfo struct {
	Name    string
	Path    string
	IsDir   bool
	IsImg   bool
	IsAudio bool
	IsVid   bool
	Size    int
	Date    time.Time
	// Set by an admin for folders (withFolderIcons).
	IconEmoji string `json:",omitempty"`
	IconImage string `json:",omitempty"`
}

type MakeFolderData struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type cookiesStruct struct {
	Time             time.Time
	Username         string
	OriginalUsername string
	Authority        string
	UserId           int
}

type psychonautwikiApiStruct struct {
	Data struct {
		Substances []struct {
			Name string `json:"name"`
			ROAs []struct {
				Name string `json:"name"`
				Dose struct {
					Units string `json:"units"`
				} `json:"dose"`
			} `json:"roas"`
		} `json:"substances"`
	} `json:"data"`
}

// Sessions are stored so a server restart doesn't sign everyone out.
var sessionSchema string = `
CREATE TABLE IF NOT EXISTS sessions (
	token TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL,
	created_at DATETIME NOT NULL,
	expires_at DATETIME NOT NULL,
	FOREIGN KEY(user_id) REFERENCES users(id)
);
`

const sessionLifetime = 30 * 24 * time.Hour

var profileSchema string = `
CREATE TABLE IF NOT EXISTS liked_substances (
	user_id INTEGER NOT NULL,
	name TEXT NOT NULL COLLATE NOCASE,
	image TEXT NOT NULL DEFAULT '',
	class TEXT NOT NULL DEFAULT '',
	liked_at DATETIME NOT NULL,
	PRIMARY KEY(user_id, name),
	FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_drug_color_settings (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	drug_id INTEGER NOT NULL,
	color TEXT NOT NULL,
	UNIQUE(user_id, drug_id),
	FOREIGN KEY(user_id) REFERENCES users(id),
	FOREIGN KEY(drug_id) REFERENCES drugs(id)
);

CREATE TABLE IF NOT EXISTS graph_experiences (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	started_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	doses TEXT NOT NULL,
	FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS graph_experiences_by_user ON graph_experiences(user_id, started_at);

CREATE TABLE IF NOT EXISTS profile_boxes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	pictures TEXT NOT NULL DEFAULT '[]',
	created_at INTEGER NOT NULL,
	FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS forum_posts (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	body TEXT NOT NULL DEFAULT '',
	pictures TEXT NOT NULL DEFAULT '[]',
	created_at INTEGER NOT NULL,
	FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS forum_posts_by_user ON forum_posts(user_id, id);

CREATE TABLE IF NOT EXISTS file_access (
	user_id INTEGER PRIMARY KEY,
	all_folders INTEGER NOT NULL DEFAULT 0,
	folders TEXT NOT NULL DEFAULT '[]',
	can_edit INTEGER NOT NULL DEFAULT 0,
	FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS custom_substances (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL UNIQUE COLLATE NOCASE,
	data TEXT NOT NULL,
	created_by INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS phone_sync (
	user_id INTEGER PRIMARY KEY,
	folders TEXT NOT NULL DEFAULT '[]',
	FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS site_pictures (
	slot TEXT PRIMARY KEY,
	path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_comments (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	post_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	body TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY(post_id) REFERENCES forum_posts(id),
	FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS forum_comments_by_post ON forum_comments(post_id, id);

CREATE TABLE IF NOT EXISTS friendships (
	requester_id INTEGER NOT NULL,
	addressee_id INTEGER NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	created_at INTEGER NOT NULL,
	PRIMARY KEY(requester_id, addressee_id),
	FOREIGN KEY(requester_id) REFERENCES users(id),
	FOREIGN KEY(addressee_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS experience_people (
	experience_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	added_at INTEGER NOT NULL,
	PRIMARY KEY(experience_id, user_id),
	FOREIGN KEY(experience_id) REFERENCES graph_experiences(id),
	FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS experience_people_by_user ON experience_people(user_id);
`

// Profile pictures and banners live in profiles/<user id>/ and are served at /profiles/.
var ProfilePicturesDirName string = "profiles"

const defaultProfilePic = "/profiles/Default/default.png"

// maxPictureMB is the biggest picture anyone can upload, in megabytes.
const maxPictureMB = 150
const maxPictureBytes = maxPictureMB << 20
const maxLikes = 500

// Graph sessions ("Experiences"): times are Unix milliseconds, the newest are kept.
const maxExperiences = 300
const maxExperienceDoses = 100

// Boxes on the Profile page (the + button): pictures (up to 4), one Graph session, or a note.
const maxPictureBoxes = 12
const picturesPerBox = 4
const maxNoteChars = 1000

// Forum posts: text and up to 4 pictures, newest first, 20 per page.
const maxPostChars = 2000
const picturesPerPost = 4
const postsPerPage = 20
const postsPer10Minutes = 10
const maxCommentChars = 1000
const commentsPer10Minutes = 30

// Friends someone can add to one Graph session ("who was with you").
const maxExperiencePeople = 20

var db *sql.DB

var UploadedFilesDirName string = "UploadedFiles"
var DataBaseFileName string = "Database.db"

// The desktop app (desktop.go, built with -tags desktop) sets these: it serves
// only this computer and opens the site in its own window. `go run
// UploadDownload.go` leaves desktop.go out, so the server is unchanged.
var desktopMode bool
var desktopServe func(handler http.Handler)

var cookiesMu sync.Mutex
var cookies = map[string]cookiesStruct{}

var tpl *template.Template

func main() {
	tpl = template.New("root")
	tpl.New("Upload")

	StartCookieCleaner()

	// The upload folder is gitignored, so a fresh checkout has none and /Files/ 400s until it exists.
	if err := os.MkdirAll(UploadedFilesDirName, 0755); err != nil {
		panic("cannot create " + UploadedFilesDirName + ": " + err.Error())
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/", "/index.html":
			// no-cache: browsers check for a newer copy each visit (a 304 when nothing changed).
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeFile(w, r, "html/index.html")
		default:
			http.NotFound(w, r)
		}
	})

	http.HandleFunc("/Main", Main)
	http.HandleFunc("/login", LoginData)
	http.HandleFunc("/signup", Signup)
	http.HandleFunc("/logout", Logout)
	http.HandleFunc("/Profile", requireLogin(Profile))
	// Files is one shared folder that only admin accounts can open.
	http.HandleFunc("/Files/", requireFilesLogin(Downloader))
	http.HandleFunc("/Uploader", requireFilesLogin(Uploader))
	http.HandleFunc("/journal", requireLogin(Journal))
	http.HandleFunc("/journal/Drug", requireLogin(DrugInfo))
	http.HandleFunc("/sub", requireLogin(Substance))
	http.HandleFunc("/admin", requireAdminLogin(AdminPanel))
	http.HandleFunc("/admin/createUser", requireAdminLogin(AdminPanelCreateUser))

	http.HandleFunc("/upload", requireFilesLogin(GetUploadData))
	http.HandleFunc("/makeFolder", requireFilesLogin(makeFolder))
	http.HandleFunc("/getFolders", requireFilesLogin(getFolders))
	http.HandleFunc("/search", requireFilesLogin(search))
	http.HandleFunc("/delete", requireFilesLogin(Delete))
	http.HandleFunc("/rename", requireFilesLogin(Rename))
	http.HandleFunc("/getItems", requireFilesLogin(getItems))
	http.HandleFunc("/admin/files-access", requireAdminLogin(adminFilesAccess))
	// Substances Importer: admins add their own substances next to PsychonautWiki's.
	http.HandleFunc("/admin/substances", requireAdminLogin(SubstancesImporter))
	http.HandleFunc("/admin/substances/api", requireAdminLogin(adminCustomSubstances))
	// Open like the Graph page, so the Graph can draw custom substances for everyone.
	http.HandleFunc("/substances/custom", publicCustomSubstances)
	// Phone sync: the folders a member picked on their Profile are copied into the app's folder on the phone.
	http.HandleFunc("/sync/folders", requireLogin(syncFolders))
	http.HandleFunc("/sync/manifest", requireLogin(syncManifest))
	http.HandleFunc("/sync/file", requireLogin(syncFile))
	// Music: the audio files in Files, playlists (also imported from Spotify), sharing with friends.
	http.HandleFunc("/Music", requireLogin(Music))
	http.HandleFunc("/music/library", requireLogin(musicLibrary))
	http.HandleFunc("/music/playlists", requireLogin(musicPlaylists))
	http.HandleFunc("/music/import", requireLogin(musicImport))
	http.HandleFunc("/music/stream/", requireLogin(musicStream))
	http.HandleFunc("/music/art/", requireLogin(musicArt))
	http.HandleFunc("/music/cover/", requireLogin(musicCover))
	http.HandleFunc("/music/offline", requireLogin(musicOffline))
	http.HandleFunc("/admin/stats", requireAdminLogin(adminStats))
	http.HandleFunc("/site/picture", requireAdminLogin(sitePictureUpload))
	http.HandleFunc("/sitepic/", sitePicture)
	http.HandleFunc("/notifications", requireLogin(notifications))
	http.HandleFunc("/journalImport", requireLogin(journalImport))
	http.HandleFunc("/profile/doses", requireLogin(profileDoses))
	http.HandleFunc("/profile/intake", requireLogin(profileIntake))
	http.HandleFunc("/profile/boxes", requireLogin(profileBoxes))
	http.HandleFunc("/profile/picture", requireLogin(profilePicture))
	http.HandleFunc("/profile/appearance", requireLogin(profileAppearance))
	http.HandleFunc("/profiles/", requireLogin(profileImage))
	http.HandleFunc("/u/", requireLogin(publicProfile))
	http.HandleFunc("/Forum", requireLogin(Forum))
	http.HandleFunc("/forum/posts", requireLogin(forumPosts))
	http.HandleFunc("/forum/members", requireLogin(forumMembers))
	http.HandleFunc("/forum/comments", requireLogin(forumComments))
	http.HandleFunc("/friends", requireLogin(friends))
	http.HandleFunc("/experiences/people", requireLogin(experiencePeople))
	http.HandleFunc("/likes", requireLogin(likes))
	http.HandleFunc("/Utility", requireLogin(Utility))
	// Replications was replaced by Utility; old links and bookmarks land there.
	http.HandleFunc("/Replications", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/Utility", http.StatusMovedPermanently)
	})
	http.HandleFunc("/replications/list", requireLogin(replicationsList))
	http.HandleFunc("/replications/files/", requireLogin(replicationsFile))
	http.HandleFunc("/replications/thumbs/", requireLogin(replicationsFile))
	http.HandleFunc("/replications/backup", requireAdminLogin(replicationsBackup))
	// The Graph page is open to everyone, so this answers [] instead of redirecting when signed out.
	http.HandleFunc("/graphColors", graphColors)
	http.HandleFunc("/experiences", experiences)
	http.HandleFunc("/sub/saveData", requireLogin(saveData))
	http.HandleFunc("/admin/createUser/AdminPanelCreateUserNow", requireAdminLogin(AdminPanelCreateUserData))

	//	http.HandleFunc("/style.css", func(w http.ResponseWriter, r *http.Request) {
	//		w.Header().Set("Content-Type", "text/css")
	//		fmt.Fprint(w, styleCSS)
	//	})

	jsFiles, err := os.ReadDir("js")
	if err != nil {
		panic(err)
	}
	for _, jsFile := range jsFiles {
		jsName := jsFile.Name()
		http.HandleFunc("/"+jsName, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeFile(w, r, "js/"+jsName)
		})
	}

	css, _ := os.ReadDir("css")
	for _, stylefile := range css {
		cssName := stylefile.Name()
		name := cssName

		http.HandleFunc("/"+name, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeFile(w, r, "css/"+name)
		})
	}

	assets, err := os.ReadDir("assets")
	if err != nil {
		panic(err)
	}
	for _, asset := range assets {
		assetName := asset.Name()

		if asset.IsDir() {
			subAssets, _ := os.ReadDir("assets/" + assetName)

			for _, assetInDir := range subAssets {
				subAssetName := assetInDir.Name()

				p := filepath.ToSlash(filepath.Join(assetName, subAssetName))
				filePath := "assets/" + p // COPY VALUE

				route := "/" + p // COPY VALUE

				http.HandleFunc(route, func(w http.ResponseWriter, r *http.Request) {
					http.ServeFile(w, r, filePath)
				})
			}
			continue
		}

		name := assetName
		http.HandleFunc("/"+name, func(w http.ResponseWriter, r *http.Request) {
			http.ServeFile(w, r, "assets/"+name)
		})
	} // TODO Make it recursive for the subfiles

	// _time_format=sqlite stores times the same way mattn/go-sqlite3 did, so old rows still read back.
	db, err = sql.Open("sqlite", DataBaseFileName+"?_time_format=sqlite")
	if err != nil {
		panic(err)
	}
	if err := db.Ping(); err != nil {
		panic("cannot open database " + DataBaseFileName + ": " + err.Error())
	}
	db.Exec(schema)
	if _, err := db.Exec(sessionSchema); err != nil {
		panic("cannot create the sessions table: " + err.Error())
	}
	if _, err := db.Exec(profileSchema); err != nil {
		panic("cannot create the liked substances table: " + err.Error())
	}
	// Keeps the name as PsychonautWiki writes it ("LSD"); drugs.name is lowercase.
	if _, err := db.Exec("ALTER TABLE user_drug_color_settings ADD COLUMN display_name TEXT NOT NULL DEFAULT ''"); err != nil && !strings.Contains(err.Error(), "duplicate column") {
		panic("cannot add the color name column: " + err.Error())
	}
	// Databases from before banners existed don't have the column yet.
	if _, err := db.Exec("ALTER TABLE users ADD COLUMN pathToBanner TEXT NOT NULL DEFAULT ''"); err != nil && !strings.Contains(err.Error(), "duplicate column") {
		panic("cannot add the banner column: " + err.Error())
	}
	// The order of the Profile cards (JSON list of keys) and a custom page background.
	// siteColor is the account's main color for the whole site ('' = the default violet);
	// widgetClear is how see-through its Profile cards are, 0 to 100 percent.
	// nameColor: an admin's name color everywhere it shows; notesSeenAt: when the
	// letter icon (comments on your posts) was last opened, in ms.
	// siteBg is the account's background on every page ('' = the drifting colors,
	// a preset name, or 'custom' for siteBgImage, darkened by siteBgDim percent).
	// createdAt and lastSeen (ms) feed the Admin page's account list.
	// graphsMade and postsMade count every Graph session and Forum post ever made
	// (for the geek rank), so deleting or the session limit doesn't lower it.
	for _, column := range []string{"profileLayout TEXT NOT NULL DEFAULT ''", "pathToBackground TEXT NOT NULL DEFAULT ''", "siteColor TEXT NOT NULL DEFAULT ''", "widgetClear INTEGER NOT NULL DEFAULT 0", "nameColor TEXT NOT NULL DEFAULT ''", "notesSeenAt INTEGER NOT NULL DEFAULT 0", "siteBg TEXT NOT NULL DEFAULT ''", "siteBgImage TEXT NOT NULL DEFAULT ''", "siteBgDim INTEGER NOT NULL DEFAULT 40", "plotStyle TEXT NOT NULL DEFAULT ''", "createdAt INTEGER NOT NULL DEFAULT 0", "lastSeen INTEGER NOT NULL DEFAULT 0", "graphsMade INTEGER NOT NULL DEFAULT 0", "postsMade INTEGER NOT NULL DEFAULT 0"} {
		if _, err := db.Exec("ALTER TABLE users ADD COLUMN " + column); err != nil && !strings.Contains(err.Error(), "duplicate column") {
			panic("cannot add the profile layout columns: " + err.Error())
		}
	}
	db.Exec(`UPDATE users SET
		graphsMade = MAX(graphsMade, (SELECT COUNT(*) FROM graph_experiences g WHERE g.user_id = users.id)),
		postsMade = MAX(postsMade, (SELECT COUNT(*) FROM forum_posts p WHERE p.user_id = users.id))`)
	if _, err := db.Exec(statsSchema); err != nil {
		panic("cannot create the view counters: " + err.Error())
	}
	if _, err := db.Exec(musicSchema); err != nil {
		panic("cannot create the music tables: " + err.Error())
	}
	registerNotes()
	registerAppUpdates()
	registerLinkDownloads()
	// Boxes from before the + menu are all picture boxes; data holds a note or a Graph session id.
	for _, column := range []string{"kind TEXT NOT NULL DEFAULT 'pictures'", "data TEXT NOT NULL DEFAULT ''"} {
		if _, err := db.Exec("ALTER TABLE profile_boxes ADD COLUMN " + column); err != nil && !strings.Contains(err.Error(), "duplicate column") {
			panic("cannot add the profile box columns: " + err.Error())
		}
	}
	if err := os.MkdirAll(ProfilePicturesDirName, 0755); err != nil {
		panic("cannot create " + ProfilePicturesDirName + ": " + err.Error())
	}

	port := 8000
	loadNameColors()
	handler := countViews(http.DefaultServeMux)
	if desktopServe != nil {
		desktopServe(handler)
		return
	}
	fmt.Println("Serving on 0.0.0.0:" + strconv.Itoa(port))

	err = http.ListenAndServeTLS("0.0.0.0: "+strconv.Itoa(port), "cert.pem", "key.pem", handler)
	if err != nil {
		http.ListenAndServe("0.0.0.0:"+strconv.Itoa(port), handler)
	}
}

func Main(w http.ResponseWriter, r *http.Request) {

	d := struct {
		Login       bool
		SessionInfo cookiesStruct
		IsAdmin     bool
		Pictures    map[string]string
	}{}

	d.SessionInfo, d.Login = sessionFromRequest(r)
	d.IsAdmin = d.Login && d.SessionInfo.Authority == "admin"
	d.Pictures = map[string]string{}
	for slot := range sitePictureSlots {
		d.Pictures[slot] = sitePictureLink(slot)
	}
	setRoleHint(w, r, d.SessionInfo, d.Login)
	fmt.Printf("[%s] NEUTRAL IP=%s USER=%s PATH=%s\n", time.Now().Format("2006-01-02 15:04:05"), clientIP(r), d.SessionInfo.OriginalUsername, r.URL.Path)

	tpl, err := template.ParseFiles("html/Main.html")
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}

	err = tpl.Execute(w, d)
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}
}

func Profile(w http.ResponseWriter, r *http.Request) {
	tpl, err := template.ParseFiles("html/profile.html")
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}

	type dose struct {
		DrugName   string
		Unit       string
		Amount     float64
		TimeAgo    string
		Method_way string
	}
	type Totals struct {
		Name         string
		TotalAmount  float64
		Unit         string
		DisplayTotal string
	}

	d := struct {
		Username      string
		Initial       string
		Avatar        string
		Banner        string
		Background    string
		Layout        string
		SiteColor     string
		WidgetClear   int
		ClearAlpha    clearAlpha
		NameColor     string
		IsAdmin       bool
		Rank          geekRank
		Liked         []likedSubstance
		RecentIntakes []dose
		Totals        map[string]Totals
	}{
		Totals: make(map[string]Totals),
	}

	session, ok := sessionFromRequest(r)
	if !ok {
		http.Error(w, "invalid session", http.StatusUnauthorized)
		return
	}

	d.Username = session.OriginalUsername
	userId := session.UserId
	if first, _ := utf8.DecodeRuneInString(d.Username); first != utf8.RuneError {
		d.Initial = strings.ToUpper(string(first))
	}

	var avatar, banner, background, layout string
	db.QueryRow("SELECT pathToProfilePic, pathToBanner, pathToBackground, profileLayout, siteColor, widgetClear, nameColor FROM users WHERE id = ?", userId).Scan(&avatar, &banner, &background, &layout, &d.SiteColor, &d.WidgetClear, &d.NameColor)
	d.ClearAlpha = makeClearAlpha(d.WidgetClear)
	d.IsAdmin = session.Authority == "admin"
	d.Rank = rankOf(d.Username)
	if !d.IsAdmin {
		d.NameColor = ""
	}
	d.Avatar = existingPicture(avatar)
	d.Banner = existingPicture(banner)
	d.Background = existingPicture(background)
	d.Layout = strings.Join(profileLayout(layout), ",")

	d.Liked, err = likedSubstances(userId)
	if err != nil {
		fmt.Println(err)
	}

	rows, err := db.Query(`
	SELECT
		drug.name,
		dose.amount,
		dose.unit,
		dose.taken_at,
		dose.method_way
	FROM doses dose
	JOIN drugs drug ON dose.drug_id = drug.id
	WHERE dose.user_id = ?
	ORDER BY dose.taken_at DESC
	LIMIT 10;
	`, userId)
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Database query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var dose dose
		var ti time.Time

		err := rows.Scan(&dose.DrugName, &dose.Amount, &dose.Unit, &ti, &dose.Method_way)
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Something went wrong while getting users intakes", http.StatusInternalServerError)
			continue
		}

		dose.TimeAgo = timeToHowLongAgoString(ti)
		d.RecentIntakes = append(d.RecentIntakes, dose)

		normalizedAmount, normalizedUnit, err := normalizeAmount(dose.Amount, dose.Unit)
		if err != nil {
			continue
		}

		t := d.Totals[dose.DrugName]
		t.TotalAmount += normalizedAmount
		t.Unit = normalizedUnit
		t.Name = dose.DrugName
		d.Totals[dose.DrugName] = t
	}
	err = rows.Err()
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Something went wrong while getting users intakes", http.StatusInternalServerError)
		return
	}
	for name, t := range d.Totals {
		prettyAmt, prettyUnit := prettyAmount(t.TotalAmount, t.Unit)
		t.TotalAmount = prettyAmt
		t.DisplayTotal = strconv.FormatFloat(prettyAmt, 'f', -1, 64)
		t.Unit = prettyUnit
		d.Totals[name] = t
	}

	err = tpl.Execute(w, d)
	if err != nil {
		fmt.Println(err)
	}
}

func normalizeAmount(amount float64, unit string) (float64, string, error) {
	switch unit {
	case "g":
		return amount * 1_000_000, "ug", nil
	case "mg":
		return amount * 1_000, "ug", nil
	case "ug", "µg", "μg", "mcg":
		return amount, "ug", nil
	case "ml":
		return amount, "ml", nil
	default:
		return 0, "", fmt.Errorf("unknown unit")
	}
}

func prettyAmount(amount float64, unit string) (float64, string) {
	switch unit {
	case "ug":
		if amount >= 1_000_000 {
			return float64(amount) / 1_000_000, "g"
		}
		if amount >= 1_000 {
			return float64(amount) / 1_000, "mg"
		}
	}
	return float64(amount), unit
}

func journalImport(w http.ResponseWriter, r *http.Request) {
	var journalData struct {
		Experiences []struct {
			Title        string `json:"title"`
			Text         string `json:"text"`
			CreationDate int64  `json:"creationDate"`
			SortDate     int64  `json:"sortDate"`
			Ingestions   []struct {
				SubstanceName       string `json:"substanceName"`
				Time                int64  `json:"time"`
				ActualTime          time.Time
				EndTime             *int64  `json:"endTime"`
				CreationDate        int64   `json:"creationDate"`
				AdministrationRoute string  `json:"administrationRoute"`
				Dose                float64 `json:"dose"`
				IsDoseAnEstimate    bool    `json:"isDoseAndEstimate"`
				Units               string  `json:"units"`
				Notes               string  `json:"notes"`
			}
		} `json:"experiences"`
		SubstanceCompanions []struct {
			SubstanceName string `json:"substanceName"`
			Color         string `json:"color"`
		} `json:"substanceCompanions"`
	}

	json.NewDecoder(r.Body).Decode(&journalData)

	tx, err := db.Begin()
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Something went wrong in server", http.StatusInternalServerError)
		return
	}
	stmt, err := tx.Prepare(
		"INSERT OR IGNORE INTO doses (user_id, drug_id, amount, taken_at) VALUES (?, ?, ?, ?)",
	)
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Something went wrong in server", http.StatusInternalServerError)
		return
	}
	defer stmt.Close()

	tx2, err := db.Begin()
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Something went wrong in server", http.StatusInternalServerError)
		return
	}
	stmt2, err := tx2.Prepare(
		"INSERT INTO user_drug_color_settings (user_id, drug_id, color) VALUES (?, ?, ?) ON CONFLICT(user_id, drug_id) DO UPDATE SET color = excluded.color",
	)
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Something went wrong in server", http.StatusInternalServerError)
		return
	}
	defer stmt2.Close()

	usersession, _ := sessionFromRequest(r)
	user_id := usersession.UserId
	cacheDrugId := map[string]int64{}

	for _, experience := range journalData.Experiences {
		for _, ingestion := range experience.Ingestions {
			ingestion.ActualTime = time.Unix(ingestion.Time/1000, 0)

			drugID, exists := cacheDrugId[strings.ToLower(ingestion.SubstanceName)]

			if !exists {
				var drugId int64
				err = db.QueryRow("select id from drugs where name = ?", strings.ToLower(ingestion.SubstanceName)).Scan(&drugId)
				if err != nil {
					if err == sql.ErrNoRows {
						var result psychonautwikiApiStruct
						query := fmt.Sprintf(`
						{
						substances(query: "%s") {
								name
								roas {
									name
									dose {
										units
									}
								}
							}
						}
						`, ingestion.SubstanceName)
						QueryPsychonautWiki(query, &result)

						drugAddedD, err := db.Exec("insert into drugs (name) values(?)", strings.ToLower(ingestion.SubstanceName))
						if err != nil {
							fmt.Println(err)
						}
						drugIdFromAdded, err := drugAddedD.LastInsertId()
						if err != nil {
							fmt.Println(err)
						}
						drugId = drugIdFromAdded

						txtemp, err := db.Begin()
						if err != nil {
							fmt.Println(err)
							http.Error(w, "Something went wrong in server", http.StatusInternalServerError)
							return
						}
						stmttemp, err := txtemp.Prepare(
							"INSERT OR IGNORE INTO drug_method_info (drug_id, method_way, unit) VALUES (?, ?, ?)",
						)
						if err != nil {
							fmt.Println(err)
							http.Error(w, "Something went wrong in server", http.StatusInternalServerError)
							return
						}
						defer stmttemp.Close()

						for _, roa := range result.Data.Substances[0].ROAs {
							_, err := stmttemp.Exec(drugId, roa.Name, roa.Dose.Units)
							if err != nil {
								fmt.Println(err)
								txtemp.Rollback()
								http.Error(w, "Could not add dose to database", http.StatusBadRequest)
								return
							}
						}
						err = txtemp.Commit()
						if err != nil {
							fmt.Println(err)
							http.Error(w, "Could not add all doses to database, something went wrong", http.StatusInternalServerError)
							return
						}
					} else {
						fmt.Println(err)
						http.Error(w, "Something went wrong with database, could not check if drug exists or not", http.StatusInternalServerError)
						return
					}
				}
				cacheDrugId[strings.ToLower(ingestion.SubstanceName)] = drugId
				drugID = drugId
			}
			_, err := stmt.Exec(user_id, drugID, ingestion.Dose, ingestion.ActualTime)
			if err != nil {
				fmt.Println(err)
				tx.Rollback()
				http.Error(w, "Could not add dose to database", http.StatusBadRequest)
				return
			}
		}
	}

	for _, color := range journalData.SubstanceCompanions {
		drugID, exists := cacheDrugId[strings.ToLower(strings.ToLower(color.SubstanceName))]

		if !exists {
			var drugId int64
			err = db.QueryRow("select id from drugs where name = ?", strings.ToLower(color.SubstanceName)).Scan(&drugId)
			if err != nil {
				if err == sql.ErrNoRows {
					var result psychonautwikiApiStruct
					query := fmt.Sprintf(`
						{
						substances(query: "%s") {
								name
								roas {
									name
									dose {
										units
									}
								}
							}
						}
					`, color.SubstanceName)
					QueryPsychonautWiki(query, &result)

					drugAddedD, err := db.Exec("insert into drugs (name) values(?)", strings.ToLower(color.SubstanceName))
					if err != nil {
						fmt.Println(err)
					}
					drugIdFromAdded, err := drugAddedD.LastInsertId()
					if err != nil {
						fmt.Println(err)
					}
					drugId = drugIdFromAdded

					txtemp, err := db.Begin()
					if err != nil {
						fmt.Println(err)
						http.Error(w, "Something went wrong in server", http.StatusInternalServerError)
						return
					}
					stmttemp, err := txtemp.Prepare(
						"INSERT OR IGNORE INTO drug_method_info (drug_id, method_way, unit) VALUES (?, ?, ?)",
					)
					if err != nil {
						fmt.Println(err)
						http.Error(w, "Something went wrong in server", http.StatusInternalServerError)
						return
					}
					defer stmttemp.Close()

					for _, roa := range result.Data.Substances[0].ROAs {
						_, err := stmttemp.Exec(drugId, roa.Name, roa.Dose.Units)
						if err != nil {
							fmt.Println(err)
							txtemp.Rollback()
							http.Error(w, "Could not add dose to database", http.StatusBadRequest)
							return
						}
					}
					err = txtemp.Commit()
					if err != nil {
						fmt.Println(err)
						http.Error(w, "Could not add all doses to database, something went wrong", http.StatusInternalServerError)
						return
					}
				} else {
					fmt.Println(err)
					http.Error(w, "Something went wrong with database, could not check if drug exists or not", http.StatusInternalServerError)
					return
				}
			}
		}
		_, err := stmt.Exec(user_id, drugID, color.Color)
		if err != nil {
			fmt.Println(err)
			tx.Rollback()
			http.Error(w, "Could not add dose to database", http.StatusBadRequest)
			return
		}

	}

	err = tx.Commit()
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Could not add all doses to database, something went wrong", http.StatusInternalServerError)
		return
	}
	err = tx2.Commit()
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Could not add all doses to database, something went wrong", http.StatusInternalServerError)
		return
	}
}

func QueryPsychonautWiki(query string, result any) error {
	reqBody := struct {
		Query string
	}{
		Query: query,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}

	resp, err := http.Post(
		"https://api.psychonautwiki.org",
		"application/json",
		bytes.NewBuffer(jsonBody),
	)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	return json.Unmarshal(body, result)
}

func timeToHowLongAgoString(timeArg time.Time) string {
	diff := time.Now().Sub(timeArg)

	seconds := int(diff.Seconds())
	minutes := int(diff.Minutes())
	hours := int(diff.Hours())
	days := hours / 24
	months := days / 30
	years := days / 365

	if seconds < 0 {
		switch {
		case seconds > -60:
			if seconds == -1 {
				return "In 1 second"
			}
			withoutMinus := strings.Trim(strconv.Itoa(seconds), "-")
			return fmt.Sprintf("In %s second", withoutMinus)

		case minutes > -60:
			if minutes == -1 {
				return "In 1 minute"
			}
			withoutMinus := strings.Trim(strconv.Itoa(minutes), "-")
			return fmt.Sprintf("In %s minutes", withoutMinus)

		case hours > -24:
			if hours == -1 {
				return "In 1 hour"
			}
			withoutMinus := strings.Trim(strconv.Itoa(hours), "-")
			return fmt.Sprintf("In %s hours", withoutMinus)

		case days > -30:
			if days == -1 {
				return "In 1 day"
			}
			withoutMinus := strings.Trim(strconv.Itoa(days), "-")
			return fmt.Sprintf("In %s days", withoutMinus)

		case months > -12:
			if months == -1 {
				return "In 1 month"
			}
			withoutMinus := strings.Trim(strconv.Itoa(months), "-")
			return fmt.Sprintf("In %s months", withoutMinus)

		default:
			if years == -1 {
				return "In 1 year"
			}
			withoutMinus := strings.Trim(strconv.Itoa(years), "-")
			return fmt.Sprintf("In %s years", withoutMinus)
		}
	}

	switch {
	case seconds < 60:
		if seconds == 1 {
			return "1 second ago"
		}
		return fmt.Sprintf("%d seconds ago", seconds)

	case minutes < 60:
		if minutes == 1 {
			return "1 minute ago"
		}
		return fmt.Sprintf("%d minutes ago", minutes)

	case hours < 24:
		if hours == 1 {
			return "1 hour ago"
		}
		return fmt.Sprintf("%d hours ago", hours)

	case days < 30:
		if days == 1 {
			return "1 day ago"
		}
		return fmt.Sprintf("%d days ago", days)

	case months < 12:
		if months == 1 {
			return "1 month ago"
		}
		return fmt.Sprintf("%d months ago", months)

	default:
		if years == 1 {
			return "1 year ago"
		}
		return fmt.Sprintf("%d years ago", years)
	}
}

func Substance(w http.ResponseWriter, r *http.Request) {
	tpl, err := template.ParseFiles("html/sub.html")
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}

	err = tpl.Execute(w, nil)
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}

}

func saveData(w http.ResponseWriter, r *http.Request) {
	Data := struct {
		DrugName string `json:"DrugName"`
		Unit     string `json:"Unit"`
		Doses    []struct {
			Time       time.Time `json:"Time"`
			DoseAmount string    `json:"DoseAmount"`
			Unit       string    `json:"Unit"`
			Method     string    `json:"Method"`
		} `json:"Doses"`
	}{}

	err := json.NewDecoder(r.Body).Decode(&Data)
	if err != nil {
		fmt.Println("Couldnt decode data, something went wrong")
		http.Error(w, "Couldnt decode data, something went wrong", http.StatusBadRequest)
		return
	}

	var drugId int64
	err = db.QueryRow("select id from drugs where name = ?", strings.ToLower(Data.DrugName)).Scan(&drugId)
	if err != nil {
		if err == sql.ErrNoRows {
			var result psychonautwikiApiStruct
			query := fmt.Sprintf(`
				{
				substances(query: "%s") {
						name
						roas {
							name
							dose {
								units
							}
						}
					}
				}
			`, Data.DrugName)
			QueryPsychonautWiki(query, &result)
			drugAddedD, err := db.Exec("insert into drugs (name) values(?)", strings.ToLower(Data.DrugName))
			if err != nil {
				fmt.Println(err)
			}
			fmt.Println(result.Data.Substances)
			drugIdFromAdded, err := drugAddedD.LastInsertId()
			if err != nil {
				fmt.Println(err)
			}
			drugId = drugIdFromAdded

			txtemp, err := db.Begin()
			if err != nil {
				fmt.Println(err)
				http.Error(w, "Something went wrong in server", http.StatusInternalServerError)
				return
			}
			stmttemp, err := txtemp.Prepare(
				"INSERT OR IGNORE INTO drug_method_info (drug_id, method_way, unit) VALUES (?, ?, ?)",
			)
			if err != nil {
				fmt.Println(err)
				http.Error(w, "Something went wrong in server", http.StatusInternalServerError)
				return
			}
			defer stmttemp.Close()

			for _, roa := range result.Data.Substances[0].ROAs {
				_, err := stmttemp.Exec(drugId, roa.Name, roa.Dose.Units)
				if err != nil {
					fmt.Println(err)
					txtemp.Rollback()
					http.Error(w, "Could not add dose to database", http.StatusBadRequest)
					return
				}
			}
			err = txtemp.Commit()
			if err != nil {
				fmt.Println(err)
				http.Error(w, "Could not add all doses to database, something went wrong", http.StatusInternalServerError)
				return
			}
		} else {
			fmt.Println(err)
			http.Error(w, "Something went wrong with database, could not check if drug exists or not", http.StatusInternalServerError)
			return
		}
	}

	usersession, _ := sessionFromRequest(r)
	userId := usersession.UserId

	tx, err := db.Begin()
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Something went wrong in server", http.StatusInternalServerError)
		return
	}
	stmt, err := tx.Prepare(
		"INSERT OR IGNORE INTO doses (user_id, drug_id, amount, unit, method_way, taken_at) VALUES (?, ?, ?, ?, ?, ?)",
	)
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Something went wrong in server", http.StatusInternalServerError)
		return
	}
	defer stmt.Close()

	for _, dose := range Data.Doses {
		_, err = stmt.Exec(userId, drugId, dose.DoseAmount, dose.Unit, dose.Method, dose.Time)
		if err != nil {
			fmt.Println(err)
			tx.Rollback()
			http.Error(w, "Could not add dose to database", http.StatusBadRequest)
			return
		}
	}

	err = tx.Commit()
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Could not add all doses to database, something went wrong", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(200)
}

func Journal(w http.ResponseWriter, r *http.Request) {
	tpl, err := template.ParseFiles("html/Journal.html")
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}

	err = tpl.Execute(w, nil)
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}
}

func DrugInfo(w http.ResponseWriter, r *http.Request) {
	tpl, err := template.ParseFiles("html/DruginfoPage.html")
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}

	err = tpl.Execute(w, nil)
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}
}

func LoginData(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	fmt.Printf("[%s] NEUTRAL IP=%s PATH=%s REASON=LogginIn\n", time.Now().Format("2006-01-02 15:04:05"), ip, r.URL.Path)

	if r.Method != http.MethodPost {
		http.Redirect(w, r, "/Main", http.StatusSeeOther)
		return
	}

	var UserLoginData struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	err := json.NewDecoder(r.Body).Decode(&UserLoginData)
	if err != nil {
		http.Error(w, "Not valid login data", http.StatusBadRequest)
		return
	}

	var originalUsername string
	var authority string
	var password string
	var userId int
	err = db.QueryRow("select originalUsername,authority,password_hash,id from users where username = ?", strings.ToLower(strings.TrimSpace(UserLoginData.Username))).Scan(&originalUsername, &authority, &password, &userId)
	if err != nil {
		if err == sql.ErrNoRows {
			fmt.Printf("[%s] DENY IP=%s USER=%q REASON=no_such_user\n", time.Now().Format("2006-01-02 15:04:05"), ip, UserLoginData.Username)
			http.Error(w, "Wrong username or password.", http.StatusUnauthorized)
			return
		} else {
			fmt.Printf("[%s] ERROR login query failed for %q: %v\n", time.Now().Format("2006-01-02 15:04:05"), UserLoginData.Username, err)
			http.Error(w, "Can not query from database rn", http.StatusInternalServerError)
			return
		}
	}

	if err := bcrypt.CompareHashAndPassword([]byte(password), []byte(UserLoginData.Password)); err != nil {
		fmt.Printf("[%s] DENY IP=%s USER=%q REASON=wrong_password\n", time.Now().Format("2006-01-02 15:04:05"), ip, UserLoginData.Username)
		http.Error(w, "Wrong username or password.", http.StatusUnauthorized)
		return
	}

	endSession(w, r) // drop any older session this browser had
	err = startSession(w, r, cookiesStruct{
		Username:         strings.ToLower(originalUsername),
		OriginalUsername: originalUsername,
		Authority:        strings.ToLower(authority),
		UserId:           userId,
	})
	if err != nil {
		fmt.Printf("[%s] ERROR could not start session for %q: %v\n", time.Now().Format("2006-01-02 15:04:05"), originalUsername, err)
		http.Error(w, "Could not sign you in right now", http.StatusInternalServerError)
		return
	}
	fmt.Printf("[%s] LOGIN IP=%s USER=%s\n", time.Now().Format("2006-01-02 15:04:05"), ip, originalUsername)

	w.WriteHeader(http.StatusOK)
}

// Signup creates a normal ("user") account and signs the new user in.
func Signup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Redirect(w, r, "/Main", http.StatusSeeOther)
		return
	}

	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "Not valid sign up data", http.StatusBadRequest)
		return
	}
	in.Username = strings.TrimSpace(in.Username)
	if msg := checkNewAccount(in.Username, in.Password); msg != "" {
		http.Error(w, msg, http.StatusBadRequest)
		return
	}

	// In the desktop app the first account is the computer's owner, so it
	// gets admin (Files, Admin page, Substances Importer).
	authority := "user"
	if desktopMode {
		var anyone bool
		if db.QueryRow("SELECT EXISTS(SELECT 1 FROM users)").Scan(&anyone) == nil && !anyone {
			authority = "admin"
		}
	}
	userId, err := createUser(in.Username, in.Password, authority)
	if errors.Is(err, errUserExists) {
		http.Error(w, "That username is taken.", http.StatusConflict)
		return
	}
	if err != nil {
		fmt.Printf("[%s] ERROR sign up failed for %q: %v\n", time.Now().Format("2006-01-02 15:04:05"), in.Username, err)
		http.Error(w, "Could not create the account right now", http.StatusInternalServerError)
		return
	}

	endSession(w, r)
	err = startSession(w, r, cookiesStruct{
		Username:         strings.ToLower(in.Username),
		OriginalUsername: in.Username,
		Authority:        authority,
		UserId:           userId,
	})
	if err != nil {
		fmt.Printf("[%s] ERROR could not start session for %q: %v\n", time.Now().Format("2006-01-02 15:04:05"), in.Username, err)
		http.Error(w, "Account created, but signing in failed. Try logging in.", http.StatusInternalServerError)
		return
	}
	fmt.Printf("[%s] SIGNUP IP=%s USER=%s\n", time.Now().Format("2006-01-02 15:04:05"), clientIP(r), in.Username)
	w.WriteHeader(http.StatusOK)
}

// Logout ends the session. Only POST signs out, so a link preview or
// prefetch of /logout can't.
func Logout(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		endSession(w, r)
	}
	http.Redirect(w, r, "/Main", http.StatusSeeOther)
}

var errUserExists = errors.New("user already exists")

var usernamePattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{3,24}$`)

// checkNewAccount returns a message for the user when the username or
// password can't be used, or "" when both are fine.
func checkNewAccount(username, password string) string {
	if !usernamePattern.MatchString(username) {
		return "Usernames are 3 to 24 letters, numbers, dots, dashes or underscores."
	}
	if len(password) < 8 {
		return "Passwords need at least 8 characters."
	}
	if len(password) > 72 { // bcrypt ignores anything past 72 bytes
		return "Passwords can be at most 72 characters."
	}
	return ""
}

// createUser stores a new account and returns its id.
func createUser(username, password, authority string) (int, error) {
	var exists bool
	err := db.QueryRow("select exists(select 1 from users where username = ?)", strings.ToLower(username)).Scan(&exists)
	if err != nil {
		return 0, err
	}
	if exists {
		return 0, errUserExists
	}

	HashedPass, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return 0, err
	}
	res, err := db.Exec("insert into users (username, originalUsername, password_hash, pathToProfilePic, authority, createdAt) values (?, ?, ?, ?, ?, ?)", strings.ToLower(username), username, string(HashedPass), "/profiles/Default/default.png", strings.ToLower(authority), time.Now().UnixMilli())
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return 0, errUserExists
		}
		return 0, err
	}
	id, err := res.LastInsertId()
	return int(id), err
}

func clientIP(r *http.Request) string {
	ip := r.RemoteAddr
	if strings.Contains(ip, ":") {
		ip, _, _ = net.SplitHostPort(ip)
	}
	return ip
}

// sessionFromRequest returns the signed-in user for the request's SessionID
// cookie. The cookies map is a cache in front of the sessions table.
func sessionFromRequest(r *http.Request) (cookiesStruct, bool) {
	c, err := r.Cookie("SessionID")
	if err != nil || c.Value == "" {
		return cookiesStruct{}, false
	}
	token := c.Value

	cookiesMu.Lock()
	s, ok := cookies[token]
	cookiesMu.Unlock()
	if ok {
		if time.Since(s.Time) < sessionLifetime {
			return s, true
		}
		deleteSession(token)
		return cookiesStruct{}, false
	}

	var created, expires time.Time
	err = db.QueryRow(`
	SELECT s.created_at, s.expires_at, u.username, u.originalUsername, u.authority, u.id
	FROM sessions s
	JOIN users u ON u.id = s.user_id
	WHERE s.token = ?`, token).Scan(&created, &expires, &s.Username, &s.OriginalUsername, &s.Authority, &s.UserId)
	if err != nil {
		return cookiesStruct{}, false
	}
	if time.Now().After(expires) {
		deleteSession(token)
		return cookiesStruct{}, false
	}
	s.Time = created
	s.Authority = strings.ToLower(s.Authority)

	cookiesMu.Lock()
	cookies[token] = s
	cookiesMu.Unlock()
	return s, true
}

// startSession stores a new session for s and sends its cookie.
func startSession(w http.ResponseWriter, r *http.Request, s cookiesStruct) error {
	b := make([]byte, 32)
	if _, err := cryptorand.Read(b); err != nil {
		return err
	}
	token := hex.EncodeToString(b)

	now := time.Now().UTC()
	s.Time = now
	_, err := db.Exec("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", token, s.UserId, now, now.Add(sessionLifetime))
	if err != nil {
		return err
	}

	cookiesMu.Lock()
	cookies[token] = s
	cookiesMu.Unlock()

	http.SetCookie(w, &http.Cookie{
		Name:     "SessionID",
		Value:    token,
		Path:     "/",
		MaxAge:   int(sessionLifetime / time.Second),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil,
	})
	setRoleHint(w, r, s, true)
	return nil
}

// endSession forgets the request's session (if any) and clears its cookie.
func endSession(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("SessionID")
	if err != nil || c.Value == "" {
		return
	}
	deleteSession(c.Value)
	http.SetCookie(w, &http.Cookie{Name: "SessionID", Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	setRoleHint(w, r, cookiesStruct{}, false)
}

// setRoleHint keeps the xn_role cookie in step with the session so nav.js can
// hide links the account can't open (Files is admin only). It is only a
// display hint: every request is still checked against the session.
func setRoleHint(w http.ResponseWriter, r *http.Request, s cookiesStruct, signedIn bool) {
	c := &http.Cookie{Name: "xn_role", Path: "/", SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil}
	if !signedIn {
		c.MaxAge = -1
	} else {
		c.Value = "user"
		if s.Authority == "admin" {
			c.Value = "admin"
		} else if _, ok := filesGrantFor(s); ok {
			c.Value = "files" // may open Files (some folders), so the nav shows the link
		}
		c.MaxAge = int(sessionLifetime / time.Second)
	}
	http.SetCookie(w, c)
}

func deleteSession(token string) {
	cookiesMu.Lock()
	delete(cookies, token)
	cookiesMu.Unlock()
	db.Exec("DELETE FROM sessions WHERE token = ?", token)
}

// notSignedIn sends page visits to the sign in box on /Main (coming back
// afterwards) and answers scripts with 401 so they can say so.
func notSignedIn(w http.ResponseWriter, r *http.Request) {
	setRoleHint(w, r, cookiesStruct{}, false)
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		http.Redirect(w, r, "/Main?next="+url.QueryEscape(r.URL.RequestURI()), http.StatusSeeOther)
		return
	}
	http.Error(w, "Please log in again.", http.StatusUnauthorized)
}

func requireLogin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)

		d, ok := sessionFromRequest(r)
		if !ok {
			fmt.Printf("[%s] DENY IP=%s PATH=%s REASON=not_signed_in\n", time.Now().Format("2006-01-02 15:04:05"), ip, r.URL.Path)
			notSignedIn(w, r)
			return
		}
		fmt.Printf("[%s] ALLOW IP=%s USER=%s PATH=%s\n", time.Now().Format("2006-01-02 15:04:05"), ip, d.OriginalUsername, r.URL.Path)
		if r.Method == http.MethodGet {
			setRoleHint(w, r, d, true)
		}

		// all good → call the real handler
		next(w, r)
	}
}

func requireAdminLogin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)

		d, ok := sessionFromRequest(r)
		if !ok {
			fmt.Printf("[%s] DENY IP=%s PATH=%s REASON=not_signed_in\n", time.Now().Format("2006-01-02 15:04:05"), ip, r.URL.Path)
			notSignedIn(w, r)
			return
		}
		if r.Method == http.MethodGet {
			setRoleHint(w, r, d, true)
		}
		if d.Authority != "admin" {
			fmt.Printf("[%s] DENY IP=%s USER=%s PATH=%s REASON=not_admin\n", time.Now().Format("2006-01-02 15:04:05"), ip, d.OriginalUsername, r.URL.Path)
			if r.Method == http.MethodGet {
				http.Redirect(w, r, "/Main?need=admin", http.StatusSeeOther)
			} else {
				http.Error(w, "Only admins can do that.", http.StatusForbidden)
			}
			return
		}

		fmt.Printf("[%s] ALLOW IP=%s USER=%s AUTHORITY=%s PATH=%s\n", time.Now().Format("2006-01-02 15:04:05"), ip, d.OriginalUsername, d.Authority, r.URL.Path)
		next(w, r)
	}
}

func StartCookieCleaner() {
	go func() {
		for {
			time.Sleep(1 * time.Hour)

			cookiesMu.Lock()
			for key, value := range cookies {
				if time.Since(value.Time) > sessionLifetime {
					delete(cookies, key)
				}
			}
			cookiesMu.Unlock()

			rows, err := db.Query("SELECT token, expires_at FROM sessions")
			if err != nil {
				continue
			}
			var expired []string
			for rows.Next() {
				var token string
				var expires time.Time
				if rows.Scan(&token, &expires) == nil && time.Now().After(expires) {
					expired = append(expired, token)
				}
			}
			rows.Close()
			for _, token := range expired {
				db.Exec("DELETE FROM sessions WHERE token = ?", token)
			}
		}
	}()
}

func Downloader(w http.ResponseWriter, r *http.Request) {
	//fs := http.FileServer(http.Dir("."))

	path := r.URL.Path
	path = strings.TrimSuffix(path, "/")

	if strings.Contains(path, "downloader.css") {
		return
	}

	session, _ := sessionFromRequest(r)
	grant, _ := filesGrantFor(session)
	dirPath, ok := insideUploads(strings.Split(strings.TrimPrefix(strings.TrimPrefix(path, "/Files"), "/"), "/")...)
	if !ok {
		http.Error(w, "Cant find folder/file, it dosent exit", http.StatusBadRequest)
		return
	}
	rel := uploadRel(dirPath)

	info, err := os.Stat(dirPath)
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "Cant find folder/file, it dosent exit", http.StatusBadRequest)
			return
		} else {
			http.Error(w, "Something went wrong when trying to find the folder", http.StatusBadRequest)
			return
		}
	}

	if info.IsDir() && !grant.canSee(rel) || !info.IsDir() && !grant.allows(rel) {
		http.Error(w, "You don't have access to that folder.", http.StatusForbidden)
		return
	}

	if info.IsDir() {
		d := struct {
			Files    []FileFolderInfo
			IsRoot   bool
			BackPath string
			CanEdit  bool
			IsAdmin  bool
		}{CanEdit: grant.canChangeIn(rel), IsAdmin: session.Authority == "admin"}
		if path == "/Files" {
			d.IsRoot = true
		} else {
			pathSplit := strings.Split(path, "/")
			if len(pathSplit) < 2 {
				d.BackPath = "/"
			} else {
				d.BackPath = strings.Join(pathSplit[:len(pathSplit)-1], "/")
			}
		}

		d.Files, err = getItemsInPath(w, r, dirPath)
		if err != nil {
			http.Error(w, "Cant find folder/file", http.StatusBadRequest)
			return
		}
		d.Files = withFolderIcons(grant.visible(d.Files, rel), rel)

		tpl, err := template.ParseFiles("html/Downloader.html")
		if err != nil {
			http.Error(w, "Couldnt load page", http.StatusBadRequest)
			return
		}

		err = tpl.Execute(w, d)
		if err != nil {
			http.Error(w, "Couldnt load page", http.StatusBadRequest)
			return
		}
	} else {
		w.Header().Set("Content-Disposition", "attachment; filename=\""+info.Name()+"\"")
		http.ServeFile(w, r, dirPath)
	}

}

func Uploader(w http.ResponseWriter, r *http.Request) {
	session, _ := sessionFromRequest(r)
	if grant, _ := filesGrantFor(session); !grant.CanEdit {
		http.Redirect(w, r, "/Files/", http.StatusSeeOther)
		return
	}

	//tpl.ExecuteTemplate(w, "Upload", nil)

	tpl, err := template.ParseFiles("html/Uploader.html")
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}

	err = tpl.Execute(w, nil)
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}
}

func GetUploadData(w http.ResponseWriter, r *http.Request) {

	err := r.ParseMultipartForm(20 << 20)
	if err != nil {
		http.Error(w, "Error parsing form", http.StatusBadRequest)
		return
	}

	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		http.Error(w, "No files uploaded", http.StatusBadRequest)
		return
	}
	uploadDir, ok := insideUploads(r.FormValue("currentPath"))
	if !ok {
		http.Error(w, "Not a valid folder", http.StatusBadRequest)
		return
	}
	if !filesGrantOf(r).canChangeIn(uploadRel(uploadDir)) {
		http.Error(w, "You can't upload to that folder.", http.StatusForbidden)
		return
	}

	os.MkdirAll(UploadedFilesDirName, 0755)
	for _, file := range files {
		f, _ := file.Open()
		out, err := os.Create(filepath.Join(uploadDir, filepath.Base(file.Filename)))
		if err != nil {
			http.Error(w, "Error Downloading File", http.StatusBadRequest)
			f.Close()
			continue
		}

		_, err = io.Copy(out, f)
		if err != nil {
			http.Error(w, "Error Saving file", http.StatusInternalServerError)
			return
		}

		f.Close()
		out.Close()
		fmt.Println("Uploaded file: " + file.Filename)
	}

	http.Redirect(w, r, "/Uploader?success=true", http.StatusSeeOther)
}

func makeFolder(w http.ResponseWriter, r *http.Request) {
	var folderData MakeFolderData
	err := json.NewDecoder(r.Body).Decode(&folderData)
	if err != nil {
		http.Error(w, "Not valid folder data", http.StatusBadRequest)
		return
	}

	folderName := folderData.Name
	path := folderData.Path

	pathSplit := strings.Split(path, "/")

	var parts []string
	if len(pathSplit) > 2 {
		parts = pathSplit[2:]
	}
	dirPath, ok := insideUploads(parts...)
	if !ok || !validName(folderName) {
		http.Error(w, "Not a valid folder name", http.StatusBadRequest)
		return
	}
	if !filesGrantOf(r).canChangeIn(uploadRel(dirPath)) {
		http.Error(w, "You can't make folders here.", http.StatusForbidden)
		return
	}

	FullPathDir := filepath.Join(dirPath, folderName)
	err = os.MkdirAll(FullPathDir, 0755)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func getFolders(w http.ResponseWriter, r *http.Request) {
	var getFolderData struct {
		CurrentPath string `json:"currentPath"`
		FolderToGet string `json:"FolderToGet"`
	}

	var FoldersReturn struct {
		Folders     []string              `json:"Folders"`
		CurrentPath string                `json:"CurrentPath"`
		Icons       map[string]folderIcon `json:"Icons"`
	}
	FoldersReturn.Icons = map[string]folderIcon{}

	err := json.NewDecoder(r.Body).Decode(&getFolderData)
	if err != nil {
		http.Error(w, "Not valid folder data", http.StatusBadRequest)
		return
	}

	currentPath := getFolderData.CurrentPath
	FolderToGet := getFolderData.FolderToGet
	if strings.HasPrefix(currentPath, "/") {
		currentPath = "./" + currentPath[1:]
	}

	Path, ok := insideUploads(currentPath, FolderToGet)
	grant := filesGrantOf(r)
	if !ok || !grant.canSee(uploadRel(Path)) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	Dirs, err := os.ReadDir(Path)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	for _, Dir := range Dirs {
		if Dir.IsDir() && grant.canSee(joinRel(uploadRel(Path), Dir.Name())) {
			FoldersReturn.Folders = append(FoldersReturn.Folders, Dir.Name())
			if ic := folderIconFor(joinRel(uploadRel(Path), Dir.Name())); ic != (folderIcon{}) {
				FoldersReturn.Icons[Dir.Name()] = ic
			}
		}
	}
	rel, _ := filepath.Rel(UploadedFilesDirName, Path)
	FoldersReturn.CurrentPath = filepath.ToSlash(rel)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(FoldersReturn)
}

func search(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	currentPath := r.URL.Query().Get("path")

	pathSplit := strings.Split(currentPath, "/")

	var parts []string
	if len(pathSplit) > 2 {
		parts = pathSplit[2:]
	}
	finalPath, ok := insideUploads(parts...)
	grant := filesGrantOf(r)
	if !ok || !grant.canSee(uploadRel(finalPath)) {
		http.Error(w, "Cant find folder/file", http.StatusBadRequest)
		return
	}

	results := []FileFolderInfo{}
	if query != "" {
		results = searchFileFolder(finalPath, query)
	} else {
		FileFolders, err := getItemsInPath(w, r, finalPath)
		if err != nil {
			http.Error(w, "Cant find folder/file", http.StatusBadRequest)
			return
		}
		results = append(results, FileFolders...)
	}
	results = grant.visible(results, "")

	w.Header().Set("Content-Type", "application/json")
	err := json.NewEncoder(w).Encode(results)
	if err != nil {
		http.Error(w, "Failed to encode results", http.StatusInternalServerError)
		return
	}
}

// getItems answers a "Path: /Files/..." header with that folder's items as JSON,
// or with the file itself. Like the other Files routes it stays inside UploadedFiles.
func getItems(w http.ResponseWriter, r *http.Request) {
	finalPath := UploadedFilesDirName
	if p := r.Header.Get("Path"); strings.Trim(strings.TrimPrefix(p, "/Files"), "/") != "" {
		var ok bool
		if finalPath, ok = uploadPathFromURL(p); !ok {
			http.Error(w, "File not found", http.StatusNotFound)
			return
		}
	}
	info, err := os.Stat(finalPath)
	grant := filesGrantOf(r)
	rel := uploadRel(finalPath)
	if err != nil || info.IsDir() && !grant.canSee(rel) || !info.IsDir() && !grant.allows(rel) {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}
	if !info.IsDir() {
		http.ServeFile(w, r, finalPath)
		return
	}

	result, err := getItemsInPath(w, r, finalPath)
	if err != nil {
		http.Error(w, "Failed to get items", http.StatusInternalServerError)
		return
	}
	result = grant.visible(result, rel)

	w.Header().Set("Content-Type", "application/json")
	err = json.NewEncoder(w).Encode(result)
	if err != nil {
		http.Error(w, "Failed to encode results", http.StatusInternalServerError)
		return
	}
}

func getItemsInPath(w http.ResponseWriter, r *http.Request, PathString string) ([]FileFolderInfo, error) {
	var Items []FileFolderInfo
	var ArgNeeded struct {
		UrlPath string `json:"urlPath"`
	}

	var path string
	if PathString == "" {
		path = urlPathToFile(ArgNeeded.UrlPath)
	} else {
		path = PathString
	}

	FilesFolders, err := os.ReadDir(path)
	if err != nil {
		http.Error(w, "Could not read files from path", http.StatusBadRequest)
		return Items, fmt.Errorf("Could not read files from path")
	}

	for _, file := range FilesFolders {
		isDir, isImg, isVid, isAudio := checkExtension(file.Name(), file.IsDir())

		info, err := file.Info()
		if err != nil {
			continue
		}

		Items = append(Items, FileFolderInfo{
			Name:    info.Name(),
			Path:    FilePathToUrl(filepath.Join(path, info.Name())),
			IsDir:   isDir,
			IsImg:   isImg,
			IsAudio: isAudio,
			IsVid:   isVid,
			Size:    int(info.Size()),
			Date:    info.ModTime(),
		})
	}

	return Items, nil
}

func getItemFromPath(w http.ResponseWriter, r *http.Request, PathString string) FileFolderInfo {
	var Item FileFolderInfo
	var ArgNeeded struct {
		UrlPath string `json:"urlPath"`
	}

	var path string
	if PathString == "" {
		path = urlPathToFile(ArgNeeded.UrlPath)
	} else {
		path = PathString
	}

	file, err := os.Stat(path)
	if err != nil {
		http.Error(w, "Could not read files from path", http.StatusBadRequest)
		return FileFolderInfo{}
	}

	isDir, isImg, isVid, isAudio := checkExtension(file.Name(), file.IsDir())

	Item = FileFolderInfo{
		Name:    file.Name(),
		Path:    FilePathToUrl(strings.Join([]string{path, file.Name()}, "/")),
		IsDir:   isDir,
		IsImg:   isImg,
		IsAudio: isAudio,
		IsVid:   isVid,
	}

	return Item
}

func checkExtension(fileName string, isDir bool) (bool, bool, bool, bool) {
	Extensions := map[string][]string{
		"Images": []string{".jpg", ".jpeg", ".png", ".gif"},
		"Videos": []string{".mp4", ".mkv", ".mov", ".webm"},
		"Audio":  []string{".mp3", ".wav"},
	}

	var isImg bool
	var isVid bool
	var isAudio bool
	if isDir {
		return isDir, isImg, isVid, isAudio
	} else {
		for Type, ExtList := range Extensions {
			for _, Ext := range ExtList {
				if fileName[len(fileName)-len(Ext):] == Ext {
					if Type == "Images" {
						isImg = true
					} else if Type == "Videos" {
						isVid = true
					} else if Type == "Audio" {
						isAudio = true
					}
					break
				}
			}
		}
		return isDir, isImg, isVid, isAudio
	}
}

func urlPathToFile(urlPath string) string {
	pathSplit := strings.Split(urlPath, "/")

	var finalPath string
	if len(pathSplit) > 2 {
		finalPath = filepath.Join(append([]string{UploadedFilesDirName}, pathSplit[2:]...)...)
	} else {
		finalPath = UploadedFilesDirName + "/."
	}
	return finalPath
}

func FilePathToUrl(filePath string) string {
	pathSplit := strings.Split(filepath.ToSlash(filePath), "/")
	finalPath := "/Files/" + strings.Join(pathSplit[1:], "/")
	return (&url.URL{Path: finalPath}).EscapedPath()
}

// insideUploads joins parts onto the upload folder and refuses anything that
// would land outside it (a "..", an absolute path).
func insideUploads(parts ...string) (string, bool) {
	p := filepath.Join(append([]string{UploadedFilesDirName}, parts...)...)
	rel, err := filepath.Rel(UploadedFilesDirName, p)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return p, true
}

// uploadPathFromURL maps a /Files/... link (a full URL or just the path,
// percent-encoded or not) to the file or folder it points at.
func uploadPathFromURL(raw string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", false
	}
	rel, found := strings.CutPrefix(u.Path, "/Files/")
	if !found || strings.Trim(rel, "/") == "" {
		return "", false
	}
	return insideUploads(strings.Split(rel, "/")...)
}

// validName is true for a plain file or folder name with no path in it.
func validName(name string) bool {
	return name != "" && name != "." && name != ".." && !strings.ContainsAny(name, "/\\")
}

func searchFileFolder(path string, query string) []FileFolderInfo {
	var results []FileFolderInfo
	entries, _ := os.ReadDir(path)

	for _, entry := range entries {
		fullPath := filepath.Join(path, entry.Name())

		if entry.IsDir() {
			results = append(results, searchFileFolder(fullPath, query)...)
		} else {
			if strings.Contains(strings.ToLower(entry.Name()), strings.ToLower(query)) {
				relPath, err := filepath.Rel(UploadedFilesDirName, fullPath)
				if err != nil {
					continue
				}

				info, err := entry.Info()
				if err != nil {
					continue
				}
				var d FileFolderInfo
				d.Name = info.Name()
				d.IsDir, d.IsImg, d.IsVid, d.IsAudio = checkExtension(info.Name(), false)
				d.Path = (&url.URL{Path: "/Files/" + filepath.ToSlash(relPath)}).EscapedPath()
				d.Size = int(info.Size())
				d.Date = info.ModTime()

				results = append(results, d)
			}
		}
	}

	return results
}

func Delete(w http.ResponseWriter, r *http.Request) {
	var deleteData struct {
		Path string `json:"path"`
	}
	err := json.NewDecoder(r.Body).Decode(&deleteData)
	if err != nil {
		http.Error(w, "Not valid folder data", http.StatusBadRequest)
		return
	}

	path, ok := uploadPathFromURL(deleteData.Path)
	if !ok {
		http.Error(w, "Not a valid file", http.StatusBadRequest)
		return
	}
	if !filesGrantOf(r).canChange(uploadRel(path)) {
		http.Error(w, "You can't delete that.", http.StatusForbidden)
		return
	}
	err = os.Remove(path)
	if err != nil {
		http.Error(w, "Failed to delete file", http.StatusInternalServerError)
		return
	}
	forgetFolderIcon(uploadRel(path))

	w.WriteHeader(http.StatusOK)
}

func Rename(w http.ResponseWriter, r *http.Request) {
	var renameData struct {
		CurrentFilenamePath string `json:"currentFilenamePath"`
		NewFileName         string `json:"newFileName"`
	}
	err := json.NewDecoder(r.Body).Decode(&renameData)
	if err != nil {
		http.Error(w, "Not valid folder data", http.StatusBadRequest)
		return
	}

	currentFilePath, ok := uploadPathFromURL(renameData.CurrentFilenamePath)
	if !ok || !validName(renameData.NewFileName) {
		http.Error(w, "Not a valid name", http.StatusBadRequest)
		return
	}
	if !filesGrantOf(r).canChange(uploadRel(currentFilePath)) {
		http.Error(w, "You can't rename that.", http.StatusForbidden)
		return
	}
	newFilePath := filepath.Join(filepath.Dir(currentFilePath), renameData.NewFileName)

	curentFileName := filepath.Base(currentFilePath)
	if curentFileName != renameData.NewFileName {
		err := os.Rename(currentFilePath, newFilePath)
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Could not rename file/folder", http.StatusInternalServerError)
			return

		}
		moveFolderIcons(uploadRel(currentFilePath), uploadRel(newFilePath))
	}

	w.WriteHeader(http.StatusOK)
}

func AdminPanel(w http.ResponseWriter, r *http.Request) {
	tpl, err := template.ParseFiles("html/AdminPanel.html")
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}

	err = tpl.Execute(w, nil)
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}
}

func AdminPanelCreateUser(w http.ResponseWriter, r *http.Request) {
	tpl, err := template.ParseFiles("html/AdminPanelCreateUser.html")
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}

	err = tpl.Execute(w, nil)
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}
}

func AdminPanelCreateUserData(w http.ResponseWriter, r *http.Request) {
	err := r.ParseMultipartForm(1024)
	if err != nil {
		http.Error(w, "Cant parse data", http.StatusBadRequest)
		return
	}
	username := strings.TrimSpace(r.FormValue("username"))
	password := r.FormValue("password")
	authority := strings.ToLower(r.FormValue("authority"))

	if authority != "user" && authority != "admin" {
		http.Error(w, "Choose User or Admin.", http.StatusBadRequest)
		return
	}
	if msg := checkNewAccount(username, password); msg != "" {
		http.Error(w, msg, http.StatusBadRequest)
		return
	}

	_, err = createUser(username, password, authority)
	if errors.Is(err, errUserExists) {
		http.Error(w, "User already exists", http.StatusBadRequest)
		return
	}
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Could not create user", http.StatusInternalServerError)
		return
	}

	w.Write([]byte("User Created"))
}

// ---- Profile: dose calendar, liked substances, pictures ----

type likedSubstance struct {
	Name  string `json:"name"`
	Image string `json:"image"`
	Class string `json:"class"`
}

// Initial is the letter shown when a liked substance has no picture.
func (l likedSubstance) Initial() string {
	first, _ := utf8.DecodeRuneInString(l.Name)
	if first == utf8.RuneError {
		return "?"
	}
	return strings.ToUpper(string(first))
}

func likedSubstances(userId int) ([]likedSubstance, error) {
	rows, err := db.Query("SELECT name, image, class FROM liked_substances WHERE user_id = ? ORDER BY liked_at DESC", userId)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []likedSubstance{}
	for rows.Next() {
		var l likedSubstance
		if err := rows.Scan(&l.Name, &l.Image, &l.Class); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// cleanText trims s, drops control characters and cuts it to max characters.
func cleanText(s string, max int) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.TrimSpace(s))
	if utf8.RuneCountInString(s) > max {
		s = string([]rune(s)[:max])
	}
	return s
}

// cleanMultiline is cleanText for notes and posts: it keeps line breaks (at
// most one empty line in a row) and drops the other control characters.
func cleanMultiline(s string, max int) string {
	lines := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
	for i, line := range lines {
		lines[i] = strings.TrimRightFunc(strings.Map(func(r rune) rune {
			if r == '\t' {
				return ' '
			}
			if unicode.IsControl(r) {
				return -1
			}
			return r
		}, line), unicode.IsSpace)
	}
	s = strings.Join(lines, "\n")
	for strings.Contains(s, "\n\n\n") {
		s = strings.ReplaceAll(s, "\n\n\n", "\n\n")
	}
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > max {
		s = strings.TrimSpace(string([]rune(s)[:max]))
	}
	return s
}

// initialOf is the letter shown when an account has no profile picture.
func initialOf(name string) string {
	if first, _ := utf8.DecodeRuneInString(name); first != utf8.RuneError {
		return strings.ToUpper(string(first))
	}
	return "?"
}

// userByName finds an account by its username (any letter case).
func userByName(name string) (int, bool) {
	var id int
	if err := db.QueryRow("SELECT id FROM users WHERE username = ?", strings.ToLower(strings.TrimSpace(name))).Scan(&id); err != nil {
		return 0, false
	}
	return id, true
}

// likes: GET lists the account's liked substances, POST {name, image, class, liked} adds or removes one.
func likes(w http.ResponseWriter, r *http.Request) {
	session, _ := sessionFromRequest(r)

	switch r.Method {
	case http.MethodGet:
		list, err := likedSubstances(session.UserId)
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't load your likes.", http.StatusInternalServerError)
			return
		}
		writeJSON(w, list)

	case http.MethodPost:
		var in struct {
			likedSubstance
			Liked bool `json:"liked"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
			http.Error(w, "Couldn't read that.", http.StatusBadRequest)
			return
		}
		name := cleanText(in.Name, 80)
		if name == "" {
			http.Error(w, "Pick a substance.", http.StatusBadRequest)
			return
		}
		if !in.Liked {
			if _, err := db.Exec("DELETE FROM liked_substances WHERE user_id = ? AND name = ?", session.UserId, name); err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't save that.", http.StatusInternalServerError)
				return
			}
			writeJSON(w, map[string]bool{"liked": false})
			return
		}

		var count int
		db.QueryRow("SELECT COUNT(*) FROM liked_substances WHERE user_id = ?", session.UserId).Scan(&count)
		if count >= maxLikes {
			http.Error(w, fmt.Sprintf("You can like up to %d substances.", maxLikes), http.StatusBadRequest)
			return
		}
		// Only keep structure pictures from PsychonautWiki itself.
		image := strings.TrimSpace(in.Image)
		if len(image) > 300 || !strings.HasPrefix(image, "https://psychonautwiki.org/") {
			image = ""
		}
		_, err := db.Exec(`INSERT INTO liked_substances (user_id, name, image, class, liked_at) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(user_id, name) DO UPDATE SET image = excluded.image, class = excluded.class`,
			session.UserId, name, image, cleanText(in.Class, 120), time.Now().UTC())
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't save that.", http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]bool{"liked": true})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// profileDoses answers GET ?month=2026-10&zone=Europe/Amsterdam (or &tz=<minutes, as JS
// getTimezoneOffset gives it>) with that month's doses grouped by day in the visitor's time zone.
func profileDoses(w http.ResponseWriter, r *http.Request) {
	session, _ := sessionFromRequest(r)
	q := r.URL.Query()

	month, err := time.Parse("2006-01", q.Get("month"))
	if err != nil {
		http.Error(w, "Pick a month like 2026-10.", http.StatusBadRequest)
		return
	}
	zone := visitorZone(q)
	start := time.Date(month.Year(), month.Month(), 1, 0, 0, 0, 0, zone)
	end := start.AddDate(0, 1, 0)

	type entry struct {
		Name   string `json:"name"`
		Amount string `json:"amount"`
		Unit   string `json:"unit"`
		Method string `json:"method"`
		Time   string `json:"time"`
	}
	out := struct {
		Month  string             `json:"month"`
		Days   map[string][]entry `json:"days"`
		Latest string             `json:"latest"`
	}{Month: start.Format("2006-01"), Days: map[string][]entry{}}

	all, err := accountDoses(session.UserId, zone, time.Time{}, time.Time{})
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Couldn't load your doses.", http.StatusInternalServerError)
		return
	}
	for _, d := range all {
		if d.At.Before(start) || !d.At.Before(end) {
			continue
		}
		day := d.At.Format("2006-01-02")
		out.Days[day] = append(out.Days[day], entry{
			Name:   d.Name,
			Amount: formatAmount(d.Amount),
			Unit:   displayUnit(d.Unit),
			Method: d.Method,
			Time:   d.At.Format("15:04"),
		})
	}
	if len(all) > 0 {
		out.Latest = all[len(all)-1].At.Format("2006-01-02")
	}
	writeJSON(w, out)
}

// visitorZone reads the browser's time zone from ?zone=<IANA name>&tz=<minutes,
// as getTimezoneOffset gives them>.
func visitorZone(q url.Values) *time.Location {
	tz, err := strconv.Atoi(q.Get("tz"))
	if err != nil || tz < -840 || tz > 840 {
		tz = 0
	}
	zone := time.FixedZone("visitor", -tz*60)
	if name := q.Get("zone"); name != "" && name != "Local" {
		if loc, err := time.LoadLocation(name); err == nil {
			zone = loc
		}
	}
	return zone
}

// loggedDose is one dose on the Profile page, from the journal (the doses
// table, filled by "Save data" and journal imports) or from a Graph session.
type loggedDose struct {
	Name   string
	Amount float64
	Unit   string
	Method string
	At     time.Time
}

// accountDoses lists the account's doses taken in [from, to), oldest first; a
// zero time means no limit. Graph sessions only keep a clock time per dose, so
// those doses go on the day the session started, in loc. A Graph dose that was
// also saved to the journal (same substance, amount and minute) is listed once.
func accountDoses(userID int, loc *time.Location, from, to time.Time) ([]loggedDose, error) {
	out := []loggedDose{}
	seen := map[string]bool{}
	add := func(d loggedDose) {
		if (!from.IsZero() && d.At.Before(from)) || (!to.IsZero() && !d.At.Before(to)) {
			return
		}
		key := strings.ToLower(d.Name) + "|" + strconv.FormatFloat(d.Amount, 'f', -1, 64) + "|" + strconv.FormatInt(d.At.Unix()/60, 10)
		if !seen[key] {
			seen[key] = true
			out = append(out, d)
		}
	}

	// taken_at is text with its own UTC offset, so filter by date a day wider here and exactly in add.
	query := `SELECT drug.name, dose.amount, dose.unit, dose.method_way, dose.taken_at
		FROM doses dose JOIN drugs drug ON dose.drug_id = drug.id WHERE dose.user_id = ?`
	args := []any{userID}
	if !from.IsZero() {
		query += " AND dose.taken_at >= ?"
		args = append(args, from.AddDate(0, 0, -1).UTC().Format("2006-01-02"))
	}
	if !to.IsZero() {
		query += " AND dose.taken_at < ?"
		args = append(args, to.AddDate(0, 0, 2).UTC().Format("2006-01-02"))
	}
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var d loggedDose
		if err := rows.Scan(&d.Name, &d.Amount, &d.Unit, &d.Method, &d.At); err != nil {
			fmt.Println(err)
			continue
		}
		d.At = d.At.In(loc)
		add(d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	lo, hi := int64(0), int64(math.MaxInt64)
	if !from.IsZero() {
		lo = from.AddDate(0, 0, -2).UnixMilli()
	}
	if !to.IsZero() {
		hi = to.AddDate(0, 0, 2).UnixMilli()
	}
	rows, err = db.Query("SELECT started_at, doses FROM graph_experiences WHERE user_id = ? AND started_at >= ? AND started_at < ?", userID, lo, hi)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var started int64
		var raw string
		if err := rows.Scan(&started, &raw); err != nil {
			continue
		}
		var doses []experienceDose
		if json.Unmarshal([]byte(raw), &doses) != nil {
			continue
		}
		day := time.UnixMilli(started).In(loc)
		for _, g := range doses {
			var h, m int
			if _, err := fmt.Sscanf(g.Time, "%d:%d", &h, &m); err != nil {
				continue
			}
			add(loggedDose{
				Name:   g.Substance,
				Amount: g.Amount,
				Unit:   g.Unit,
				Method: strings.Trim(strings.Join([]string{g.Route, g.Formulation}, ", "), ", "),
				At:     time.Date(day.Year(), day.Month(), day.Day(), h, m, 0, 0, loc),
			})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.Before(out[j].At) })
	return out, nil
}

func formatAmount(v float64) string {
	return strconv.FormatFloat(math.Round(v*100)/100, 'f', -1, 64)
}

// displayUnit writes micrograms the way PsychonautWiki does.
func displayUnit(unit string) string {
	if unit == "ug" || unit == "mcg" || unit == "μg" {
		return "µg"
	}
	return unit
}

// profileIntake: the Profile page's "Recent intake" (newest 10 doses) and
// "Totals" per substance for the last 7 days, 30 days and all time.
func profileIntake(w http.ResponseWriter, r *http.Request) {
	session, _ := sessionFromRequest(r)
	loc := visitorZone(r.URL.Query())
	all, err := accountDoses(session.UserId, loc, time.Time{}, time.Time{})
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Couldn't load your doses.", http.StatusInternalServerError)
		return
	}

	type recentDose struct {
		Name   string `json:"name"`
		Amount string `json:"amount"`
		Unit   string `json:"unit"`
		Method string `json:"method"`
		At     string `json:"at"`
		Ago    string `json:"ago"`
	}
	type total struct {
		Name   string `json:"name"`
		Amount string `json:"amount"`
		Unit   string `json:"unit"`
		Doses  int    `json:"doses"`
	}
	out := struct {
		Count  int                `json:"count"`
		Recent []recentDose       `json:"recent"`
		Totals map[string][]total `json:"totals"`
	}{Count: len(all), Recent: []recentDose{}, Totals: map[string][]total{}}

	// The journal stores names in lowercase; the Graph keeps PsychonautWiki's spelling ("LSD").
	names := map[string]string{}
	for _, d := range all {
		k := strings.ToLower(d.Name)
		if cur, ok := names[k]; !ok || cur == k {
			names[k] = d.Name
		}
	}

	for i := len(all) - 1; i >= 0 && len(out.Recent) < 10; i-- {
		d := all[i]
		out.Recent = append(out.Recent, recentDose{
			Name:   names[strings.ToLower(d.Name)],
			Amount: formatAmount(d.Amount),
			Unit:   displayUnit(d.Unit),
			Method: d.Method,
			At:     d.At.Format(time.RFC3339),
			Ago:    timeToHowLongAgoString(d.At),
		})
	}

	now := time.Now().In(loc)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	ranges := map[string]time.Time{"week": today.AddDate(0, 0, -6), "month": today.AddDate(0, 0, -29), "all": {}}
	for key, from := range ranges {
		type sum struct {
			name   string
			amount float64
			unit   string
			doses  int
		}
		sums := map[string]*sum{}
		order := []string{}
		for _, d := range all {
			if !from.IsZero() && d.At.Before(from) {
				continue
			}
			amount, unit, err := normalizeAmount(d.Amount, d.Unit)
			if err != nil {
				amount, unit = d.Amount, d.Unit
			}
			k := strings.ToLower(d.Name) + "|" + unit
			if sums[k] == nil {
				sums[k] = &sum{name: names[strings.ToLower(d.Name)], unit: unit}
				order = append(order, k)
			}
			sums[k].amount += amount
			sums[k].doses++
		}
		list := []total{}
		for _, k := range order {
			s := sums[k]
			amount, unit := prettyAmount(s.amount, s.unit)
			list = append(list, total{Name: s.name, Amount: formatAmount(amount), Unit: displayUnit(unit), Doses: s.doses})
		}
		sort.SliceStable(list, func(i, j int) bool {
			if list[i].Doses != list[j].Doses {
				return list[i].Doses > list[j].Doses
			}
			return strings.ToLower(list[i].Name) < strings.ToLower(list[j].Name)
		})
		out.Totals[key] = list
	}
	writeJSON(w, out)
}

// profileFile maps a /profiles/... link to its file inside the profiles folder.
func profileFile(link string) (string, bool) {
	rel, found := strings.CutPrefix(link, "/profiles/")
	if !found || strings.Trim(rel, "/") == "" {
		return "", false
	}
	p := filepath.Join(ProfilePicturesDirName, filepath.FromSlash(rel))
	r, err := filepath.Rel(ProfilePicturesDirName, p)
	if err != nil || r == "." || r == ".." || strings.HasPrefix(r, ".."+string(filepath.Separator)) {
		return "", false
	}
	return p, true
}

// existingPicture returns link when it points at a picture that is really on disk, else "".
func existingPicture(link string) string {
	p, ok := profileFile(link)
	if !ok {
		return ""
	}
	if info, err := os.Stat(p); err != nil || info.IsDir() {
		return ""
	}
	return link
}

func profileImage(w http.ResponseWriter, r *http.Request) {
	p, ok := profileFile(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	switch strings.ToLower(filepath.Ext(p)) {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp":
	default:
		http.NotFound(w, r)
		return
	}
	if info, err := os.Stat(p); err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeFile(w, r, p)
}

// removeOwnPicture deletes a replaced upload, but only one inside that account's own folder.
func removeOwnPicture(link string, userId int) {
	if !strings.HasPrefix(link, "/profiles/"+strconv.Itoa(userId)+"/") {
		return
	}
	if p, ok := profileFile(link); ok {
		os.Remove(p)
	}
}

// saveProfileImage stores an uploaded JPG/PNG/GIF/WebP in profiles/<uid>/ as
// <prefix>-<random>.<ext> and returns its /profiles/ link, or an HTTP status
// and message when it can't.
func saveProfileImage(file io.ReadSeeker, uid int, prefix string) (string, int, string) {
	name, status, msg := saveImageIn(file, filepath.Join(ProfilePicturesDirName, strconv.Itoa(uid)), prefix)
	if status != 0 {
		return "", status, msg
	}
	return "/profiles/" + strconv.Itoa(uid) + "/" + name, 0, ""
}

// saveImageIn stores an uploaded JPG/PNG/GIF/WebP in dir as
// <prefix>-<random>.<ext> and returns the file name.
func saveImageIn(file io.ReadSeeker, dir, prefix string) (string, int, string) {
	head := make([]byte, 512)
	n, _ := io.ReadFull(file, head)
	var ext string
	switch http.DetectContentType(head[:n]) {
	case "image/jpeg":
		ext = ".jpg"
	case "image/png":
		ext = ".png"
	case "image/gif":
		ext = ".gif"
	case "image/webp":
		ext = ".webp"
	default:
		return "", http.StatusUnsupportedMediaType, "Use a JPG, PNG, GIF or WebP picture."
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", http.StatusInternalServerError, "Couldn't read the picture."
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		fmt.Println(err)
		return "", http.StatusInternalServerError, "Couldn't save the picture."
	}
	b := make([]byte, 6)
	cryptorand.Read(b)
	name := prefix + "-" + hex.EncodeToString(b) + ext
	out, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		fmt.Println(err)
		return "", http.StatusInternalServerError, "Couldn't save the picture."
	}
	_, copyErr := io.Copy(out, file)
	closeErr := out.Close()
	if copyErr != nil || closeErr != nil {
		os.Remove(filepath.Join(dir, name))
		return "", http.StatusInternalServerError, "Couldn't save the picture."
	}
	return name, 0, ""
}

// profilePicture takes a multipart POST with kind=avatar|banner and either an
// "image" file or remove=1, and answers {"url": "<new link or empty>"}.
func profilePicture(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	session, _ := sessionFromRequest(r)
	uid := session.UserId

	r.Body = http.MaxBytesReader(w, r.Body, maxPictureBytes+(64<<10))
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		http.Error(w, fmt.Sprintf("That picture is too big. Pick one under %d MB.", maxPictureMB), http.StatusRequestEntityTooLarge)
		return
	}
	defer r.MultipartForm.RemoveAll()

	var column string
	kind := r.FormValue("kind")
	switch kind {
	case "avatar":
		column = "pathToProfilePic"
	case "banner":
		column = "pathToBanner"
	case "background":
		column = "pathToBackground"
	case "sitebg":
		column = "siteBgImage"
	default:
		http.Error(w, "Unknown picture.", http.StatusBadRequest)
		return
	}
	var old string
	db.QueryRow("SELECT "+column+" FROM users WHERE id = ?", uid).Scan(&old)

	if r.FormValue("remove") == "1" {
		link := ""
		if kind == "avatar" {
			link = defaultProfilePic
		}
		if _, err := db.Exec("UPDATE users SET "+column+" = ? WHERE id = ?", link, uid); err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't remove the picture.", http.StatusInternalServerError)
			return
		}
		removeOwnPicture(old, uid)
		writeJSON(w, map[string]string{"url": ""})
		return
	}

	file, _, err := r.FormFile("image")
	if err != nil {
		http.Error(w, "Pick a picture first.", http.StatusBadRequest)
		return
	}
	defer file.Close()

	link, status, msg := saveProfileImage(file, uid, kind)
	if status != 0 {
		http.Error(w, msg, status)
		return
	}
	if _, err := db.Exec("UPDATE users SET "+column+" = ? WHERE id = ?", link, uid); err != nil {
		fmt.Println(err)
		removeOwnPicture(link, uid)
		http.Error(w, "Couldn't save the picture.", http.StatusInternalServerError)
		return
	}
	removeOwnPicture(old, uid)
	writeJSON(w, map[string]string{"url": link})
}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// graphColors: GET lists the account's custom graph colors as [{name, color}],
// POST {name, color} sets one, and an empty color goes back to the default.
func graphColors(w http.ResponseWriter, r *http.Request) {
	session, ok := sessionFromRequest(r)

	switch r.Method {
	case http.MethodGet:
		type entry struct {
			Name  string `json:"name"`
			Color string `json:"color"`
		}
		out := []entry{}
		if ok {
			rows, err := db.Query(`
			SELECT CASE WHEN c.display_name != '' THEN c.display_name ELSE d.name END, c.color
			FROM user_drug_color_settings c
			JOIN drugs d ON d.id = c.drug_id
			WHERE c.user_id = ?
			ORDER BY c.id DESC`, session.UserId)
			if err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't load your colors.", http.StatusInternalServerError)
				return
			}
			defer rows.Close()
			for rows.Next() {
				var e entry
				if err := rows.Scan(&e.Name, &e.Color); err == nil && hexColor.MatchString(e.Color) {
					out = append(out, e)
				}
			}
		}
		writeJSON(w, out)

	case http.MethodPost:
		if !ok {
			notSignedIn(w, r)
			return
		}
		var in struct {
			Name  string `json:"name"`
			Color string `json:"color"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
			http.Error(w, "Couldn't read that.", http.StatusBadRequest)
			return
		}
		name := cleanText(in.Name, 80)
		if name == "" {
			http.Error(w, "Pick a substance.", http.StatusBadRequest)
			return
		}
		key := strings.ToLower(name)

		if in.Color == "" {
			_, err := db.Exec("DELETE FROM user_drug_color_settings WHERE user_id = ? AND drug_id = (SELECT id FROM drugs WHERE name = ?)", session.UserId, key)
			if err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't save that.", http.StatusInternalServerError)
				return
			}
			writeJSON(w, map[string]string{"name": name, "color": ""})
			return
		}
		if !hexColor.MatchString(in.Color) {
			http.Error(w, "Pick a color like #a67cff.", http.StatusBadRequest)
			return
		}
		color := strings.ToLower(in.Color)

		if _, err := db.Exec("INSERT OR IGNORE INTO drugs (name) VALUES (?)", key); err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't save that.", http.StatusInternalServerError)
			return
		}
		_, err := db.Exec(`INSERT INTO user_drug_color_settings (user_id, drug_id, color, display_name)
			VALUES (?, (SELECT id FROM drugs WHERE name = ?), ?, ?)
			ON CONFLICT(user_id, drug_id) DO UPDATE SET color = excluded.color, display_name = excluded.display_name`,
			session.UserId, key, color, name)
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't save that.", http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]string{"name": name, "color": color})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// One dose of a graph session, with the duration profile it was drawn
// with so the curve can be redrawn without asking PsychonautWiki again.
type experienceDose struct {
	Substance    string  `json:"substance"`
	Amount       float64 `json:"amount"`
	Unit         string  `json:"unit"`
	Formulation  string  `json:"formulation"`
	ReleaseHours float64 `json:"releaseHours"`
	Route        string  `json:"route"` // route of administration: oral, insufflated, ...
	Time         string  `json:"time"`
	Note         string  `json:"note,omitempty"` // how the dose felt, written on the Graph
	Profile      struct {
		Base struct {
			Onset  float64 `json:"onset"`
			Comeup float64 `json:"comeup"`
			Peak   float64 `json:"peak"`
			Offset float64 `json:"offset"`
			// Only custom substances (Substances Importer) have these.
			Comedown      float64     `json:"comedown,omitempty"`
			ComedownLevel float64     `json:"comedownLevel,omitempty"`
			Peak2         *secondPeak `json:"peak2,omitempty"`
		} `json:"base"`
		CommonDose float64 `json:"commonDose"`
	} `json:"profile"`
}

type experience struct {
	ID        int64            `json:"id"`
	StartedAt int64            `json:"startedAt"`
	UpdatedAt int64            `json:"updatedAt"`
	Doses     []experienceDose `json:"doses"`
	// Friends the owner added to the session, and (for a session shared
	// with you) whose session it is.
	People []postAuthor `json:"people"`
	Owner  *postAuthor  `json:"owner,omitempty"`
}

var clockTime = regexp.MustCompile(`^([01]?[0-9]|2[0-3]):[0-5][0-9]$`)

func inRange(v, min, max float64) bool {
	return !math.IsNaN(v) && v >= min && v <= max
}

// cleanExperienceDoses checks every field and drops what the graph could not draw.
func cleanExperienceDoses(in []experienceDose) ([]experienceDose, bool) {
	if len(in) == 0 || len(in) > maxExperienceDoses {
		return nil, false
	}
	out := make([]experienceDose, 0, len(in))
	for _, d := range in {
		d.Substance = cleanText(d.Substance, 80)
		d.Unit = cleanText(d.Unit, 12)
		d.Formulation = cleanText(d.Formulation, 40)
		d.Route = cleanText(d.Route, 30)
		d.Note = cleanMultiline(d.Note, 2000)
		b := d.Profile.Base
		if d.Substance == "" || !clockTime.MatchString(d.Time) ||
			!inRange(d.Amount, 0.000001, 1e6) || !inRange(d.ReleaseHours, 0, 48) ||
			!inRange(d.Profile.CommonDose, 0.000001, 1e6) ||
			!inRange(b.Onset, 0, 240) || !inRange(b.Comeup, 0, 240) || !inRange(b.Peak, 0, 240) || !inRange(b.Offset, 0, 240) ||
			!inRange(b.Comedown, 0, 240) || !inRange(b.ComedownLevel, 0, 1) || (b.Peak2 != nil && !b.Peak2.valid()) {
			return nil, false
		}
		out = append(out, d)
	}
	return out, true
}

// experiences: GET lists the account's graph sessions, newest first, as
// {signedIn, items}. POST {id, startedAt, doses} saves one (id 0 = new) and
// POST {id, delete: true} removes one.
func experiences(w http.ResponseWriter, r *http.Request) {
	session, ok := sessionFromRequest(r)

	switch r.Method {
	case http.MethodGet:
		items := []experience{}
		if ok {
			rows, err := db.Query(`SELECT id, started_at, updated_at, doses FROM graph_experiences
				WHERE user_id = ? ORDER BY started_at DESC, id DESC LIMIT ?`, session.UserId, maxExperiences)
			if err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't load your experiences.", http.StatusInternalServerError)
				return
			}
			defer rows.Close()
			for rows.Next() {
				var e experience
				var doses string
				if err := rows.Scan(&e.ID, &e.StartedAt, &e.UpdatedAt, &doses); err != nil {
					continue
				}
				if json.Unmarshal([]byte(doses), &e.Doses) == nil && len(e.Doses) > 0 {
					items = append(items, e)
				}
			}
			rows.Close()
		}
		shared := []experience{}
		if ok {
			people := sessionPeople("SELECT id FROM graph_experiences WHERE user_id = ?", session.UserId)
			for i := range items {
				items[i].People = orNobody(people[items[i].ID])
			}
			shared = sharedExperiences(session.UserId)
		}
		writeJSON(w, map[string]any{"signedIn": ok, "items": items, "shared": shared})

	case http.MethodPost:
		if !ok {
			notSignedIn(w, r)
			return
		}
		var in struct {
			experience
			Delete bool `json:"delete"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512<<10)).Decode(&in); err != nil {
			http.Error(w, "Couldn't read that session.", http.StatusBadRequest)
			return
		}

		if in.Delete {
			res, err := db.Exec("DELETE FROM graph_experiences WHERE id = ? AND user_id = ?", in.ID, session.UserId)
			if err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't delete that.", http.StatusInternalServerError)
				return
			}
			if n, _ := res.RowsAffected(); n > 0 {
				db.Exec("DELETE FROM experience_people WHERE experience_id = ?", in.ID)
			}
			writeJSON(w, map[string]any{"id": in.ID, "deleted": true})
			return
		}

		doses, valid := cleanExperienceDoses(in.Doses)
		if !valid {
			http.Error(w, "That session has a dose the graph can't draw.", http.StatusBadRequest)
			return
		}
		body, _ := json.Marshal(doses)
		now := time.Now().UnixMilli()
		started := in.StartedAt
		if started <= 0 || started > now+86400000 {
			started = now
		}

		saved := false
		if in.ID > 0 {
			res, err := db.Exec("UPDATE graph_experiences SET doses = ?, updated_at = ? WHERE id = ? AND user_id = ?",
				string(body), now, in.ID, session.UserId)
			if err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't save that session.", http.StatusInternalServerError)
				return
			}
			n, _ := res.RowsAffected()
			saved = n > 0
		}
		if !saved {
			// New, or deleted on another device meanwhile: store it as a new one.
			res, err := db.Exec("INSERT INTO graph_experiences (user_id, started_at, updated_at, doses) VALUES (?, ?, ?, ?)",
				session.UserId, started, now, string(body))
			if err == nil {
				db.Exec("UPDATE users SET graphsMade = graphsMade + 1 WHERE id = ?", session.UserId)
			}
			staleRanks()
			if err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't save that session.", http.StatusInternalServerError)
				return
			}
			in.ID, _ = res.LastInsertId()
			db.Exec(`DELETE FROM graph_experiences WHERE user_id = ? AND id NOT IN
				(SELECT id FROM graph_experiences WHERE user_id = ? ORDER BY started_at DESC, id DESC LIMIT ?)`,
				session.UserId, session.UserId, maxExperiences)
			db.Exec("DELETE FROM experience_people WHERE experience_id NOT IN (SELECT id FROM graph_experiences)")
		} else {
			db.QueryRow("SELECT started_at FROM graph_experiences WHERE id = ?", in.ID).Scan(&started)
		}
		people := orNobody(sessionPeople("SELECT ?", in.ID)[in.ID])
		writeJSON(w, experience{ID: in.ID, StartedAt: started, UpdatedAt: now, Doses: doses, People: people})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// profileBox is one box from the + menu on the Profile page. Kind "pictures"
// holds up to 4 pictures, "experience" shows one saved Graph session and
// "note" a few lines of text. Everyone who opens the profile sees them.
type profileBox struct {
	ID         int64       `json:"id"`
	Kind       string      `json:"kind"`
	Pictures   []string    `json:"pictures"`
	Note       string      `json:"note"`
	Experience *experience `json:"experience"`
}

// shown reports whether a box has anything for other people to see.
func (b profileBox) shown() bool {
	switch b.Kind {
	case "note":
		return b.Note != ""
	case "experience":
		return b.Experience != nil
	default:
		return len(b.Pictures) > 0
	}
}

// loadExperience returns one of the account's saved Graph sessions, or nil
// when it was deleted.
func loadExperience(id int64, uid int) *experience {
	e := experience{ID: id}
	var doses string
	if err := db.QueryRow("SELECT started_at, updated_at, doses FROM graph_experiences WHERE id = ? AND user_id = ?", id, uid).Scan(&e.StartedAt, &e.UpdatedAt, &doses); err != nil {
		return nil
	}
	if json.Unmarshal([]byte(doses), &e.Doses) != nil || len(e.Doses) == 0 {
		return nil
	}
	e.People = orNobody(sessionPeople("SELECT ?", id)[id])
	return &e
}

// makeProfileBox turns a profile_boxes row into a box. It looks up the Graph
// session of an experience box, so call it after the rows are closed.
func makeProfileBox(id int64, kind, pictures, data string, owner int) profileBox {
	b := profileBox{ID: id, Kind: kind, Pictures: []string{}}
	switch kind {
	case "note":
		b.Note = data
	case "experience":
		if expID, err := strconv.ParseInt(data, 10, 64); err == nil {
			b.Experience = loadExperience(expID, owner)
		}
	default:
		b.Kind = "pictures"
		if json.Unmarshal([]byte(pictures), &b.Pictures) != nil || b.Pictures == nil {
			b.Pictures = []string{}
		}
	}
	return b
}

func loadPictureBox(id int64, uid int) (profileBox, bool) {
	var kind, pictures, data string
	if err := db.QueryRow("SELECT kind, pictures, data FROM profile_boxes WHERE id = ? AND user_id = ?", id, uid).Scan(&kind, &pictures, &data); err != nil {
		return profileBox{}, false
	}
	return makeProfileBox(id, kind, pictures, data, uid), true
}

func savePictureBox(b profileBox, uid int) error {
	raw, _ := json.Marshal(b.Pictures)
	_, err := db.Exec("UPDATE profile_boxes SET pictures = ? WHERE id = ? AND user_id = ?", string(raw), b.ID, uid)
	return err
}

// profileBoxes: GET lists the account's boxes, or with ?user=<name> the boxes
// that account shows other people. POST JSON {action: "create", kind,
// experience, note}, {action: "note", id, note}, {action: "delete", id} or
// {action: "remove", id, url}; a multipart POST with id and image adds a
// picture to a picture box (4 per box).
func profileBoxes(w http.ResponseWriter, r *http.Request) {
	session, _ := sessionFromRequest(r)
	uid := session.UserId

	switch r.Method {
	case http.MethodGet:
		// ?user=<name> is the public view (also when it's the account's own name).
		owner := uid
		name := r.URL.Query().Get("user")
		if name != "" {
			id, ok := userByName(name)
			if !ok {
				http.Error(w, "No account has that name.", http.StatusNotFound)
				return
			}
			owner = id
		}
		type row struct {
			id                   int64
			kind, pictures, data string
		}
		rows, err := db.Query("SELECT id, kind, pictures, data FROM profile_boxes WHERE user_id = ? ORDER BY id", owner)
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't load the boxes.", http.StatusInternalServerError)
			return
		}
		var found []row
		for rows.Next() {
			var x row
			if err := rows.Scan(&x.id, &x.kind, &x.pictures, &x.data); err == nil {
				found = append(found, x)
			}
		}
		rows.Close()
		var layout string
		db.QueryRow("SELECT profileLayout FROM users WHERE id = ?", owner).Scan(&layout)
		place := map[string]int{}
		for i, key := range profileLayout(layout) {
			place[key] = i
		}
		sort.SliceStable(found, func(a, b int) bool {
			pa, okA := place["b"+strconv.FormatInt(found[a].id, 10)]
			pb, okB := place["b"+strconv.FormatInt(found[b].id, 10)]
			if okA != okB {
				return okA
			}
			return okA && pa < pb
		})
		out := []profileBox{}
		for _, x := range found {
			b := makeProfileBox(x.id, x.kind, x.pictures, x.data, owner)
			if name != "" && !b.shown() {
				continue
			}
			out = append(out, b)
		}
		writeJSON(w, out)

	case http.MethodPost:
		if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
			r.Body = http.MaxBytesReader(w, r.Body, maxPictureBytes+(64<<10))
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				http.Error(w, fmt.Sprintf("That picture is too big. Pick one under %d MB.", maxPictureMB), http.StatusRequestEntityTooLarge)
				return
			}
			defer r.MultipartForm.RemoveAll()
			id, _ := strconv.ParseInt(r.FormValue("id"), 10, 64)
			box, ok := loadPictureBox(id, uid)
			if !ok || box.Kind != "pictures" {
				http.Error(w, "That box was removed. Reload the page.", http.StatusNotFound)
				return
			}
			if len(box.Pictures) >= picturesPerBox {
				http.Error(w, "This box already has 4 pictures.", http.StatusBadRequest)
				return
			}
			file, _, err := r.FormFile("image")
			if err != nil {
				http.Error(w, "Pick a picture first.", http.StatusBadRequest)
				return
			}
			defer file.Close()
			link, status, msg := saveProfileImage(file, uid, "box")
			if status != 0 {
				http.Error(w, msg, status)
				return
			}
			box.Pictures = append(box.Pictures, link)
			if err := savePictureBox(box, uid); err != nil {
				fmt.Println(err)
				removeOwnPicture(link, uid)
				http.Error(w, "Couldn't save the picture.", http.StatusInternalServerError)
				return
			}
			writeJSON(w, box)
			return
		}

		var in struct {
			Action     string   `json:"action"`
			ID         int64    `json:"id"`
			URL        string   `json:"url"`
			Kind       string   `json:"kind"`
			Note       string   `json:"note"`
			Experience int64    `json:"experience"`
			Order      []string `json:"order"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in); err != nil {
			http.Error(w, "Couldn't read that.", http.StatusBadRequest)
			return
		}
		switch in.Action {
		case "order":
			// The Profile cards in the order the owner dragged them into:
			// "intake", "totals" and "b<box id>" for their own boxes.
			own := map[string]bool{"intake": true, "totals": true}
			rows, err := db.Query("SELECT id FROM profile_boxes WHERE user_id = ?", uid)
			if err == nil {
				for rows.Next() {
					var id int64
					if rows.Scan(&id) == nil {
						own["b"+strconv.FormatInt(id, 10)] = true
					}
				}
				rows.Close()
			}
			keys := []string{}
			for _, key := range in.Order {
				if own[key] {
					keys = append(keys, key)
					delete(own, key)
				}
			}
			if _, err := db.Exec("UPDATE users SET profileLayout = ? WHERE id = ?", strings.Join(keys, ","), uid); err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't save the order.", http.StatusInternalServerError)
				return
			}
			writeJSON(w, map[string][]string{"order": keys})
			return
		case "create":
			var n int
			db.QueryRow("SELECT COUNT(*) FROM profile_boxes WHERE user_id = ?", uid).Scan(&n)
			if n >= maxPictureBoxes {
				http.Error(w, "You can have up to 12 boxes.", http.StatusBadRequest)
				return
			}
			kind, data := in.Kind, ""
			switch kind {
			case "", "pictures":
				kind = "pictures"
			case "note":
				data = cleanMultiline(in.Note, maxNoteChars)
			case "experience":
				if loadExperience(in.Experience, uid) == nil {
					http.Error(w, "That Graph session was deleted. Pick another one.", http.StatusNotFound)
					return
				}
				data = strconv.FormatInt(in.Experience, 10)
			default:
				http.Error(w, "Unknown kind of box.", http.StatusBadRequest)
				return
			}
			res, err := db.Exec("INSERT INTO profile_boxes (user_id, pictures, created_at, kind, data) VALUES (?, '[]', ?, ?, ?)", uid, time.Now().UnixMilli(), kind, data)
			if err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't add a box.", http.StatusInternalServerError)
				return
			}
			id, _ := res.LastInsertId()
			box, _ := loadPictureBox(id, uid)
			writeJSON(w, box)

		case "note":
			box, ok := loadPictureBox(in.ID, uid)
			if !ok || box.Kind != "note" {
				http.Error(w, "That box was removed. Reload the page.", http.StatusNotFound)
				return
			}
			box.Note = cleanMultiline(in.Note, maxNoteChars)
			if _, err := db.Exec("UPDATE profile_boxes SET data = ? WHERE id = ? AND user_id = ?", box.Note, in.ID, uid); err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't save the note.", http.StatusInternalServerError)
				return
			}
			writeJSON(w, box)

		case "delete":
			box, ok := loadPictureBox(in.ID, uid)
			if ok {
				if _, err := db.Exec("DELETE FROM profile_boxes WHERE id = ? AND user_id = ?", in.ID, uid); err != nil {
					fmt.Println(err)
					http.Error(w, "Couldn't remove that box.", http.StatusInternalServerError)
					return
				}
				for _, p := range box.Pictures {
					removeOwnPicture(p, uid)
				}
			}
			writeJSON(w, map[string]any{"id": in.ID, "deleted": true})

		case "remove":
			box, ok := loadPictureBox(in.ID, uid)
			if !ok || box.Kind != "pictures" {
				http.Error(w, "That box was removed. Reload the page.", http.StatusNotFound)
				return
			}
			kept := []string{}
			found := false
			for _, p := range box.Pictures {
				if p == in.URL && !found {
					found = true
					continue
				}
				kept = append(kept, p)
			}
			if found {
				box.Pictures = kept
				if err := savePictureBox(box, uid); err != nil {
					fmt.Println(err)
					http.Error(w, "Couldn't remove that picture.", http.StatusInternalServerError)
					return
				}
				removeOwnPicture(in.URL, uid)
			}
			writeJSON(w, box)

		default:
			http.Error(w, "Unknown action.", http.StatusBadRequest)
		}

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// publicProfile serves /u/<name>: what an account shows other members (its
// pictures, boxes, liked substances and Forum posts). The dose calendar,
// recent intake and totals stay on the owner's own Profile page.
func publicProfile(w http.ResponseWriter, r *http.Request) {
	session, _ := sessionFromRequest(r)
	name := strings.Trim(strings.TrimPrefix(r.URL.Path, "/u/"), "/")

	d := struct {
		Found      bool
		Name       string
		Initial    string
		Avatar     string
		Banner     string
		Background string
		Clear      int
		ClearAlpha clearAlpha
		NameColor  string
		Admin      bool
		Rank       geekRank
		IsSelf     bool
		Posts      int
		Friend     string
		Liked      []likedSubstance
	}{Name: name}

	var id int
	var avatar, banner, background, authority string
	err := db.QueryRow("SELECT id, originalUsername, pathToProfilePic, pathToBanner, pathToBackground, widgetClear, authority FROM users WHERE username = ?", strings.ToLower(name)).Scan(&id, &d.Name, &avatar, &banner, &background, &d.Clear, &authority)
	d.ClearAlpha = makeClearAlpha(d.Clear)
	if err == nil {
		d.Found = true
		d.Initial = initialOf(d.Name)
		d.Avatar = existingPicture(avatar)
		d.Banner = existingPicture(banner)
		d.Background = existingPicture(background)
		d.Admin = authority == "admin"
		d.NameColor = adminNameColor(d.Name, authority)
		d.Rank = rankOf(d.Name)
		d.IsSelf = id == session.UserId
		d.Friend = friendState(session.UserId, id)
		db.QueryRow("SELECT COUNT(*) FROM forum_posts WHERE user_id = ?", id).Scan(&d.Posts)
		if d.Liked, err = likedSubstances(id); err != nil {
			fmt.Println(err)
		}
	}

	tpl, err := template.ParseFiles("html/user.html")
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	if !d.Found {
		w.WriteHeader(http.StatusNotFound)
	}
	if err := tpl.Execute(w, d); err != nil {
		fmt.Println(err)
	}
}

// Forum serves the Forum page; the posts come from /forum/posts.
func Forum(w http.ResponseWriter, r *http.Request) {
	session, _ := sessionFromRequest(r)
	var avatar string
	db.QueryRow("SELECT pathToProfilePic FROM users WHERE id = ?", session.UserId).Scan(&avatar)
	d := struct {
		Name    string
		Initial string
		Avatar  string
	}{session.OriginalUsername, initialOf(session.OriginalUsername), existingPicture(avatar)}

	tpl, err := template.ParseFiles("html/forum.html")
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	if err := tpl.Execute(w, d); err != nil {
		fmt.Println(err)
	}
}

type postAuthor struct {
	Name    string `json:"name"`
	Initial string `json:"initial"`
	Avatar  string `json:"avatar"`
	Admin   bool   `json:"admin"`
	Color   string `json:"color,omitempty"` // an admin's name color
	Rank    int    `json:"rank,omitempty"`  // geek rank tier, 1 to 5
	Level   int    `json:"level,omitempty"` // times the account reached Geek⁴
}

type forumPost struct {
	ID        int64      `json:"id"`
	Author    postAuthor `json:"author"`
	Body      string     `json:"body"`
	Pictures  []string   `json:"pictures"`
	CreatedAt int64      `json:"createdAt"`
	CanDelete bool       `json:"canDelete"`
	Comments  int        `json:"comments"`
}

// forumPosts: GET answers {posts, more} newest first, 20 at a time
// (?before=<id> for older ones, ?user=<name> for one account's posts).
// A multipart POST with body and up to 4 "image" files adds a post;
// POST JSON {action: "delete", id} removes one (its author or an admin).
func forumPosts(w http.ResponseWriter, r *http.Request) {
	session, _ := sessionFromRequest(r)
	uid := session.UserId
	isAdmin := session.Authority == "admin"

	switch r.Method {
	case http.MethodGet:
		q := r.URL.Query()
		before, _ := strconv.ParseInt(q.Get("before"), 10, 64)
		only, _ := strconv.ParseInt(q.Get("id"), 10, 64) // ?id= answers just that post (letter icon links)
		owner := 0
		if name := q.Get("user"); name != "" {
			id, ok := userByName(name)
			if !ok {
				http.Error(w, "No account has that name.", http.StatusNotFound)
				return
			}
			owner = id
		}
		rows, err := db.Query(`
		SELECT p.id, p.user_id, p.body, p.pictures, p.created_at, u.originalUsername, u.pathToProfilePic, u.authority,
			(SELECT COUNT(*) FROM forum_comments c WHERE c.post_id = p.id)
		FROM forum_posts p
		JOIN users u ON u.id = p.user_id
		WHERE (? = 0 OR p.id < ?) AND (? = 0 OR p.user_id = ?) AND (? = 0 OR p.id = ?)
		ORDER BY p.id DESC
		LIMIT ?`, before, before, owner, owner, only, only, postsPerPage+1)
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't load the posts.", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		avatars := map[int]string{}
		posts := []forumPost{}
		for rows.Next() {
			var p forumPost
			var author int
			var pictures, avatar, authority string
			if err := rows.Scan(&p.ID, &author, &p.Body, &pictures, &p.CreatedAt, &p.Author.Name, &avatar, &authority, &p.Comments); err != nil {
				continue
			}
			if _, seen := avatars[author]; !seen {
				avatars[author] = existingPicture(avatar)
			}
			p.Author.Avatar = avatars[author]
			p.Author.Initial = initialOf(p.Author.Name)
			p.Author.Admin = authority == "admin"
			p.Author.Color = adminNameColor(p.Author.Name, authority)
			p.Author.Rank, p.Author.Level = rankOf(p.Author.Name).Tier, rankOf(p.Author.Name).Level
			if json.Unmarshal([]byte(pictures), &p.Pictures) != nil || p.Pictures == nil {
				p.Pictures = []string{}
			}
			p.CanDelete = author == uid || isAdmin
			posts = append(posts, p)
		}
		more := len(posts) > postsPerPage
		if more {
			posts = posts[:postsPerPage]
		}
		writeJSON(w, map[string]any{"posts": posts, "more": more})

	case http.MethodPost:
		if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
			r.Body = http.MaxBytesReader(w, r.Body, picturesPerPost*maxPictureBytes+(64<<10))
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				http.Error(w, fmt.Sprintf("That post is too big. Each picture has to be under %d MB.", maxPictureMB), http.StatusRequestEntityTooLarge)
				return
			}
			defer r.MultipartForm.RemoveAll()
			body := cleanMultiline(r.FormValue("body"), maxPostChars)
			files := r.MultipartForm.File["image"]
			if len(files) > picturesPerPost {
				http.Error(w, "A post can have up to 4 pictures.", http.StatusBadRequest)
				return
			}
			if body == "" && len(files) == 0 {
				http.Error(w, "Write something or add a picture first.", http.StatusBadRequest)
				return
			}
			var recent int
			db.QueryRow("SELECT COUNT(*) FROM forum_posts WHERE user_id = ? AND created_at > ?", uid, time.Now().Add(-10*time.Minute).UnixMilli()).Scan(&recent)
			if recent >= postsPer10Minutes {
				http.Error(w, "You've posted a lot just now. Wait a few minutes and try again.", http.StatusTooManyRequests)
				return
			}

			saved := []string{}
			fail := func(status int, msg string) {
				for _, link := range saved {
					removeOwnPicture(link, uid)
				}
				http.Error(w, msg, status)
			}
			for _, header := range files {
				if header.Size > maxPictureBytes {
					fail(http.StatusRequestEntityTooLarge, fmt.Sprintf("Each picture has to be under %d MB.", maxPictureMB))
					return
				}
				file, err := header.Open()
				if err != nil {
					fail(http.StatusBadRequest, "Couldn't read one of the pictures.")
					return
				}
				link, status, msg := saveProfileImage(file, uid, "post")
				file.Close()
				if status != 0 {
					fail(status, msg)
					return
				}
				saved = append(saved, link)
			}
			raw, _ := json.Marshal(saved)
			now := time.Now().UnixMilli()
			res, err := db.Exec("INSERT INTO forum_posts (user_id, body, pictures, created_at) VALUES (?, ?, ?, ?)", uid, body, string(raw), now)
			if err == nil {
				db.Exec("UPDATE users SET postsMade = postsMade + 1 WHERE id = ?", uid)
			}
			staleRanks()
			if err != nil {
				fmt.Println(err)
				fail(http.StatusInternalServerError, "Couldn't save your post.")
				return
			}
			id, _ := res.LastInsertId()
			var avatar string
			db.QueryRow("SELECT pathToProfilePic FROM users WHERE id = ?", uid).Scan(&avatar)
			writeJSON(w, forumPost{
				ID:        id,
				Author:    postAuthor{Name: session.OriginalUsername, Initial: initialOf(session.OriginalUsername), Avatar: existingPicture(avatar), Admin: isAdmin, Color: adminNameColor(session.OriginalUsername, session.Authority), Rank: rankOf(session.OriginalUsername).Tier, Level: rankOf(session.OriginalUsername).Level},
				Body:      body,
				Pictures:  saved,
				CreatedAt: now,
				CanDelete: true,
			})
			return
		}

		var in struct {
			Action string `json:"action"`
			ID     int64  `json:"id"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil || in.Action != "delete" {
			http.Error(w, "Couldn't read that.", http.StatusBadRequest)
			return
		}
		var author int
		var pictures string
		err := db.QueryRow("SELECT user_id, pictures FROM forum_posts WHERE id = ?", in.ID).Scan(&author, &pictures)
		if err == sql.ErrNoRows {
			writeJSON(w, map[string]any{"id": in.ID, "deleted": true})
			return
		}
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't delete that post.", http.StatusInternalServerError)
			return
		}
		if author != uid && !isAdmin {
			http.Error(w, "You can only delete your own posts.", http.StatusForbidden)
			return
		}
		if _, err := db.Exec("DELETE FROM forum_posts WHERE id = ?", in.ID); err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't delete that post.", http.StatusInternalServerError)
			return
		}
		db.Exec("DELETE FROM forum_comments WHERE post_id = ?", in.ID)
		var links []string
		json.Unmarshal([]byte(pictures), &links)
		for _, link := range links {
			removeOwnPicture(link, author)
		}
		writeJSON(w, map[string]any{"id": in.ID, "deleted": true})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// forumMembers lists every account for the Forum's Members box, as
// [{name, initial, avatar, admin, posts}].
func forumMembers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rows, err := db.Query(`
	SELECT u.id, u.originalUsername, u.pathToProfilePic, u.authority,
		(SELECT COUNT(*) FROM forum_posts p WHERE p.user_id = u.id)
	FROM users u
	ORDER BY lower(u.originalUsername)
	LIMIT 500`)
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Couldn't load the members.", http.StatusInternalServerError)
		return
	}
	type member struct {
		postAuthor
		Posts  int    `json:"posts"`
		Friend string `json:"friend"`
		Self   bool   `json:"self"`
	}
	type found struct {
		member
		id int
	}
	var list []found
	for rows.Next() {
		var m found
		var avatar, authority string
		if err := rows.Scan(&m.id, &m.Name, &avatar, &authority, &m.Posts); err != nil {
			continue
		}
		m.Initial = initialOf(m.Name)
		m.Avatar = existingPicture(avatar)
		m.Admin = authority == "admin"
		m.Color = adminNameColor(m.Name, authority)
		m.Rank, m.Level = rankOf(m.Name).Tier, rankOf(m.Name).Level
		list = append(list, m)
	}
	rows.Close()
	session, _ := sessionFromRequest(r)
	states := friendStates(session.UserId)
	out := []member{}
	for _, m := range list {
		m.Friend = states[m.id]
		m.Self = m.id == session.UserId
		out = append(out, m.member)
	}
	writeJSON(w, out)
}

// person is how an account is shown next to posts, comments and friends.
func person(name, avatar, authority string) postAuthor {
	return postAuthor{Name: name, Initial: initialOf(name), Avatar: existingPicture(avatar), Admin: authority == "admin", Color: adminNameColor(name, authority), Rank: rankOf(name).Tier, Level: rankOf(name).Level}
}

// profileAppearance reads (GET) or saves (POST JSON) the account's site color
// and Profile card transparency. Fields left out of a POST stay as they are;
// an empty color goes back to the default violet.
func profileAppearance(w http.ResponseWriter, r *http.Request) {
	session, ok := sessionFromRequest(r)
	if !ok {
		http.Error(w, "Log in first.", http.StatusUnauthorized)
		return
	}
	uid := session.UserId
	if r.Method == http.MethodPost {
		var in struct {
			SiteColor   *string    `json:"siteColor"`
			WidgetClear *int       `json:"widgetClear"`
			NameColor   *string    `json:"nameColor"`
			SiteBg      *string    `json:"siteBg"`
			SiteBgDim   *int       `json:"siteBgDim"`
			PlotStyle   *plotStyle `json:"plotStyle"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in); err != nil {
			http.Error(w, "Bad request.", http.StatusBadRequest)
			return
		}
		if in.SiteColor != nil {
			color := strings.ToLower(strings.TrimSpace(*in.SiteColor))
			if color != "" && !hexColor.MatchString(color) {
				http.Error(w, "Pick a color like #a67cff.", http.StatusBadRequest)
				return
			}
			if _, err := db.Exec("UPDATE users SET siteColor = ? WHERE id = ?", color, uid); err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't save the color.", http.StatusInternalServerError)
				return
			}
		}
		if in.NameColor != nil {
			color := strings.ToLower(strings.TrimSpace(*in.NameColor))
			if session.Authority != "admin" {
				http.Error(w, "Only admins can color their name.", http.StatusForbidden)
				return
			}
			if color != "" && !hexColor.MatchString(color) {
				http.Error(w, "Pick a color like #a67cff.", http.StatusBadRequest)
				return
			}
			if _, err := db.Exec("UPDATE users SET nameColor = ? WHERE id = ?", color, uid); err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't save the name color.", http.StatusInternalServerError)
				return
			}
			loadNameColors()
		}
		if in.SiteBg != nil {
			scene := strings.TrimSpace(*in.SiteBg)
			if !siteScenes[scene] {
				http.Error(w, "Unknown background.", http.StatusBadRequest)
				return
			}
			if _, err := db.Exec("UPDATE users SET siteBg = ? WHERE id = ?", scene, uid); err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't save the background.", http.StatusInternalServerError)
				return
			}
		}
		if in.SiteBgDim != nil {
			if _, err := db.Exec("UPDATE users SET siteBgDim = ? WHERE id = ?", min(max(*in.SiteBgDim, 0), 90), uid); err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't save the background.", http.StatusInternalServerError)
				return
			}
		}
		if in.PlotStyle != nil {
			body, _ := json.Marshal(in.PlotStyle.clean())
			if _, err := db.Exec("UPDATE users SET plotStyle = ? WHERE id = ?", string(body), uid); err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't save the graph style.", http.StatusInternalServerError)
				return
			}
		}
		if in.WidgetClear != nil {
			clear := min(max(*in.WidgetClear, 0), 100)
			if _, err := db.Exec("UPDATE users SET widgetClear = ? WHERE id = ?", clear, uid); err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't save the transparency.", http.StatusInternalServerError)
				return
			}
		}
	} else if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed.", http.StatusMethodNotAllowed)
		return
	}
	var out struct {
		SiteColor   string     `json:"siteColor"`
		WidgetClear int        `json:"widgetClear"`
		NameColor   string     `json:"nameColor"`
		SiteBg      string     `json:"siteBg"`
		SiteBgImage string     `json:"siteBgImage"`
		SiteBgDim   int        `json:"siteBgDim"`
		PlotStyle   *plotStyle `json:"plotStyle"`
	}
	var storedPlot string
	db.QueryRow("SELECT siteColor, widgetClear, nameColor, siteBg, siteBgImage, siteBgDim, plotStyle FROM users WHERE id = ?", uid).Scan(&out.SiteColor, &out.WidgetClear, &out.NameColor, &out.SiteBg, &out.SiteBgImage, &out.SiteBgDim, &storedPlot)
	if storedPlot != "" {
		var ps plotStyle
		if json.Unmarshal([]byte(storedPlot), &ps) == nil {
			ps = ps.clean()
			out.PlotStyle = &ps
		}
	}
	out.SiteBgImage = existingPicture(out.SiteBgImage)
	writeJSON(w, out)
}

// plotStyle is how an account likes the Graph drawn (Profile > Preferences);
// js/plot.js has the same fields and defaults.
type plotStyle struct {
	Width    *int   `json:"width,omitempty"`
	Shape    string `json:"shape,omitempty"`
	Fill     *int   `json:"fill,omitempty"`
	Glow     *bool  `json:"glow,omitempty"`
	Grid     *bool  `json:"grid,omitempty"`
	YLabels  *bool  `json:"yLabels,omitempty"`
	TopHours *bool  `json:"topHours,omitempty"`
	Dots     *bool  `json:"dots,omitempty"`
	Now      *bool  `json:"now,omitempty"`
	Height   string `json:"height,omitempty"`
}

func (p plotStyle) clean() plotStyle {
	if p.Width != nil {
		v := min(max(*p.Width, 2), 12)
		p.Width = &v
	}
	if p.Fill != nil {
		v := min(max(*p.Fill, 0), 60)
		p.Fill = &v
	}
	if p.Shape != "smooth" && p.Shape != "sharp" {
		p.Shape = ""
	}
	if p.Height != "compact" && p.Height != "normal" && p.Height != "tall" {
		p.Height = ""
	}
	return p
}

// profileLayout splits the stored card order ("intake,totals,b12") into keys.
func profileLayout(stored string) []string {
	keys := []string{}
	for _, key := range strings.Split(stored, ",") {
		if key = strings.TrimSpace(key); key != "" {
			keys = append(keys, key)
		}
	}
	return keys
}

// orNobody makes a missing list an empty one, so the JSON says [] and not null.
func orNobody(people []postAuthor) []postAuthor {
	if people == nil {
		return []postAuthor{}
	}
	return people
}

// sessionPeople returns the friends added to each Graph session that the
// subquery idQuery (with one ? argument) lists, keyed by session id.
func sessionPeople(idQuery string, arg any) map[int64][]postAuthor {
	out := map[int64][]postAuthor{}
	rows, err := db.Query(`
	SELECT p.experience_id, u.originalUsername, u.pathToProfilePic, u.authority
	FROM experience_people p
	JOIN users u ON u.id = p.user_id
	WHERE p.experience_id IN (`+idQuery+`)
	ORDER BY p.added_at, lower(u.originalUsername)`, arg)
	if err != nil {
		fmt.Println(err)
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var name, avatar, authority string
		if err := rows.Scan(&id, &name, &avatar, &authority); err == nil {
			out[id] = append(out[id], person(name, avatar, authority))
		}
	}
	return out
}

// sharedExperiences lists the Graph sessions friends added this account to.
func sharedExperiences(uid int) []experience {
	out := []experience{}
	rows, err := db.Query(`
	SELECT e.id, e.started_at, e.updated_at, e.doses, u.originalUsername, u.pathToProfilePic, u.authority
	FROM experience_people p
	JOIN graph_experiences e ON e.id = p.experience_id
	JOIN users u ON u.id = e.user_id
	WHERE p.user_id = ?
	ORDER BY e.started_at DESC, e.id DESC
	LIMIT 100`, uid)
	if err != nil {
		fmt.Println(err)
		return out
	}
	for rows.Next() {
		var e experience
		var doses, name, avatar, authority string
		if err := rows.Scan(&e.ID, &e.StartedAt, &e.UpdatedAt, &doses, &name, &avatar, &authority); err != nil {
			continue
		}
		if json.Unmarshal([]byte(doses), &e.Doses) != nil || len(e.Doses) == 0 {
			continue
		}
		owner := person(name, avatar, authority)
		e.Owner = &owner
		out = append(out, e)
	}
	rows.Close()
	people := sessionPeople("SELECT experience_id FROM experience_people WHERE user_id = ?", uid)
	var me string
	db.QueryRow("SELECT originalUsername FROM users WHERE id = ?", uid).Scan(&me)
	for i := range out {
		// The others who were there; you know you were.
		out[i].People = []postAuthor{}
		for _, p := range people[out[i].ID] {
			if p.Name != me {
				out[i].People = append(out[i].People, p)
			}
		}
	}
	return out
}

// friendState says how other relates to me: "friends", "outgoing" (I asked),
// "incoming" (they asked) or "".
func friendState(me, other int) string {
	var from int
	var status string
	err := db.QueryRow(`SELECT requester_id, status FROM friendships
		WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
		ORDER BY status = 'accepted' DESC LIMIT 1`, me, other, other, me).Scan(&from, &status)
	switch {
	case err != nil:
		return ""
	case status == "accepted":
		return "friends"
	case from == me:
		return "outgoing"
	default:
		return "incoming"
	}
}

// friendStates is friendState for every account me has a friendship with.
func friendStates(me int) map[int]string {
	out := map[int]string{}
	rows, err := db.Query("SELECT requester_id, addressee_id, status FROM friendships WHERE requester_id = ? OR addressee_id = ?", me, me)
	if err != nil {
		fmt.Println(err)
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var from, to int
		var status string
		if rows.Scan(&from, &to, &status) != nil {
			continue
		}
		other := to
		if to == me {
			other = from
		}
		switch {
		case status == "accepted":
			out[other] = "friends"
		case out[other] == "friends":
		case from == me:
			out[other] = "outgoing"
		default:
			out[other] = "incoming"
		}
	}
	return out
}

// friends: GET answers {friends, incoming, outgoing}. POST {action, user},
// action being request, accept, decline, cancel or remove, answers {state}.
func friends(w http.ResponseWriter, r *http.Request) {
	session, _ := sessionFromRequest(r)
	me := session.UserId

	switch r.Method {
	case http.MethodGet:
		out := map[string][]postAuthor{"friends": {}, "incoming": {}, "outgoing": {}}
		rows, err := db.Query(`
		SELECT f.requester_id, f.status, u.originalUsername, u.pathToProfilePic, u.authority
		FROM friendships f
		JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
		WHERE f.requester_id = ? OR f.addressee_id = ?
		ORDER BY lower(u.originalUsername)`, me, me, me)
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't load your friends.", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		for rows.Next() {
			var from int
			var status, name, avatar, authority string
			if rows.Scan(&from, &status, &name, &avatar, &authority) != nil {
				continue
			}
			key := "friends"
			if status != "accepted" {
				key = "incoming"
				if from == me {
					key = "outgoing"
				}
			}
			out[key] = append(out[key], person(name, avatar, authority))
		}
		writeJSON(w, out)

	case http.MethodPost:
		var in struct {
			Action string `json:"action"`
			User   string `json:"user"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
			http.Error(w, "Couldn't read that.", http.StatusBadRequest)
			return
		}
		other, ok := userByName(in.User)
		if !ok {
			http.Error(w, "No account has that name.", http.StatusNotFound)
			return
		}
		if other == me {
			http.Error(w, "That's your own account.", http.StatusBadRequest)
			return
		}
		state := friendState(me, other)
		var err error
		switch in.Action {
		case "request":
			switch state {
			case "incoming":
				// They already asked, so asking back makes you friends.
				_, err = db.Exec("UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?", other, me)
				state = "friends"
			case "":
				var waiting int
				db.QueryRow("SELECT COUNT(*) FROM friendships WHERE requester_id = ? AND status = 'pending'", me).Scan(&waiting)
				if waiting >= 100 {
					http.Error(w, "You have 100 friend requests waiting. Cancel some first.", http.StatusBadRequest)
					return
				}
				_, err = db.Exec("INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)", me, other, time.Now().UnixMilli())
				state = "outgoing"
			}
		case "accept":
			if state != "incoming" && state != "friends" {
				http.Error(w, "That friend request was cancelled.", http.StatusConflict)
				return
			}
			_, err = db.Exec("UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?", other, me)
			state = "friends"
		case "decline":
			if state == "incoming" {
				_, err = db.Exec("DELETE FROM friendships WHERE requester_id = ? AND addressee_id = ?", other, me)
				state = ""
			}
		case "cancel":
			if state == "outgoing" {
				_, err = db.Exec("DELETE FROM friendships WHERE requester_id = ? AND addressee_id = ?", me, other)
				state = ""
			}
		case "remove":
			if state == "friends" {
				_, err = db.Exec("DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)", me, other, other, me)
				// They also leave each other's Graph sessions.
				db.Exec(`DELETE FROM experience_people WHERE
					(user_id = ? AND experience_id IN (SELECT id FROM graph_experiences WHERE user_id = ?)) OR
					(user_id = ? AND experience_id IN (SELECT id FROM graph_experiences WHERE user_id = ?))`, other, me, me, other)
				state = ""
			}
		default:
			http.Error(w, "Unknown action.", http.StatusBadRequest)
			return
		}
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't change that. Try again.", http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]string{"state": state})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// experiencePeople: POST {id, people: [names]} sets which friends were part
// of one of your Graph sessions, and answers {id, people}. Those friends see
// the session under "Shared with you" on their Graph page.
func experiencePeople(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	session, _ := sessionFromRequest(r)
	me := session.UserId
	var in struct {
		ID     int64    `json:"id"`
		People []string `json:"people"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in); err != nil {
		http.Error(w, "Couldn't read that.", http.StatusBadRequest)
		return
	}
	var owner int
	if err := db.QueryRow("SELECT user_id FROM graph_experiences WHERE id = ?", in.ID).Scan(&owner); err != nil || owner != me {
		http.Error(w, "That session was deleted. Reload the page.", http.StatusNotFound)
		return
	}
	if len(in.People) > maxExperiencePeople {
		http.Error(w, "A session can have up to 20 people.", http.StatusBadRequest)
		return
	}
	var ids []int
	seen := map[int]bool{}
	for _, name := range in.People {
		id, ok := userByName(name)
		if !ok || id == me || seen[id] {
			continue
		}
		if friendState(me, id) != "friends" {
			http.Error(w, "You can only add friends, and "+cleanText(name, 40)+" isn't one.", http.StatusForbidden)
			return
		}
		seen[id] = true
		ids = append(ids, id)
	}

	tx, err := db.Begin()
	if err == nil {
		_, err = tx.Exec("DELETE FROM experience_people WHERE experience_id = ?", in.ID)
		now := time.Now().UnixMilli()
		for i, id := range ids {
			if err != nil {
				break
			}
			_, err = tx.Exec("INSERT INTO experience_people (experience_id, user_id, added_at) VALUES (?, ?, ?)", in.ID, id, now+int64(i))
		}
		if err == nil {
			err = tx.Commit()
		} else {
			tx.Rollback()
		}
	}
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Couldn't save who was there. Try again.", http.StatusInternalServerError)
		return
	}
	people := orNobody(sessionPeople("SELECT ?", in.ID)[in.ID])
	if people == nil {
		people = []postAuthor{}
	}
	writeJSON(w, map[string]any{"id": in.ID, "people": people})
}

type forumComment struct {
	ID        int64      `json:"id"`
	Author    postAuthor `json:"author"`
	Body      string     `json:"body"`
	CreatedAt int64      `json:"createdAt"`
	CanDelete bool       `json:"canDelete"`
}

// forumComments: GET ?post=<id> lists a post's comments, oldest first.
// POST JSON {action: "add", post, body} adds one and {action: "delete", id}
// removes one (its author, the post's author or an admin).
func forumComments(w http.ResponseWriter, r *http.Request) {
	session, _ := sessionFromRequest(r)
	me := session.UserId
	isAdmin := session.Authority == "admin"

	switch r.Method {
	case http.MethodGet:
		postID, _ := strconv.ParseInt(r.URL.Query().Get("post"), 10, 64)
		var postAuthorID int
		if err := db.QueryRow("SELECT user_id FROM forum_posts WHERE id = ?", postID).Scan(&postAuthorID); err != nil {
			http.Error(w, "That post was deleted.", http.StatusNotFound)
			return
		}
		rows, err := db.Query(`
		SELECT c.id, c.user_id, c.body, c.created_at, u.originalUsername, u.pathToProfilePic, u.authority
		FROM forum_comments c
		JOIN users u ON u.id = c.user_id
		WHERE c.post_id = ?
		ORDER BY c.id
		LIMIT 500`, postID)
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't load the comments.", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		out := []forumComment{}
		for rows.Next() {
			var c forumComment
			var author int
			var name, avatar, authority string
			if rows.Scan(&c.ID, &author, &c.Body, &c.CreatedAt, &name, &avatar, &authority) != nil {
				continue
			}
			c.Author = person(name, avatar, authority)
			c.CanDelete = author == me || postAuthorID == me || isAdmin
			out = append(out, c)
		}
		writeJSON(w, out)

	case http.MethodPost:
		var in struct {
			Action string `json:"action"`
			Post   int64  `json:"post"`
			ID     int64  `json:"id"`
			Body   string `json:"body"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in); err != nil {
			http.Error(w, "Couldn't read that.", http.StatusBadRequest)
			return
		}
		switch in.Action {
		case "add":
			body := cleanMultiline(in.Body, maxCommentChars)
			if body == "" {
				http.Error(w, "Write something first.", http.StatusBadRequest)
				return
			}
			var postAuthorID int
			if err := db.QueryRow("SELECT user_id FROM forum_posts WHERE id = ?", in.Post).Scan(&postAuthorID); err != nil {
				http.Error(w, "That post was deleted.", http.StatusNotFound)
				return
			}
			var recent int
			db.QueryRow("SELECT COUNT(*) FROM forum_comments WHERE user_id = ? AND created_at > ?", me, time.Now().Add(-10*time.Minute).UnixMilli()).Scan(&recent)
			if recent >= commentsPer10Minutes {
				http.Error(w, "You've commented a lot just now. Wait a few minutes and try again.", http.StatusTooManyRequests)
				return
			}
			now := time.Now().UnixMilli()
			res, err := db.Exec("INSERT INTO forum_comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)", in.Post, me, body, now)
			if err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't save your comment.", http.StatusInternalServerError)
				return
			}
			id, _ := res.LastInsertId()
			var avatar, authority string
			db.QueryRow("SELECT pathToProfilePic, authority FROM users WHERE id = ?", me).Scan(&avatar, &authority)
			writeJSON(w, forumComment{ID: id, Author: person(session.OriginalUsername, avatar, authority), Body: body, CreatedAt: now, CanDelete: true})

		case "delete":
			var author, postAuthorID int
			err := db.QueryRow("SELECT c.user_id, p.user_id FROM forum_comments c JOIN forum_posts p ON p.id = c.post_id WHERE c.id = ?", in.ID).Scan(&author, &postAuthorID)
			if err == sql.ErrNoRows {
				writeJSON(w, map[string]any{"id": in.ID, "deleted": true})
				return
			}
			if err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't delete that comment.", http.StatusInternalServerError)
				return
			}
			if author != me && postAuthorID != me && !isAdmin {
				http.Error(w, "You can only delete your own comments.", http.StatusForbidden)
				return
			}
			if _, err := db.Exec("DELETE FROM forum_comments WHERE id = ?", in.ID); err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't delete that comment.", http.StatusInternalServerError)
				return
			}
			writeJSON(w, map[string]any{"id": in.ID, "deleted": true})

		default:
			http.Error(w, "Unknown action.", http.StatusBadRequest)
		}

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// ---- Files access for members (picked on the admin page) ----

// filesGrant is what an account may do in Files. Admins can do everything;
// a member listed in file_access can open the folders picked for them (and
// everything inside), and with CanEdit upload, rename and delete in there.
type filesGrant struct {
	All     bool     `json:"all"`
	Folders []string `json:"folders"`
	CanEdit bool     `json:"canEdit"`
}

// filesGrantFor answers the account's grant, and false when it has no access at all.
func filesGrantFor(s cookiesStruct) (filesGrant, bool) {
	if s.Authority == "admin" {
		return filesGrant{All: true, CanEdit: true}, true
	}
	if s.UserId == 0 {
		return filesGrant{}, false
	}
	var all, edit int
	var folders string
	if err := db.QueryRow("SELECT all_folders, folders, can_edit FROM file_access WHERE user_id = ?", s.UserId).Scan(&all, &folders, &edit); err != nil {
		return filesGrant{}, false
	}
	g := filesGrant{All: all == 1, CanEdit: edit == 1}
	json.Unmarshal([]byte(folders), &g.Folders)
	return g, true
}

func filesGrantOf(r *http.Request) filesGrant {
	session, _ := sessionFromRequest(r)
	g, _ := filesGrantFor(session)
	return g
}

// uploadRel is a path inside UploadedFiles as "a/b" ("" for the folder itself).
func uploadRel(p string) string {
	rel, err := filepath.Rel(UploadedFilesDirName, p)
	if err != nil || rel == "." {
		return ""
	}
	return filepath.ToSlash(rel)
}

func joinRel(dir, name string) string {
	if dir == "" {
		return name
	}
	return dir + "/" + name
}

// allows: rel is one of the granted folders or inside one.
func (g filesGrant) allows(rel string) bool {
	if g.All {
		return true
	}
	for _, f := range g.Folders {
		if rel == f || strings.HasPrefix(rel, f+"/") {
			return true
		}
	}
	return false
}

// canSee: rel can be listed, either because it is allowed or because a
// granted folder is somewhere below it (so the member can walk down to it).
func (g filesGrant) canSee(rel string) bool {
	if g.allows(rel) {
		return true
	}
	for _, f := range g.Folders {
		if rel == "" || strings.HasPrefix(f, rel+"/") {
			return true
		}
	}
	return false
}

// canChangeIn: new files and folders may go into the folder rel.
func (g filesGrant) canChangeIn(rel string) bool {
	return g.CanEdit && g.allows(rel)
}

// canChange: the item rel may be renamed or deleted (never a granted folder itself).
func (g filesGrant) canChange(rel string) bool {
	if !g.CanEdit || rel == "" {
		return false
	}
	if g.All {
		return true
	}
	for _, f := range g.Folders {
		if strings.HasPrefix(rel, f+"/") {
			return true
		}
	}
	return false
}

// visible drops the items the member may not see. dir is the listed folder,
// or "" when the items carry their own full /Files/ links (search results).
func (g filesGrant) visible(items []FileFolderInfo, dir string) []FileFolderInfo {
	if g.All {
		return items
	}
	out := []FileFolderInfo{}
	for _, it := range items {
		rel := joinRel(dir, it.Name)
		if dir == "" {
			if p, ok := uploadPathFromURL(it.Path); ok {
				rel = uploadRel(p)
			}
		}
		if it.IsDir && g.canSee(rel) || !it.IsDir && g.allows(rel) {
			out = append(out, it)
		}
	}
	return out
}

// requireFilesLogin lets in admins and the members an admin gave Files access.
func requireFilesLogin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		d, ok := sessionFromRequest(r)
		if !ok {
			notSignedIn(w, r)
			return
		}
		if r.Method == http.MethodGet {
			setRoleHint(w, r, d, true)
		}
		if _, ok := filesGrantFor(d); !ok {
			fmt.Printf("[%s] DENY IP=%s USER=%s PATH=%s REASON=no_files_access\n", time.Now().Format("2006-01-02 15:04:05"), clientIP(r), d.OriginalUsername, r.URL.Path)
			if r.Method == http.MethodGet {
				http.Redirect(w, r, "/Main?need=files", http.StatusSeeOther)
			} else {
				http.Error(w, "You don't have access to Files.", http.StatusForbidden)
			}
			return
		}
		next(w, r)
	}
}

// uploadFolders lists the folders in UploadedFiles (three levels deep, at most 400).
func uploadFolders() []string {
	out := []string{}
	var walk func(dir, rel string, depth int)
	walk = func(dir, rel string, depth int) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			if !e.IsDir() || len(out) >= 400 {
				continue
			}
			r := joinRel(rel, e.Name())
			out = append(out, r)
			if depth < 3 {
				walk(filepath.Join(dir, e.Name()), r, depth+1)
			}
		}
	}
	walk(UploadedFilesDirName, "", 1)
	sort.Strings(out)
	return out
}

// adminFilesAccess: GET lists the accounts with their Files access and the
// folders to pick from; POST {user, access} sets one account's access
// (access null takes it away).
func adminFilesAccess(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		type row struct {
			ID     int         `json:"id"`
			Name   string      `json:"name"`
			Admin  bool        `json:"admin"`
			Access *filesGrant `json:"access"`
		}
		rows, err := db.Query("SELECT id, originalUsername, authority FROM users ORDER BY lower(originalUsername) LIMIT 1000")
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't load the accounts.", http.StatusInternalServerError)
			return
		}
		var list []row
		for rows.Next() {
			var x row
			var authority string
			if rows.Scan(&x.ID, &x.Name, &authority) == nil {
				x.Admin = authority == "admin"
				list = append(list, x)
			}
		}
		rows.Close()
		for i := range list {
			if g, ok := filesGrantFor(cookiesStruct{UserId: list[i].ID, Authority: map[bool]string{true: "admin", false: "user"}[list[i].Admin]}); ok {
				if g.Folders == nil {
					g.Folders = []string{}
				}
				list[i].Access = &g
			}
		}
		writeJSON(w, map[string]any{"users": list, "folders": uploadFolders()})

	case http.MethodPost:
		var in struct {
			User   int         `json:"user"`
			Access *filesGrant `json:"access"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
			http.Error(w, "Couldn't read that.", http.StatusBadRequest)
			return
		}
		var authority string
		if err := db.QueryRow("SELECT authority FROM users WHERE id = ?", in.User).Scan(&authority); err != nil {
			http.Error(w, "That account doesn't exist.", http.StatusNotFound)
			return
		}
		if authority == "admin" {
			http.Error(w, "Admins can always open every folder.", http.StatusBadRequest)
			return
		}
		if in.Access == nil {
			db.Exec("DELETE FROM file_access WHERE user_id = ?", in.User)
			writeJSON(w, map[string]any{"user": in.User, "access": nil})
			return
		}
		// Only real folders inside UploadedFiles, written as "a/b", each once.
		folders := []string{}
		seen := map[string]bool{}
		for _, f := range in.Access.Folders {
			p, ok := insideUploads(strings.Split(strings.Trim(filepath.ToSlash(f), "/"), "/")...)
			rel := uploadRel(p)
			if !ok || rel == "" || seen[rel] {
				continue
			}
			if info, err := os.Stat(p); err != nil || !info.IsDir() {
				continue
			}
			seen[rel] = true
			folders = append(folders, rel)
			if len(folders) >= 100 {
				break
			}
		}
		g := filesGrant{All: in.Access.All, Folders: folders, CanEdit: in.Access.CanEdit}
		if g.All {
			g.Folders = []string{}
		}
		list, _ := json.Marshal(g.Folders)
		all, edit := 0, 0
		if g.All {
			all = 1
		}
		if g.CanEdit {
			edit = 1
		}
		if _, err := db.Exec(`INSERT INTO file_access (user_id, all_folders, folders, can_edit) VALUES (?, ?, ?, ?)
			ON CONFLICT(user_id) DO UPDATE SET all_folders = excluded.all_folders, folders = excluded.folders, can_edit = excluded.can_edit`, in.User, all, string(list), edit); err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't save the access.", http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{"user": in.User, "access": g})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// ---- Admin name colors ----

var nameColorsMu sync.RWMutex
var nameColors = map[string]string{} // lower-case name -> color, admins only

func loadNameColors() {
	m := map[string]string{}
	if rows, err := db.Query("SELECT originalUsername, nameColor FROM users WHERE authority = 'admin' AND nameColor != ''"); err == nil {
		for rows.Next() {
			var name, color string
			if rows.Scan(&name, &color) == nil && hexColor.MatchString(color) {
				m[strings.ToLower(name)] = color
			}
		}
		rows.Close()
	}
	nameColorsMu.Lock()
	nameColors = m
	nameColorsMu.Unlock()
}

// adminNameColor is the color an admin picked for their name ("" for everyone else).
func adminNameColor(name, authority string) string {
	if authority != "admin" {
		return ""
	}
	nameColorsMu.RLock()
	defer nameColorsMu.RUnlock()
	return nameColors[strings.ToLower(name)]
}

// ---- Main page pictures (admins can swap them) ----

var sitePictureSlots = map[string]string{
	"member1": "/hookey.jpg",
	"member2": "/tepz.jpg",
	// Music page Library picture; "" = the built-in icon.
	"musicLibrary": "",
}

var sitePicturesDir = filepath.Join(ProfilePicturesDirName, "site")

// sitePictureLink is the link Main uses for a slot: the uploaded picture
// (with a version so browsers fetch a new one) or the original file.
func sitePictureLink(slot string) string {
	var path string
	if db.QueryRow("SELECT path FROM site_pictures WHERE slot = ?", slot).Scan(&path) == nil {
		if info, err := os.Stat(filepath.Join(sitePicturesDir, filepath.Base(path))); err == nil && !info.IsDir() {
			return "/sitepic/" + slot + "?v=" + strconv.FormatInt(info.ModTime().UnixMilli(), 36)
		}
	}
	return sitePictureSlots[slot]
}

// sitePicture serves an uploaded Main picture to everyone (Main is public).
func sitePicture(w http.ResponseWriter, r *http.Request) {
	slot := strings.TrimPrefix(r.URL.Path, "/sitepic/")
	fallback, known := sitePictureSlots[slot]
	if !known {
		http.NotFound(w, r)
		return
	}
	var path string
	if db.QueryRow("SELECT path FROM site_pictures WHERE slot = ?", slot).Scan(&path) != nil {
		if fallback == "" {
			http.NotFound(w, r)
			return
		}
		http.Redirect(w, r, fallback, http.StatusFound)
		return
	}
	p := filepath.Join(sitePicturesDir, filepath.Base(path))
	switch strings.ToLower(filepath.Ext(p)) {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp":
	default:
		http.NotFound(w, r)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, p)
}

// sitePictureUpload: multipart POST slot=<slot> with an "image", or remove=1
// to go back to the original picture. Admins only. Answers {"url": "..."}.
func sitePictureUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxPictureBytes+(64<<10))
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		http.Error(w, fmt.Sprintf("That picture is too big. Pick one under %d MB.", maxPictureMB), http.StatusRequestEntityTooLarge)
		return
	}
	defer r.MultipartForm.RemoveAll()
	slot := r.FormValue("slot")
	if _, known := sitePictureSlots[slot]; !known {
		http.Error(w, "Unknown picture.", http.StatusBadRequest)
		return
	}
	var old string
	db.QueryRow("SELECT path FROM site_pictures WHERE slot = ?", slot).Scan(&old)

	if r.FormValue("remove") == "1" {
		db.Exec("DELETE FROM site_pictures WHERE slot = ?", slot)
		if old != "" {
			os.Remove(filepath.Join(sitePicturesDir, filepath.Base(old)))
		}
		writeJSON(w, map[string]string{"url": sitePictureLink(slot)})
		return
	}
	file, _, err := r.FormFile("image")
	if err != nil {
		http.Error(w, "Pick a picture first.", http.StatusBadRequest)
		return
	}
	defer file.Close()
	name, status, msg := saveImageIn(file, sitePicturesDir, slot)
	if status != 0 {
		http.Error(w, msg, status)
		return
	}
	if _, err := db.Exec("INSERT INTO site_pictures (slot, path) VALUES (?, ?) ON CONFLICT(slot) DO UPDATE SET path = excluded.path", slot, name); err != nil {
		fmt.Println(err)
		os.Remove(filepath.Join(sitePicturesDir, name))
		http.Error(w, "Couldn't save the picture.", http.StatusInternalServerError)
		return
	}
	if old != "" && old != name {
		os.Remove(filepath.Join(sitePicturesDir, filepath.Base(old)))
	}
	writeJSON(w, map[string]string{"url": sitePictureLink(slot)})
}

// ---- Letter icon: comments on your Forum posts ----

// notifications: GET answers {unread, items} with the newest 30 comments
// other people left on the account's posts (unread = newer than the last
// time the letter was opened); POST {action:"seen"} marks them all read.
func notifications(w http.ResponseWriter, r *http.Request) {
	session, _ := sessionFromRequest(r)
	me := session.UserId
	var seen int64
	db.QueryRow("SELECT notesSeenAt FROM users WHERE id = ?", me).Scan(&seen)

	switch r.Method {
	case http.MethodGet:
		type note struct {
			ID       int64      `json:"id"`
			Post     int64      `json:"post"`
			PostText string     `json:"postText"`
			From     postAuthor `json:"from"`
			Body     string     `json:"body"`
			At       int64      `json:"at"`
			Unread   bool       `json:"unread"`
		}
		out := struct {
			Unread int    `json:"unread"`
			Items  []note `json:"items"`
		}{Items: []note{}}
		db.QueryRow(`SELECT COUNT(*) FROM forum_comments c JOIN forum_posts p ON p.id = c.post_id
			WHERE p.user_id = ? AND c.user_id != ? AND c.created_at > ?`, me, me, seen).Scan(&out.Unread)
		if r.URL.Query().Get("count") == "1" {
			writeJSON(w, out)
			return
		}
		rows, err := db.Query(`
		SELECT c.id, c.post_id, p.body, c.body, c.created_at, u.originalUsername, u.pathToProfilePic, u.authority
		FROM forum_comments c
		JOIN forum_posts p ON p.id = c.post_id
		JOIN users u ON u.id = c.user_id
		WHERE p.user_id = ? AND c.user_id != ?
		ORDER BY c.id DESC
		LIMIT 30`, me, me)
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't load your messages.", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		for rows.Next() {
			var n note
			var name, avatar, authority string
			if rows.Scan(&n.ID, &n.Post, &n.PostText, &n.Body, &n.At, &name, &avatar, &authority) != nil {
				continue
			}
			if runes := []rune(n.PostText); len(runes) > 80 {
				n.PostText = string(runes[:80]) + "…"
			}
			n.From = person(name, avatar, authority)
			n.Unread = n.At > seen
			out.Items = append(out.Items, n)
		}
		writeJSON(w, out)

	case http.MethodPost:
		var in struct {
			Action string `json:"action"`
		}
		json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&in)
		if in.Action != "seen" {
			http.Error(w, "Unknown action.", http.StatusBadRequest)
			return
		}
		db.Exec("UPDATE users SET notesSeenAt = ? WHERE id = ?", time.Now().UnixMilli(), me)
		writeJSON(w, map[string]int{"unread": 0})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// ---- Site backgrounds ----

// siteScenes are the backgrounds an account can pick for every page.
var siteScenes = map[string]bool{"": true, "none": true, "aurora": true, "stars": true, "grid": true, "pills": true, "waves": true, "custom": true}

// ---- Geek rank ----

// geekRank: every Graph session and every Forum post an account ever made is a point.
// The five tiers make a round of rankRound points. Reaching Geek⁴ earns a level,
// and when the round is full the tiers start over from Fresh Geek, so the level
// keeps counting up (Geek⁴ once = level 1, twice = level 2, ...). Every round
// needs rankHarder (10%) more points than the one before, tiers included.
type geekRank struct {
	Tier      int    `json:"tier"`
	Name      string `json:"name"`
	Level     int    `json:"level"`     // times Geek⁴ was reached
	Round     int    `json:"round"`     // which round the account is in, from 1
	RoundSize int    `json:"roundSize"` // points this round takes
	Score     int    `json:"score"`
	Graphs    int    `json:"graphs"`
	Posts     int    `json:"posts"`
	Next      string `json:"next"`     // what comes next: a tier name or "a new round"
	ToNext    int    `json:"toNext"`   // points still needed for it
	Progress  int    `json:"progress"` // percent of the way from this tier to the next
}

const rankRound = 150
const rankHarder = 1.10

// rankScale is how much bigger round r (0 = the first) is than the first.
func rankScale(r int) float64 { return math.Pow(rankHarder, float64(r)) }

func scaled(points int, r int) int { return int(math.Round(float64(points) * rankScale(r))) }

var geekTiers = []struct {
	Name string
	From int
}{{"Fresh Geek", 0}, {"Geek", 5}, {"Big Geek", 20}, {"Mega Geek", 50}, {"Geek⁴", 120}}

func makeRank(graphs, posts int) geekRank {
	g := geekRank{Graphs: graphs, Posts: posts, Score: graphs + posts}
	rounds, in := 0, g.Score
	for in >= scaled(rankRound, rounds) {
		in -= scaled(rankRound, rounds)
		rounds++
	}
	g.Level = rounds
	g.Round = rounds + 1
	g.RoundSize = scaled(rankRound, rounds)
	for i, t := range geekTiers {
		if in >= scaled(t.From, rounds) {
			g.Tier, g.Name = i+1, t.Name
		}
	}
	if g.Tier == len(geekTiers) {
		g.Level++
	}
	from := scaled(geekTiers[g.Tier-1].From, rounds)
	to := g.RoundSize
	g.Next = "a new round"
	if g.Tier < len(geekTiers) {
		to = scaled(geekTiers[g.Tier].From, rounds)
		g.Next = geekTiers[g.Tier].Name
	}
	g.ToNext = to - in
	g.Progress = (in - from) * 100 / (to - from)
	return g
}

var ranksMu sync.Mutex
var ranks = map[string]geekRank{} // lower-case name -> rank
var ranksAt time.Time

func staleRanks() {
	ranksMu.Lock()
	ranksAt = time.Time{}
	ranksMu.Unlock()
}

// allRanks recounts everyone at most every 30 seconds (or right after a new post or session).
func allRanks() map[string]geekRank {
	ranksMu.Lock()
	defer ranksMu.Unlock()
	if time.Since(ranksAt) < 30*time.Second {
		return ranks
	}
	m := map[string]geekRank{}
	rows, err := db.Query("SELECT username, graphsMade, postsMade FROM users")
	if err != nil {
		fmt.Println(err)
		return ranks
	}
	for rows.Next() {
		var name string
		var graphs, posts int
		if rows.Scan(&name, &graphs, &posts) == nil {
			m[strings.ToLower(name)] = makeRank(graphs, posts)
		}
	}
	rows.Close()
	ranks, ranksAt = m, time.Now()
	return ranks
}

func rankOf(name string) geekRank {
	if g, ok := allRanks()[strings.ToLower(name)]; ok {
		return g
	}
	return makeRank(0, 0)
}

// ---- Page views ----

var statsSchema = `
CREATE TABLE IF NOT EXISTS page_views (
	day TEXT NOT NULL,
	page TEXT NOT NULL,
	views INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY(day, page)
);
CREATE TABLE IF NOT EXISTS page_visitors (
	day TEXT NOT NULL,
	visitor TEXT NOT NULL,
	PRIMARY KEY(day, visitor)
);
`

// viewedPage names the page a browser opened, or "" for scripts, files and pictures.
func viewedPage(r *http.Request) string {
	if r.Method != http.MethodGet {
		return ""
	}
	if dest := r.Header.Get("Sec-Fetch-Dest"); dest != "" && dest != "document" {
		return ""
	}
	p := r.URL.Path
	switch {
	case p == "/" || p == "/Main" || p == "/journal" || p == "/journal/Drug" || p == "/Profile" || p == "/Forum" || p == "/admin" || p == "/Uploader" || p == "/Utility":
		return p
	case strings.HasPrefix(p, "/u/"):
		return "/u/"
	case strings.HasPrefix(p, "/Files/") && strings.HasSuffix(p, "/"):
		return "/Files/"
	}
	return ""
}

// countViews adds one view per page opened, and remembers each visitor once a day:
// an account by its id, everyone else by a hash of their address and browser.
func countViews(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if page := viewedPage(r); page != "" {
			day := time.Now().Format("2006-01-02")
			visitor := ""
			if s, ok := sessionFromRequest(r); ok && s.UserId != 0 {
				visitor = "u" + strconv.Itoa(s.UserId)
				db.Exec("UPDATE users SET lastSeen = ? WHERE id = ?", time.Now().UnixMilli(), s.UserId)
			} else {
				sum := sha256.Sum256([]byte(clientIP(r) + "|" + r.UserAgent()))
				visitor = "a" + hex.EncodeToString(sum[:8])
			}
			db.Exec(`INSERT INTO page_views (day, page, views) VALUES (?, ?, 1)
				ON CONFLICT(day, page) DO UPDATE SET views = views + 1`, day, page)
			db.Exec("INSERT OR IGNORE INTO page_visitors (day, visitor) VALUES (?, ?)", day, visitor)
		}
		next.ServeHTTP(w, r)
	})
}

// adminStats: views per day (last 30 days), the most opened pages, site totals
// and every account with its numbers and geek rank.
func adminStats(w http.ResponseWriter, r *http.Request) {
	type dayRow struct {
		Day      string `json:"day"`
		Views    int    `json:"views"`
		Visitors int    `json:"visitors"`
	}
	now := time.Now()
	days := make([]dayRow, 30)
	index := map[string]int{}
	for i := range days {
		d := now.AddDate(0, 0, i-29).Format("2006-01-02")
		days[i].Day = d
		index[d] = i
	}
	first := days[0].Day
	if rows, err := db.Query("SELECT day, SUM(views) FROM page_views WHERE day >= ? GROUP BY day", first); err == nil {
		for rows.Next() {
			var d string
			var n int
			if rows.Scan(&d, &n) == nil {
				if i, ok := index[d]; ok {
					days[i].Views = n
				}
			}
		}
		rows.Close()
	}
	if rows, err := db.Query("SELECT day, COUNT(*) FROM page_visitors WHERE day >= ? GROUP BY day", first); err == nil {
		for rows.Next() {
			var d string
			var n int
			if rows.Scan(&d, &n) == nil {
				if i, ok := index[d]; ok {
					days[i].Visitors = n
				}
			}
		}
		rows.Close()
	}
	type pageRow struct {
		Page  string `json:"page"`
		Views int    `json:"views"`
	}
	pages := []pageRow{}
	if rows, err := db.Query("SELECT page, SUM(views) AS n FROM page_views WHERE day >= ? GROUP BY page ORDER BY n DESC", first); err == nil {
		for rows.Next() {
			var p pageRow
			if rows.Scan(&p.Page, &p.Views) == nil {
				pages = append(pages, p)
			}
		}
		rows.Close()
	}
	type userRow struct {
		ID       int      `json:"id"`
		Name     string   `json:"name"`
		Admin    bool     `json:"admin"`
		Avatar   string   `json:"avatar"`
		Joined   int64    `json:"joined"`
		LastSeen int64    `json:"lastSeen"`
		Graphs   int      `json:"graphs"`
		Posts    int      `json:"posts"`
		Comments int      `json:"comments"`
		Doses    int      `json:"doses"`
		Likes    int      `json:"likes"`
		Friends  int      `json:"friends"`
		Rank     geekRank `json:"rank"`
	}
	users := []userRow{}
	rows, err := db.Query(`SELECT u.id, u.originalUsername, u.authority, u.pathToProfilePic, u.createdAt, u.lastSeen,
		u.graphsMade, u.postsMade,
		(SELECT COUNT(*) FROM forum_comments c WHERE c.user_id = u.id),
		(SELECT COUNT(*) FROM doses d WHERE d.user_id = u.id),
		(SELECT COUNT(*) FROM liked_substances l WHERE l.user_id = u.id),
		(SELECT COUNT(*) FROM friendships f WHERE f.status = 'accepted' AND (f.requester_id = u.id OR f.addressee_id = u.id)),
		(SELECT MAX(created_at) FROM sessions s WHERE s.user_id = u.id)
		FROM users u ORDER BY lower(u.originalUsername) LIMIT 2000`)
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Couldn't load the accounts.", http.StatusInternalServerError)
		return
	}
	for rows.Next() {
		var u userRow
		var authority, avatar string
		var login sql.NullString
		if err := rows.Scan(&u.ID, &u.Name, &authority, &avatar, &u.Joined, &u.LastSeen, &u.Graphs, &u.Posts, &u.Comments, &u.Doses, &u.Likes, &u.Friends, &login); err != nil {
			fmt.Println(err)
			continue
		}
		u.Admin = authority == "admin"
		u.Avatar = existingPicture(avatar)
		if u.LastSeen == 0 && login.Valid {
			// Accounts from before lastSeen existed: their latest sign in.
			for _, layout := range []string{"2006-01-02 15:04:05.999999999-07:00", "2006-01-02 15:04:05-07:00", time.RFC3339Nano, "2006-01-02 15:04:05"} {
				if t, err := time.Parse(layout, login.String); err == nil {
					u.LastSeen = t.UnixMilli()
					break
				}
			}
		}
		u.Rank = makeRank(u.Graphs, u.Posts)
		users = append(users, u)
	}
	rows.Close()
	var totals struct {
		Accounts int `json:"accounts"`
		Graphs   int `json:"graphs"`
		Posts    int `json:"posts"`
		Comments int `json:"comments"`
	}
	totals.Accounts = len(users)
	for _, u := range users {
		totals.Graphs += u.Graphs
		totals.Posts += u.Posts
		totals.Comments += u.Comments
	}
	tiers := []map[string]any{}
	for i, t := range geekTiers {
		tiers = append(tiers, map[string]any{"tier": i + 1, "name": t.Name, "from": t.From})
	}
	writeJSON(w, map[string]any{"days": days, "pages": pages, "users": users, "totals": totals, "tiers": tiers, "round": rankRound})
}

// clearAlpha: the card opacities for a widget transparency, worked out here so
// the page doesn't need calc() inside rgba(), which some phone browsers skip.
type clearAlpha struct{ Card, Inner string }

func makeClearAlpha(clear int) clearAlpha {
	c := float64(min(max(clear, 0), 100)) / 100
	return clearAlpha{Card: strconv.FormatFloat(1-c, 'f', 2, 64), Inner: strconv.FormatFloat(1-c*0.85, 'f', 3, 64)}
}

// ---------------- Replications: a backup of PsychonautWiki's effect pictures ----------------

// An admin presses "Back up" on /Replications and this server (it's the one with internet)
// walks the wiki's effect pages through the MediaWiki API, then downloads every replication
// picture plus a small preview into replications/ (gitignored), with index.json keeping the
// effect, caption and artist credit of each. Pressing it again only fetches what's new, and
// pictures that later vanish from the wiki stay here. PW_API changes the API address (tests).

const replicationsDir = "replications"
const replAgent = "Geek4uBackup/1.0 (personal backup of effect replications)"
const replThumbWidth = 480
const replMaxBytes = 250 << 20

type replication struct {
	Name     string   `json:"name"`            // the wiki's file name, without "File:"
	File     string   `json:"file"`            // in replications/files/
	Thumb    string   `json:"thumb,omitempty"` // in replications/thumbs/ ('' = the file is small enough)
	Width    int      `json:"width"`
	Height   int      `json:"height"`
	Bytes    int64    `json:"bytes"`
	Mime     string   `json:"mime"`
	Effects  []string `json:"effects"`
	Kinds    []string `json:"kinds,omitempty"` // e.g. Visual, from the effect pages' categories
	Caption  string   `json:"caption,omitempty"`
	About    string   `json:"about,omitempty"` // the file page's own description
	Artist   string   `json:"artist,omitempty"`
	License  string   `json:"license,omitempty"`
	Source   string   `json:"source"` // the file's page on the wiki
	Uploaded string   `json:"uploaded,omitempty"`
}

type replIndex struct {
	Updated int64         `json:"updated"`
	Items   []replication `json:"items"`
	Removed []string      `json:"removed,omitempty"` // removed by an admin, so updates skip them
}

type replStatus struct {
	Running  bool   `json:"running"`
	Phase    string `json:"phase"`
	Done     int    `json:"done"`
	Total    int    `json:"total"`
	New      int    `json:"new"`
	Failed   int    `json:"failed"`
	Bytes    int64  `json:"bytes"`
	Started  int64  `json:"started,omitempty"`
	Finished int64  `json:"finished,omitempty"`
	Error    string `json:"error,omitempty"`
}

var (
	replMu    sync.Mutex // guards replState and replStop
	replState replStatus
	replStop  bool

	replIdxMu   sync.Mutex // guards replIdx
	replIdx     *replIndex
	errReplStop = errors.New("stopped")
)

var replAPIClient = &http.Client{Timeout: 90 * time.Second}

// Pictures can be big, so there's no overall time limit, only for the wiki to start answering.
var replFileClient = &http.Client{Transport: &http.Transport{
	Proxy:                 http.ProxyFromEnvironment,
	ResponseHeaderTimeout: 60 * time.Second,
	IdleConnTimeout:       90 * time.Second,
}}

func replAPI() string {
	if v := os.Getenv("PW_API"); v != "" {
		return v
	}
	return "https://psychonautwiki.org/w/api.php"
}

func replSetState(change func(s *replStatus)) {
	replMu.Lock()
	change(&replState)
	replMu.Unlock()
}

func replStopped() bool {
	replMu.Lock()
	defer replMu.Unlock()
	return replStop
}

// replLoaded returns the index, reading index.json the first time. Call with replIdxMu held.
func replLoaded() *replIndex {
	if replIdx == nil {
		replIdx = &replIndex{}
		if b, err := os.ReadFile(filepath.Join(replicationsDir, "index.json")); err == nil {
			json.Unmarshal(b, replIdx)
		}
	}
	return replIdx
}

// replSave writes index.json through a temporary file so a crash can't leave half of it. Call with replIdxMu held.
func replSave() error {
	idx := replLoaded()
	idx.Updated = time.Now().UnixMilli()
	b, err := json.MarshalIndent(idx, "", " ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(replicationsDir, 0755); err != nil {
		return err
	}
	tmp := filepath.Join(replicationsDir, "index.json.tmp")
	if err := os.WriteFile(tmp, b, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(replicationsDir, "index.json"))
}

// ---- MediaWiki API ----

type wikiPage struct {
	Title    string `json:"title"`
	Ns       int    `json:"ns"`
	Missing  any    `json:"missing,omitempty"`
	Revision []struct {
		Content string `json:"content"`
		Star    string `json:"*"`
		Slots   struct {
			Main struct {
				Content string `json:"content"`
				Star    string `json:"*"`
			} `json:"main"`
		} `json:"slots"`
	} `json:"revisions"`
	Images []struct {
		Title string `json:"title"`
	} `json:"images"`
	Links []struct {
		Title string `json:"title"`
	} `json:"links"`
	ImageInfo []struct {
		URL         string `json:"url"`
		ThumbURL    string `json:"thumburl"`
		Size        int64  `json:"size"`
		Width       int    `json:"width"`
		Height      int    `json:"height"`
		Mime        string `json:"mime"`
		DescURL     string `json:"descriptionurl"`
		Timestamp   string `json:"timestamp"`
		User        string `json:"user"`
		ExtMetadata map[string]struct {
			Value any `json:"value"`
		} `json:"extmetadata"`
	} `json:"imageinfo"`
}

func (p wikiPage) text() string {
	for _, r := range p.Revision {
		for _, s := range []string{r.Slots.Main.Content, r.Slots.Main.Star, r.Content, r.Star} {
			if s != "" {
				return s
			}
		}
	}
	return ""
}

type wikiAnswer struct {
	Continue map[string]any `json:"continue"`
	Error    *struct {
		Code string `json:"code"`
		Info string `json:"info"`
	} `json:"error"`
	Query struct {
		Normalized []struct {
			From string `json:"from"`
			To   string `json:"to"`
		} `json:"normalized"`
		Redirects []struct {
			From string `json:"from"`
			To   string `json:"to"`
		} `json:"redirects"`
		Pages           json.RawMessage `json:"pages"`
		CategoryMembers []struct {
			Title string `json:"title"`
			Ns    int    `json:"ns"`
		} `json:"categorymembers"`
	} `json:"query"`
}

// pages reads query.pages, which is a list in formatversion 2 and an object in older wikis.
func (a wikiAnswer) pages() []wikiPage {
	var list []wikiPage
	if json.Unmarshal(a.Query.Pages, &list) == nil {
		return list
	}
	var byID map[string]wikiPage
	json.Unmarshal(a.Query.Pages, &byID)
	for _, p := range byID {
		list = append(list, p)
	}
	return list
}

// replAsk makes one API call, waiting and retrying when the wiki is busy, then pauses a moment to stay polite.
func replAsk(params url.Values) (wikiAnswer, error) {
	params.Set("action", "query")
	params.Set("format", "json")
	params.Set("formatversion", "2")
	params.Set("maxlag", "5")
	var answer wikiAnswer
	var last error
	for try := 0; try < 5; try++ {
		if try > 0 {
			time.Sleep(time.Duration(2<<try) * time.Second)
		}
		if replStopped() {
			return answer, errReplStop
		}
		req, _ := http.NewRequest(http.MethodGet, replAPI()+"?"+params.Encode(), nil)
		req.Header.Set("User-Agent", replAgent)
		res, err := replAPIClient.Do(req)
		if err != nil {
			var ue *url.Error
			if errors.As(err, &ue) {
				err = ue.Err
			}
			last = fmt.Errorf("couldn't reach PsychonautWiki (%v)", err)
			if try >= 2 {
				break // no internet or the address is wrong; retrying longer won't help
			}
			continue
		}
		body, err := io.ReadAll(io.LimitReader(res.Body, 64<<20))
		res.Body.Close()
		if err != nil {
			last = err
			continue
		}
		if res.StatusCode != http.StatusOK {
			last = fmt.Errorf("the wiki answered %s", res.Status)
			if res.StatusCode == http.StatusTooManyRequests || res.StatusCode >= 500 {
				continue
			}
			return answer, last
		}
		answer = wikiAnswer{}
		if err := json.Unmarshal(body, &answer); err != nil {
			last = fmt.Errorf("the wiki sent something that isn't JSON")
			continue
		}
		if answer.Error != nil {
			last = fmt.Errorf("the wiki said: %s", answer.Error.Info)
			if answer.Error.Code == "maxlag" {
				continue
			}
			return answer, last
		}
		time.Sleep(300 * time.Millisecond)
		return answer, nil
	}
	return answer, last
}

// replEach follows the API's "continue" until every part of the answer has arrived.
func replEach(params url.Values, each func(wikiAnswer)) error {
	base := url.Values{}
	for k, v := range params {
		base[k] = v
	}
	cont := map[string]any{}
	for {
		q := url.Values{}
		for k, v := range base {
			q[k] = v
		}
		for k, v := range cont {
			q.Set(k, fmt.Sprint(v))
		}
		answer, err := replAsk(q)
		if err != nil {
			return err
		}
		each(answer)
		if len(answer.Continue) == 0 {
			return nil
		}
		cont = answer.Continue
	}
}

// ---- reading the wiki text ----

func replFileKey(title string) string {
	t := strings.TrimSpace(strings.ReplaceAll(title, "_", " "))
	if i := strings.Index(t, ":"); i >= 0 {
		switch strings.ToLower(strings.TrimSpace(t[:i])) {
		case "file", "image":
			t = strings.TrimSpace(t[i+1:])
		}
	}
	t = strings.Join(strings.Fields(t), " ")
	if t == "" {
		return ""
	}
	r, n := utf8.DecodeRuneInString(t)
	return string(unicode.ToUpper(r)) + t[n:]
}

var (
	reWikiTemplate = regexp.MustCompile(`\{\{[^{}]*\}\}`)
	reWikiRef      = regexp.MustCompile(`(?is)<ref[^>]*/>|<ref[^>]*>.*?</ref>`)
	reWikiLink     = regexp.MustCompile(`\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]`)
	reWikiExtLink  = regexp.MustCompile(`\[(?:https?:)?//[^\s\]]+\s+([^\]]*)\]`)
	reTags         = regexp.MustCompile(`<[^>]*>`)
	reGallery      = regexp.MustCompile(`(?is)<gallery[^>]*>(.*?)</gallery>`)
	reSpace        = regexp.MustCompile(`\s+`)
	reUnderscores  = regexp.MustCompile(`_+`)
)

// replPlain turns a bit of wiki text or HTML into plain text.
func replPlain(s string, limit int) string {
	// Simple templates like {{Sub|DMT}} keep their last part; bigger ones go.
	for i := 0; i < 3; i++ {
		s = reWikiTemplate.ReplaceAllStringFunc(s, func(t string) string {
			parts := strings.Split(strings.Trim(t, "{}"), "|")
			last := strings.TrimSpace(parts[len(parts)-1])
			if len(parts) < 2 || len(parts) > 3 || strings.Contains(last, "=") || utf8.RuneCountInString(last) > 40 {
				return ""
			}
			return last
		})
	}
	s = reWikiRef.ReplaceAllString(s, "")
	s = reWikiLink.ReplaceAllString(s, "$1")
	s = reWikiExtLink.ReplaceAllString(s, "$1")
	s = reTags.ReplaceAllString(s, " ")
	s = strings.NewReplacer("'''", "", "''", "", "&nbsp;", " ").Replace(s)
	s = html.UnescapeString(s)
	s = strings.TrimSpace(reSpace.ReplaceAllString(s, " "))
	s = strings.Trim(s, "|")
	if limit > 0 && utf8.RuneCountInString(s) > limit {
		s = string([]rune(s)[:limit]) + "…"
	}
	return s
}

// splitWikiArgs splits "a|[[b|c]]|d" on the bars that aren't inside a link or template.
func splitWikiArgs(s string) []string {
	var out []string
	depth, start := 0, 0
	for i := 0; i < len(s); i++ {
		switch {
		case strings.HasPrefix(s[i:], "[[") || strings.HasPrefix(s[i:], "{{"):
			depth++
			i++
		case (strings.HasPrefix(s[i:], "]]") || strings.HasPrefix(s[i:], "}}")) && depth > 0:
			depth--
			i++
		case s[i] == '|' && depth == 0:
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	return append(out, s[start:])
}

// pictureCaption picks the caption out of a picture's options, skipping things like "thumb" or "300px".
func pictureCaption(args []string) string {
	caption := ""
	for _, a := range args {
		t := strings.TrimSpace(a)
		l := strings.ToLower(t)
		if t == "" || strings.HasSuffix(l, "px") || strings.Contains(l, "=") && !strings.Contains(l, "[[") && len(strings.SplitN(l, "=", 2)[0]) < 12 {
			continue
		}
		switch l {
		case "thumb", "thumbnail", "frame", "framed", "frameless", "border", "left", "right", "center", "centre", "none", "upright", "baseline", "middle", "top", "bottom":
			continue
		}
		caption = t
	}
	return replPlain(caption, 400)
}

type wikiPicture struct {
	Caption string
	Gallery bool
}

// picturesInText finds the pictures a page shows: <gallery> lines and [[File:...]] links.
func picturesInText(text string) map[string]wikiPicture {
	found := map[string]wikiPicture{}
	add := func(name, caption string, gallery bool) {
		key := replFileKey(name)
		if key == "" || strings.ContainsAny(key, "{}[]<>") {
			return
		}
		old, seen := found[key]
		if !seen || (gallery && !old.Gallery) || old.Caption == "" {
			found[key] = wikiPicture{caption, gallery || old.Gallery}
		}
	}
	for _, m := range reGallery.FindAllStringSubmatch(text, -1) {
		for _, line := range strings.Split(m[1], "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			parts := splitWikiArgs(line)
			add(parts[0], pictureCaption(parts[1:]), true)
		}
	}
	text = reGallery.ReplaceAllString(text, "")
	for i := 0; ; {
		j := strings.Index(text[i:], "[[")
		if j < 0 {
			break
		}
		start := i + j + 2
		depth, end := 1, -1
		for k := start; k < len(text)-1; k++ {
			if text[k] == '[' && text[k+1] == '[' {
				depth++
				k++
			} else if text[k] == ']' && text[k+1] == ']' {
				depth--
				k++
				if depth == 0 {
					end = k - 1
					break
				}
			}
		}
		if end < 0 {
			break
		}
		inner := text[start:end]
		i = end + 2
		parts := splitWikiArgs(inner)
		head := strings.ToLower(strings.TrimSpace(parts[0]))
		if strings.HasPrefix(head, "file:") || strings.HasPrefix(head, "image:") {
			add(parts[0], pictureCaption(parts[1:]), false)
		}
	}
	return found
}

// ---- the backup run ----

type replFound struct {
	effects        map[string]bool
	caption        string
	galleryCaption bool // the caption came from a gallery, so a later one doesn't replace it
	gallery        bool
	inCat          bool
}

func startReplicationsBackup() bool {
	replMu.Lock()
	defer replMu.Unlock()
	if replState.Running {
		return false
	}
	replStop = false
	replState = replStatus{Running: true, Phase: "Finding the effect pages", Started: time.Now().UnixMilli()}
	go func() {
		err := backupReplications()
		replMu.Lock()
		replState.Running = false
		replState.Finished = time.Now().UnixMilli()
		switch {
		case err == errReplStop:
			replState.Phase = "Stopped"
		case err != nil:
			replState.Phase = "Didn't finish"
			replState.Error = err.Error()
		default:
			replState.Phase = "Done"
		}
		replMu.Unlock()
		if err != nil {
			fmt.Println("Replications backup:", err)
		}
	}()
	return true
}

func backupReplications() error {
	for _, dir := range []string{"files", "thumbs"} {
		if err := os.MkdirAll(filepath.Join(replicationsDir, dir), 0755); err != nil {
			return err
		}
	}

	// 1. Effect pages: everything under the effect and replication categories (two levels down).
	pages := map[string]map[string]bool{} // page -> the categories it was listed in
	found := map[string]*replFound{}
	seeds := []string{"Category:Effect", "Category:Effects", "Category:Replication", "Category:Replications"}
	seed := map[string]bool{}
	for _, s := range seeds {
		seed[s] = true
	}
	type catAt struct {
		title string
		depth int
	}
	queue := []catAt{}
	for _, s := range seeds {
		queue = append(queue, catAt{s, 0})
	}
	seenCat := map[string]bool{}
	for len(queue) > 0 && len(seenCat) < 120 {
		c := queue[0]
		queue = queue[1:]
		if seenCat[c.title] {
			continue
		}
		seenCat[c.title] = true
		err := replEach(url.Values{"list": {"categorymembers"}, "cmtitle": {c.title}, "cmtype": {"page|subcat|file"}, "cmlimit": {"max"}}, func(a wikiAnswer) {
			for _, m := range a.Query.CategoryMembers {
				switch m.Ns {
				case 0:
					if pages[m.Title] == nil {
						pages[m.Title] = map[string]bool{}
					}
					if !seed[c.title] {
						pages[m.Title][strings.TrimPrefix(c.title, "Category:")] = true
					}
				case 14:
					if c.depth < 2 {
						queue = append(queue, catAt{m.Title, c.depth + 1})
					}
				case 6:
					key := replFileKey(m.Title)
					if found[key] == nil {
						found[key] = &replFound{effects: map[string]bool{}}
					}
					found[key].inCat = true
				}
			}
		})
		if err == errReplStop {
			return err
		}
		if err != nil && len(seenCat) == 1 {
			return err // the very first question failed, so the wiki can't be reached
		}
		if err != nil && c.depth == 0 {
			fmt.Println("Replications:", c.title, err)
		}
		replSetState(func(s *replStatus) { s.Phase = fmt.Sprintf("Finding the effect pages (%d so far)", len(pages)) })
	}
	// Few pages in categories (the wiki may be set up differently): use the effect index's links too.
	if len(pages) < 40 {
		replEach(url.Values{"prop": {"links"}, "titles": {"Subjective effect index|Effect index"}, "redirects": {"1"}, "plnamespace": {"0"}, "pllimit": {"max"}}, func(a wikiAnswer) {
			for _, p := range a.pages() {
				for _, l := range p.Links {
					if pages[l.Title] == nil {
						pages[l.Title] = map[string]bool{}
					}
				}
			}
		})
	}
	if replStopped() {
		return errReplStop
	}
	if len(pages) == 0 && len(found) == 0 {
		return errors.New("couldn't find any effect pages on the wiki")
	}

	// 2. Read each page: the pictures in its galleries and text, and every picture it shows.
	titles := make([]string, 0, len(pages))
	for t := range pages {
		titles = append(titles, t)
	}
	sort.Strings(titles)
	usedOn := map[string]int{} // how many pages show a picture; logos and icons are on lots of them
	kindsOf := map[string]map[string]bool{}
	for i := 0; i < len(titles); i += 20 {
		batch := titles[i:min(i+20, len(titles))]
		replSetState(func(s *replStatus) {
			s.Phase = fmt.Sprintf("Reading effect pages (%d of %d)", i, len(titles))
		})
		seenHere := map[string]map[string]bool{}
		err := replEach(url.Values{"prop": {"revisions|images"}, "titles": {strings.Join(batch, "|")}, "rvprop": {"content"}, "rvslots": {"main"}, "imlimit": {"max"}}, func(a wikiAnswer) {
			for _, p := range a.pages() {
				if p.Missing != nil && p.Missing != false {
					continue
				}
				if seenHere[p.Title] == nil {
					seenHere[p.Title] = map[string]bool{}
				}
				for name, pic := range picturesInText(p.text()) {
					f := found[name]
					if f == nil {
						f = &replFound{effects: map[string]bool{}}
						found[name] = f
					}
					f.effects[p.Title] = true
					f.gallery = f.gallery || pic.Gallery
					if pic.Caption != "" && (f.caption == "" || pic.Gallery && !f.galleryCaption) {
						f.caption = pic.Caption
						f.galleryCaption = pic.Gallery
					}
					seenHere[p.Title][name] = true
				}
				for _, im := range p.Images {
					name := replFileKey(im.Title)
					if found[name] == nil {
						found[name] = &replFound{effects: map[string]bool{}}
					}
					found[name].effects[p.Title] = true
					seenHere[p.Title][name] = true
				}
			}
		})
		if err != nil {
			return err
		}
		for page, names := range seenHere {
			for name := range names {
				usedOn[name]++
				if len(pages[page]) > 0 {
					if kindsOf[name] == nil {
						kindsOf[name] = map[string]bool{}
					}
					for k := range pages[page] {
						kindsOf[name][k] = true
					}
				}
			}
		}
	}

	// Keep pictures from galleries and the replication categories, plus pictures shown on just a few pages.
	keep := []string{}
	for name, f := range found {
		if f.gallery || f.inCat || usedOn[name] <= 3 {
			keep = append(keep, name)
		}
	}
	sort.Strings(keep)

	// 3. Look up each picture: its address, size, artist and license.
	type infoRow struct {
		replication
		url, thumb string
	}
	infos := map[string]infoRow{}
	for i := 0; i < len(keep); i += 50 {
		batch := keep[i:min(i+50, len(keep))]
		replSetState(func(s *replStatus) { s.Phase = fmt.Sprintf("Looking up pictures (%d of %d)", i, len(keep)) })
		names := make([]string, len(batch))
		for j, n := range batch {
			names[j] = "File:" + n
		}
		err := replEach(url.Values{"prop": {"imageinfo"}, "titles": {strings.Join(names, "|")}, "iiprop": {"url|size|mime|extmetadata|timestamp|user"}, "iiurlwidth": {strconv.Itoa(replThumbWidth)}, "iiextmetadatafilter": {"ImageDescription|Artist|LicenseShortName|Credit"}}, func(a wikiAnswer) {
			for _, p := range a.pages() {
				if len(p.ImageInfo) == 0 {
					continue
				}
				ii := p.ImageInfo[0]
				meta := func(k string) string {
					if v, ok := ii.ExtMetadata[k]; ok {
						return fmt.Sprint(v.Value)
					}
					return ""
				}
				row := infoRow{url: ii.URL, thumb: ii.ThumbURL}
				row.Name = replFileKey(p.Title)
				row.Width, row.Height, row.Bytes, row.Mime = ii.Width, ii.Height, ii.Size, ii.Mime
				row.Source = ii.DescURL
				row.Uploaded = ii.Timestamp
				row.About = replPlain(meta("ImageDescription"), 600)
				row.Artist = replPlain(meta("Artist"), 120)
				if row.Artist == "" {
					row.Artist = ii.User
				}
				row.License = replPlain(meta("LicenseShortName"), 60)
				infos[row.Name] = row
			}
		})
		if err != nil {
			return err
		}
	}

	// 4. Download what's new.
	replIdxMu.Lock()
	idx := replLoaded()
	have := map[string]replication{}
	for _, it := range idx.Items {
		have[it.Name] = it
	}
	removed := map[string]bool{}
	for _, n := range idx.Removed {
		removed[n] = true
	}
	replIdxMu.Unlock()

	todo := []infoRow{}
	for _, name := range keep {
		row, ok := infos[name]
		if !ok || removed[name] || row.url == "" {
			continue
		}
		ext := strings.ToLower(filepath.Ext(name))
		if !replExtOK(ext) || !strings.HasPrefix(row.Mime, "image/") && !strings.HasPrefix(row.Mime, "video/") {
			continue
		}
		f := found[name]
		big := min(row.Width, row.Height) >= 150
		if !(f.gallery || f.inCat) && !big {
			continue // small pictures outside galleries are icons
		}
		row.Effects = sortedKeys(f.effects)
		row.Kinds = sortedKeys(kindsOf[name])
		row.Caption = f.caption
		todo = append(todo, row)
	}
	replSetState(func(s *replStatus) {
		s.Phase = "Downloading pictures"
		s.Total = len(todo)
	})

	base, _ := url.Parse(replAPI())
	sinceSave := 0
	for _, row := range todo {
		if replStopped() {
			break
		}
		it := row.replication
		old, had := have[it.Name]
		it.File = replSafeName(it.Name)
		filePath := filepath.Join(replicationsDir, "files", it.File)
		fresh := false
		// Download it when it's new, its file is gone, or the wiki has a newer upload of it.
		if st, err := os.Stat(filePath); err == nil && had && st.Size() > 0 && (it.Uploaded == "" || old.Uploaded == "" || it.Uploaded == old.Uploaded) {
			it.Bytes = st.Size()
		} else {
			if it.Bytes > replMaxBytes {
				replSetState(func(s *replStatus) { s.Done++; s.Failed++ })
				continue
			}
			n, err := replDownload(replResolve(base, row.url), filePath)
			if err == errReplStop {
				break
			}
			if err != nil {
				fmt.Println("Replications:", it.Name, err)
				replSetState(func(s *replStatus) { s.Done++; s.Failed++ })
				continue
			}
			it.Bytes = n
			fresh = true
			replSetState(func(s *replStatus) { s.Bytes += n; s.New++ })
		}
		// A preview for the grid, when the picture is bigger than one.
		it.Thumb = old.Thumb
		if row.thumb != "" && row.thumb != row.url && it.Width > replThumbWidth {
			thumbName := strings.TrimSuffix(it.File, filepath.Ext(it.File)) + replThumbExt(row.thumb)
			thumbPath := filepath.Join(replicationsDir, "thumbs", thumbName)
			if _, err := os.Stat(thumbPath); err != nil || fresh {
				if n, err := replDownload(replResolve(base, row.thumb), thumbPath); err == nil {
					it.Thumb = thumbName
					replSetState(func(s *replStatus) { s.Bytes += n })
				}
			} else {
				it.Thumb = thumbName
			}
		}
		replIdxMu.Lock()
		idx := replLoaded()
		placed := false
		for i := range idx.Items {
			if idx.Items[i].Name == it.Name {
				idx.Items[i] = it
				placed = true
				break
			}
		}
		if !placed {
			idx.Items = append(idx.Items, it)
		}
		sinceSave++
		if sinceSave >= 20 {
			replSave()
			sinceSave = 0
		}
		replIdxMu.Unlock()
		replSetState(func(s *replStatus) { s.Done++ })
	}
	replIdxMu.Lock()
	err := replSave()
	replIdxMu.Unlock()
	if replStopped() {
		return errReplStop
	}
	return err
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func replExtOK(ext string) bool {
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".webm", ".mp4":
		return true
	}
	return false
}

func replThumbExt(link string) string {
	if u, err := url.Parse(link); err == nil {
		if ext := strings.ToLower(filepath.Ext(u.Path)); replExtOK(ext) {
			return ext
		}
	}
	return ".jpg"
}

func replResolve(base *url.URL, link string) string {
	u, err := url.Parse(link)
	if err != nil || base == nil {
		return link
	}
	return base.ResolveReference(u).String()
}

// replSafeName makes a file name that's fine on Windows: plain letters, plus a short hash so
// two names that differ only in case or symbols don't land on the same file.
func replSafeName(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	var b strings.Builder
	for _, r := range strings.TrimSuffix(name, filepath.Ext(name)) {
		switch {
		case r < 128 && (unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-'):
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
		if b.Len() >= 100 {
			break
		}
	}
	s := strings.Trim(reUnderscores.ReplaceAllString(b.String(), "_"), "_")
	if s == "" {
		s = "picture"
	}
	sum := sha256.Sum256([]byte(name))
	return s + "-" + hex.EncodeToString(sum[:3]) + ext
}

// replDownload saves a link to a file, through a .part file so a broken download never looks finished.
func replDownload(link, dest string) (int64, error) {
	var last error
	for try := 0; try < 3; try++ {
		if replStopped() {
			return 0, errReplStop
		}
		if try > 0 {
			time.Sleep(time.Duration(3*try) * time.Second)
		}
		req, err := http.NewRequest(http.MethodGet, link, nil)
		if err != nil {
			return 0, err
		}
		req.Header.Set("User-Agent", replAgent)
		res, err := replFileClient.Do(req)
		if err != nil {
			last = err
			continue
		}
		if res.StatusCode != http.StatusOK {
			res.Body.Close()
			last = fmt.Errorf("the wiki answered %s", res.Status)
			if res.StatusCode == http.StatusNotFound {
				return 0, last
			}
			continue
		}
		part := dest + ".part"
		out, err := os.Create(part)
		if err != nil {
			res.Body.Close()
			return 0, err
		}
		n, err := io.Copy(out, io.LimitReader(res.Body, replMaxBytes+1))
		res.Body.Close()
		if cerr := out.Close(); err == nil {
			err = cerr
		}
		if err == nil && n > replMaxBytes {
			err = errors.New("too big")
		}
		if err != nil {
			os.Remove(part)
			last = err
			continue
		}
		if err := os.Rename(part, dest); err != nil {
			os.Remove(part)
			return 0, err
		}
		time.Sleep(150 * time.Millisecond)
		return n, nil
	}
	return 0, last
}

// ---- pages and endpoints ----

// Utility: small tools (volumetric dosing, unit converter, redose timer) that
// run in the browser, so they also work in the app without internet.
func Utility(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, "html/utility.html")
}

func Replications(w http.ResponseWriter, r *http.Request) {
	session, _ := sessionFromRequest(r)
	t, err := template.ParseFiles("html/replications.html")
	if err != nil {
		http.Error(w, "Couldnt load page", http.StatusBadRequest)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	if err := t.Execute(w, struct{ Admin bool }{session.Authority == "admin"}); err != nil {
		fmt.Println(err)
	}
}

// replicationsList: GET every backed-up picture (gzipped, it can be a long list); admins also get the backup's progress.
func replicationsList(w http.ResponseWriter, r *http.Request) {
	session, _ := sessionFromRequest(r)
	out := struct {
		Updated int64         `json:"updated"`
		Items   []replication `json:"items"`
		Bytes   int64         `json:"bytes"`
		Admin   bool          `json:"admin"`
		Status  *replStatus   `json:"status,omitempty"`
	}{Admin: session.Authority == "admin"}
	replIdxMu.Lock()
	idx := replLoaded()
	out.Updated = idx.Updated
	out.Items = append([]replication{}, idx.Items...)
	replIdxMu.Unlock()
	for _, it := range out.Items {
		out.Bytes += it.Bytes
	}
	if out.Admin {
		replMu.Lock()
		st := replState
		replMu.Unlock()
		out.Status = &st
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Vary", "Accept-Encoding")
		gz := gzip.NewWriter(w)
		defer gz.Close()
		json.NewEncoder(gz).Encode(out)
		return
	}
	json.NewEncoder(w).Encode(out)
}

// replicationsFile serves /replications/files/<name> and /replications/thumbs/<name>.
func replicationsFile(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/replications/")
	dir, name, ok := strings.Cut(rest, "/")
	if !ok || (dir != "files" && dir != "thumbs") || name == "" || name != filepath.Base(name) || strings.HasPrefix(name, ".") || !replExtOK(strings.ToLower(filepath.Ext(name))) {
		http.NotFound(w, r)
		return
	}
	p := filepath.Join(replicationsDir, dir, name)
	if info, err := os.Stat(p); err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=604800")
	http.ServeFile(w, r, p)
}

// replicationsBackup (admins): GET the progress; POST {action: "start" | "stop" | "remove", name}.
func replicationsBackup(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var in struct {
			Action string `json:"action"`
			Name   string `json:"name"`
		}
		if json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&in) != nil {
			http.Error(w, "Bad request.", http.StatusBadRequest)
			return
		}
		switch in.Action {
		case "start":
			startReplicationsBackup()
		case "stop":
			replMu.Lock()
			if replState.Running {
				replStop = true
				replState.Phase = "Stopping…"
			}
			replMu.Unlock()
		case "remove":
			replIdxMu.Lock()
			idx := replLoaded()
			kept := idx.Items[:0]
			var gone *replication
			for i := range idx.Items {
				if idx.Items[i].Name == in.Name && gone == nil {
					it := idx.Items[i]
					gone = &it
					continue
				}
				kept = append(kept, idx.Items[i])
			}
			idx.Items = kept
			if gone != nil {
				idx.Removed = append(idx.Removed, gone.Name)
				os.Remove(filepath.Join(replicationsDir, "files", filepath.Base(gone.File)))
				if gone.Thumb != "" {
					os.Remove(filepath.Join(replicationsDir, "thumbs", filepath.Base(gone.Thumb)))
				}
			}
			err := replSave()
			replIdxMu.Unlock()
			if gone == nil {
				http.Error(w, "That picture isn't in the backup.", http.StatusNotFound)
				return
			}
			if err != nil {
				http.Error(w, "Couldn't save the list.", http.StatusInternalServerError)
				return
			}
		default:
			http.Error(w, "Bad request.", http.StatusBadRequest)
			return
		}
	} else if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	replMu.Lock()
	st := replState
	replMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(st)
}

// ---- Phone sync ----
//
// A member with Files access picks folders on their Profile; the Android and
// iOS apps copy those folders into "Geek4u" in the phone's Files and keep them
// matching the server (new and changed files come down, removed ones go).

const syncMaxFiles = 20000

// syncChosen is the account's picked folders that it may still open.
func syncChosen(s cookiesStruct, g filesGrant) []string {
	var raw string
	db.QueryRow("SELECT folders FROM phone_sync WHERE user_id = ?", s.UserId).Scan(&raw)
	var picked []string
	json.Unmarshal([]byte(raw), &picked)
	out := []string{}
	for _, f := range picked {
		if g.allows(f) {
			out = append(out, f)
		}
	}
	return out
}

// syncFolders: GET answers {access, available, chosen}; POST {folders} saves the pick.
func syncFolders(w http.ResponseWriter, r *http.Request) {
	s, _ := sessionFromRequest(r)
	g, ok := filesGrantFor(s)
	switch r.Method {
	case http.MethodGet:
		if !ok {
			writeJSON(w, map[string]any{"access": false, "available": []string{}, "chosen": []string{}})
			return
		}
		available := []string{}
		for _, f := range uploadFolders() {
			if g.allows(f) {
				available = append(available, f)
			}
		}
		writeJSON(w, map[string]any{"access": true, "available": available, "chosen": syncChosen(s, g)})
	case http.MethodPost:
		if !ok {
			http.Error(w, "You don't have access to Files.", http.StatusForbidden)
			return
		}
		var in struct {
			Folders []string `json:"folders"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in); err != nil {
			http.Error(w, "Bad request.", http.StatusBadRequest)
			return
		}
		keep := []string{}
		seen := map[string]bool{}
		for _, f := range in.Folders {
			f = strings.Trim(filepath.ToSlash(f), "/")
			p, inside := insideUploads(strings.Split(f, "/")...)
			if f == "" || !inside || seen[f] || !g.allows(f) {
				continue
			}
			if st, err := os.Stat(p); err != nil || !st.IsDir() {
				continue
			}
			seen[f] = true
			keep = append(keep, f)
			if len(keep) >= 100 {
				break
			}
		}
		b, _ := json.Marshal(keep)
		if _, err := db.Exec(`INSERT INTO phone_sync (user_id, folders) VALUES (?, ?)
			ON CONFLICT(user_id) DO UPDATE SET folders = excluded.folders`, s.UserId, string(b)); err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't save your sync folders.", http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{"chosen": keep})
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

type syncEntry struct {
	Path  string `json:"path"`
	Size  int64  `json:"size"`
	MTime int64  `json:"mtime"`
}

// syncManifest lists every file in the picked folders: {folders, files:[{path,size,mtime}]}.
func syncManifest(w http.ResponseWriter, r *http.Request) {
	s, _ := sessionFromRequest(r)
	g, ok := filesGrantFor(s)
	if !ok {
		http.Error(w, "You don't have access to Files.", http.StatusForbidden)
		return
	}
	chosen := syncChosen(s, g)
	files := []syncEntry{}
	seen := map[string]bool{}
	truncated := false
	for _, f := range chosen {
		root, inside := insideUploads(strings.Split(f, "/")...)
		if !inside {
			continue
		}
		filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.Type()&fs.ModeSymlink != 0 {
				return nil
			}
			if strings.HasPrefix(d.Name(), ".") && p != root {
				if d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if d.IsDir() {
				return nil
			}
			if len(files) >= syncMaxFiles {
				truncated = true
				return filepath.SkipAll
			}
			rel := uploadRel(p)
			if seen[rel] {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			seen[rel] = true
			files = append(files, syncEntry{Path: rel, Size: info.Size(), MTime: info.ModTime().Unix()})
			return nil
		})
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, map[string]any{"folders": chosen, "files": files, "truncated": truncated})
}

// syncFile sends one file from a picked folder (?path=a/b/c.jpg).
func syncFile(w http.ResponseWriter, r *http.Request) {
	s, _ := sessionFromRequest(r)
	g, ok := filesGrantFor(s)
	rel := strings.Trim(filepath.ToSlash(r.URL.Query().Get("path")), "/")
	if !ok || rel == "" || !g.allows(rel) {
		http.Error(w, "Not allowed.", http.StatusForbidden)
		return
	}
	picked := false
	for _, f := range syncChosen(s, g) {
		if rel == f || strings.HasPrefix(rel, f+"/") {
			picked = true
			break
		}
	}
	p, inside := insideUploads(strings.Split(rel, "/")...)
	st, err := os.Stat(p)
	if !picked || !inside || err != nil || st.IsDir() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Disposition", "attachment")
	http.ServeFile(w, r, p)
}

// ---- Substances Importer (admin) ----
//
// Admins add medications and other substances PsychonautWiki doesn't have.
// They live in custom_substances, apart from anything fetched from
// PsychonautWiki (which is never stored on the server), and the Graph,
// Journal and Drug info read them from /substances/custom.

// secondPeak: a biphasic effect. gap hours after the first peak ends (dipping
// to dip, a share of the first peak), it holds at level for duration hours.
type secondPeak struct {
	Gap      float64 `json:"gap"`
	Dip      float64 `json:"dip"`
	Duration float64 `json:"duration"`
	Level    float64 `json:"level"`
}

func (p *secondPeak) valid() bool {
	return inRange(p.Gap, 0, 240) && inRange(p.Dip, 0, 1) && inRange(p.Duration, 0.01, 240) && inRange(p.Level, 0.01, 1)
}

type rangeValue struct {
	Min *float64 `json:"min,omitempty"`
	Max *float64 `json:"max,omitempty"`
}

type customSubstance struct {
	ID                 int64       `json:"id"`
	Name               string      `json:"name"`
	Aliases            []string    `json:"aliases"`
	Class              string      `json:"class"`
	ChemicalClass      string      `json:"chemicalClass"`
	Summary            string      `json:"summary"`
	HalfLife           *rangeValue `json:"halfLife,omitempty"` // hours
	AddictionPotential string      `json:"addictionPotential"`
	Risks              string      `json:"risks"`
	Notes              string      `json:"notes"`
	Interactions       struct {
		Dangerous []string `json:"dangerous"`
		Unsafe    []string `json:"unsafe"`
		Uncertain []string `json:"uncertain"`
	} `json:"interactions"`
	// The first ingestion method; Methods holds any others.
	Route     string          `json:"route"`
	Units     string          `json:"units"`
	Dose      customDose      `json:"dose"`
	Durations customDurations `json:"durations"`
	Methods   []customMethod  `json:"methods,omitempty"`
	CreatedBy string          `json:"createdBy,omitempty"`
	CreatedAt int64           `json:"createdAt,omitempty"`
	UpdatedAt int64           `json:"updatedAt,omitempty"`
}

type customDose struct {
	Threshold *float64    `json:"threshold,omitempty"`
	Light     *rangeValue `json:"light,omitempty"`
	Common    *rangeValue `json:"common,omitempty"`
	Strong    *rangeValue `json:"strong,omitempty"`
	Heavy     *float64    `json:"heavy,omitempty"`
}

// All in hours, the same shape the Graph draws (js/curve.js).
type customDurations struct {
	Onset         float64     `json:"onset"`
	Comeup        float64     `json:"comeup"`
	Peak          float64     `json:"peak"`
	Comedown      float64     `json:"comedown"`
	ComedownLevel float64     `json:"comedownLevel"`
	Offset        float64     `json:"offset"`
	Peak2         *secondPeak `json:"peak2,omitempty"`
}

// customMethod is one more way to take the substance (rectal, insufflated...)
// with its own doses and timeline.
type customMethod struct {
	Route     string          `json:"route"`
	Dose      customDose      `json:"dose"`
	Durations customDurations `json:"durations"`
}

func cleanList(in []string, maxItems, maxLen int) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, v := range in {
		v = cleanText(v, maxLen)
		if v == "" || seen[strings.ToLower(v)] {
			continue
		}
		seen[strings.ToLower(v)] = true
		out = append(out, v)
		if len(out) >= maxItems {
			break
		}
	}
	return out
}

func okNumber(p *float64, max float64) bool {
	return p == nil || inRange(*p, 0, max)
}

func okRange(r *rangeValue, max float64) bool {
	if r == nil {
		return true
	}
	if !okNumber(r.Min, max) || !okNumber(r.Max, max) {
		return false
	}
	return r.Min == nil || r.Max == nil || *r.Min <= *r.Max
}

// clean checks an entry from the form; the message says what to fix.
func (c *customSubstance) clean() string {
	c.Name = cleanText(c.Name, 80)
	if c.Name == "" {
		return "Give the substance a name."
	}
	c.Aliases = cleanList(c.Aliases, 20, 80)
	c.Class = cleanText(c.Class, 60)
	c.ChemicalClass = cleanText(c.ChemicalClass, 60)
	c.Summary = cleanMultiline(c.Summary, 4000)
	c.AddictionPotential = cleanText(c.AddictionPotential, 120)
	c.Risks = cleanMultiline(c.Risks, 4000)
	c.Notes = cleanMultiline(c.Notes, 4000)
	c.Interactions.Dangerous = cleanList(c.Interactions.Dangerous, 60, 80)
	c.Interactions.Unsafe = cleanList(c.Interactions.Unsafe, 60, 80)
	c.Interactions.Uncertain = cleanList(c.Interactions.Uncertain, 60, 80)
	c.Units = cleanText(c.Units, 12)
	if c.Units == "" {
		c.Units = "mg"
	}
	if !okRange(c.HalfLife, 24*365) {
		return "The half-life needs numbers from 0 up, with the lowest first."
	}
	if msg := cleanCustomMethod(&c.Route, &c.Dose, &c.Durations); msg != "" {
		return msg
	}
	if len(c.Methods) > 12 {
		return "A substance can have at most 13 ingestion methods."
	}
	seen := map[string]bool{c.Route: true}
	for i := range c.Methods {
		m := &c.Methods[i]
		if msg := cleanCustomMethod(&m.Route, &m.Dose, &m.Durations); msg != "" {
			return m.Route + ": " + msg
		}
		if seen[m.Route] {
			return "Each ingestion method can only be added once (" + m.Route + " is there twice)."
		}
		seen[m.Route] = true
	}
	return ""
}

// cleanCustomMethod checks one ingestion method's route, doses and timeline.
func cleanCustomMethod(route *string, d *customDose, t *customDurations) string {
	*route = strings.ToLower(cleanText(*route, 30))
	if *route == "" {
		*route = "oral"
	}
	if !okNumber(d.Threshold, 1e6) || !okNumber(d.Heavy, 1e6) || !okRange(d.Light, 1e6) || !okRange(d.Common, 1e6) || !okRange(d.Strong, 1e6) {
		return "Doses need numbers from 0 up, with the lowest first."
	}
	if d.Common == nil || (d.Common.Min == nil && d.Common.Max == nil) {
		return "Enter a common dose. The Graph scales the curve with it."
	}
	if (d.Common.Min != nil && *d.Common.Min <= 0) || (d.Common.Min == nil && *d.Common.Max <= 0) {
		return "The common dose must be more than 0."
	}
	for _, v := range []float64{t.Onset, t.Comeup, t.Peak, t.Comedown, t.Offset} {
		if !inRange(v, 0, 240) {
			return "Durations must be between 0 and 240 hours."
		}
	}
	if t.Comeup+t.Peak+t.Offset+t.Comedown <= 0 {
		return "Set at least the come-up, peak or offset, so there is a curve to draw."
	}
	if !inRange(t.ComedownLevel, 0, 1) {
		return "The come-down level must be between 0 and 100%."
	}
	if t.Comedown == 0 {
		t.ComedownLevel = 0
	} else if t.ComedownLevel == 0 {
		t.ComedownLevel = 0.35
	}
	if t.Peak2 != nil && t.Peak2.Duration == 0 {
		t.Peak2 = nil // "no second peak"
	}
	if t.Peak2 != nil && !t.Peak2.valid() {
		return "The second peak needs a length, a level between 1 and 100% and a dip between 0 and 100%."
	}
	return ""
}

func loadCustomSubstances() ([]customSubstance, error) {
	rows, err := db.Query(`SELECT c.id, c.data, c.created_at, c.updated_at, COALESCE(u.originalUsername, '')
		FROM custom_substances c LEFT JOIN users u ON u.id = c.created_by ORDER BY lower(c.name)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []customSubstance{}
	for rows.Next() {
		var c customSubstance
		var data string
		var id, created, updated int64
		var by string
		if err := rows.Scan(&id, &data, &created, &updated, &by); err != nil {
			return nil, err
		}
		if json.Unmarshal([]byte(data), &c) != nil {
			continue
		}
		c.ID, c.CreatedAt, c.UpdatedAt, c.CreatedBy = id, created, updated, by
		out = append(out, c)
	}
	return out, rows.Err()
}

func SubstancesImporter(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, "html/substances.html")
}

// publicCustomSubstances lists the custom substances for the Graph, Journal and Drug info.
func publicCustomSubstances(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	list, err := loadCustomSubstances()
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Couldn't load the custom substances.", http.StatusInternalServerError)
		return
	}
	for i := range list {
		list[i].CreatedBy = "" // who added it is for admins only
	}
	writeJSON(w, list)
}

// adminCustomSubstances: GET lists them; POST {..., id} creates (id 0) or
// updates one; POST {id, delete: true} removes one.
func adminCustomSubstances(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := loadCustomSubstances()
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't load the custom substances.", http.StatusInternalServerError)
			return
		}
		writeJSON(w, list)
	case http.MethodPost:
		session, _ := sessionFromRequest(r)
		var in struct {
			customSubstance
			Delete bool `json:"delete"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
			http.Error(w, "Couldn't read that substance.", http.StatusBadRequest)
			return
		}
		if in.Delete {
			if _, err := db.Exec("DELETE FROM custom_substances WHERE id = ?", in.ID); err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't delete that.", http.StatusInternalServerError)
				return
			}
			writeJSON(w, map[string]any{"id": in.ID, "deleted": true})
			return
		}
		c := in.customSubstance
		if msg := c.clean(); msg != "" {
			http.Error(w, msg, http.StatusBadRequest)
			return
		}
		id := c.ID
		c.ID, c.CreatedBy, c.CreatedAt, c.UpdatedAt = 0, "", 0, 0
		body, _ := json.Marshal(c)
		now := time.Now().UnixMilli()
		var err error
		if id > 0 {
			var res sql.Result
			res, err = db.Exec("UPDATE custom_substances SET name = ?, data = ?, updated_at = ? WHERE id = ?", c.Name, string(body), now, id)
			if err == nil {
				if n, _ := res.RowsAffected(); n == 0 {
					http.Error(w, "That substance was deleted meanwhile.", http.StatusNotFound)
					return
				}
			}
		} else {
			var res sql.Result
			res, err = db.Exec("INSERT INTO custom_substances (name, data, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
				c.Name, string(body), session.UserId, now, now)
			if err == nil {
				id, _ = res.LastInsertId()
			}
		}
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				http.Error(w, "There is already a custom substance called "+c.Name+".", http.StatusConflict)
				return
			}
			fmt.Println(err)
			http.Error(w, "Couldn't save that substance.", http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{"id": id, "name": c.Name})
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// ---- Music ----
//
// The music library is the audio files in Files (UploadedFiles) that the
// account may open, so music is uploaded and organised like any other file
// and the Files access an admin gives decides whose music is whose. Each file
// is read once (title, artist, album, length, cover) with ffprobe when it's
// installed, otherwise from its name ("Artist - Title.mp3") and folders, and
// kept in music_tracks; only new or changed files are read again.
//
// Playlists are made on the Music page or imported from Spotify. Spotify only
// gives the list (names, artists, albums, covers): each song is then matched
// to an audio file in the library. Nothing is ever streamed or downloaded from
// Spotify. Owners can share a playlist with friends, who can play it (also
// the songs they couldn't open in Files themselves) but not change it.
//
// Files iPhones can't play (ogg, opus, wma, ape...) are turned into AAC with
// ffmpeg the first time they're played and kept in MusicCache. The iOS app
// keeps playlists on the phone for offline listening (/music/offline).

const musicCacheDir = "MusicCache"
const maxPlaylists = 200
const maxPlaylistTracks = 2000

// Played as they are by Safari, the iOS app and Chrome.
var musicDirect = map[string]string{
	".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav",
	".flac": "audio/flac", ".aif": "audio/aiff", ".aiff": "audio/aiff", ".alac": "audio/mp4",
}

// Turned into AAC (.m4a) with ffmpeg first.
var musicConvert = map[string]bool{
	".ogg": true, ".oga": true, ".opus": true, ".wma": true, ".ape": true, ".wv": true,
	".mka": true, ".webm": true, ".ac3": true, ".dsf": true, ".tta": true,
}

const musicSchema = `
CREATE TABLE IF NOT EXISTS music_tracks (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	path TEXT NOT NULL UNIQUE,
	size INTEGER NOT NULL,
	mtime INTEGER NOT NULL,
	title TEXT NOT NULL DEFAULT '',
	artist TEXT NOT NULL DEFAULT '',
	album TEXT NOT NULL DEFAULT '',
	duration REAL NOT NULL DEFAULT 0,
	has_art INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS music_playlists (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	owner_id INTEGER NOT NULL,
	name TEXT NOT NULL,
	source TEXT NOT NULL DEFAULT 'manual',
	spotify_id TEXT NOT NULL DEFAULT '',
	image TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY(owner_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS music_playlists_by_owner ON music_playlists(owner_id);
CREATE TABLE IF NOT EXISTS music_playlist_tracks (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	playlist_id INTEGER NOT NULL,
	position INTEGER NOT NULL,
	title TEXT NOT NULL,
	artist TEXT NOT NULL DEFAULT '',
	album TEXT NOT NULL DEFAULT '',
	duration_ms INTEGER NOT NULL DEFAULT 0,
	isrc TEXT NOT NULL DEFAULT '',
	spotify_id TEXT NOT NULL DEFAULT '',
	image_url TEXT NOT NULL DEFAULT '',
	track_id INTEGER,
	manual INTEGER NOT NULL DEFAULT 0,
	FOREIGN KEY(playlist_id) REFERENCES music_playlists(id)
);
CREATE INDEX IF NOT EXISTS music_playlist_tracks_by_list ON music_playlist_tracks(playlist_id, position);
CREATE TABLE IF NOT EXISTS music_playlist_shares (
	playlist_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	added_at INTEGER NOT NULL,
	PRIMARY KEY(playlist_id, user_id),
	FOREIGN KEY(playlist_id) REFERENCES music_playlists(id),
	FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS music_playlist_shares_by_user ON music_playlist_shares(user_id);
`

type musicTrack struct {
	ID       int64   `json:"id"`
	Path     string  `json:"-"`
	Size     int64   `json:"size"`
	MTime    int64   `json:"-"`
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Album    string  `json:"album"`
	Duration float64 `json:"duration"`
	HasArt   bool    `json:"art"`
	Version  string  `json:"v"`
	Playable bool    `json:"playable"`
	Folder   string  `json:"folder"`
}

func (t *musicTrack) fill() {
	t.Version = strconv.FormatInt(t.MTime, 36) + strconv.FormatInt(t.Size, 36)
	ext := strings.ToLower(filepath.Ext(t.Path))
	t.Playable = musicDirect[ext] != "" || musicConvert[ext] && ffmpegPath() != ""
	t.Folder = ""
	if i := strings.LastIndex(t.Path, "/"); i > 0 {
		t.Folder = t.Path[:i]
	}
}

var musicMu sync.Mutex // guards the scan state below
var musicScanning bool
var musicScannedAt time.Time

var ffOnce sync.Once
var ffmpegBin, ffprobeBin string

// ffmpegPath is ffmpeg's location, "" when it isn't installed (PATH, or next to the server).
func ffmpegPath() string {
	ffOnce.Do(func() {
		exeDir := ""
		if exe, err := os.Executable(); err == nil {
			exeDir = filepath.Dir(exe)
		}
		find := func(name string) string {
			if p, err := exec.LookPath(name); err == nil {
				return p
			}
			candidates := []string{name, name + ".exe", filepath.Join("ffmpeg", "bin", name+".exe"), filepath.Join("ffmpeg", "bin", name)}
			if exeDir != "" {
				candidates = append([]string{
					filepath.Join(exeDir, name),
					filepath.Join(exeDir, name+".exe"),
					filepath.Join(exeDir, "ffmpeg", "bin", name+".exe"),
					filepath.Join(exeDir, "ffmpeg", "bin", name),
				}, candidates...)
			}
			for _, cand := range candidates {
				if st, err := os.Stat(cand); err == nil && !st.IsDir() {
					abs, _ := filepath.Abs(cand)
					return abs
				}
			}
			return ""
		}
		ffmpegBin, ffprobeBin = find("ffmpeg"), find("ffprobe")
		if ffmpegBin == "" {
			fmt.Println("Music: ffmpeg not found, so ogg/opus/wma files won't play and covers come only from cover.jpg files.")
		}
	})
	return ffmpegBin
}

func isMusicFile(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return musicDirect[ext] != "" || musicConvert[ext]
}

// musicGuess fills in a song's details from its file name and folders:
// "Artist - Title", "01 - Title" or "01. Artist - Title", with the folder as album.
func musicGuess(rel string) (title, artist, album string) {
	parts := strings.Split(rel, "/")
	base := strings.TrimSuffix(parts[len(parts)-1], filepath.Ext(parts[len(parts)-1]))
	base = strings.TrimSpace(strings.ReplaceAll(base, "_", " "))
	base = strings.TrimLeft(regexp.MustCompile(`^\d{1,3}\s*[-.)]?\s+`).ReplaceAllString(base, ""), " ")
	if i := strings.Index(base, " - "); i > 0 {
		artist, title = strings.TrimSpace(base[:i]), strings.TrimSpace(base[i+3:])
	} else {
		title = base
	}
	if len(parts) >= 2 {
		album = parts[len(parts)-2]
	}
	if artist == "" && len(parts) >= 4 { // Artist/Album/song, inside a top folder
		artist = parts[len(parts)-3]
	}
	return
}

// musicProbe reads a file's tags with ffprobe. ok is false without ffprobe or on a bad file.
func musicProbe(p string) (title, artist, album string, duration float64, art bool, ok bool) {
	if ffmpegPath(); ffprobeBin == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, ffprobeBin, "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", p).Output()
	if err != nil {
		return
	}
	var info struct {
		Format struct {
			Duration string            `json:"duration"`
			Tags     map[string]string `json:"tags"`
		} `json:"format"`
		Streams []struct {
			CodecType   string            `json:"codec_type"`
			Disposition map[string]int    `json:"disposition"`
			Tags        map[string]string `json:"tags"`
		} `json:"streams"`
	}
	if json.Unmarshal(out, &info) != nil {
		return
	}
	tags := map[string]string{}
	add := func(m map[string]string) {
		for k, v := range m {
			k = strings.ToLower(k)
			if tags[k] == "" {
				tags[k] = strings.TrimSpace(v)
			}
		}
	}
	add(info.Format.Tags)
	for _, s := range info.Streams {
		if s.CodecType == "audio" {
			add(s.Tags) // ogg/opus keep their tags on the stream
		}
		if s.CodecType == "video" && s.Disposition["attached_pic"] == 1 {
			art = true
		}
	}
	title, album = tags["title"], tags["album"]
	artist = tags["artist"]
	if artist == "" {
		artist = tags["album_artist"]
	}
	duration, _ = strconv.ParseFloat(info.Format.Duration, 64)
	return cleanText(title, 200), cleanText(artist, 200), cleanText(album, 200), duration, art, true
}

// musicScan brings music_tracks up to date with the audio files in UploadedFiles.
func musicScan() {
	known := map[string]musicTrack{}
	rows, err := db.Query("SELECT id, path, size, mtime FROM music_tracks")
	if err == nil {
		for rows.Next() {
			var t musicTrack
			if rows.Scan(&t.ID, &t.Path, &t.Size, &t.MTime) == nil {
				known[t.Path] = t
			}
		}
		rows.Close()
	}
	seen := map[string]bool{}
	changed := false
	filepath.WalkDir(UploadedFilesDirName, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.Type()&fs.ModeSymlink != 0 {
			return nil
		}
		if strings.HasPrefix(d.Name(), ".") && p != UploadedFilesDirName {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() || !isMusicFile(d.Name()) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		rel := uploadRel(p)
		seen[rel] = true
		old, had := known[rel]
		if had && old.Size == info.Size() && old.MTime == info.ModTime().Unix() {
			return nil
		}
		title, artist, album, duration, art, ok := musicProbe(p)
		gt, ga, gal := musicGuess(rel)
		if !ok || title == "" {
			title = gt
		}
		if artist == "" {
			artist = ga
		}
		if album == "" {
			album = gal
		}
		if _, err := db.Exec(`INSERT INTO music_tracks (path, size, mtime, title, artist, album, duration, has_art) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, title = excluded.title,
			artist = excluded.artist, album = excluded.album, duration = excluded.duration, has_art = excluded.has_art`,
			rel, info.Size(), info.ModTime().Unix(), title, artist, album, duration, boolInt(art)); err != nil {
			fmt.Println("music scan:", err)
		}
		changed = true
		return nil
	})
	for path, t := range known {
		if !seen[path] {
			db.Exec("DELETE FROM music_tracks WHERE id = ?", t.ID)
			db.Exec("UPDATE music_playlist_tracks SET track_id = NULL, manual = 0 WHERE track_id = ?", t.ID)
			changed = true
		}
	}
	if changed {
		musicRematchAll()
	}
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// musicRefresh starts a library scan in the background when the last one is
// over 30 seconds old (wait: finish it first). It answers whether one is running.
func musicRefresh(wait bool) bool {
	musicMu.Lock()
	if musicScanning || time.Since(musicScannedAt) < 30*time.Second {
		running := musicScanning
		musicMu.Unlock()
		return running
	}
	musicScanning = true
	musicMu.Unlock()
	done := make(chan struct{})
	go func() {
		defer close(done)
		musicScan()
		musicMu.Lock()
		musicScanning, musicScannedAt = false, time.Now()
		musicMu.Unlock()
	}()
	if wait {
		select {
		case <-done:
			return false
		case <-time.After(8 * time.Second):
		}
	}
	return true
}

func loadMusicTracks(where string, args ...any) []musicTrack {
	out := []musicTrack{}
	rows, err := db.Query("SELECT id, path, size, mtime, title, artist, album, duration, has_art FROM music_tracks "+where, args...)
	if err != nil {
		fmt.Println(err)
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var t musicTrack
		var art int
		if rows.Scan(&t.ID, &t.Path, &t.Size, &t.MTime, &t.Title, &t.Artist, &t.Album, &t.Duration, &art) == nil {
			t.HasArt = art == 1
			t.fill()
			out = append(out, t)
		}
	}
	return out
}

// musicLibraryFor is every song the account may open in Files.
func musicLibraryFor(s cookiesStruct) []musicTrack {
	g, ok := filesGrantFor(s)
	if !ok {
		return []musicTrack{}
	}
	all := loadMusicTracks("ORDER BY lower(artist), lower(album), lower(title)")
	if g.All {
		return all
	}
	out := []musicTrack{}
	for _, t := range all {
		if g.allows(t.Path) {
			out = append(out, t)
		}
	}
	return out
}

// ---- matching Spotify songs to files ----

var musicNoise = regexp.MustCompile(`(?i)\s*[\(\[][^\)\]]*[\)\]]|\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo|deluxe|bonus).*$|\s+(feat\.?|ft\.?|featuring)\s.*$`)
var musicAccents = strings.NewReplacer("á", "a", "à", "a", "â", "a", "ä", "a", "ã", "a", "å", "a", "æ", "ae", "ç", "c",
	"é", "e", "è", "e", "ê", "e", "ë", "e", "í", "i", "ì", "i", "î", "i", "ï", "i", "ñ", "n", "ó", "o", "ò", "o",
	"ô", "o", "ö", "o", "õ", "o", "ø", "o", "ú", "u", "ù", "u", "û", "u", "ü", "u", "ý", "y", "ÿ", "y", "ß", "ss", "&", " and ")

// musicNorm makes names comparable: "Don't Stop (2011 Remaster)" -> "dont stop".
func musicNorm(s string) string {
	s = musicAccents.Replace(strings.ToLower(musicNoise.ReplaceAllString(s, "")))
	var b strings.Builder
	space := false
	for _, r := range s {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			space = false
		case r == '\'' || r == '’' || r == '.':
		default:
			if !space && b.Len() > 0 {
				b.WriteByte(' ')
				space = true
			}
		}
	}
	return strings.TrimSpace(b.String())
}

// firstArtist: "A, B & C" -> "a".
func firstArtist(s string) string {
	for _, sep := range []string{",", ";", " & ", " x ", " feat", " ft."} {
		if i := strings.Index(strings.ToLower(s), sep); i > 0 {
			s = s[:i]
		}
	}
	return musicNorm(s)
}

type musicCandidate struct {
	id                 int64
	title, artist, all string
	duration           float64
}

func musicCandidates(tracks []musicTrack) []musicCandidate {
	out := make([]musicCandidate, 0, len(tracks))
	for _, t := range tracks {
		if !t.Playable {
			continue
		}
		gt, ga, _ := musicGuess(t.Path)
		out = append(out, musicCandidate{
			id: t.ID, title: musicNorm(t.Title), artist: musicNorm(t.Artist), duration: t.Duration,
			all: " " + musicNorm(t.Title+" "+t.Artist+" "+gt+" "+ga+" "+strings.TrimSuffix(filepath.Base(t.Path), filepath.Ext(t.Path))) + " ",
		})
	}
	return out
}

// musicMatch finds the library file for one song, 0 when none fits well enough.
func musicMatch(cands []musicCandidate, title, artist string, durationMs int64) int64 {
	nt, na := musicNorm(title), firstArtist(artist)
	if nt == "" {
		return 0
	}
	best, bestScore := int64(0), 0
	for _, c := range cands {
		score := 0
		switch {
		case c.title == nt:
			score = 4
		case strings.Contains(c.all, " "+nt+" "):
			score = 2
		default:
			continue
		}
		switch {
		case na == "":
		case c.artist != "" && (strings.Contains(c.artist, na) || strings.Contains(na, c.artist)):
			score += 3
		case strings.Contains(c.all, " "+na+" "):
			score += 2
		case c.artist != "":
			score -= 3 // same title, someone else's song
		}
		if durationMs > 0 && c.duration > 0 {
			diff := math.Abs(c.duration - float64(durationMs)/1000)
			if diff <= 4 {
				score++
			} else if diff > 30 {
				score--
			}
		}
		if score > bestScore {
			best, bestScore = c.id, score
		}
	}
	if bestScore >= 4 {
		return best
	}
	return 0
}

// musicRematch matches a playlist's songs that have no file yet (or lost it),
// against the owner's library. Songs matched by hand are left alone.
func musicRematch(playlistID int64) {
	var owner int
	if db.QueryRow("SELECT owner_id FROM music_playlists WHERE id = ?", playlistID).Scan(&owner) != nil {
		return
	}
	var authority string
	db.QueryRow("SELECT authority FROM users WHERE id = ?", owner).Scan(&authority)
	cands := musicCandidates(musicLibraryFor(cookiesStruct{UserId: owner, Authority: authority}))
	type row struct {
		id       int64
		title    string
		artist   string
		duration int64
	}
	var todo []row
	rows, err := db.Query("SELECT id, title, artist, duration_ms FROM music_playlist_tracks WHERE playlist_id = ? AND track_id IS NULL AND manual = 0", playlistID)
	if err != nil {
		return
	}
	for rows.Next() {
		var r row
		if rows.Scan(&r.id, &r.title, &r.artist, &r.duration) == nil {
			todo = append(todo, r)
		}
	}
	rows.Close()
	for _, r := range todo {
		if id := musicMatch(cands, r.title, r.artist, r.duration); id > 0 {
			db.Exec("UPDATE music_playlist_tracks SET track_id = ? WHERE id = ?", id, r.id)
		}
	}
}

func musicRematchAll() {
	var ids []int64
	rows, err := db.Query("SELECT DISTINCT playlist_id FROM music_playlist_tracks WHERE track_id IS NULL AND manual = 0")
	if err != nil {
		return
	}
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		musicRematch(id)
	}
}

// ---- who may see what ----

// musicPlaylistRole: "owner", "shared" (a friend it was shared with) or "".
func musicPlaylistRole(id int64, me int) string {
	var owner int
	if db.QueryRow("SELECT owner_id FROM music_playlists WHERE id = ?", id).Scan(&owner) != nil {
		return ""
	}
	if owner == me {
		return "owner"
	}
	var n int
	db.QueryRow("SELECT COUNT(*) FROM music_playlist_shares WHERE playlist_id = ? AND user_id = ?", id, me).Scan(&n)
	if n > 0 && friendState(me, owner) == "friends" {
		return "shared"
	}
	return ""
}

// musicCanPlay: the file is in the account's Files access, or on a playlist it owns or was shared.
func musicCanPlay(s cookiesStruct, t musicTrack) bool {
	if g, ok := filesGrantFor(s); ok && g.allows(t.Path) {
		return true
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM music_playlist_tracks pt JOIN music_playlists p ON p.id = pt.playlist_id
		WHERE pt.track_id = ? AND (p.owner_id = ? OR EXISTS (SELECT 1 FROM music_playlist_shares sh WHERE sh.playlist_id = p.id AND sh.user_id = ?))`,
		t.ID, s.UserId, s.UserId).Scan(&n)
	return n > 0
}

func musicTrackByID(raw string) (musicTrack, bool) {
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return musicTrack{}, false
	}
	list := loadMusicTracks("WHERE id = ?", id)
	if len(list) == 0 {
		return musicTrack{}, false
	}
	return list[0], true
}

// ---- pages and answers ----

func Music(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, "html/music.html")
}

// musicLibrary: GET answers {tracks, scanning, ffmpeg, access}. ?wait=1 waits for a scan.
func musicLibrary(w http.ResponseWriter, r *http.Request) {
	s, _ := sessionFromRequest(r)
	_, access := filesGrantFor(s)
	scanning := false
	if access {
		scanning = musicRefresh(r.URL.Query().Get("wait") == "1")
	}
	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, map[string]any{"tracks": musicLibraryFor(s), "scanning": scanning, "ffmpeg": ffmpegPath() != "", "access": access,
		"libraryIcon": sitePictureLink("musicLibrary"), "admin": s.Authority == "admin"})
}

type playlistSummary struct {
	ID      int64       `json:"id"`
	Name    string      `json:"name"`
	Source  string      `json:"source"`
	Image   string      `json:"image"`
	Count   int         `json:"count"`
	Matched int         `json:"matched"`
	Owner   *postAuthor `json:"owner,omitempty"`
	Updated int64       `json:"updated"`
}

type playlistSong struct {
	ID       int64       `json:"id"`
	Title    string      `json:"title"`
	Artist   string      `json:"artist"`
	Album    string      `json:"album"`
	Duration int64       `json:"durationMs"`
	Image    string      `json:"image"`
	Spotify  string      `json:"spotify"`
	Manual   bool        `json:"manual"`
	Track    *musicTrack `json:"track"`
}

func playlistCover(id int64, image string) string {
	if image == "" {
		return ""
	}
	return fmt.Sprintf("/music/cover/%d?v=%s", id, image)
}

func musicPlaylistSummaries(query string, args ...any) []playlistSummary {
	out := []playlistSummary{}
	rows, err := db.Query(`SELECT p.id, p.name, p.source, p.image, p.updated_at, u.originalUsername, u.pathToProfilePic, u.authority,
		(SELECT COUNT(*) FROM music_playlist_tracks t WHERE t.playlist_id = p.id),
		(SELECT COUNT(*) FROM music_playlist_tracks t WHERE t.playlist_id = p.id AND t.track_id IS NOT NULL)
		FROM music_playlists p JOIN users u ON u.id = p.owner_id `+query, args...)
	if err != nil {
		fmt.Println(err)
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var p playlistSummary
		var name, avatar, authority string
		if rows.Scan(&p.ID, &p.Name, &p.Source, &p.Image, &p.Updated, &name, &avatar, &authority, &p.Count, &p.Matched) == nil {
			a := person(name, avatar, authority)
			p.Owner = &a
			p.Image = playlistCover(p.ID, p.Image)
			out = append(out, p)
		}
	}
	return out
}

func musicPlaylistSongs(id int64) []playlistSong {
	out := []playlistSong{}
	tracks := map[int64]musicTrack{}
	for _, t := range loadMusicTracks("WHERE id IN (SELECT track_id FROM music_playlist_tracks WHERE playlist_id = ?)", id) {
		tracks[t.ID] = t
	}
	rows, err := db.Query(`SELECT id, title, artist, album, duration_ms, image_url, spotify_id, manual, track_id
		FROM music_playlist_tracks WHERE playlist_id = ? ORDER BY position, id`, id)
	if err != nil {
		fmt.Println(err)
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var s playlistSong
		var manual int
		var track sql.NullInt64
		if rows.Scan(&s.ID, &s.Title, &s.Artist, &s.Album, &s.Duration, &s.Image, &s.Spotify, &manual, &track) != nil {
			continue
		}
		s.Manual = manual == 1
		if t, ok := tracks[track.Int64]; track.Valid && ok {
			t := t
			s.Track = &t
		}
		out = append(out, s)
	}
	return out
}

// musicPlaylists: GET lists {own, shared}; GET ?id= answers one playlist with its songs.
// POST {action, ...} changes one (see the switch below).
func musicPlaylists(w http.ResponseWriter, r *http.Request) {
	s, _ := sessionFromRequest(r)
	me := s.UserId
	w.Header().Set("Cache-Control", "no-cache")
	if r.Method == http.MethodGet {
		if raw := r.URL.Query().Get("id"); raw != "" {
			id, _ := strconv.ParseInt(raw, 10, 64)
			role := musicPlaylistRole(id, me)
			if role == "" {
				http.Error(w, "That playlist was deleted, or isn't shared with you.", http.StatusNotFound)
				return
			}
			if role == "owner" {
				musicRematch(id)
			}
			list := musicPlaylistSummaries("WHERE p.id = ?", id)
			if len(list) == 0 {
				http.NotFound(w, r)
				return
			}
			var spotify string
			db.QueryRow("SELECT spotify_id FROM music_playlists WHERE id = ?", id).Scan(&spotify)
			shares := []postAuthor{}
			if role == "owner" {
				shares = orNobody(musicShares(id))
				if shares == nil {
					shares = []postAuthor{}
				}
			}
			writeJSON(w, map[string]any{"playlist": list[0], "mine": role == "owner", "spotify": spotify, "shares": shares, "songs": musicPlaylistSongs(id)})
			return
		}
		writeJSON(w, map[string]any{
			"own":    musicPlaylistSummaries("WHERE p.owner_id = ? ORDER BY p.updated_at DESC", me),
			"shared": musicSharedWith(me),
		})
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in struct {
		Action string   `json:"action"`
		ID     int64    `json:"id"`
		Name   string   `json:"name"`
		Tracks []int64  `json:"tracks"` // library songs to add
		Song   int64    `json:"song"`   // a playlist row
		Track  int64    `json:"track"`  // a library song (0 = no file)
		Order  []int64  `json:"order"`  // playlist rows in their new order
		People []string `json:"people"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&in); err != nil {
		http.Error(w, "Couldn't read that.", http.StatusBadRequest)
		return
	}
	now := time.Now().UnixMilli()
	if in.Action == "create" {
		name := cleanText(in.Name, 100)
		if name == "" {
			http.Error(w, "Give the playlist a name.", http.StatusBadRequest)
			return
		}
		var n int
		db.QueryRow("SELECT COUNT(*) FROM music_playlists WHERE owner_id = ?", me).Scan(&n)
		if n >= maxPlaylists {
			http.Error(w, fmt.Sprintf("You have %d playlists, the most there can be. Delete one first.", maxPlaylists), http.StatusBadRequest)
			return
		}
		res, err := db.Exec("INSERT INTO music_playlists (owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)", me, name, now, now)
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't make the playlist. Try again.", http.StatusInternalServerError)
			return
		}
		id, _ := res.LastInsertId()
		in.ID = id
		if len(in.Tracks) > 0 {
			in.Action = "add"
		} else {
			writeJSON(w, map[string]any{"id": id})
			return
		}
	}
	if musicPlaylistRole(in.ID, me) != "owner" {
		http.Error(w, "That playlist was deleted, or isn't yours to change.", http.StatusNotFound)
		return
	}
	var err error
	touch := true
	switch in.Action {
	case "rename":
		name := cleanText(in.Name, 100)
		if name == "" {
			http.Error(w, "Give the playlist a name.", http.StatusBadRequest)
			return
		}
		_, err = db.Exec("UPDATE music_playlists SET name = ? WHERE id = ?", name, in.ID)
	case "delete":
		touch = false
		for _, q := range []string{"DELETE FROM music_playlist_tracks WHERE playlist_id = ?", "DELETE FROM music_playlist_shares WHERE playlist_id = ?", "DELETE FROM music_playlists WHERE id = ?"} {
			if _, e := db.Exec(q, in.ID); e != nil {
				err = e
			}
		}
		os.Remove(filepath.Join(musicCacheDir, "covers", fmt.Sprintf("%d.jpg", in.ID)))
	case "add":
		var count, pos int
		db.QueryRow("SELECT COUNT(*), COALESCE(MAX(position), 0) FROM music_playlist_tracks WHERE playlist_id = ?", in.ID).Scan(&count, &pos)
		allowed := map[int64]musicTrack{}
		for _, t := range musicLibraryFor(s) {
			allowed[t.ID] = t
		}
		for _, tid := range in.Tracks {
			t, ok := allowed[tid]
			if !ok || count >= maxPlaylistTracks {
				continue
			}
			pos++
			count++
			if _, e := db.Exec(`INSERT INTO music_playlist_tracks (playlist_id, position, title, artist, album, duration_ms, track_id, manual)
				VALUES (?, ?, ?, ?, ?, ?, ?, 1)`, in.ID, pos, t.Title, t.Artist, t.Album, int64(t.Duration*1000), t.ID); e != nil {
				err = e
			}
		}
	case "remove":
		_, err = db.Exec("DELETE FROM music_playlist_tracks WHERE id = ? AND playlist_id = ?", in.Song, in.ID)
	case "move":
		tx, e := db.Begin()
		if e == nil {
			for i, sid := range in.Order {
				if _, e = tx.Exec("UPDATE music_playlist_tracks SET position = ? WHERE id = ? AND playlist_id = ?", i+1, sid, in.ID); e != nil {
					break
				}
			}
			if e == nil {
				e = tx.Commit()
			} else {
				tx.Rollback()
			}
		}
		err = e
	case "match":
		// Pick the file for a song by hand (track 0: "no file", and stop guessing).
		if in.Track == 0 {
			_, err = db.Exec("UPDATE music_playlist_tracks SET track_id = NULL, manual = 1 WHERE id = ? AND playlist_id = ?", in.Song, in.ID)
			break
		}
		ok := false
		for _, t := range musicLibraryFor(s) {
			if t.ID == in.Track {
				ok = true
				break
			}
		}
		if !ok {
			http.Error(w, "That file isn't in your music.", http.StatusForbidden)
			return
		}
		_, err = db.Exec("UPDATE music_playlist_tracks SET track_id = ?, manual = 1 WHERE id = ? AND playlist_id = ?", in.Track, in.Song, in.ID)
	case "unmatch":
		// Let the server guess again.
		_, err = db.Exec("UPDATE music_playlist_tracks SET track_id = NULL, manual = 0 WHERE id = ? AND playlist_id = ?", in.Song, in.ID)
		if err == nil {
			musicRematch(in.ID)
		}
	case "share":
		var ids []int
		seen := map[int]bool{}
		for _, name := range in.People {
			id, ok := userByName(name)
			if !ok || id == me || seen[id] {
				continue
			}
			if friendState(me, id) != "friends" {
				http.Error(w, "You can only share with friends, and "+cleanText(name, 40)+" isn't one.", http.StatusForbidden)
				return
			}
			seen[id] = true
			ids = append(ids, id)
		}
		if len(ids) > 50 {
			http.Error(w, "A playlist can be shared with up to 50 friends.", http.StatusBadRequest)
			return
		}
		tx, e := db.Begin()
		if e == nil {
			_, e = tx.Exec("DELETE FROM music_playlist_shares WHERE playlist_id = ?", in.ID)
			for i, id := range ids {
				if e != nil {
					break
				}
				_, e = tx.Exec("INSERT INTO music_playlist_shares (playlist_id, user_id, added_at) VALUES (?, ?, ?)", in.ID, id, now+int64(i))
			}
			if e == nil {
				e = tx.Commit()
			} else {
				tx.Rollback()
			}
		}
		err = e
	case "resync":
		var spotify string
		db.QueryRow("SELECT spotify_id FROM music_playlists WHERE id = ?", in.ID).Scan(&spotify)
		if spotify == "" {
			http.Error(w, "This playlist didn't come from Spotify.", http.StatusBadRequest)
			return
		}
		pl, e := spotifyPlaylist(spotify)
		if e != nil {
			http.Error(w, e.Error(), http.StatusBadGateway)
			return
		}
		err = musicStoreImport(in.ID, pl, true)
	default:
		http.Error(w, "Unknown action.", http.StatusBadRequest)
		return
	}
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Couldn't change the playlist. Try again.", http.StatusInternalServerError)
		return
	}
	if touch {
		db.Exec("UPDATE music_playlists SET updated_at = ? WHERE id = ?", now, in.ID)
	}
	writeJSON(w, map[string]any{"id": in.ID})
}

func musicShares(id int64) []postAuthor {
	out := []postAuthor{}
	rows, err := db.Query(`SELECT u.originalUsername, u.pathToProfilePic, u.authority FROM music_playlist_shares s
		JOIN users u ON u.id = s.user_id WHERE s.playlist_id = ? ORDER BY s.added_at`, id)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var name, avatar, authority string
		if rows.Scan(&name, &avatar, &authority) == nil {
			out = append(out, person(name, avatar, authority))
		}
	}
	return out
}

// musicSharedWith: playlists friends shared with me (only while we're still friends).
func musicSharedWith(me int) []playlistSummary {
	out := []playlistSummary{}
	states := friendStates(me)
	for _, p := range musicPlaylistSummaries("WHERE p.id IN (SELECT playlist_id FROM music_playlist_shares WHERE user_id = ?) ORDER BY p.updated_at DESC", me) {
		var owner int
		db.QueryRow("SELECT owner_id FROM music_playlists WHERE id = ?", p.ID).Scan(&owner)
		if states[owner] == "friends" {
			out = append(out, p)
		}
	}
	return out
}

// ---- Spotify (playlist details only) ----

type spotifySong struct {
	Title, Artist, Album, ISRC, ID, Image string
	DurationMs                            int64
}

type spotifyList struct {
	Name, Image string
	Songs       []spotifySong
}

var spotifyMu sync.Mutex
var spotifyToken string
var spotifyTokenUntil time.Time

// spotifyCredentials come from SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET, or
// spotify.json ({"clientId": "...", "clientSecret": "..."}) next to the server.
func spotifyCredentials() (string, string) {
	id, secret := os.Getenv("SPOTIFY_CLIENT_ID"), os.Getenv("SPOTIFY_CLIENT_SECRET")
	if id != "" && secret != "" {
		return id, secret
	}
	var f struct {
		ClientID     string `json:"clientId"`
		ClientSecret string `json:"clientSecret"`
	}
	if b, err := os.ReadFile("spotify.json"); err == nil && json.Unmarshal(b, &f) == nil {
		return strings.TrimSpace(f.ClientID), strings.TrimSpace(f.ClientSecret)
	}
	return "", ""
}

var errNoSpotify = errors.New("Spotify import isn't set up on the server yet. An admin needs to add a Spotify app's client ID and secret (spotify.json next to the server). Until then, paste the song list instead.")

func spotifyAuth() (string, error) {
	spotifyMu.Lock()
	defer spotifyMu.Unlock()
	if spotifyToken != "" && time.Now().Before(spotifyTokenUntil) {
		return spotifyToken, nil
	}
	id, secret := spotifyCredentials()
	if id == "" || secret == "" {
		return "", errNoSpotify
	}
	req, _ := http.NewRequest("POST", "https://accounts.spotify.com/api/token", strings.NewReader("grant_type=client_credentials"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(id+":"+secret)))
	res, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return "", errors.New("Couldn't reach Spotify. Try again later.")
	}
	defer res.Body.Close()
	var out struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if res.StatusCode != 200 || json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&out) != nil || out.AccessToken == "" {
		return "", errors.New("Spotify didn't accept the server's client ID and secret.")
	}
	spotifyToken, spotifyTokenUntil = out.AccessToken, time.Now().Add(time.Duration(out.ExpiresIn-60)*time.Second)
	return spotifyToken, nil
}

func spotifyGet(link string, into any) error {
	token, err := spotifyAuth()
	if err != nil {
		return err
	}
	req, _ := http.NewRequest("GET", link, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return errors.New("Couldn't reach Spotify. Try again later.")
	}
	defer res.Body.Close()
	switch res.StatusCode {
	case 200:
	case 404, 400:
		return errors.New("Spotify can't find that playlist. It must be public; Spotify's own mixes (like Discover Weekly) can't be read by apps.")
	case 401:
		spotifyMu.Lock()
		spotifyToken = ""
		spotifyMu.Unlock()
		return errors.New("Spotify turned the server away. Try again.")
	case 429:
		return errors.New("Spotify says too many requests. Try again in a minute.")
	default:
		return fmt.Errorf("Spotify answered %d. Try again later.", res.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(res.Body, 16<<20)).Decode(into)
}

var spotifyIDPattern = regexp.MustCompile(`(?:playlist[/:])([A-Za-z0-9]{10,40})`)

// spotifyPlaylistID takes a link, a spotify:playlist: URI or a bare ID.
func spotifyPlaylistID(s string) string {
	s = strings.TrimSpace(s)
	if m := spotifyIDPattern.FindStringSubmatch(s); m != nil {
		return m[1]
	}
	if regexp.MustCompile(`^[A-Za-z0-9]{22}$`).MatchString(s) {
		return s
	}
	return ""
}

func spotifyPlaylist(id string) (spotifyList, error) {
	var head struct {
		Name   string `json:"name"`
		Images []struct {
			URL string `json:"url"`
		} `json:"images"`
	}
	base := "https://api.spotify.com/v1/playlists/" + url.PathEscape(id)
	if err := spotifyGet(base+"?fields=name,images", &head); err != nil {
		return spotifyList{}, err
	}
	out := spotifyList{Name: cleanText(head.Name, 100)}
	if len(head.Images) > 0 {
		out.Image = head.Images[0].URL
	}
	next := base + "/tracks?limit=100&fields=" + url.QueryEscape("next,items(track(id,name,duration_ms,external_ids(isrc),artists(name),album(name,images)))")
	for next != "" && len(out.Songs) < maxPlaylistTracks {
		var page struct {
			Next  string `json:"next"`
			Items []struct {
				Track *struct {
					ID         string `json:"id"`
					Name       string `json:"name"`
					DurationMs int64  `json:"duration_ms"`
					External   struct {
						ISRC string `json:"isrc"`
					} `json:"external_ids"`
					Artists []struct {
						Name string `json:"name"`
					} `json:"artists"`
					Album struct {
						Name   string `json:"name"`
						Images []struct {
							URL   string `json:"url"`
							Width int    `json:"width"`
						} `json:"images"`
					} `json:"album"`
				} `json:"track"`
			} `json:"items"`
		}
		if err := spotifyGet(next, &page); err != nil {
			return spotifyList{}, err
		}
		for _, it := range page.Items {
			t := it.Track
			if t == nil || t.Name == "" {
				continue // removed songs and podcast episodes
			}
			names := []string{}
			for _, a := range t.Artists {
				names = append(names, a.Name)
			}
			img := ""
			for _, im := range t.Album.Images { // the smallest one at least 200px wide
				if img == "" || im.Width >= 200 {
					img = im.URL
				}
			}
			out.Songs = append(out.Songs, spotifySong{Title: cleanText(t.Name, 200), Artist: cleanText(strings.Join(names, ", "), 200),
				Album: cleanText(t.Album.Name, 200), ISRC: t.External.ISRC, ID: t.ID, Image: img, DurationMs: t.DurationMs})
		}
		if !strings.HasPrefix(page.Next, "https://api.spotify.com/") {
			break
		}
		next = page.Next
	}
	return out, nil
}

// musicParseText reads a pasted song list: one "Artist - Title" per line, or a
// CSV with Track Name / Artist Name(s) columns (like Exportify's export).
func musicParseText(text string) []spotifySong {
	out := []spotifySong{}
	text = strings.TrimPrefix(text, "\ufeff")
	rd := csv.NewReader(strings.NewReader(text))
	rd.FieldsPerRecord = -1
	rd.LazyQuotes = true
	if records, err := rd.ReadAll(); err == nil && len(records) > 1 {
		col := map[string]int{}
		for i, h := range records[0] {
			col[strings.ToLower(strings.TrimSpace(h))] = i
		}
		pick := func(rec []string, names ...string) string {
			for _, n := range names {
				if i, ok := col[n]; ok && i < len(rec) {
					return strings.TrimSpace(rec[i])
				}
			}
			return ""
		}
		if _, ok := col["track name"]; ok {
			for _, rec := range records[1:] {
				title := pick(rec, "track name")
				if title == "" {
					continue
				}
				ms, _ := strconv.ParseInt(pick(rec, "duration (ms)", "track duration (ms)"), 10, 64)
				id := pick(rec, "track uri", "spotify id")
				id = strings.TrimPrefix(id, "spotify:track:")
				out = append(out, spotifySong{Title: cleanText(title, 200), Artist: cleanText(strings.ReplaceAll(pick(rec, "artist name(s)", "artist name", "artist"), ";", ", "), 200),
					Album: cleanText(pick(rec, "album name", "album"), 200), ISRC: pick(rec, "isrc"), ID: cleanText(id, 40), DurationMs: ms})
				if len(out) >= maxPlaylistTracks {
					break
				}
			}
			return out
		}
	}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(regexp.MustCompile(`^\d{1,4}[.)]\s*`).ReplaceAllString(strings.TrimSpace(line), ""))
		if line == "" {
			continue
		}
		s := spotifySong{Title: line}
		for _, sep := range []string{" - ", " – ", " — ", "\t"} {
			if i := strings.Index(line, sep); i > 0 {
				s.Artist, s.Title = strings.TrimSpace(line[:i]), strings.TrimSpace(line[i+len(sep):])
				break
			}
		}
		s.Title, s.Artist = cleanText(s.Title, 200), cleanText(s.Artist, 200)
		if s.Title != "" {
			out = append(out, s)
		}
		if len(out) >= maxPlaylistTracks {
			break
		}
	}
	return out
}

// musicStoreImport writes an imported song list into playlist id. With keep,
// songs already there (same Spotify ID, or same title and artist) keep a file
// that was picked by hand; songs no longer on the list go.
func musicStoreImport(id int64, pl spotifyList, keep bool) error {
	type old struct {
		track  sql.NullInt64
		manual int
	}
	prev := map[string]old{}
	if keep {
		rows, err := db.Query("SELECT spotify_id, title, artist, track_id, manual FROM music_playlist_tracks WHERE playlist_id = ?", id)
		if err == nil {
			for rows.Next() {
				var sid, title, artist string
				var o old
				if rows.Scan(&sid, &title, &artist, &o.track, &o.manual) == nil && o.manual == 1 {
					prev["s:"+sid] = o
					prev["n:"+musicNorm(title)+"|"+firstArtist(artist)] = o
				}
			}
			rows.Close()
		}
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM music_playlist_tracks WHERE playlist_id = ?", id); err != nil {
		tx.Rollback()
		return err
	}
	for i, s := range pl.Songs {
		var track any
		manual := 0
		o, ok := prev["s:"+s.ID]
		if !ok || s.ID == "" {
			o, ok = prev["n:"+musicNorm(s.Title)+"|"+firstArtist(s.Artist)]
		}
		if ok {
			manual = 1
			if o.track.Valid {
				track = o.track.Int64
			}
		}
		if _, err = tx.Exec(`INSERT INTO music_playlist_tracks (playlist_id, position, title, artist, album, duration_ms, isrc, spotify_id, image_url, track_id, manual)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, i+1, s.Title, s.Artist, s.Album, s.DurationMs, s.ISRC, s.ID, s.Image, track, manual); err != nil {
			tx.Rollback()
			return err
		}
	}
	var current string
	db.QueryRow("SELECT image FROM music_playlists WHERE id = ?", id).Scan(&current)
	// A picture the owner uploaded ("u" versions) wins over Spotify's cover.
	if pl.Image != "" && !strings.HasPrefix(current, "u") {
		if saved := musicSaveCover(id, pl.Image); saved != "" {
			tx.Exec("UPDATE music_playlists SET image = ? WHERE id = ?", saved, id)
		}
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	musicRematch(id)
	return nil
}

// musicSaveCover keeps a copy of a Spotify cover picture on the server, so it
// shows offline and the phone never talks to Spotify. Answers a version tag.
func musicSaveCover(id int64, link string) string {
	u, err := url.Parse(link)
	if err != nil || u.Scheme != "https" || !(strings.HasSuffix(u.Host, ".scdn.co") || strings.HasSuffix(u.Host, ".spotifycdn.com")) {
		return ""
	}
	res, err := (&http.Client{Timeout: 20 * time.Second}).Get(link)
	if err != nil {
		return ""
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return ""
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil || !strings.HasPrefix(http.DetectContentType(data), "image/") {
		return ""
	}
	dir := filepath.Join(musicCacheDir, "covers")
	os.MkdirAll(dir, 0755)
	if os.WriteFile(filepath.Join(dir, fmt.Sprintf("%d.jpg", id)), data, 0644) != nil {
		return ""
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:4])
}

// musicImport: POST {link} (a Spotify playlist) or {text, name} (a pasted list)
// makes a playlist and matches its songs to the library. Answers {id, count, matched}.
func musicImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	s, _ := sessionFromRequest(r)
	var in struct {
		Link string `json:"link"`
		Text string `json:"text"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&in); err != nil {
		http.Error(w, "Couldn't read that. A pasted list can be up to 2 MB.", http.StatusBadRequest)
		return
	}
	var n int
	db.QueryRow("SELECT COUNT(*) FROM music_playlists WHERE owner_id = ?", s.UserId).Scan(&n)
	if n >= maxPlaylists {
		http.Error(w, fmt.Sprintf("You have %d playlists, the most there can be. Delete one first.", maxPlaylists), http.StatusBadRequest)
		return
	}
	var pl spotifyList
	source, spotifyID := "text", ""
	if strings.TrimSpace(in.Link) != "" {
		spotifyID = spotifyPlaylistID(in.Link)
		if spotifyID == "" {
			http.Error(w, "That isn't a Spotify playlist link. Copy it in Spotify with Share › Copy link to playlist.", http.StatusBadRequest)
			return
		}
		var err error
		if pl, err = spotifyPlaylist(spotifyID); err != nil {
			code := http.StatusBadGateway
			if err == errNoSpotify {
				code = http.StatusServiceUnavailable
			}
			http.Error(w, err.Error(), code)
			return
		}
		source = "spotify"
	} else {
		pl.Songs = musicParseText(in.Text)
		pl.Name = cleanText(in.Name, 100)
		if len(pl.Songs) == 0 {
			http.Error(w, "Paste one song per line, like: Artist - Title.", http.StatusBadRequest)
			return
		}
	}
	if pl.Name == "" {
		pl.Name = "Imported playlist"
	}
	if len(pl.Songs) == 0 {
		http.Error(w, "That playlist has no songs.", http.StatusBadRequest)
		return
	}
	musicRefresh(true)
	now := time.Now().UnixMilli()
	res, err := db.Exec("INSERT INTO music_playlists (owner_id, name, source, spotify_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
		s.UserId, pl.Name, source, spotifyID, now, now)
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Couldn't save the playlist. Try again.", http.StatusInternalServerError)
		return
	}
	id, _ := res.LastInsertId()
	if err := musicStoreImport(id, pl, false); err != nil {
		fmt.Println(err)
		db.Exec("DELETE FROM music_playlists WHERE id = ?", id)
		http.Error(w, "Couldn't save the playlist. Try again.", http.StatusInternalServerError)
		return
	}
	var matched int
	db.QueryRow("SELECT COUNT(*) FROM music_playlist_tracks WHERE playlist_id = ? AND track_id IS NOT NULL", id).Scan(&matched)
	writeJSON(w, map[string]any{"id": id, "count": len(pl.Songs), "matched": matched})
}

// ---- sending audio and pictures ----

var musicConvertMu sync.Mutex
var musicConverting = map[string]*sync.Mutex{}

// musicFileFor answers the file to send for a song and its type: the file
// itself, or its AAC copy (made with ffmpeg the first time).
func musicFileFor(t musicTrack) (string, string, error) {
	p, inside := insideUploads(strings.Split(t.Path, "/")...)
	if !inside {
		return "", "", errors.New("not found")
	}
	ext := strings.ToLower(filepath.Ext(t.Path))
	if mime := musicDirect[ext]; mime != "" {
		return p, mime, nil
	}
	if ffmpegPath() == "" {
		return "", "", errors.New("This song needs FFmpeg on the server to play.")
	}
	dir := filepath.Join(musicCacheDir, "audio")
	out := filepath.Join(dir, fmt.Sprintf("%d-%s.m4a", t.ID, t.Version))
	if _, err := os.Stat(out); err == nil {
		return out, "audio/mp4", nil
	}
	musicConvertMu.Lock()
	m := musicConverting[out]
	if m == nil {
		m = &sync.Mutex{}
		musicConverting[out] = m
	}
	musicConvertMu.Unlock()
	m.Lock()
	defer m.Unlock()
	if _, err := os.Stat(out); err == nil {
		return out, "audio/mp4", nil
	}
	os.MkdirAll(dir, 0755)
	// Older copies of this song (the file changed) go.
	if old, _ := filepath.Glob(filepath.Join(dir, fmt.Sprintf("%d-*.m4a", t.ID))); len(old) > 0 {
		for _, f := range old {
			os.Remove(f)
		}
	}
	tmp := out + ".part.m4a"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffmpegBin, "-y", "-v", "error", "-i", p, "-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", tmp)
	if msg, err := cmd.CombinedOutput(); err != nil {
		os.Remove(tmp)
		fmt.Println("music convert:", t.Path, err, strings.TrimSpace(string(msg)))
		return "", "", errors.New("This song couldn't be converted.")
	}
	if err := os.Rename(tmp, out); err != nil {
		return "", "", err
	}
	return out, "audio/mp4", nil
}

// musicStream: GET /music/stream/<id> sends a song (Range works, for seeking).
func musicStream(w http.ResponseWriter, r *http.Request) {
	s, _ := sessionFromRequest(r)
	t, ok := musicTrackByID(strings.TrimPrefix(r.URL.Path, "/music/stream/"))
	if !ok || !musicCanPlay(s, t) {
		http.Error(w, "That song is gone, or you can't play it.", http.StatusNotFound)
		return
	}
	p, mime, err := musicFileFor(t)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnsupportedMediaType)
		return
	}
	f, err := os.Open(p)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, _ := f.Stat()
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Music-Version", t.Version)
	// The URL carries ?v=<version>, so a changed file gets a new URL.
	if r.URL.Query().Get("v") == t.Version {
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "private, no-cache")
	}
	http.ServeContent(w, r, "", st.ModTime(), f)
}

var musicCoverNames = []string{"cover.jpg", "folder.jpg", "front.jpg", "cover.png", "folder.png", "album.jpg", "Cover.jpg", "Folder.jpg"}

// musicArt: GET /music/art/<id> sends a song's cover (embedded, or cover.jpg beside it).
func musicArt(w http.ResponseWriter, r *http.Request) {
	s, _ := sessionFromRequest(r)
	t, ok := musicTrackByID(strings.TrimPrefix(r.URL.Path, "/music/art/"))
	if !ok || !musicCanPlay(s, t) {
		http.NotFound(w, r)
		return
	}
	p, inside := insideUploads(strings.Split(t.Path, "/")...)
	if !inside {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	if t.HasArt && ffmpegPath() != "" {
		dir := filepath.Join(musicCacheDir, "art")
		out := filepath.Join(dir, fmt.Sprintf("%d-%s.jpg", t.ID, t.Version))
		if _, err := os.Stat(out); err != nil {
			os.MkdirAll(dir, 0755)
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			tmp := out + ".part.jpg"
			err := exec.CommandContext(ctx, ffmpegBin, "-y", "-v", "error", "-i", p, "-map", "0:v:0", "-frames:v", "1",
				"-vf", "scale='min(600,iw)':-2", "-q:v", "3", tmp).Run()
			cancel()
			if err == nil {
				os.Rename(tmp, out)
			} else {
				os.Remove(tmp)
			}
		}
		if _, err := os.Stat(out); err == nil {
			http.ServeFile(w, r, out)
			return
		}
	}
	dir := filepath.Dir(p)
	for _, name := range musicCoverNames {
		if st, err := os.Stat(filepath.Join(dir, name)); err == nil && !st.IsDir() {
			http.ServeFile(w, r, filepath.Join(dir, name))
			return
		}
	}
	http.NotFound(w, r)
}

// musicCover: GET /music/cover/<playlist id> sends a playlist's picture.
// The owner can POST multipart with an "image" file (JPG, PNG, GIF or WebP)
// or remove=1; it answers {"image": "<new link or empty>"}.
func musicCover(w http.ResponseWriter, r *http.Request) {
	s, _ := sessionFromRequest(r)
	id, _ := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, "/music/cover/"), 10, 64)
	role := musicPlaylistRole(id, s.UserId)
	if role == "" {
		http.NotFound(w, r)
		return
	}
	file := filepath.Join(musicCacheDir, "covers", fmt.Sprintf("%d.jpg", id))
	if r.Method == http.MethodPost {
		if role != "owner" {
			http.Error(w, "Only the playlist's owner can change its picture.", http.StatusForbidden)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 12<<20)
		if err := r.ParseMultipartForm(12 << 20); err != nil {
			http.Error(w, "The picture is too big. Use one under 10 MB.", http.StatusRequestEntityTooLarge)
			return
		}
		version := ""
		if r.FormValue("remove") != "1" {
			upload, _, err := r.FormFile("image")
			if err != nil {
				http.Error(w, "Choose a picture.", http.StatusBadRequest)
				return
			}
			data, err := io.ReadAll(io.LimitReader(upload, 10<<20+1))
			upload.Close()
			if err != nil || len(data) > 10<<20 {
				http.Error(w, "The picture is too big. Use one under 10 MB.", http.StatusRequestEntityTooLarge)
				return
			}
			switch http.DetectContentType(data) {
			case "image/jpeg", "image/png", "image/gif", "image/webp":
			default:
				http.Error(w, "Use a JPG, PNG, GIF or WebP picture.", http.StatusUnsupportedMediaType)
				return
			}
			os.MkdirAll(filepath.Dir(file), 0755)
			if err := os.WriteFile(file, data, 0644); err != nil {
				fmt.Println(err)
				http.Error(w, "Couldn't save the picture.", http.StatusInternalServerError)
				return
			}
			sum := sha256.Sum256(data)
			version = "u" + hex.EncodeToString(sum[:4])
		} else {
			os.Remove(file)
		}
		db.Exec("UPDATE music_playlists SET image = ?, updated_at = ? WHERE id = ?", version, time.Now().UnixMilli(), id)
		writeJSON(w, map[string]any{"image": playlistCover(id, version)})
		return
	}
	// The file is named .jpg but may hold any of the picture types above.
	if f, err := os.Open(file); err == nil {
		head := make([]byte, 512)
		n, _ := io.ReadFull(f, head)
		f.Close()
		w.Header().Set("Content-Type", http.DetectContentType(head[:n]))
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeFile(w, r, file)
}

// musicOffline: GET /music/offline?playlists=1,2 lists the songs the phone
// should keep for those playlists: {songs:[{id, v, size, title, artist}]}.
// The phone downloads only the ones it doesn't have in that version.
func musicOffline(w http.ResponseWriter, r *http.Request) {
	s, _ := sessionFromRequest(r)
	type entry struct {
		ID     int64  `json:"id"`
		V      string `json:"v"`
		Size   int64  `json:"size"`
		Title  string `json:"title"`
		Artist string `json:"artist"`
		Art    bool   `json:"art"`
	}
	out := []entry{}
	seen := map[int64]bool{}
	lists := []int64{}
	for _, raw := range strings.Split(r.URL.Query().Get("playlists"), ",") {
		id, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
		if err != nil || musicPlaylistRole(id, s.UserId) == "" {
			continue
		}
		lists = append(lists, id)
		for _, song := range musicPlaylistSongs(id) {
			if song.Track == nil || seen[song.Track.ID] || !song.Track.Playable {
				continue
			}
			seen[song.Track.ID] = true
			t := song.Track
			out = append(out, entry{ID: t.ID, V: t.Version, Size: t.Size, Title: t.Title, Artist: t.Artist, Art: t.HasArt})
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, map[string]any{"playlists": lists, "songs": out})
}

// ---------------------------------------------------------------------------
// Notes: trip reports, the notepad and the Portable Apps card.
// Dose notes live on the doses themselves (experienceDose.Note); the Notes
// page (/Notes) gathers them from /experiences and sorts them by substance.
// ---------------------------------------------------------------------------

const notesSchema = `
CREATE TABLE IF NOT EXISTS trip_reports (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	experience_id INTEGER NOT NULL DEFAULT 0,
	title TEXT NOT NULL DEFAULT '',
	substances TEXT NOT NULL DEFAULT '',
	setting TEXT NOT NULL DEFAULT '',
	body TEXT NOT NULL DEFAULT '',
	rating INTEGER NOT NULL DEFAULT 0,
	happened_at INTEGER NOT NULL DEFAULT 0,
	updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trip_reports_user ON trip_reports(user_id);
CREATE TABLE IF NOT EXISTS notepad_notes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	title TEXT NOT NULL DEFAULT '',
	body TEXT NOT NULL DEFAULT '',
	pinned INTEGER NOT NULL DEFAULT 0,
	updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notepad_notes_user ON notepad_notes(user_id);
CREATE TABLE IF NOT EXISTS portable_apps (
	user_id INTEGER PRIMARY KEY,
	folder TEXT NOT NULL DEFAULT ''
);
`

const maxReports = 500
const maxPadNotes = 500

func registerNotes() {
	if _, err := db.Exec(notesSchema); err != nil {
		panic("cannot create the notes tables: " + err.Error())
	}
	// Public trip reports can be read by every account (/notes/reports/public).
	if _, err := db.Exec("ALTER TABLE trip_reports ADD COLUMN public INTEGER NOT NULL DEFAULT 0"); err != nil && !strings.Contains(err.Error(), "duplicate column") {
		panic("cannot add trip_reports.public: " + err.Error())
	}
	db.Exec("CREATE INDEX IF NOT EXISTS trip_reports_public ON trip_reports(public, happened_at)")
	http.HandleFunc("/Notes", requireLogin(func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "html/notes.html")
	}))
	http.HandleFunc("/notes/reports", tripReports)
	http.HandleFunc("/notes/reports/public", publicTripReports)
	http.HandleFunc("/notes/pad", notepad)
	http.HandleFunc("/apps", portableApps)
	http.HandleFunc("/apps/run", portableAppRun)
}

type tripReport struct {
	ID           int64  `json:"id"`
	ExperienceID int64  `json:"experienceId"`
	Title        string `json:"title"`
	Substances   string `json:"substances"`
	Setting      string `json:"setting"`
	Body         string `json:"body"`
	Rating       int    `json:"rating"`
	HappenedAt   int64  `json:"happenedAt"`
	UpdatedAt    int64  `json:"updatedAt"`
	Public       bool   `json:"public"`
}

// tripReports: GET lists the account's reports, newest first. POST saves one
// (id 0 = new) and POST {id, delete: true} removes one.
func tripReports(w http.ResponseWriter, r *http.Request) {
	session, ok := sessionFromRequest(r)
	if !ok {
		notSignedIn(w, r)
		return
	}
	if r.Method == http.MethodGet {
		rows, err := db.Query(`SELECT id, experience_id, title, substances, setting, body, rating, happened_at, updated_at, public
			FROM trip_reports WHERE user_id = ? ORDER BY happened_at DESC, id DESC LIMIT ?`, session.UserId, maxReports)
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't load your trip reports.", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		items := []tripReport{}
		for rows.Next() {
			var t tripReport
			if rows.Scan(&t.ID, &t.ExperienceID, &t.Title, &t.Substances, &t.Setting, &t.Body, &t.Rating, &t.HappenedAt, &t.UpdatedAt, &t.Public) == nil {
				items = append(items, t)
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, map[string]any{"items": items})
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in struct {
		tripReport
		Delete bool `json:"delete"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10)).Decode(&in); err != nil {
		http.Error(w, "Couldn't read that report.", http.StatusBadRequest)
		return
	}
	if in.Delete {
		db.Exec("DELETE FROM trip_reports WHERE id = ? AND user_id = ?", in.ID, session.UserId)
		writeJSON(w, map[string]any{"id": in.ID, "deleted": true})
		return
	}
	t := in.tripReport
	t.Title = cleanText(t.Title, 120)
	t.Substances = cleanText(t.Substances, 300)
	t.Setting = cleanText(t.Setting, 300)
	t.Body = cleanMultiline(t.Body, 50000)
	if t.Rating < 0 || t.Rating > 5 {
		t.Rating = 0
	}
	now := time.Now().UnixMilli()
	if t.HappenedAt <= 0 || t.HappenedAt > now+86400000 {
		t.HappenedAt = now
	}
	if t.ExperienceID > 0 {
		var owner int
		if db.QueryRow("SELECT user_id FROM graph_experiences WHERE id = ?", t.ExperienceID).Scan(&owner) != nil || owner != session.UserId {
			t.ExperienceID = 0
		}
	}
	if t.Title == "" && t.Body == "" {
		http.Error(w, "Give the report a title or write something first.", http.StatusBadRequest)
		return
	}
	t.UpdatedAt = now
	if t.ID > 0 {
		res, err := db.Exec(`UPDATE trip_reports SET experience_id = ?, title = ?, substances = ?, setting = ?, body = ?, rating = ?, happened_at = ?, updated_at = ?, public = ?
			WHERE id = ? AND user_id = ?`, t.ExperienceID, t.Title, t.Substances, t.Setting, t.Body, t.Rating, t.HappenedAt, now, t.Public, t.ID, session.UserId)
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't save that report.", http.StatusInternalServerError)
			return
		}
		if n, _ := res.RowsAffected(); n > 0 {
			writeJSON(w, t)
			return
		}
	}
	var count int
	db.QueryRow("SELECT COUNT(*) FROM trip_reports WHERE user_id = ?", session.UserId).Scan(&count)
	if count >= maxReports {
		http.Error(w, fmt.Sprintf("You have %d trip reports, the most there can be. Delete an old one first.", maxReports), http.StatusConflict)
		return
	}
	res, err := db.Exec(`INSERT INTO trip_reports (user_id, experience_id, title, substances, setting, body, rating, happened_at, updated_at, public)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, session.UserId, t.ExperienceID, t.Title, t.Substances, t.Setting, t.Body, t.Rating, t.HappenedAt, now, t.Public)
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Couldn't save that report.", http.StatusInternalServerError)
		return
	}
	t.ID, _ = res.LastInsertId()
	writeJSON(w, t)
}

// publicTripReports: GET lists everyone's public trip reports, newest first,
// with who wrote them. ?before=<happenedAt>_<id> pages back; ?user=<name> keeps
// one person's. The Graph session link stays private.
func publicTripReports(w http.ResponseWriter, r *http.Request) {
	session, ok := sessionFromRequest(r)
	if !ok {
		notSignedIn(w, r)
		return
	}
	const page = 30
	where := "t.public = 1"
	args := []any{}
	if b := r.URL.Query().Get("before"); b != "" {
		parts := strings.SplitN(b, "_", 2)
		at, _ := strconv.ParseInt(parts[0], 10, 64)
		var id int64
		if len(parts) == 2 {
			id, _ = strconv.ParseInt(parts[1], 10, 64)
		}
		where += " AND (t.happened_at < ? OR (t.happened_at = ? AND t.id < ?))"
		args = append(args, at, at, id)
	}
	if u := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("user"))); u != "" {
		where += " AND u.username = ?"
		args = append(args, u)
	}
	args = append(args, page+1)
	rows, err := db.Query(`SELECT t.id, t.title, t.substances, t.setting, t.body, t.rating, t.happened_at, t.updated_at,
			u.id, u.originalUsername, u.pathToProfilePic
		FROM trip_reports t JOIN users u ON u.id = t.user_id
		WHERE `+where+` ORDER BY t.happened_at DESC, t.id DESC LIMIT ?`, args...)
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Couldn't load the public trip reports.", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	type author struct {
		Name   string `json:"name"`
		Avatar string `json:"avatar"`
	}
	type item struct {
		tripReport
		Author author `json:"author"`
		Mine   bool   `json:"mine"`
	}
	items := []item{}
	for rows.Next() {
		var it item
		var uid int
		if rows.Scan(&it.ID, &it.Title, &it.Substances, &it.Setting, &it.Body, &it.Rating, &it.HappenedAt, &it.UpdatedAt, &uid, &it.Author.Name, &it.Author.Avatar) == nil {
			it.Public = true
			it.Mine = uid == session.UserId
			items = append(items, it)
		}
	}
	more := len(items) > page
	if more {
		items = items[:page]
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, map[string]any{"items": items, "more": more})
}

type padNote struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	Pinned    bool   `json:"pinned"`
	UpdatedAt int64  `json:"updatedAt"`
}

// notepad: GET lists the account's notes (pinned first, then newest). POST
// saves one (id 0 = new) and POST {id, delete: true} removes one.
func notepad(w http.ResponseWriter, r *http.Request) {
	session, ok := sessionFromRequest(r)
	if !ok {
		notSignedIn(w, r)
		return
	}
	if r.Method == http.MethodGet {
		rows, err := db.Query(`SELECT id, title, body, pinned, updated_at FROM notepad_notes
			WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC LIMIT ?`, session.UserId, maxPadNotes)
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't load your notes.", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		items := []padNote{}
		for rows.Next() {
			var n padNote
			var pinned int
			if rows.Scan(&n.ID, &n.Title, &n.Body, &pinned, &n.UpdatedAt) == nil {
				n.Pinned = pinned == 1
				items = append(items, n)
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, map[string]any{"items": items})
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in struct {
		padNote
		Delete bool `json:"delete"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&in); err != nil {
		http.Error(w, "Couldn't read that note.", http.StatusBadRequest)
		return
	}
	if in.Delete {
		db.Exec("DELETE FROM notepad_notes WHERE id = ? AND user_id = ?", in.ID, session.UserId)
		writeJSON(w, map[string]any{"id": in.ID, "deleted": true})
		return
	}
	n := in.padNote
	n.Title = cleanText(n.Title, 120)
	// The notepad keeps text exactly as typed (indents, blank lines), only
	// without stray control characters.
	n.Body = strings.Map(func(c rune) rune {
		if c == '\n' || c == '\t' || !unicode.IsControl(c) {
			return c
		}
		return -1
	}, strings.ReplaceAll(n.Body, "\r\n", "\n"))
	if utf8.RuneCountInString(n.Body) > 100000 {
		n.Body = string([]rune(n.Body)[:100000])
	}
	pinned := 0
	if n.Pinned {
		pinned = 1
	}
	now := time.Now().UnixMilli()
	n.UpdatedAt = now
	if n.ID > 0 {
		res, err := db.Exec("UPDATE notepad_notes SET title = ?, body = ?, pinned = ?, updated_at = ? WHERE id = ? AND user_id = ?",
			n.Title, n.Body, pinned, now, n.ID, session.UserId)
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't save that note.", http.StatusInternalServerError)
			return
		}
		if c, _ := res.RowsAffected(); c > 0 {
			writeJSON(w, n)
			return
		}
	}
	var count int
	db.QueryRow("SELECT COUNT(*) FROM notepad_notes WHERE user_id = ?", session.UserId).Scan(&count)
	if count >= maxPadNotes {
		http.Error(w, fmt.Sprintf("You have %d notes, the most there can be. Delete an old one first.", maxPadNotes), http.StatusConflict)
		return
	}
	res, err := db.Exec("INSERT INTO notepad_notes (user_id, title, body, pinned, updated_at) VALUES (?, ?, ?, ?, ?)",
		session.UserId, n.Title, n.Body, pinned, now)
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Couldn't save that note.", http.StatusInternalServerError)
		return
	}
	n.ID, _ = res.LastInsertId()
	writeJSON(w, n)
}

// portableAppKind tells programs apart from other files; "" means not a program.
func portableAppKind(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".exe":
		return "Windows"
	case ".msi":
		return "Windows installer"
	case ".appimage":
		return "Linux"
	case ".apk":
		return "Android"
	case ".ipa":
		return "iPhone"
	case ".dmg":
		return "Mac"
	}
	return ""
}

type portableApp struct {
	Name     string `json:"name"`
	Path     string `json:"path"` // inside UploadedFiles, "a/b/App.exe"
	Folder   string `json:"folder"`
	Kind     string `json:"kind"`
	Size     int64  `json:"size"`
	Modified int64  `json:"modified"`
	CanRun   bool   `json:"canRun"`
}

// portableAppList finds the programs in folder and its subfolders (three
// levels, like PortableApps' App/Name/Name.exe), at most 300.
func portableAppList(folder string, grant filesGrant) []portableApp {
	root, ok := insideUploads(strings.Split(folder, "/")...)
	out := []portableApp{}
	if !ok {
		return out
	}
	base := strings.Count(filepath.ToSlash(root), "/")
	filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || len(out) >= 300 {
			return filepath.SkipDir
		}
		rel := uploadRel(p)
		if d.IsDir() {
			if strings.Count(filepath.ToSlash(p), "/")-base > 3 || !grant.canSee(rel) {
				return filepath.SkipDir
			}
			return nil
		}
		kind := portableAppKind(d.Name())
		if kind == "" || !grant.allows(rel) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		dir := path.Dir(rel)
		if dir == "." {
			dir = ""
		}
		app := portableApp{Name: strings.TrimSuffix(d.Name(), filepath.Ext(d.Name())), Path: rel, Folder: dir, Kind: kind, Size: info.Size(), Modified: info.ModTime().UnixMilli()}
		app.CanRun = desktopMode && portableCanRun(kind)
		out = append(out, app)
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}

// portableCanRun: the desktop app can start programs made for the computer it runs on.
func portableCanRun(kind string) bool {
	switch runtime.GOOS {
	case "windows":
		return kind == "Windows" || kind == "Windows installer"
	case "linux":
		return kind == "Linux"
	}
	return false
}

// portableApps: GET answers the account's apps folder and the programs in it;
// POST {folder} picks the folder. Needs Files access.
func portableApps(w http.ResponseWriter, r *http.Request) {
	session, ok := sessionFromRequest(r)
	if !ok {
		notSignedIn(w, r)
		return
	}
	grant, ok := filesGrantFor(session)
	if !ok {
		http.Error(w, "You don't have access to Files.", http.StatusForbidden)
		return
	}
	if r.Method == http.MethodPost {
		var in struct {
			Folder string `json:"folder"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
			http.Error(w, "Couldn't read that folder.", http.StatusBadRequest)
			return
		}
		folder := strings.Trim(path.Clean("/"+strings.ReplaceAll(in.Folder, "\\", "/")), "/")
		p, inside := insideUploads(strings.Split(folder, "/")...)
		if folder != "" {
			if fi, err := os.Stat(p); !inside || err != nil || !fi.IsDir() || !grant.canSee(folder) {
				http.Error(w, "That folder isn't in Files.", http.StatusBadRequest)
				return
			}
		}
		if _, err := db.Exec("INSERT INTO portable_apps (user_id, folder) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET folder = excluded.folder", session.UserId, folder); err != nil {
			fmt.Println(err)
			http.Error(w, "Couldn't save that folder.", http.StatusInternalServerError)
			return
		}
	} else if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var folder string
	set := db.QueryRow("SELECT folder FROM portable_apps WHERE user_id = ?", session.UserId).Scan(&folder) == nil
	// Every folder the account can see, for the picker (three levels deep).
	folders := []string{}
	filepath.WalkDir(UploadedFilesDirName, func(p string, d fs.DirEntry, err error) error {
		if err != nil || !d.IsDir() || len(folders) >= 500 {
			return nil
		}
		rel := uploadRel(p)
		if rel == "" {
			return nil
		}
		if strings.Count(rel, "/") > 2 || !grant.canSee(rel) {
			return filepath.SkipDir
		}
		folders = append(folders, rel)
		return nil
	})
	items := []portableApp{}
	if set {
		items = portableAppList(folder, grant)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, map[string]any{"folder": folder, "set": set, "folders": folders, "items": items, "desktop": desktopMode})
}

// portableAppRun starts a program from Files on this computer. Only the
// desktop app does this: there the server and the person are on the same
// computer. On the website the card offers downloads instead.
func portableAppRun(w http.ResponseWriter, r *http.Request) {
	if !desktopMode {
		http.Error(w, "Programs can only be started from the desktop app.", http.StatusForbidden)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	session, ok := sessionFromRequest(r)
	if !ok {
		notSignedIn(w, r)
		return
	}
	grant, ok := filesGrantFor(session)
	if !ok {
		http.Error(w, "You don't have access to Files.", http.StatusForbidden)
		return
	}
	// Only the app's own pages may start programs, never another website.
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+r.Host {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	var in struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
		http.Error(w, "Couldn't read that program.", http.StatusBadRequest)
		return
	}
	rel := strings.Trim(path.Clean("/"+in.Path), "/")
	p, inside := insideUploads(strings.Split(rel, "/")...)
	fi, err := os.Stat(p)
	if !inside || err != nil || fi.IsDir() || !grant.allows(rel) || !portableCanRun(portableAppKind(p)) {
		http.Error(w, "That program can't be started here.", http.StatusBadRequest)
		return
	}
	abs, _ := filepath.Abs(p)
	var cmd *exec.Cmd
	switch {
	case strings.EqualFold(filepath.Ext(abs), ".msi"):
		cmd = exec.Command("msiexec", "/i", abs)
	default:
		if runtime.GOOS == "linux" {
			os.Chmod(abs, fi.Mode()|0100) // AppImages need to be executable
		}
		cmd = exec.Command(abs)
	}
	cmd.Dir = filepath.Dir(abs)
	if err := cmd.Start(); err != nil {
		http.Error(w, "Couldn't start it: "+err.Error(), http.StatusInternalServerError)
		return
	}
	go cmd.Wait()
	fmt.Printf("[%s] RUN USER=%s PATH=%s\n", time.Now().Format("2006-01-02 15:04:05"), session.OriginalUsername, rel)
	writeJSON(w, map[string]any{"started": true})
}

// App updates: the desktop app (desktop.go) asks the website for its newest
// site files and program on start, so it keeps up with the website.
//   GET /app-update/version            {"site", "siteTime", "build", "programs"}
//   GET /app-update/site.zip           html, css, js and assets as one zip
//   GET /app-update/program/<os-arch>  the program from desktop/dist
// "site" is worked out the same way as desktopUnpack's version, so an app
// built from the same files sees nothing to fetch.

var appUpdateDirs = []string{"assets", "css", "html", "js"}

var appUpdatePrograms = map[string]string{
	"windows-amd64": "Geek4u.exe",
	"linux-amd64":   "Geek4u-linux-x64",
	"linux-arm64":   "Geek4u-linux-arm64",
}

var appUpdateCache struct {
	sync.Mutex
	checked  time.Time
	version  string
	siteTime int64
	zip      []byte
}

func registerAppUpdates() {
	if desktopMode {
		return
	}
	http.HandleFunc("/app-update/version", appUpdateVersion)
	http.HandleFunc("/app-update/site.zip", appUpdateSite)
	http.HandleFunc("/app-update/program/", appUpdateProgram)
}

// appUpdateFiles lists the site's files in the order go:embed walks them,
// leaving out names starting with "." or "_" as go:embed does.
func appUpdateFiles() []string {
	var files []string
	for _, dir := range appUpdateDirs {
		filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if name := d.Name(); p != dir && (strings.HasPrefix(name, ".") || strings.HasPrefix(name, "_")) {
				if d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if d.Type().IsRegular() {
				files = append(files, filepath.ToSlash(p))
			}
			return nil
		})
	}
	return files
}

// appUpdateState rebuilds the version and zip at most every 30 seconds.
func appUpdateState() (string, int64, []byte, error) {
	c := &appUpdateCache
	c.Lock()
	defer c.Unlock()
	if c.version != "" && time.Since(c.checked) < 30*time.Second {
		return c.version, c.siteTime, c.zip, nil
	}
	sum := sha256.New()
	var newest int64
	type entry struct {
		name string
		data []byte
	}
	var entries []entry
	for _, name := range appUpdateFiles() {
		b, err := os.ReadFile(filepath.FromSlash(name))
		if err != nil {
			return "", 0, nil, err
		}
		if info, err := os.Stat(filepath.FromSlash(name)); err == nil && info.ModTime().Unix() > newest {
			newest = info.ModTime().Unix()
		}
		sum.Write([]byte(name + "\x00"))
		sum.Write(b)
		entries = append(entries, entry{name, b})
	}
	version := hex.EncodeToString(sum.Sum(nil))
	if version != c.version {
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		for _, e := range entries {
			f, err := zw.Create(e.name)
			if err != nil {
				return "", 0, nil, err
			}
			f.Write(e.data)
		}
		if err := zw.Close(); err != nil {
			return "", 0, nil, err
		}
		c.zip = buf.Bytes()
	}
	c.version, c.siteTime, c.checked = version, newest, time.Now()
	return c.version, c.siteTime, c.zip, nil
}

func appUpdateVersion(w http.ResponseWriter, r *http.Request) {
	version, siteTime, _, err := appUpdateState()
	if err != nil {
		http.Error(w, "Couldn't read the site files", http.StatusInternalServerError)
		return
	}
	build := ""
	if b, err := os.ReadFile(filepath.Join("desktop", "dist", "build.txt")); err == nil {
		build = strings.TrimSpace(string(b))
	}
	programs := []string{}
	for key, name := range appUpdatePrograms {
		if info, err := os.Stat(filepath.Join("desktop", "dist", name)); err == nil && info.Mode().IsRegular() {
			programs = append(programs, key)
		}
	}
	sort.Strings(programs)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, map[string]any{"site": version, "siteTime": siteTime, "build": build, "programs": programs})
}

func appUpdateSite(w http.ResponseWriter, r *http.Request) {
	version, _, data, err := appUpdateState()
	if err != nil {
		http.Error(w, "Couldn't read the site files", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Site-Version", version)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Write(data)
}

func appUpdateProgram(w http.ResponseWriter, r *http.Request) {
	name, ok := appUpdatePrograms[strings.TrimPrefix(r.URL.Path, "/app-update/program/")]
	if !ok {
		http.NotFound(w, r)
		return
	}
	file := filepath.Join("desktop", "dist", name)
	if info, err := os.Stat(file); err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, file)
}

// ---- Link downloads (Upload page): ffmpeg saves a video or audio link straight into a Files folder ----

// Pages like YouTube aren't video files, so those go through yt-dlp when it
// is installed (PATH or next to the server); yt-dlp then uses our ffmpeg.

type linkJob struct {
	ID       string  `json:"id"`
	URL      string  `json:"url"`
	Folder   string  `json:"folder"`
	Name     string  `json:"name"`
	State    string  `json:"state"` // running | done | error | cancelled
	Error    string  `json:"error,omitempty"`
	Tool     string  `json:"tool"`
	Bytes    int64   `json:"bytes"`
	Seconds  float64 `json:"seconds"`
	Duration float64 `json:"duration"`
	Percent  float64 `json:"percent"`
	Started  int64   `json:"started"`
	Ended    int64   `json:"ended,omitempty"`
	user     int
	cancel   context.CancelFunc
}

var (
	linkJobsMu  sync.Mutex
	linkJobs    = map[string]*linkJob{}
	ytdlpOnce   sync.Once
	ytdlpBin    string
	linkTempDir = "LinkDownloads"
)

const linkJobsPerUser = 3
const linkJobsTotal = 6

var linkMediaExt = map[string]bool{".mp4": true, ".m4v": true, ".mkv": true, ".webm": true, ".mov": true, ".avi": true, ".flv": true, ".ts": true, ".mp3": true, ".m4a": true, ".aac": true, ".ogg": true, ".opus": true, ".wav": true, ".flac": true}
var linkAudioExt = map[string]bool{".mp3": true, ".m4a": true, ".aac": true, ".ogg": true, ".opus": true, ".wav": true, ".flac": true}

// ytdlpPath prefers the copy the server keeps up to date itself (linkTools),
// then one on PATH or next to the server.
func ytdlpPath() string {
	if p := linkToolPath(ytdlpAsset()); p != "" {
		return p
	}
	ytdlpOnce.Do(func() {
		for _, name := range []string{"yt-dlp", "yt-dlp.exe"} {
			if p, err := exec.LookPath(name); err == nil {
				ytdlpBin = p
				return
			}
			for _, cand := range []string{name, filepath.Join("ffmpeg", "bin", name)} {
				if st, err := os.Stat(cand); err == nil && !st.IsDir() {
					ytdlpBin, _ = filepath.Abs(cand)
					return
				}
			}
		}
	})
	return ytdlpBin
}

// ---- yt-dlp + Deno kept up to date by the server itself ----
// YouTube changes often, so an old yt-dlp stops working, and new yt-dlp
// needs a JavaScript runtime (Deno) for YouTube. Nobody has to log in to the
// server: it downloads the official release builds from GitHub into
// linkToolsDir at start and checks for updates every 12 hours.

var linkToolsDir = "LinkTools"

func ytdlpAsset() string {
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "windows/amd64", "windows/arm64":
		return "yt-dlp.exe"
	case "linux/amd64":
		return "yt-dlp_linux"
	case "linux/arm64":
		return "yt-dlp_linux_aarch64"
	case "darwin/amd64", "darwin/arm64":
		return "yt-dlp_macos"
	}
	return ""
}

func denoAsset() string {
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "windows/amd64", "windows/arm64":
		return "deno-x86_64-pc-windows-msvc.zip"
	case "linux/amd64":
		return "deno-x86_64-unknown-linux-gnu.zip"
	case "linux/arm64":
		return "deno-aarch64-unknown-linux-gnu.zip"
	case "darwin/amd64":
		return "deno-x86_64-apple-darwin.zip"
	case "darwin/arm64":
		return "deno-aarch64-apple-darwin.zip"
	}
	return ""
}

func denoName() string {
	if runtime.GOOS == "windows" {
		return "deno.exe"
	}
	return "deno"
}

// linkToolPath is the absolute path of a tool in linkToolsDir, "" if it isn't there.
func linkToolPath(name string) string {
	if name == "" {
		return ""
	}
	p := filepath.Join(linkToolsDir, name)
	if st, err := os.Stat(p); err == nil && !st.IsDir() && st.Size() > 0 {
		abs, _ := filepath.Abs(p)
		return abs
	}
	return ""
}

// denoPath: our Deno, else one on PATH.
func denoPath() string {
	if p := linkToolPath(denoName()); p != "" {
		return p
	}
	p, _ := exec.LookPath("deno")
	return p
}

var linkToolsMu sync.Mutex
var linkToolsState = map[string]string{} // "ytdlp" / "deno" -> version or error text

// downloadTo saves url into path (via a .new file, so a half download never replaces a working tool).
func downloadTo(ctx context.Context, rawURL, path string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Geek4u-server")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("GitHub answered %s", res.Status)
	}
	tmp := path + ".new"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, io.LimitReader(res.Body, 400<<20)); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	os.Chmod(tmp, 0755)
	os.Remove(path)
	return os.Rename(tmp, path)
}

func linkToolVersion(bin string, args ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, bin, args...).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(strings.SplitN(string(out), "\n", 2)[0])
}

func updateLinkTools() {
	if os.Getenv("GEEK4U_TOOLS") == "off" {
		return
	}
	os.MkdirAll(linkToolsDir, 0755)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	set := func(k, v string) {
		linkToolsMu.Lock()
		linkToolsState[k] = v
		linkToolsMu.Unlock()
	}

	if asset := ytdlpAsset(); asset != "" {
		if have := linkToolPath(asset); have == "" {
			fmt.Println("Link downloads: getting yt-dlp from GitHub…")
			if err := downloadTo(ctx, "https://github.com/yt-dlp/yt-dlp/releases/latest/download/"+asset, filepath.Join(linkToolsDir, asset)); err != nil {
				fmt.Println("Link downloads: couldn't get yt-dlp:", err)
				set("ytdlp", "couldn't download: "+err.Error())
			}
		} else {
			// The release build updates itself.
			uctx, ucancel := context.WithTimeout(ctx, 5*time.Minute)
			if out, err := exec.CommandContext(uctx, have, "-U").CombinedOutput(); err != nil {
				fmt.Println("Link downloads: yt-dlp -U:", err, strings.TrimSpace(string(out)))
			}
			ucancel()
		}
		if p := linkToolPath(asset); p != "" {
			set("ytdlp", linkToolVersion(p, "--version"))
		}
	}

	if asset := denoAsset(); asset != "" {
		zipPath := filepath.Join(linkToolsDir, asset)
		have := linkToolPath(denoName())
		var stamp time.Time
		if st, err := os.Stat(zipPath + ".got"); err == nil {
			stamp = st.ModTime()
		}
		// Deno is fetched once and then refreshed weekly.
		if have == "" || time.Since(stamp) > 7*24*time.Hour {
			fmt.Println("Link downloads: getting Deno from GitHub…")
			err := downloadTo(ctx, "https://github.com/denoland/deno/releases/latest/download/"+asset, zipPath)
			if err == nil {
				err = unzipOne(zipPath, denoName(), filepath.Join(linkToolsDir, denoName()))
				os.Remove(zipPath)
			}
			if err != nil {
				fmt.Println("Link downloads: couldn't get Deno:", err)
				if have == "" {
					set("deno", "couldn't download: "+err.Error())
				}
			} else {
				os.WriteFile(zipPath+".got", []byte(time.Now().Format(time.RFC3339)), 0644)
			}
		}
		if p := linkToolPath(denoName()); p != "" {
			set("deno", linkToolVersion(p, "--version"))
		}
	}
}

// unzipOne takes the file called name out of a zip into dest.
func unzipOne(zipPath, name, dest string) error {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer zr.Close()
	for _, f := range zr.File {
		if filepath.Base(f.Name) != name || f.FileInfo().IsDir() {
			continue
		}
		in, err := f.Open()
		if err != nil {
			return err
		}
		defer in.Close()
		tmp := dest + ".new"
		out, err := os.Create(tmp)
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, io.LimitReader(in, 1<<30)); err != nil {
			out.Close()
			os.Remove(tmp)
			return err
		}
		out.Close()
		os.Chmod(tmp, 0755)
		os.Remove(dest)
		return os.Rename(tmp, dest)
	}
	return fmt.Errorf("%s not found in %s", name, filepath.Base(zipPath))
}

func registerLinkDownloads() {
	os.RemoveAll(linkTempDir) // leftovers from a run that was stopped
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS folder_icons (
	path TEXT PRIMARY KEY,
	emoji TEXT NOT NULL DEFAULT '',
	image TEXT NOT NULL DEFAULT ''
)`); err != nil {
		fmt.Println("folder_icons:", err)
	}
	loadFolderIcons()
	if !desktopMode {
		go func() {
			for {
				updateLinkTools()
				time.Sleep(12 * time.Hour)
			}
		}()
	}
	http.HandleFunc("/upload/link", requireFilesLogin(uploadLink))
	http.HandleFunc("/files/folder-icon", requireAdminLogin(setFolderIcon))
	http.HandleFunc("/folder-icon/", requireFilesLogin(serveFolderIcon))
}

// publicHost is true when every address of host is on the internet, so a
// link can't make the server fetch from itself or the home network.
func publicHost(host string) bool {
	if host == "" || strings.EqualFold(host, "localhost") {
		return false
	}
	ips, err := net.LookupIP(host)
	if err != nil || len(ips) == 0 {
		return false
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsInterfaceLocalMulticast() {
			return false
		}
		if v4 := ip.To4(); v4 != nil && (v4[0] == 0 || v4[0] == 100 && v4[1]&0xc0 == 64) {
			return false
		}
	}
	return true
}

// linkFileName makes a safe file name (without extension) from what the user typed or the link.
func linkFileName(name string) string {
	name = strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`<>:"/\|?*`, r) {
			return -1
		}
		return r
	}, name)
	name = strings.Trim(strings.TrimSpace(name), ". ")
	for utf8.RuneCountInString(name) > 120 {
		_, size := utf8.DecodeLastRuneInString(name)
		name = name[:len(name)-size]
	}
	return name
}

// freeName is name+ext inside dir, or "name (2).ext" and so on when taken.
func freeName(dir, name, ext string) string {
	for i := 1; ; i++ {
		n := name + ext
		if i > 1 {
			n = fmt.Sprintf("%s (%d)%s", name, i, ext)
		}
		if _, err := os.Stat(filepath.Join(dir, n)); os.IsNotExist(err) {
			return n
		}
	}
}

func moveFile(from, to string) error {
	if err := os.Rename(from, to); err == nil {
		return nil
	}
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
		os.Remove(to)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(to)
		return err
	}
	in.Close()
	return os.Remove(from)
}

func linkJobsOf(user int) []*linkJob {
	linkJobsMu.Lock()
	defer linkJobsMu.Unlock()
	var list []*linkJob
	cutoff := time.Now().Add(-6 * time.Hour).UnixMilli()
	for id, j := range linkJobs {
		if j.State != "running" && j.Ended < cutoff {
			delete(linkJobs, id)
			continue
		}
		if j.user == user {
			c := *j
			list = append(list, &c)
		}
	}
	sort.Slice(list, func(a, b int) bool { return list[a].Started > list[b].Started })
	if len(list) > 15 {
		list = list[:15]
	}
	return list
}

// uploadLink: GET answers {jobs, ffmpeg, ytdlp}. POST {url, currentPath, name}
// starts a download; POST {action:"cancel", id} stops one; POST {action:"clear"}
// forgets finished ones.
func uploadLink(w http.ResponseWriter, r *http.Request) {
	session, _ := sessionFromRequest(r)
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodGet {
		linkToolsMu.Lock()
		tools := map[string]string{"ytdlp": linkToolsState["ytdlp"], "deno": linkToolsState["deno"]}
		linkToolsMu.Unlock()
		writeJSON(w, map[string]any{"jobs": linkJobsOf(session.UserId), "ffmpeg": ffmpegPath() != "", "ytdlp": ytdlpPath() != "", "tools": tools})
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in struct {
		Action      string `json:"action"`
		ID          string `json:"id"`
		URL         string `json:"url"`
		CurrentPath string `json:"currentPath"`
		Name        string `json:"name"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}
	switch in.Action {
	case "cancel":
		linkJobsMu.Lock()
		j := linkJobs[in.ID]
		if j != nil && j.user == session.UserId && j.State == "running" {
			j.cancel()
		}
		linkJobsMu.Unlock()
		writeJSON(w, map[string]any{"jobs": linkJobsOf(session.UserId)})
		return
	case "clear":
		linkJobsMu.Lock()
		for id, j := range linkJobs {
			if j.user == session.UserId && j.State != "running" {
				delete(linkJobs, id)
			}
		}
		linkJobsMu.Unlock()
		writeJSON(w, map[string]any{"jobs": linkJobsOf(session.UserId)})
		return
	}

	if ffmpegPath() == "" {
		http.Error(w, "FFmpeg isn't installed on the server. Put ffmpeg.exe in an ffmpeg\\bin folder next to the server, or on PATH, and restart it.", http.StatusServiceUnavailable)
		return
	}
	u, err := url.Parse(strings.TrimSpace(in.URL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		http.Error(w, "Paste a link that starts with http:// or https://.", http.StatusBadRequest)
		return
	}
	if !publicHost(u.Hostname()) {
		http.Error(w, "That link points at this server or a home network, so it can't be downloaded.", http.StatusBadRequest)
		return
	}
	cur := in.CurrentPath
	if strings.HasPrefix(cur, "/") {
		cur = "./" + cur[1:]
	}
	dir, ok := insideUploads(cur)
	if !ok {
		http.Error(w, "Not a valid folder", http.StatusBadRequest)
		return
	}
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		http.Error(w, "That folder doesn't exist anymore.", http.StatusBadRequest)
		return
	}
	if !filesGrantOf(r).canChangeIn(uploadRel(dir)) {
		http.Error(w, "You can't save to that folder.", http.StatusForbidden)
		return
	}

	ext := strings.ToLower(path.Ext(u.Path))
	tool := "ffmpeg"
	if !linkMediaExt[ext] && ext != ".m3u8" && ext != ".mpd" && ytdlpPath() != "" {
		tool = "yt-dlp"
	}
	name := linkFileName(in.Name)
	if name == "" && tool == "ffmpeg" {
		base, _ := url.PathUnescape(path.Base(u.Path))
		name = linkFileName(strings.TrimSuffix(base, path.Ext(base)))
		if name == "" || name == "." || strings.EqualFold(name, "index") || strings.EqualFold(name, "playlist") || strings.EqualFold(name, "master") {
			name = "video " + time.Now().Format("2006-01-02 15.04")
		}
	}

	linkJobsMu.Lock()
	mine, all := 0, 0
	for _, j := range linkJobs {
		if j.State == "running" {
			all++
			if j.user == session.UserId {
				mine++
			}
		}
	}
	if mine >= linkJobsPerUser || all >= linkJobsTotal {
		linkJobsMu.Unlock()
		http.Error(w, "Wait for a download to finish before starting another.", http.StatusTooManyRequests)
		return
	}
	b := make([]byte, 8)
	cryptorand.Read(b)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Hour)
	shown := uploadRel(dir)
	j := &linkJob{ID: hex.EncodeToString(b), URL: u.String(), Folder: "/" + shown, Name: name, State: "running", Tool: tool, Started: time.Now().UnixMilli(), user: session.UserId, cancel: cancel}
	linkJobs[j.ID] = j
	linkJobsMu.Unlock()

	fmt.Printf("[%s] LINK DOWNLOAD USER=%s TOOL=%s URL=%s TO=/%s\n", time.Now().Format("2006-01-02 15:04:05"), session.OriginalUsername, tool, u.String(), shown)
	go runLinkJob(ctx, j, dir, ext)
	writeJSON(w, map[string]any{"jobs": linkJobsOf(session.UserId)})
}

func linkUpdate(j *linkJob, f func(j *linkJob)) {
	linkJobsMu.Lock()
	f(j)
	linkJobsMu.Unlock()
}

func runLinkJob(ctx context.Context, j *linkJob, dir, ext string) {
	defer j.cancel()
	tmp := filepath.Join(linkTempDir, j.ID)
	defer os.RemoveAll(tmp)
	finish := func(state, msg string) {
		linkUpdate(j, func(j *linkJob) {
			j.State, j.Error, j.Ended = state, msg, time.Now().UnixMilli()
			if state == "done" {
				j.Percent = 100
			}
		})
	}
	if err := os.MkdirAll(tmp, 0755); err != nil {
		finish("error", "Couldn't make a temporary folder on the server.")
		return
	}
	var err error
	var files []string
	if j.Tool == "yt-dlp" {
		files, err = linkWithYtdlp(ctx, j, tmp)
	} else {
		files, err = linkWithFfmpeg(ctx, j, tmp, ext)
	}
	if ctx.Err() == context.Canceled {
		finish("cancelled", "")
		return
	}
	if ctx.Err() == context.DeadlineExceeded {
		finish("error", "It took longer than 4 hours, so it was stopped.")
		return
	}
	if err != nil {
		finish("error", err.Error())
		return
	}
	var saved []string
	for _, f := range files {
		e := filepath.Ext(f)
		n := freeName(dir, strings.TrimSuffix(filepath.Base(f), e), e)
		if err := moveFile(f, filepath.Join(dir, n)); err != nil {
			fmt.Println("link download:", err)
			finish("error", "Downloaded, but couldn't put it in the folder.")
			return
		}
		saved = append(saved, n)
	}
	if len(saved) == 0 {
		finish("error", "Nothing was downloaded from that link.")
		return
	}
	linkUpdate(j, func(j *linkJob) { j.Name = strings.Join(saved, ", ") })
	finish("done", "")
}

// lastLines keeps the end of a program's error output for the message.
type lastLines struct{ buf []byte }

func (l *lastLines) Write(p []byte) (int, error) {
	l.buf = append(l.buf, p...)
	if len(l.buf) > 4096 {
		l.buf = l.buf[len(l.buf)-4096:]
	}
	return len(p), nil
}

// errorLine is yt-dlp's "ERROR: ..." line (without the prefix and the
// "Please report this issue" advice), or the last line.
func (l *lastLines) errorLine() string {
	lines := strings.Split(strings.TrimSpace(string(l.buf)), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if rest, ok := strings.CutPrefix(strings.TrimSpace(lines[i]), "ERROR: "); ok {
			if j := strings.Index(rest, "; please report"); j > 0 {
				rest = rest[:j]
			}
			return strings.TrimSpace(rest)
		}
	}
	return l.last()
}

func (l *lastLines) last() string {
	lines := strings.Split(strings.TrimSpace(string(l.buf)), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}

func linkWithFfmpeg(ctx context.Context, j *linkJob, tmp, ext string) ([]string, error) {
	out := ".mp4"
	audio := linkAudioExt[ext]
	if audio || ext == ".webm" || ext == ".mkv" || ext == ".mov" {
		out = ext
	}
	file := filepath.Join(tmp, j.Name+out)
	if ffprobeBin != "" {
		pctx, cancel := context.WithTimeout(ctx, 25*time.Second)
		if b, err := exec.CommandContext(pctx, ffprobeBin, "-v", "error", "-protocol_whitelist", "http,https,tcp,tls,crypto,hls", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", j.URL).Output(); err == nil {
			if d, err := strconv.ParseFloat(strings.TrimSpace(string(b)), 64); err == nil && d > 0 {
				linkUpdate(j, func(j *linkJob) { j.Duration = d })
			}
		}
		cancel()
	}
	run := func(codec []string) error {
		args := []string{"-hide_banner", "-nostdin", "-y", "-v", "error", "-nostats", "-progress", "pipe:1",
			"-protocol_whitelist", "http,https,tcp,tls,crypto,hls", "-user_agent", "Mozilla/5.0 (Geek4u downloader)",
			"-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
			"-i", j.URL}
		if audio {
			args = append(args, "-vn")
		} else {
			args = append(args, "-map", "0:v:0?", "-map", "0:a:0?")
		}
		args = append(args, codec...)
		if out == ".mp4" || out == ".m4a" || out == ".mov" {
			args = append(args, "-movflags", "+faststart")
		}
		args = append(args, file)
		cmd := exec.CommandContext(ctx, ffmpegBin, args...)
		errs := &lastLines{}
		cmd.Stderr = errs
		pipe, err := cmd.StdoutPipe()
		if err != nil {
			return err
		}
		if err := cmd.Start(); err != nil {
			return errors.New("Couldn't start FFmpeg.")
		}
		buf := make([]byte, 0, 4096)
		chunk := make([]byte, 2048)
		for {
			n, rerr := pipe.Read(chunk)
			buf = append(buf, chunk[:n]...)
			for {
				i := bytes.IndexByte(buf, '\n')
				if i < 0 {
					break
				}
				line := strings.TrimSpace(string(buf[:i]))
				buf = buf[i+1:]
				k, v, _ := strings.Cut(line, "=")
				switch k {
				case "out_time_us", "out_time_ms": // both are microseconds in ffmpeg
					if us, err := strconv.ParseFloat(v, 64); err == nil && us > 0 {
						linkUpdate(j, func(j *linkJob) {
							j.Seconds = us / 1e6
							if j.Duration > 0 {
								j.Percent = math.Min(99, j.Seconds/j.Duration*100)
							}
						})
					}
				case "total_size":
					if n, err := strconv.ParseInt(v, 10, 64); err == nil {
						linkUpdate(j, func(j *linkJob) { j.Bytes = n })
					}
				}
			}
			if rerr != nil {
				break
			}
		}
		if err := cmd.Wait(); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			msg := errs.last()
			if msg == "" {
				msg = err.Error()
			}
			return errors.New(msg)
		}
		return nil
	}
	err := run([]string{"-c", "copy"})
	if err != nil && ctx.Err() == nil {
		// Some streams can't be copied into this kind of file; convert them instead.
		os.Remove(file)
		linkUpdate(j, func(j *linkJob) { j.Seconds, j.Bytes, j.Percent = 0, 0, 0 })
		codec := []string{"-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "192k"}
		if audio {
			codec = nil
		} else if out == ".webm" {
			codec = []string{"-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-c:a", "libopus"}
		}
		err = run(codec)
	}
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		msg := err.Error()
		if ytdlpPath() == "" && !linkMediaExt[ext] && ext != ".m3u8" && ext != ".mpd" {
			msg = "FFmpeg couldn't read a video from that link (" + msg + "). Links to pages like YouTube need yt-dlp next to the server."
		} else {
			msg = "FFmpeg couldn't download it: " + strings.TrimPrefix(msg, "Error opening input files: ")
		}
		return nil, errors.New(msg)
	}
	return []string{file}, nil
}

var ytdlpProgress = regexp.MustCompile(`\[download\]\s+([\d.]+)%(?:\s+of\s+~?\s*([\d.]+)([KMG]i?B))?`)

func linkWithYtdlp(ctx context.Context, j *linkJob, tmp string) ([]string, error) {
	tpl := "%(title).120B [%(id)s].%(ext)s"
	if j.Name != "" {
		tpl = strings.ReplaceAll(j.Name, "%", "%%") + ".%(ext)s"
	}
	args := []string{"--no-playlist", "--newline", "--no-colors", "--no-mtime",
		"--ffmpeg-location", ffmpegBin, "-S", "ext:mp4:m4a", "--merge-output-format", "mp4",
		"-P", tmp, "-o", tpl, "--", j.URL}
	// Only our own (current) yt-dlp knows --js-runtimes.
	if deno := denoPath(); deno != "" && linkToolPath(ytdlpAsset()) != "" {
		args = append([]string{"--js-runtimes", "deno:" + deno}, args...)
	}
	cmd := exec.CommandContext(ctx, ytdlpPath(), args...)
	errs := &lastLines{}
	cmd.Stderr = errs
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, errors.New("Couldn't start yt-dlp.")
	}
	unit := map[string]float64{"KiB": 1 << 10, "MiB": 1 << 20, "GiB": 1 << 30, "KB": 1e3, "MB": 1e6, "GB": 1e9}
	buf := make([]byte, 0, 4096)
	chunk := make([]byte, 2048)
	for {
		n, rerr := pipe.Read(chunk)
		buf = append(buf, chunk[:n]...)
		for {
			i := bytes.IndexAny(buf, "\r\n")
			if i < 0 {
				break
			}
			line := string(buf[:i])
			buf = buf[i+1:]
			if m := ytdlpProgress.FindStringSubmatch(line); m != nil {
				p, _ := strconv.ParseFloat(m[1], 64)
				size, _ := strconv.ParseFloat(m[2], 64)
				linkUpdate(j, func(j *linkJob) {
					j.Percent = math.Min(99, p)
					if size > 0 {
						j.Bytes = int64(size * unit[m[3]] * p / 100)
					}
				})
			}
		}
		if rerr != nil {
			break
		}
	}
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		msg := errs.errorLine()
		if msg == "" {
			msg = err.Error()
		}
		low := strings.ToLower(msg)
		switch {
		case strings.Contains(low, "drm"):
			return nil, errors.New("That link is DRM protected (Spotify, Apple Music, Netflix and similar lock their files), so it can't be downloaded. Spotify playlists can be imported on the Music page instead.")
		case strings.Contains(low, "requested format is not available") || strings.Contains(low, "no video formats found"):
			return nil, errors.New("YouTube didn't give yt-dlp any video to download. The server updates yt-dlp and Deno by itself every 12 hours (and at start), so try again after a restart. If it keeps happening, YouTube may be blocking the server for a while.")
		case strings.Contains(low, "unsupported url"):
			return nil, errors.New("yt-dlp doesn't know that site, so it can't be downloaded.")
		}
		return nil, errors.New("yt-dlp couldn't download it: " + msg + " (the server updates yt-dlp by itself; try again after a restart)")
	}
	entries, _ := os.ReadDir(tmp)
	var files []string
	for _, e := range entries {
		n := e.Name()
		if e.IsDir() || strings.HasSuffix(n, ".part") || strings.HasSuffix(n, ".ytdl") || strings.Contains(n, ".temp.") {
			continue
		}
		files = append(files, filepath.Join(tmp, n))
	}
	return files, nil
}

// ---- Folder icons: admins can give a Files folder an emoji or a picture ----

type folderIcon struct {
	Emoji string `json:"emoji,omitempty"`
	Image string `json:"image,omitempty"` // link
}

var (
	folderIconsMu sync.RWMutex
	folderIcons   = map[string]folderIcon{} // rel path -> icon
	folderIconDir = filepath.Join(ProfilePicturesDirName, "folders")
)

func loadFolderIcons() {
	rows, err := db.Query("SELECT path, emoji, image FROM folder_icons")
	if err != nil {
		return
	}
	defer rows.Close()
	folderIconsMu.Lock()
	defer folderIconsMu.Unlock()
	for rows.Next() {
		var p, e, img string
		if rows.Scan(&p, &e, &img) == nil {
			folderIcons[p] = folderIconOf(e, img)
		}
	}
}

func folderIconOf(emoji, image string) folderIcon {
	ic := folderIcon{Emoji: emoji}
	if image != "" {
		v := ""
		if st, err := os.Stat(filepath.Join(folderIconDir, image)); err == nil {
			v = "?v=" + strconv.FormatInt(st.ModTime().UnixMilli(), 36)
		}
		ic.Image = "/folder-icon/" + url.PathEscape(image) + v
	}
	return ic
}

func folderIconFor(rel string) folderIcon {
	folderIconsMu.RLock()
	defer folderIconsMu.RUnlock()
	return folderIcons[rel]
}

// withFolderIcons fills in the icon of every folder in items (dir is their folder).
func withFolderIcons(items []FileFolderInfo, dir string) []FileFolderInfo {
	for i := range items {
		if items[i].IsDir {
			ic := folderIconFor(joinRel(dir, items[i].Name))
			items[i].IconEmoji, items[i].IconImage = ic.Emoji, ic.Image
		}
	}
	return items
}

// moveFolderIcons keeps icons when a folder is renamed (the folder and everything in it).
func moveFolderIcons(from, to string) {
	if from == "" || to == "" {
		return
	}
	db.Exec("UPDATE folder_icons SET path = ? || substr(path, ?) WHERE path = ? OR path LIKE ? ESCAPE '\\'", to, len(from)+1, from, likeEscape(from)+"/%")
	folderIconsMu.Lock()
	for p, ic := range folderIcons {
		if p == from || strings.HasPrefix(p, from+"/") {
			delete(folderIcons, p)
			folderIcons[to+strings.TrimPrefix(p, from)] = ic
		}
	}
	folderIconsMu.Unlock()
}

func likeEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func forgetFolderIcon(rel string) {
	var img string
	db.QueryRow("SELECT image FROM folder_icons WHERE path = ?", rel).Scan(&img)
	db.Exec("DELETE FROM folder_icons WHERE path = ?", rel)
	if img != "" {
		os.Remove(filepath.Join(folderIconDir, filepath.Base(img)))
	}
	folderIconsMu.Lock()
	delete(folderIcons, rel)
	folderIconsMu.Unlock()
}

// setFolderIcon: multipart POST path=<Files link of the folder> with emoji=<text>
// and/or an "image", or remove=1. Admins only. Answers the folder's icon.
func setFolderIcon(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxPictureBytes+(64<<10))
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		http.Error(w, fmt.Sprintf("That picture is too big. Pick one under %d MB.", maxPictureMB), http.StatusRequestEntityTooLarge)
		return
	}
	defer r.MultipartForm.RemoveAll()
	p, ok := uploadPathFromURL(r.FormValue("path"))
	if !ok {
		http.Error(w, "Not a valid folder", http.StatusBadRequest)
		return
	}
	if st, err := os.Stat(p); err != nil || !st.IsDir() {
		http.Error(w, "That folder doesn't exist.", http.StatusBadRequest)
		return
	}
	rel := uploadRel(p)
	if r.FormValue("remove") == "1" {
		forgetFolderIcon(rel)
		writeJSON(w, folderIcon{})
		return
	}
	emoji := strings.TrimSpace(r.FormValue("emoji"))
	if utf8.RuneCountInString(emoji) > 8 || strings.ContainsAny(emoji, "<>&\"'") {
		http.Error(w, "Use one emoji or a few characters.", http.StatusBadRequest)
		return
	}
	var oldImg string
	db.QueryRow("SELECT image FROM folder_icons WHERE path = ?", rel).Scan(&oldImg)
	img := oldImg
	if file, _, err := r.FormFile("image"); err == nil {
		defer file.Close()
		name, status, msg := saveImageIn(file, folderIconDir, "folder")
		if status != 0 {
			http.Error(w, msg, status)
			return
		}
		img = name
	} else if r.FormValue("emoji") != "" || r.FormValue("dropImage") == "1" {
		img = "" // picking an emoji replaces the picture
	}
	if emoji == "" && img == "" {
		forgetFolderIcon(rel)
		writeJSON(w, folderIcon{})
		return
	}
	if img != "" {
		emoji = ""
	}
	if _, err := db.Exec("INSERT INTO folder_icons (path, emoji, image) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET emoji = excluded.emoji, image = excluded.image", rel, emoji, img); err != nil {
		fmt.Println(err)
		http.Error(w, "Couldn't save the icon.", http.StatusInternalServerError)
		return
	}
	if oldImg != "" && oldImg != img {
		os.Remove(filepath.Join(folderIconDir, filepath.Base(oldImg)))
	}
	ic := folderIconOf(emoji, img)
	folderIconsMu.Lock()
	folderIcons[rel] = ic
	folderIconsMu.Unlock()
	writeJSON(w, ic)
}

func serveFolderIcon(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(strings.TrimPrefix(r.URL.Path, "/folder-icon/"))
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".png", ".gif", ".webp":
	default:
		http.NotFound(w, r)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeFile(w, r, filepath.Join(folderIconDir, name))
}
