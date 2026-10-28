//go:build desktop && windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

// desktopAlert shows a message box: the Windows build has no console.
func desktopAlert(msg string) {
	title, _ := syscall.UTF16PtrFromString("Geek4u")
	text, _ := syscall.UTF16PtrFromString(msg)
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), 0x40) // MB_ICONINFORMATION
}

// desktopShortcut puts Geek4u in the Start menu, and fixes the shortcut when
// the program was moved.
func desktopShortcut() {
	exe, err := os.Executable()
	// Started by the Electron window: the shortcut opens that instead.
	if shell := os.Getenv("GEEK4U_SHELL"); shell != "" {
		exe = shell
	}
	// Portable (Electron with Geek4u-data next to it): leave nothing on the PC.
	if err != nil || os.Getenv("APPDATA") == "" || os.Getenv("GEEK4U_PORTABLE") == "1" {
		return
	}
	done := filepath.Join(desktopDataDir, "shortcut.txt")
	link := filepath.Join(os.Getenv("APPDATA"), `Microsoft\Windows\Start Menu\Programs\Geek4u.lnk`)
	if b, err := os.ReadFile(done); err == nil && strings.TrimSpace(string(b)) == exe {
		if _, err := os.Stat(link); err == nil {
			return
		}
	}
	quote := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
	script := "$s=(New-Object -ComObject WScript.Shell).CreateShortcut(" + quote(link) + ");" +
		"$s.TargetPath=" + quote(exe) + ";" +
		"$s.WorkingDirectory=" + quote(filepath.Dir(exe)) + ";" +
		"$s.IconLocation=" + quote(exe+",0") + ";" +
		"$s.Description='Geek4u';$s.Save()"
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	if cmd.Run() == nil {
		os.WriteFile(done, []byte(exe+"\n"), 0644)
	}
}
