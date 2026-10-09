package main

import (
	"bytes"
	cryptorand "crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
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
const maxPictureBytes = 6 << 20
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
	http.HandleFunc("/Files/", requireAdminLogin(Downloader))
	http.HandleFunc("/Uploader", requireAdminLogin(Uploader))
	http.HandleFunc("/journal", requireLogin(Journal))
	http.HandleFunc("/journal/Drug", requireLogin(DrugInfo))
	http.HandleFunc("/sub", requireLogin(Substance))
	http.HandleFunc("/admin", requireAdminLogin(AdminPanel))
	http.HandleFunc("/admin/createUser", requireAdminLogin(AdminPanelCreateUser))

	http.HandleFunc("/upload", requireAdminLogin(GetUploadData))
	http.HandleFunc("/makeFolder", requireAdminLogin(makeFolder))
	http.HandleFunc("/getFolders", requireAdminLogin(getFolders))
	http.HandleFunc("/search", requireAdminLogin(search))
	http.HandleFunc("/delete", requireAdminLogin(Delete))
	http.HandleFunc("/rename", requireAdminLogin(Rename))
	http.HandleFunc("/getItems", requireAdminLogin(getItems))
	http.HandleFunc("/journalImport", requireLogin(journalImport))
	http.HandleFunc("/profile/doses", requireLogin(profileDoses))
	http.HandleFunc("/profile/intake", requireLogin(profileIntake))
	http.HandleFunc("/profile/boxes", requireLogin(profileBoxes))
	http.HandleFunc("/profile/picture", requireLogin(profilePicture))
	http.HandleFunc("/profiles/", requireLogin(profileImage))
	http.HandleFunc("/u/", requireLogin(publicProfile))
	http.HandleFunc("/Forum", requireLogin(Forum))
	http.HandleFunc("/forum/posts", requireLogin(forumPosts))
	http.HandleFunc("/forum/members", requireLogin(forumMembers))
	http.HandleFunc("/forum/comments", requireLogin(forumComments))
	http.HandleFunc("/friends", requireLogin(friends))
	http.HandleFunc("/experiences/people", requireLogin(experiencePeople))
	http.HandleFunc("/likes", requireLogin(likes))
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
	fmt.Println("Serving on 0.0.0.0:" + strconv.Itoa(port))

	err = http.ListenAndServeTLS("0.0.0.0: "+strconv.Itoa(port), "cert.pem", "key.pem", nil)
	if err != nil {
		http.ListenAndServe("0.0.0.0:"+strconv.Itoa(port), nil)
	}
}

func Main(w http.ResponseWriter, r *http.Request) {

	d := struct {
		Login       bool
		SessionInfo cookiesStruct
	}{}

	d.SessionInfo, d.Login = sessionFromRequest(r)
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

	var avatar, banner string
	db.QueryRow("SELECT pathToProfilePic, pathToBanner FROM users WHERE id = ?", userId).Scan(&avatar, &banner)
	d.Avatar = existingPicture(avatar)
	d.Banner = existingPicture(banner)

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

	userId, err := createUser(in.Username, in.Password, "user")
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
		Authority:        "user",
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
	res, err := db.Exec("insert into users (username, originalUsername, password_hash, pathToProfilePic, authority) values (?, ?, ?, ?, ?)", strings.ToLower(username), username, string(HashedPass), "/profiles/Default/default.png", strings.ToLower(authority))
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

	dirPath := urlPathToFile(path)

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

	if info.IsDir() {
		d := struct {
			Files    []FileFolderInfo
			IsRoot   bool
			BackPath string
		}{}
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
		Folders     []string `json:"Folders"`
		CurrentPath string   `json:"CurrentPath"`
	}

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
	if !ok {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	Dirs, err := os.ReadDir(Path)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	for _, Dir := range Dirs {
		if Dir.IsDir() {
			FoldersReturn.Folders = append(FoldersReturn.Folders, Dir.Name())
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
	if !ok {
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
	if err != nil {
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
	err = os.Remove(path)
	if err != nil {
		http.Error(w, "Failed to delete file", http.StatusInternalServerError)
		return
	}

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
	newFilePath := filepath.Join(filepath.Dir(currentFilePath), renameData.NewFileName)

	curentFileName := filepath.Base(currentFilePath)
	if curentFileName != renameData.NewFileName {
		err := os.Rename(currentFilePath, newFilePath)
		if err != nil {
			fmt.Println(err)
			http.Error(w, "Could not rename file/folder", http.StatusInternalServerError)
			return

		}
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
				Method: g.Formulation,
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

	dir := filepath.Join(ProfilePicturesDirName, strconv.Itoa(uid))
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
	return "/profiles/" + strconv.Itoa(uid) + "/" + name, 0, ""
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
		http.Error(w, "That picture is too big. Pick one under 6 MB.", http.StatusRequestEntityTooLarge)
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
	Time         string  `json:"time"`
	Profile      struct {
		Base struct {
			Onset  float64 `json:"onset"`
			Comeup float64 `json:"comeup"`
			Peak   float64 `json:"peak"`
			Offset float64 `json:"offset"`
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
		b := d.Profile.Base
		if d.Substance == "" || !clockTime.MatchString(d.Time) ||
			!inRange(d.Amount, 0.000001, 1e6) || !inRange(d.ReleaseHours, 0, 48) ||
			!inRange(d.Profile.CommonDose, 0.000001, 1e6) ||
			!inRange(b.Onset, 0, 240) || !inRange(b.Comeup, 0, 240) || !inRange(b.Peak, 0, 240) || !inRange(b.Offset, 0, 240) {
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
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 96<<10)).Decode(&in); err != nil {
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
				http.Error(w, "That picture is too big. Pick one under 6 MB.", http.StatusRequestEntityTooLarge)
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
			Action     string `json:"action"`
			ID         int64  `json:"id"`
			URL        string `json:"url"`
			Kind       string `json:"kind"`
			Note       string `json:"note"`
			Experience int64  `json:"experience"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in); err != nil {
			http.Error(w, "Couldn't read that.", http.StatusBadRequest)
			return
		}
		switch in.Action {
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
		Found   bool
		Name    string
		Initial string
		Avatar  string
		Banner  string
		Admin   bool
		IsSelf  bool
		Posts   int
		Friend  string
		Liked   []likedSubstance
	}{Name: name}

	var id int
	var avatar, banner, authority string
	err := db.QueryRow("SELECT id, originalUsername, pathToProfilePic, pathToBanner, authority FROM users WHERE username = ?", strings.ToLower(name)).Scan(&id, &d.Name, &avatar, &banner, &authority)
	if err == nil {
		d.Found = true
		d.Initial = initialOf(d.Name)
		d.Avatar = existingPicture(avatar)
		d.Banner = existingPicture(banner)
		d.Admin = authority == "admin"
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
		WHERE (? = 0 OR p.id < ?) AND (? = 0 OR p.user_id = ?)
		ORDER BY p.id DESC
		LIMIT ?`, before, before, owner, owner, postsPerPage+1)
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
				http.Error(w, "That post is too big. Each picture has to be under 6 MB.", http.StatusRequestEntityTooLarge)
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
					fail(http.StatusRequestEntityTooLarge, "Each picture has to be under 6 MB.")
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
				Author:    postAuthor{Name: session.OriginalUsername, Initial: initialOf(session.OriginalUsername), Avatar: existingPicture(avatar), Admin: isAdmin},
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
	return postAuthor{Name: name, Initial: initialOf(name), Avatar: existingPicture(avatar), Admin: authority == "admin"}
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
