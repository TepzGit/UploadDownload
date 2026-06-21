package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"math/rand"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"

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

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.Redirect(w, r, "/Main", http.StatusSeeOther)
			return
		}
	})

	http.HandleFunc("/Main", Main)
	http.HandleFunc("/login", LoginData)
	http.HandleFunc("/Profile", requireLogin(Profile))
	http.HandleFunc("/Files/", requireLogin(Downloader))
	http.HandleFunc("/Uploader", requireLogin(Uploader))
	http.HandleFunc("/journal", requireLogin(Journal))
	http.HandleFunc("/journal/Drug", requireLogin(DrugInfo))
	http.HandleFunc("/sub", requireLogin(Substance))
	http.HandleFunc("/admin", requireAdminLogin(AdminPanel))
	http.HandleFunc("/admin/createUser", requireAdminLogin(AdminPanelCreateUser))

	http.HandleFunc("/upload", requireLogin(GetUploadData))
	http.HandleFunc("/makeFolder", requireLogin(makeFolder))
	http.HandleFunc("/getFolders", requireLogin(getFolders))
	http.HandleFunc("/search", requireLogin(search))
	http.HandleFunc("/delete", requireLogin(Delete))
	http.HandleFunc("/rename", requireLogin(Rename))
	http.HandleFunc("/journalImport", requireLogin(journalImport))
	http.HandleFunc("/sub/saveData", requireLogin(saveData))
	http.HandleFunc("/admin/createUser/AdminPanelCreateUserNow", requireAdminLogin(AdminPanelCreateUserData))

	//	http.HandleFunc("/style.css", func(w http.ResponseWriter, r *http.Request) {
	//		w.Header().Set("Content-Type", "text/css")
	//		fmt.Fprint(w, styleCSS)
	//	})

	http.HandleFunc("/script.js", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "js/script.js")
	})

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

	cookies["test"] = cookiesStruct{
		Time:             time.Now(),
		Username:         "test",
		OriginalUsername: "test",
		Authority:        "admin",
		UserId:           1,
	}

	db, err = sql.Open("sqlite3", DataBaseFileName)
	if err != nil {
		panic(err)
	}
	db.Exec(schema)

	port := 8000
	fmt.Println("Serving on 0.0.0.0:" + strconv.Itoa(port))

	err = http.ListenAndServeTLS("0.0.0.0: "+strconv.Itoa(port), "cert.pem", "key.pem", nil)
	if err != nil {
		http.ListenAndServe("0.0.0.0:"+strconv.Itoa(port), nil)
	}
}

