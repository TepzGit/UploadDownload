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
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

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
	http.HandleFunc("/journalImport", requireLogin(journalImport))
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
			http.ServeFile(w, r, "js/"+jsName)
		})
	}

	css, _ := os.ReadDir("css")
	for _, stylefile := range css {
		cssName := stylefile.Name()
		name := cssName

		http.HandleFunc("/"+name, func(w http.ResponseWriter, r *http.Request) {
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

	port := 6767
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
	case "ug":
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
