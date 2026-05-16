package main

import (
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

	"golang.org/x/crypto/bcrypt"
)

type FileFolderInfo struct {
	Name string
	Path string
	IsDir bool
	IsImg bool
	IsAudio bool
	IsVid bool
	Size int
	Date time.Time
}

type MakeFolderData struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type userMapData map[string]struct{
	Password string `json:"Password"`
	OriginalUsername string `json:"OriginalUsername"`
	Authority string `json:"Authority"`
}

type cookiesStruct struct{
	Time time.Time
	Username string
	OriginalUsername string
	Authority string
}

var UploadedFilesDirName string = "UploadedFiles"
var LoginDataFileName string = "loginData.json"

var cookiesMu sync.Mutex
var cookies = map[string]cookiesStruct{}

var userLoginDataMap userMapData
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
	http.HandleFunc("/admin/createUser/AdminPanelCreateUserNow", requireAdminLogin(AdminPanelCreateUserData))

//	http.HandleFunc("/style.css", func(w http.ResponseWriter, r *http.Request) {
//		w.Header().Set("Content-Type", "text/css")
//		fmt.Fprint(w, styleCSS)
//	})


	http.HandleFunc("/script.js", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "js/script.js")
	})

	css,_ := os.ReadDir("css")
	for _,stylefile := range css {
		cssName := stylefile.Name()
		name := cssName

		http.HandleFunc("/" + name, func(w http.ResponseWriter, r *http.Request) {
			http.ServeFile(w, r, "css/" + name)
		})
	}

	assets,_ := os.ReadDir("assets")
	for _,asset := range assets {
		assetName := asset.Name()
		name := assetName

		http.HandleFunc("/" + name, func(w http.ResponseWriter, r *http.Request) {
			http.ServeFile(w, r, "assets/" + name)
		})
	}


	loginData, err := os.ReadFile(LoginDataFileName)
	if err != nil {
		_,err := os.Create(LoginDataFileName)
		if err != nil {
			fmt.Println("Could not create a login database file")
			return
		}
		fmt.Println("Created login database file")
	} else {
		err = json.Unmarshal(loginData, &userLoginDataMap)
		if err != nil && len(loginData) > 0 {
			fmt.Println("Cant Unmarshal Login Database")
			return
		}
	}

	port := 8000
	fmt.Println("Serving on 0.0.0.0:" + strconv.Itoa(port))

	err = http.ListenAndServeTLS("0.0.0.0: " + strconv.Itoa(port), "cert.pem", "key.pem", nil)
	if err != nil {
		http.ListenAndServe("0.0.0.0:" + strconv.Itoa(port), nil)
	}
}