func Main(w http.ResponseWriter, r *http.Request) {

	SessionId, err := r.Cookie("SessionID")

	d := struct {
		Login       bool
		SessionInfo cookiesStruct
	}{}

	ip := r.RemoteAddr
	if strings.Contains(ip, ":") {
		ip, _, _ = net.SplitHostPort(ip)
	}
	fmt.Printf("[%s] NEUTRAL IP=%s USER=%s PATH=%s\n", time.Now().Format("2006-01-02 15:04:05"), ip, d.SessionInfo.OriginalUsername, r.URL.Path)

	if err == nil && SessionId != nil {
		c, ok := cookies[SessionId.Value]
		if ok {
			d.Login = true
			d.SessionInfo = c
		}
	}

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

	userCookie, _ := r.Cookie("SessionID")
	if err != nil {
		http.Error(w, "no session", http.StatusUnauthorized)
		return
	}
	session, ok := cookies[userCookie.Value]
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

	usercookie, _ := r.Cookie("SessionID")
	user_id := cookies[usercookie.Value].UserId
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

	SessionId, err := r.Cookie("SessionID")
	userId := cookies[SessionId.Value].UserId

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
	ip := r.RemoteAddr
	if strings.Contains(ip, ":") {
		ip, _, _ = net.SplitHostPort(ip)
	}
	fmt.Printf("[%s] NEUTRAL IP=%s PATH=%s REASON=LogginIn\n", time.Now().Format("2006-01-02 15:04:05"), ip, r.URL.Path)

	var UserLoginData struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	err := json.NewDecoder(r.Body).Decode(&UserLoginData)
	if err != nil {
		http.Error(w, "Not valid folder data", http.StatusBadRequest)
		return
	}

	var originalUsername string
	var authority string
	var password string
	var userId int
	err = db.QueryRow("select originalUsername,authority,password_hash,id from users where username = ?", strings.ToLower(UserLoginData.Username)).Scan(&originalUsername, &authority, &password, &userId)
	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "User Dosent Exist", http.StatusBadRequest)
			return
		} else {
			http.Error(w, "Can not query from database rn", http.StatusInternalServerError)
			return
		}
	}

	if err := bcrypt.CompareHashAndPassword([]byte(password), []byte(UserLoginData.Password)); err != nil {
		http.Error(w, "Wrong Password", http.StatusBadRequest)
		return
	}

	randomCookie := RandomCharacters()

	cookie := &http.Cookie{
		Name:   "SessionID",
		Value:  randomCookie,
		Path:   "/",
		MaxAge: 86400,
	}

	http.SetCookie(w, cookie)

	c := cookies[randomCookie]
	c.Time = time.Now()
	c.Username = strings.ToLower(UserLoginData.Username)
	c.OriginalUsername = originalUsername
	c.Authority = strings.ToLower(authority)
	c.UserId = userId
	cookies[randomCookie] = c

	w.WriteHeader(http.StatusOK)
}

func requireLogin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if strings.Contains(ip, ":") {
			ip, _, _ = net.SplitHostPort(ip)
		}

		SessionId, err := r.Cookie("SessionID")
		if err != nil || SessionId == nil {
			fmt.Printf("[%s] DENY IP=%s PATH=%s REASON=no_cookie\n", time.Now().Format("2006-01-02 15:04:05"), ip, r.URL.Path)
			http.Redirect(w, r, "/Main", http.StatusSeeOther)
			return
		}

		// check if session exists in your map
		d, ok := cookies[SessionId.Value]
		if !ok {
			fmt.Printf("[%s] DENY IP=%s PATH=%s REASON=invalid_session\n", time.Now().Format("2006-01-02 15:04:05"), ip, r.URL.Path)
			http.Redirect(w, r, "/Main", http.StatusSeeOther)
			return
		}
		fmt.Printf("[%s] ALLOW IP=%s USER=%s PATH=%s\n", time.Now().Format("2006-01-02 15:04:05"), ip, d.OriginalUsername, r.URL.Path)

		// all good → call the real handler
		next(w, r)
	}
}

func requireAdminLogin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if strings.Contains(ip, ":") {
			ip, _, _ = net.SplitHostPort(ip)
		}

		SessionId, err := r.Cookie("SessionID")
		if err != nil || SessionId == nil {
			fmt.Printf("[%s] DENY IP=%s PATH=%s REASON=no_cookie\n", time.Now().Format("2006-01-02 15:04:05"), ip, r.URL.Path)
			http.Redirect(w, r, "/Main", http.StatusSeeOther)
			return
		}

		d, ok := cookies[SessionId.Value]
		if !ok || strings.ToLower(d.Authority) != "admin" {
			fmt.Printf("[%s] DENY IP=%s USER=%s PATH=%s REASON=invalid_sessionOrNoAuthority\n", time.Now().Format("2006-01-02 15:04:05"), ip, d.OriginalUsername, r.URL.Path)
			http.Redirect(w, r, "/Main", http.StatusSeeOther)
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

			maxTimeHours := 744

			cookiesMu.Lock()
			for key, value := range cookies {
				if time.Now().After(value.Time.Add(time.Hour * time.Duration(maxTimeHours))) {
					delete(cookies, key)
				}
			}
			cookiesMu.Unlock()
		}
	}()
}

