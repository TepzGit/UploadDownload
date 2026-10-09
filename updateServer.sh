#!/usr/bin/bash

#testcomment

scp -r * Server:UploadDownload/.
ssh -t Server "cd UploadDownload && sed -i 's/port := 8000/port := 42067/' UploadDownload.go && go build UploadDownload.go && sudo systemctl restart UploadDownloader"
