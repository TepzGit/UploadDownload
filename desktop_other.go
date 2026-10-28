//go:build desktop && !windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// desktopAlert shows a message in a dialog when one of the usual tools is
// installed (started from the menu there is no terminal to read).
func desktopAlert(msg string) {
	if runtime.GOOS == "darwin" {
		exec.Command("osascript", "-e", `display dialog "`+strings.ReplaceAll(msg, `"`, `'`)+`" with title "Geek4u" buttons {"OK"}`).Run()
		return
	}
	if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
		return
	}
	for _, try := range [][]string{
		{"zenity", "--info", "--title=Geek4u", "--text=" + msg},
		{"kdialog", "--title", "Geek4u", "--msgbox", msg},
		{"xmessage", "-center", msg},
	} {
		if _, err := exec.LookPath(try[0]); err == nil {
			exec.Command(try[0], try[1:]...).Run()
			return
		}
	}
}

// desktopShortcut adds Geek4u to the Linux app menu (and keeps the entry
// pointing at the program if it was moved).
func desktopShortcut() {
	if runtime.GOOS != "linux" {
		return
	}
	exe, err := os.Executable()
	// Started by the Electron window: the shortcut opens that instead.
	if shell := os.Getenv("GEEK4U_SHELL"); shell != "" {
		exe = shell
	}
	home, herr := os.UserHomeDir()
	if err != nil || herr != nil {
		return
	}
	apps := filepath.Join(home, ".local", "share", "applications")
	if v := os.Getenv("XDG_DATA_HOME"); v != "" {
		apps = filepath.Join(v, "applications")
	}
	icon := filepath.Join(desktopDataDir, "geek4u.png")
	if _, err := os.Stat(icon); err != nil {
		os.WriteFile(icon, desktopIcon(), 0644)
	}
	quote := func(s string) string {
		if !strings.ContainsAny(s, " \t\"'\\$`") {
			return s
		}
		return `"` + strings.NewReplacer(`\`, `\\\\`, `"`, `\"`, "`", "\\`", "$", `\$`).Replace(s) + `"`
	}
	entry := "[Desktop Entry]\nType=Application\nName=Geek4u\nComment=Graph, Journal, Files and Music, offline\n" +
		"Exec=" + quote(exe) + "\nIcon=" + icon + "\nTerminal=false\nCategories=Utility;\n"
	file := filepath.Join(apps, "geek4u.desktop")
	if b, err := os.ReadFile(file); err == nil && string(b) == entry {
		return
	}
	if os.MkdirAll(apps, 0755) == nil {
		os.WriteFile(file, []byte(entry), 0755)
	}
}
