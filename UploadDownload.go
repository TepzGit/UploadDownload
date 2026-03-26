package main

import (
	"fmt"
	"html/template"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type DownloadFileDir struct {
	Name string
	Path string
	IsDir bool
	IsImg bool
}

var UploadedFilesDirName string = "UploadedFiles"

var UploadHTML string = `
<html>
    <head>
    <link rel="stylesheet" href="style.css">
    <script>
        function listFiles() {
            var files = document.querySelector('input[name="files"]').files
            var FileListingPart = document.querySelector(".FileListings")

            FileListingPart.innerText = ""

            for (i=0;i<files.length;i++) {
                const file = files[i]
		var size = file.size
		if (size > 1000000000) {
			size = size / (1000 * 1000 * 1000)
			size = Math.round(size).toString() + " GB"
		} else if (size > 1000000) {
			size = size / (1000 * 1000)
			size = Math.round(size).toString() + " MB"
		} else if (size > 1000) {
			size = size / 1000
			size = Math.round(size).toString() + " KB"
		} else {
			size = size.toString() + " bytes"
		}

		console.log(file)

                var elem = document.createElement('span');
                elem.innerText = file.name + " " + size

                FileListingPart.appendChild(elem)
            }
        }

        document.addEventListener('DOMContentLoaded', function() {
            document.querySelector('input[name="files"]').addEventListener('change', listFiles);
        });
    </script>
    </head>

    <body>
        <div class="main">
        <form id="box" action="/upload" method="post" enctype="multipart/form-data">
            

            <label class="custom-upload">
                Input
                <input  type="file" name="files" multiple>
            </label>
            <label class="custom-upload">
                    Submit
            <input id="submit" type="submit" value="Upload">
            </label>
            <label id="labell">files:</label>
            <div class="FileListings"></div>
            <img id="img" src="https://i.pinimg.com/originals/ba/e3/0e/bae30e0c7acfec296e5a30d0a75af0f1.gif" alt="">
            
        </form>
        
        </div>
    </body>
</html>
`
var styleCSS string = `
body {
    background-color: #000000;
}


.main {
    display: flex;
    margin-top: 10%;
    justify-content: center;
    align-content: center;
}


.input {
    height: 50px;
    width: 50px;
}

#submit {
    height: 150px;
    font-family: Arial, sans-serif;
    font-size: 25px;

}

input {
    background-color: transparent;
    color: white;
    border: 3px solid white;
}

.custom-upload {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    font-size: 25px;

    height: 50px !important;
    padding: 10px 16px;
    width: 200px;
    text-align: center;
    background: rgb(15, 15, 15);
    color: white;

    cursor: pointer;
    display: flex;
    justify-content: center;
    align-items: center;
}

span {
    color: white;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    font-size: 20px;
}

.FileListings {
    order: 5;
    display: flex;
    flex-direction: column;
    gap: 10px;
    height: 150px;
    width: 300px;
    max-height: 200px;
    overflow-y: auto;
}

#img {
    display: block;
    order: 0;
    width: 200px;
    height: 150px;
    object-fit: cover;

}

#labell {
    order: 4;
    color: white;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    border: solid 2px #0000;
    --b: 2px;
    --a: 0deg;
    --l: #0000 0% 70%, #00ff96ff;
    font-size: 20px;
}

#box {
    display: flex;
    flex-direction: column;
    align-items: center;
    repeating-conic-gradient(from var(--a, 0deg), var(--l, #0000 0% 70%, #00ff96ff)) border-box;
    gap: 20px;
    background-color: rgb(10, 10, 10);
    padding: 25px;
    width: 400px;
    min-height: 500px;

}

.custom-upload {
    order: 1;
}

.custom-upload input[type="file"] {
    display: none;
}

.custom-upload input[type="submit"] {
    display: none;
}
`

var tpl *template.Template

func main() {

	tpl = template.New("root")
	tpl.New("Upload").Parse(UploadHTML)
	
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.Redirect(w, r, "/Files", http.StatusSeeOther)
			return
		}
	})
	http.HandleFunc("/Files/", Downloader)
	http.HandleFunc("/Uploader", Uploader)
	http.HandleFunc("/upload", GetUploadData)

