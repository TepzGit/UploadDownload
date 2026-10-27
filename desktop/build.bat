@echo off
rem Builds the Geek4u desktop app into desktop\dist (Windows + Linux).
rem Needs only Go. Double-click it, or run desktop\build.bat from the repo folder.
setlocal
cd /d "%~dp0.."
set "OUT=%CD%\desktop\dist"
set "WORK=%TEMP%\geek4u-desktop-build"
if exist "%WORK%" rmdir /s /q "%WORK%"
mkdir "%WORK%" "%OUT%" 2>nul

rem A clean copy with just what the app needs (this folder also has
rem CreateBcryptPass.go, a second main, and the phone apps).
for %%f in (go.mod go.sum UploadDownload.go desktop.go desktop_windows.go desktop_other.go) do copy /y "%%f" "%WORK%\" >nul
copy /y desktop\rsrc_windows_*.syso "%WORK%\" >nul
for %%d in (html css js assets) do xcopy /e /i /q /y "%%d" "%WORK%\%%d" >nul

rem The build time lets the app tell whether the website has a newer one
rem (desktop\dist\build.txt goes to the website with updateServer.sh).
for /f %%t in ('powershell -NoProfile -Command "(Get-Date).ToUniversalTime() | Get-Date -UFormat %%Y%%m%%d%%H%%M%%S"') do set "STAMP=%%t"

pushd "%WORK%"
set CGO_ENABLED=0
set GOOS=windows& set GOARCH=amd64
go build -tags desktop -trimpath -ldflags "-s -w -X main.desktopBuild=%STAMP% -H windowsgui" -o "%OUT%\Geek4u.exe" . || goto fail
set GOOS=linux& set GOARCH=amd64
go build -tags desktop -trimpath -ldflags "-s -w -X main.desktopBuild=%STAMP%" -o "%OUT%\Geek4u-linux-x64" . || goto fail
set GOOS=linux& set GOARCH=arm64
go build -tags desktop -trimpath -ldflags "-s -w -X main.desktopBuild=%STAMP%" -o "%OUT%\Geek4u-linux-arm64" . || goto fail
popd
>"%OUT%\build.txt" echo %STAMP%
rmdir /s /q "%WORK%"
echo Built into %OUT%
dir /b "%OUT%"
pause
exit /b 0

:fail
popd
echo Build failed.
pause
exit /b 1