func Main(w http.ResponseWriter, r *http.Request) {

	SessionId, err := r.Cookie("SessionID")

	d := struct{
		Login bool
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

	tpl,err := template.ParseFiles("html/Main.html")
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

func Substance(w http.ResponseWriter, r*http.Request) {
	tpl,err := template.ParseFiles("html/sub.html")
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

func Journal(w http.ResponseWriter, r *http.Request) {
	tpl,err := template.ParseFiles("html/Journal.html")
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
	tpl,err := template.ParseFiles("html/DruginfoPage.html")
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

	type login struct{
		Username string `json:"username"`
		Password string `json:"password"`
	}

	var UserLoginData login

	err := json.NewDecoder(r.Body).Decode(&UserLoginData)
	if err != nil {
		http.Error(w, "Not valid folder data", http.StatusBadRequest)
		return
	}


	d,exists := userLoginDataMap[strings.ToLower(UserLoginData.Username)]
	password := d.Password

	if !exists {
		http.Error(w, "User Dosent Exist", http.StatusBadRequest)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(password), []byte(UserLoginData.Password)); err != nil {
		http.Error(w, "Wrong Password", http.StatusBadRequest)
		return
	}
	
	randomCookie := RandomCharacters()

	cookie := &http.Cookie{
		Name:  "SessionID",
		Value: randomCookie,
		Path:  "/",
		MaxAge: 86400,
	}

	http.SetCookie(w, cookie)

	c := cookies[randomCookie]
	c.Time = time.Now()
	c.Username = strings.ToLower(UserLoginData.Username)
	c.OriginalUsername = d.OriginalUsername
	c.Authority = d.Authority
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

		d, ok := cookies[SessionId.Value];
		if !ok || d.Authority != "Admin" {
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
			for key,value := range cookies {
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
	for i:=0;i<length;i++ {
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

		info,err := os.Stat(dirPath)
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
			d := struct{
				Files []FileFolderInfo
				IsRoot bool
				BackPath string
			}{}
			if path == "/Files/" {
				d.IsRoot = true
			} else {
				pathSplit := strings.Split(path, "/")
				if len(pathSplit) < 2 {
					d.BackPath = "/"
				} else {
					d.BackPath = "/" + filepath.Join(pathSplit[:len(pathSplit) - 1]...)
				}
			}


			d.Files,err = getItemsInPath(w, r, dirPath)
			if err != nil {
				http.Error(w, "Cant find folder/file", http.StatusBadRequest)
				return
			}

			tpl,err := template.ParseFiles("html/Downloader.html")
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

	tpl,err := template.ParseFiles("html/Uploader.html")
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
	for _,file := range files {
		f,_ := file.Open()
		out, err := os.Create(filepath.Join(UploadedFilesDirName, currentPath, file.Filename))
		if err != nil {
			http.Error(w, "Error Downloading File", http.StatusBadRequest)
			f.Close()
			continue
		}
		
		_,err = io.Copy(out, f)
		if err != nil {
			http.Error(w, "Error Saving file", http.StatusBadRequest)
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
	var getFolderData struct{
		CurrentPath string `json:"currentPath"`
		FolderToGet string `json:"FolderToGet"`
	}

	var FoldersReturn struct{
		Folders []string `json:"Folders"`
		CurrentPath string `json:"CurrentPath"`
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

	for _,Dir := range Dirs {
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
		FileFolders,err := getItemsInPath(w,r, finalPath)
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
	var ArgNeeded struct{
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
	
	for _,file := range FilesFolders {
		isDir, isImg, isVid, isAudio := checkExtension(file.Name(), file.IsDir())

		info, err := file.Info()
		if err != nil {
			continue
		}

		Items = append(Items, FileFolderInfo{
			Name: info.Name(),
			Path: FilePathToUrl(filepath.Join(path, info.Name())),
			IsDir: isDir,
			IsImg: isImg,
			IsAudio: isAudio,
			IsVid: isVid,
			Size: int(info.Size()),
			Date: info.ModTime(),
		})
	}

	return Items, nil
}

func getItemFromPath(w http.ResponseWriter, r *http.Request, PathString string) FileFolderInfo {
	var Item FileFolderInfo
	var ArgNeeded struct{
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
		Name: file.Name(),
		Path: FilePathToUrl(strings.Join([]string{path, file.Name()}, "/")),
		IsDir: isDir,
		IsImg: isImg,
		IsAudio: isAudio,
		IsVid: isVid,
	}

	return Item
}

func checkExtension(fileName string, isDir bool) (bool, bool, bool, bool) {
	Extensions := map[string][]string{
		"Images": []string{".jpg", ".jpeg", ".png", ".gif"},
		"Videos": []string{".mp4", ".mkv", ".mov", ".webm"},
		"Audio": []string{".mp3", ".wav"},
	}

	var isImg bool
	var isVid bool
	var isAudio bool
	if isDir {
		return isDir, isImg, isVid, isAudio
	} else {
		for Type,ExtList := range Extensions {
			for _,Ext := range ExtList {
				if fileName[len(fileName) - len(Ext):] == Ext {
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
	entries,_ := os.ReadDir(path)
	
	for _, entry := range entries {
		fullPath := filepath.Join(path, entry.Name())

		if entry.IsDir(){
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
	var deleteData struct{
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
	var renameData struct{
		CurrentFilenamePath string `json:"currentFilenamePath"`
		NewFileName string `json"newFileName"`
	}
	err := json.NewDecoder(r.Body).Decode(&renameData)
	if err != nil {
		http.Error(w, "Not valid folder data", http.StatusBadRequest)
		return
	}

	currentFilePathSplit := strings.Split(renameData.CurrentFilenamePath, "/")
	currentFilePath := filepath.Join(UploadedFilesDirName, strings.Join(currentFilePathSplit[4:], "/"))
	newFilePath := filepath.Join(UploadedFilesDirName, strings.Join(currentFilePathSplit[4:len(currentFilePathSplit) - 1], "/"), renameData.NewFileName)

	curentFileName := currentFilePathSplit[len(currentFilePathSplit) - 1]
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
	tpl,err := template.ParseFiles("html/AdminPanel.html")
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
	tpl,err := template.ParseFiles("html/AdminPanelCreateUser.html")
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

	d,exists := userLoginDataMap[strings.ToLower(username)]
	if exists {
		http.Error(w, "User already exists", http.StatusBadRequest)
		return
	}
	
	d.OriginalUsername = username
	HashedPass,err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Cant hash password", http.StatusBadRequest)
		return
	}
	d.Password = string(HashedPass)
	d.Authority = authority

	userLoginDataMap[strings.ToLower(username)] = d
	w.Write([]byte("User Created"))
}
