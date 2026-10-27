// Keeps music playing on other pages. While a song is loaded, links from the
// Music page open inside a frame above the player bar instead of leaving the
// page, so the <audio> never stops. Pages in the frame keep the address bar
// up to date, and their Music link (js/nav.js) closes the frame again.

const audio = document.getElementById("muAudio");
let shell = null;
let frame = null;
const musicTitle = document.title;

function songLoaded() {
  return Boolean(audio && audio.currentSrc && (!audio.paused || audio.currentTime > 0));
}

/** Same-site links that should open in the frame. */
function shellUrl(a, event) {
  if (!a || event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  if (a.hasAttribute("download") || (a.target && a.target !== "_self")) return null;
  const href = a.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) return null;
  let url;
  try { url = new URL(a.href, location.href); } catch { return null; }
  if (url.origin !== location.origin) return null;
  if (/^\/(music|logout|download)/i.test(url.pathname)) return null;
  return url;
}

function open(url) {
  if (!shell) {
    shell = document.createElement("div");
    shell.className = "mu-shell";
    frame = document.createElement("iframe");
    frame.title = "Page";
    frame.addEventListener("load", onFrameLoad);
    shell.append(frame);
    document.body.append(shell);
  }
  frame.src = url.href;
  shell.hidden = false;
  document.documentElement.classList.add("mu-shell-open");
  history.pushState({ muShell: 1 }, "", url.href);
}

function onFrameLoad() {
  let loc;
  try { loc = frame.contentWindow.location; } catch { return; }
  if (!loc || loc.href === "about:blank") return;
  if (/^\/music/i.test(loc.pathname)) return close();
  if (location.href !== loc.href) history.replaceState({ muShell: 1 }, "", loc.href);
  try { document.title = frame.contentDocument.title || musicTitle; } catch {}
}

export function close({ fromHistory = false } = {}) {
  if (!shell || shell.hidden) return;
  shell.hidden = true;
  frame.src = "about:blank";
  document.documentElement.classList.remove("mu-shell-open");
  document.title = musicTitle;
  if (!fromHistory) history.pushState({}, "", "/Music");
}

document.addEventListener("click", (event) => {
  if (!songLoaded()) return;
  const url = shellUrl(event.target.closest?.("a[href]"), event);
  if (!url) return;
  event.preventDefault();
  open(url);
}, true);

window.addEventListener("popstate", (event) => {
  if (!event.state?.muShell) close({ fromHistory: true });
});

window.xnMusicShell = { close, open: (href) => open(new URL(href, location.href)) };
