// Geek4u desktop window (Electron). The Go program (resources/engine) does all
// the work: it mirrors the website, keeps the offline copy and updates itself.
// This file only gives it a proper window with Geek4u's own title bar.
const { app, BrowserWindow, WebContentsView, ipcMain, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const TITLE_H = 38;
let engine = null;
let win = null;
let view = null;
let siteURL = "";

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
Menu.setApplicationMenu(null);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(start);
}

function enginePath() {
  const name = process.platform === "win32" ? "Geek4u-engine.exe" : "geek4u-engine";
  return app.isPackaged ? path.join(process.resourcesPath, "engine", name) : path.join(__dirname, "..", "engine", name);
}

// The same data folder the old app used: Geek4u-data next to the program
// when it exists (portable), otherwise the engine's normal place.
function dataArgs() {
  const portable = path.join(path.dirname(process.execPath), "Geek4u-data");
  return fs.existsSync(portable) ? ["--data", portable] : [];
}

function startEngine() {
  return new Promise((resolve, reject) => {
    const args = ["--no-window", ...dataArgs(), ...process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => a.startsWith("--") && a !== "--no-window")];
    // The engine writes its address to this file (and prints it too).
    const addrFile = path.join(app.getPath("temp"), "geek4u-addr-" + process.pid + ".txt");
    try { fs.unlinkSync(addrFile); } catch {}
    engine = spawn(enginePath(), args, { cwd: path.dirname(enginePath()), windowsHide: true, env: { ...process.env, GEEK4U_SHELL: process.execPath, GEEK4U_ADDR_FILE: addrFile } });
    let out = "";
    let done = false;
    const found = (url) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      try { fs.unlinkSync(addrFile); } catch {}
      resolve(url);
    };
    const fromFile = () => {
      try {
        const url = fs.readFileSync(addrFile, "utf8").trim();
        if (/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) found(url);
      } catch {}
    };
    const poll = setInterval(fromFile, 150);
    const look = (chunk) => {
      out += chunk.toString();
      const m = out.match(/(?:is running|is already running) at (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) found(m[1]);
    };
    engine.stdout.on("data", look);
    engine.stderr.on("data", look);
    engine.on("error", (err) => { clearInterval(poll); reject(err); });
    engine.on("exit", (code) => {
      engine = null;
      // "Already running" ends the engine at once; the address is in the file.
      fromFile();
      if (done) return;
      clearInterval(poll);
      reject(new Error("The Geek4u engine stopped (" + code + "):\n" + (out.slice(-800) || "no output, see geek4u.log in the data folder")));
    });
    setTimeout(() => reject(new Error("The Geek4u engine didn't start in time.\n" + out.slice(-800))), 60000);
  });
}

async function start() {
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 380,
    minHeight: 420,
    frame: false,
    backgroundColor: "#000000",
    icon: path.join(__dirname, "icon.png"),
    title: "Geek⁴u",
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, "titlebar.html"));
  win.once("ready-to-show", () => win.show());

  view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: true } });
  view.setBackgroundColor("#000000");
  win.contentView.addChildView(view);
  const fit = () => {
    const [w, h] = win.getContentSize();
    view.setBounds({ x: 0, y: TITLE_H, width: w, height: Math.max(0, h - TITLE_H) });
  };
  fit();
  win.on("resize", fit);
  win.on("maximize", () => { fit(); send("max", true); });
  win.on("unmaximize", () => { fit(); send("max", false); });
  win.on("enter-full-screen", fit);
  win.on("leave-full-screen", fit);
  win.on("closed", () => { win = null; app.quit(); });

  const wc = view.webContents;
  const nav = () => send("nav", { back: wc.navigationHistory.canGoBack(), forward: wc.navigationHistory.canGoForward() });
  wc.on("page-title-updated", (_e, title) => { send("title", title); win?.setTitle(title); });
  // The title bar already has the logo, so the site's own nav logo is hidden here.
  // The "Show the Geek4u logo" setting (html.xn-nologo) hides the title bar logo too.
  wc.on("dom-ready", () => {
    wc.insertCSS(".xn > .xn-brand { display: none !important; }").catch(() => {});
    wc.executeJavaScript(`(() => {
      const root = document.documentElement;
      const tell = () => console.log("__geek4u_logo:" + (root.classList.contains("xn-nologo") ? 0 : 1));
      new MutationObserver(tell).observe(root, { attributes: true, attributeFilter: ["class"] });
      tell();
    })()`).catch(() => {});
  });
  wc.on("console-message", (e, _level, text) => {
    const m = /^__geek4u_logo:([01])$/.exec(String((e && e.message) || text || ""));
    if (m) send("logo", m[1] === "1");
  });
  wc.on("did-navigate", nav);
  wc.on("did-navigate-in-page", nav);
  wc.on("did-start-loading", () => send("loading", true));
  wc.on("did-stop-loading", () => send("loading", false));
  // Links to other sites open in the normal browser.
  wc.setWindowOpenHandler(({ url }) => {
    if (siteURL && url.startsWith(siteURL)) {
      wc.loadURL(url);
    } else if (/^https?:/i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => {
    if (siteURL && !url.startsWith(siteURL) && /^https?:/i.test(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  wc.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    const mod = input.control || input.meta;
    if (input.key === "F5" || (mod && input.key.toLowerCase() === "r")) { wc.reload(); e.preventDefault(); }
    else if (input.key === "F11") { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (input.key === "F12") { wc.toggleDevTools(); e.preventDefault(); }
    else if (input.alt && input.key === "ArrowLeft") { wc.navigationHistory.goBack(); e.preventDefault(); }
    else if (input.alt && input.key === "ArrowRight") { wc.navigationHistory.goForward(); e.preventDefault(); }
    else if (mod && (input.key === "=" || input.key === "+")) { wc.setZoomLevel(wc.getZoomLevel() + 0.5); e.preventDefault(); }
    else if (mod && input.key === "-") { wc.setZoomLevel(wc.getZoomLevel() - 0.5); e.preventDefault(); }
    else if (mod && input.key === "0") { wc.setZoomLevel(0); e.preventDefault(); }
  });

  try {
    siteURL = await startEngine();
    wc.loadURL(siteURL + "/Main");
  } catch (err) {
    send("error", String(err.message || err));
  }
}

function send(kind, value) {
  if (win && !win.isDestroyed()) win.webContents.send("geek4u", kind, value);
}

ipcMain.on("geek4u", (_e, act) => {
  if (!win) return;
  const wc = view?.webContents;
  if (act === "min") win.minimize();
  else if (act === "max") win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (act === "close") win.close();
  else if (act === "back") wc?.navigationHistory.goBack();
  else if (act === "forward") wc?.navigationHistory.goForward();
  else if (act === "reload") wc?.reload();
  else if (act === "home" && siteURL) wc?.loadURL(siteURL + "/Main");
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  if (engine) engine.kill();
});