//	http.HandleFunc("/style.css", func(w http.ResponseWriter, r *http.Request) {
//		w.Header().Set("Content-Type", "text/css")
//		fmt.Fprint(w, styleCSS)
//	})

	http.HandleFunc("/downloader.css", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "css/downloader.css")
	})

	http.HandleFunc("/style.css", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "css/style.css")
	})

	http.HandleFunc("/NoPreview.png", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "assets/NoPreview.png")
	})


	fmt.Println("Serving on 0.0.0.0:8000")
	http.ListenAndServe("0.0.0.0:8000", nil)
}

func Downloader(w http.ResponseWriter, r *http.Request) {
		//fs := http.FileServer(http.Dir("."))
		ip, _, _ := net.SplitHostPort(r.RemoteAddr)
		fmt.Println("Client IP:", ip, "requested", r.URL.Path)

		path := r.URL.Path
		path = strings.TrimSuffix(path, "/")

		if strings.Contains(path, "downloader.css") {
			return
		}
		pathSplit := strings.Split(path, "/")

		var dirPath string
		if len(pathSplit) > 2 {
			dirPath = filepath.Join(append([]string{UploadedFilesDirName}, pathSplit[2:]...)...)
		} else {
			dirPath = UploadedFilesDirName + "/."
		}

		info,err := os.Stat(dirPath)
		if err != nil {
			if os.IsNotExist(err) {
				http.Error(w, "Cant find folder/file", http.StatusBadRequest)
				return
			}
		}

		if info.IsDir() {
			d := struct{
				Files []DownloadFileDir
				IsRoot bool
				BackPath string
			}{}
			if path == "/Files/" {
				d.IsRoot = true
			} else {
				if len(pathSplit) < 2 {
					d.BackPath = "/"
				} else {
					d.BackPath = filepath.Join(pathSplit[:len(pathSplit) - 1]...)
				}
			}

			ImgExt := []string{".jpg", ".png", ".gif"}

			files,err := os.ReadDir(dirPath)
			if err != nil {
				http.Error(w, "Cant find folder/file", http.StatusBadRequest)
				return
			}


			for _,file := range files {
				var isImg bool
				for _,Ext := range ImgExt {
					if file.Name()[len(file.Name()) - len(Ext):] == Ext {
						isImg = true
						break
					}
				}

				d.Files = append(d.Files, DownloadFileDir{
					Name: file.Name(),
					Path: strings.Join([]string{path, file.Name()}, "/"),
					IsDir: file.IsDir(),
					IsImg: isImg,
				})
			}

			tpl,err := template.ParseFiles("html/Downloader.html")
			if err != nil {
				fmt.Println(err)
				return
			}

			err = tpl.Execute(w, d)
			if err != nil {
				fmt.Println(err)
			}
		} else {
			w.Header().Set("Content-Disposition", "attachment; filename=\""+info.Name()+"\"")
			http.ServeFile(w, r, dirPath)
		}

}

func Uploader(w http.ResponseWriter, r *http.Request) {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	fmt.Println("Client IP:", ip, "requested", r.URL.Path)

	//tpl.ExecuteTemplate(w, "Upload", nil)

	tpl,err := template.ParseFiles("html/Uploader.html")
	if err != nil {
		fmt.Println(err)
		return
	}

	err = tpl.Execute(w, nil)
	if err != nil {
		fmt.Println(err)
	}
}

func GetUploadData(w http.ResponseWriter, r *http.Request) {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	fmt.Println("Client IP:", ip, "requested", r.URL.Path)
	
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

	os.Mkdir(UploadedFilesDirName, 0755)
	for _,file := range files {
		f,_ := file.Open()
		out, err := os.Create(filepath.Join(UploadedFilesDirName, file.Filename))
		if err != nil {
			http.Error(w, "Error Downloading File", http.StatusBadRequest)
			f.Close()
			continue
		}
		
		_,err = io.Copy(out, f)
		if err != nil {
			fmt.Println("Error saving file:", err)
		}

		f.Close()
		out.Close()
		fmt.Println("Uploaded file: " + file.Filename)
	}

	http.Redirect(w, r, "/Uploader?success=true", http.StatusSeeOther)
}