func RandomCharacters() string {
	awailable := []rune("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890")

	rand.Seed(time.Now().UnixNano())

	length := 32
	s := make([]rune, length)
	for i := 0; i < length; i++ {
		s[i] = awailable[rand.Intn(len(awailable))]
	}

	return string(s)
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
		if path == "/Files/" {
			d.IsRoot = true
		} else {
			pathSplit := strings.Split(path, "/")
			if len(pathSplit) < 2 {
				d.BackPath = "/"
			} else {
				d.BackPath = "/" + filepath.Join(pathSplit[:len(pathSplit)-1]...)
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
	currentPath := r.FormValue("currentPath")

	os.Mkdir(UploadedFilesDirName, 0755)
	for _, file := range files {
		f, _ := file.Open()
		out, err := os.Create(filepath.Join(UploadedFilesDirName, currentPath, file.Filename))
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

	var dirPath string
	if len(pathSplit) > 2 {
		dirPath = filepath.Join(append([]string{UploadedFilesDirName}, pathSplit[2:]...)...)
	} else {
		dirPath = UploadedFilesDirName + "/."
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
	if currentPath[:1] == "/" {
		currentPath = "./" + currentPath[1:]
	}

	Path := filepath.Join(UploadedFilesDirName, currentPath, FolderToGet)

	Dirs, err := os.ReadDir(Path)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if strings.Contains(Path, "..") || strings.Contains(Path, ".") {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	for _, Dir := range Dirs {
		if Dir.IsDir() {
			FoldersReturn.Folders = append(FoldersReturn.Folders, Dir.Name())
		}
	}
	FoldersReturn.CurrentPath = filepath.Join(currentPath, FolderToGet)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(FoldersReturn)
}

func search(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	currentPath := r.URL.Query().Get("path")

	pathSplit := strings.Split(currentPath, "/")

	var finalPath string
	if len(pathSplit) > 2 {
		finalPath = filepath.Join(append([]string{UploadedFilesDirName}, pathSplit[2:]...)...)
	} else {
		finalPath = UploadedFilesDirName + "/."
	}

	var results []FileFolderInfo
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
	pathSplit := strings.Split(filePath, "/")
	finalPath := "/Files/" + strings.Join(pathSplit[1:], "/")
	return finalPath
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
				d.Path = "/Files/" + relPath
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

	pathSplit := strings.Split(deleteData.Path, "/")
	path := filepath.Join(UploadedFilesDirName, strings.Join(pathSplit[4:], "/"))
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
		NewFileName         string `json"newFileName"`
	}
	err := json.NewDecoder(r.Body).Decode(&renameData)
	if err != nil {
		http.Error(w, "Not valid folder data", http.StatusBadRequest)
		return
	}

	currentFilePathSplit := strings.Split(renameData.CurrentFilenamePath, "/")
	currentFilePath := filepath.Join(UploadedFilesDirName, strings.Join(currentFilePathSplit[4:], "/"))
	newFilePath := filepath.Join(UploadedFilesDirName, strings.Join(currentFilePathSplit[4:len(currentFilePathSplit)-1], "/"), renameData.NewFileName)

	curentFileName := currentFilePathSplit[len(currentFilePathSplit)-1]
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
	username := r.FormValue("username")
	password := r.FormValue("password")
	authority := r.FormValue("authority")

	var exists bool
	err = db.QueryRow("select exists(select 1 from users where username = ?)", strings.ToLower(username)).Scan(&exists)
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Something went wrong with database, could not check if user exists or not", http.StatusInternalServerError)
		return
	}

	if exists {
		http.Error(w, "User already exists", http.StatusBadRequest)
		return
	}

	HashedPass, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Cant hash password", http.StatusBadRequest)
		return
	}
	_, err = db.Exec("insert into users (username, originalUsername, password_hash, pathToProfilePic, authority) values (?, ?, ?, ?, ?)", strings.ToLower(username), username, string(HashedPass), "/profiles/Default/default.png", strings.ToLower(authority))
	if err != nil {
		fmt.Println(err)
		http.Error(w, "Could not create user", http.StatusBadRequest)
		return
	}

	w.Write([]byte("User Created"))
}
