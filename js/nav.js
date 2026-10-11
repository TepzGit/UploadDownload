// ============================================================
// nav.js
// Shared nav bar: highlights the current page and drives the
// phone menu (tap to open, tap outside / Esc / pick a link to close).
// ============================================================

(function () {
  document.documentElement.classList.add("xn-js");

  // Site color: the account's main color (Profile > Appearance), saved on
  // the server and kept in localStorage so each page paints in it at once.
  const COLOR_KEY = "xn_site_color";
  const DEFAULT_COLOR = "#a67cff";

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function luminance([r, g, b]) {
    const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }
  // Very dark picks are mixed toward white until text in that color stays
  // readable on black (and dark text on it stays readable too).
  function readable(rgb) {
    let out = rgb;
    for (let t = 0; t <= 1 && luminance(out) < 0.2; t += 0.04) {
      out = rgb.map((c) => Math.round(c + (255 - c) * t));
    }
    return out;
  }
  function applySiteColor(hex) {
    const rgb = hexToRgb(hex);
    const root = document.documentElement.style;
    if (!rgb || hex.toLowerCase() === DEFAULT_COLOR) root.removeProperty("--xn-accent-rgb");
    else root.setProperty("--xn-accent-rgb", readable(rgb).join(", "));
  }
  function storeSiteColor(hex) {
    try {
      if (hex) localStorage.setItem(COLOR_KEY, hex);
      else localStorage.removeItem(COLOR_KEY);
    } catch (_) {}
  }
  const signedIn = /(?:^|;\s*)xn_role=/.test(document.cookie);
  let cached = "";
  try { cached = signedIn ? localStorage.getItem(COLOR_KEY) || "" : ""; } catch (_) {}
  if (!signedIn) storeSiteColor("");
  applySiteColor(cached);
  window.xnSiteColor = {
    DEFAULT: DEFAULT_COLOR,
    apply: applySiteColor,
    // Shows the color now and remembers it for the next page.
    use(hex) { applySiteColor(hex); storeSiteColor(hex); },
    preview: (hex) => { const rgb = hexToRgb(hex); return rgb ? "rgb(" + readable(rgb).join(", ") + ")" : ""; },
  };
  if (signedIn) {
    fetch("/profile/appearance", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const color = data.siteColor || "";
        if (color !== cached) window.xnSiteColor.use(color);
      })
      .catch(() => {});
  }
  // The server sets xn_role so admin-only links (Files) can be hidden for
  // other accounts before the page paints. The server still checks access.
  if (/(?:^|;\s*)xn_role=admin(?:;|$)/.test(document.cookie)) {
    document.documentElement.classList.add("xn-admin");
  }
  // Members an admin let into Files.
  if (/(?:^|;\s*)xn_role=files(?:;|$)/.test(document.cookie)) {
    document.documentElement.classList.add("xn-files");
  }

  // Admin name colors: elements marked data-name-color get painted in it.
  function paintNames(root) {
    (root || document).querySelectorAll("[data-name-color]").forEach((el) => {
      const color = window.xnSiteColor.preview(el.dataset.nameColor);
      if (!color) return;
      el.style.color = color;
      el.classList.add("xn-named");
    });
  }
  window.xnPaintNames = paintNames;

  // The letter next to the logo: comments other people left on your
  // Forum posts. It shows only while some are unread.
  const MAIL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m4 7 8 6 8-6"/></svg>';
  const esc = (text) => String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function ago(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    if (s < 86400 * 7) return Math.floor(s / 86400) + " d ago";
    return new Date(ms).toLocaleDateString();
  }

  function initMail(nav) {
    if (!signedIn) return;
    const brand = nav.querySelector(".xn-brand");
    if (!brand) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "xn-mail";
    button.hidden = true;
    button.innerHTML = MAIL_ICON + '<span class="xn-mail-count"></span>';
    brand.after(button);
    const count = button.querySelector(".xn-mail-count");

    let dialog = null;
    let shown = 0;
    function setCount(n) {
      const wasHidden = button.hidden;
      button.hidden = n <= 0;
      nav.classList.toggle("has-mail", n > 0);
      count.textContent = n > 9 ? "9+" : String(n);
      button.setAttribute("aria-label", n === 1 ? "1 new comment on your posts" : n + " new comments on your posts");
      if (n > 0 && (wasHidden || n > shown)) {
        button.classList.remove("is-pop");
        void button.offsetWidth;
        button.classList.add("is-pop");
      }
      shown = n;
    }
    async function check() {
      if (document.hidden || (dialog && dialog.open)) return;
      try {
        const res = await fetch("/notifications?count=1", { headers: { Accept: "application/json" } });
        if (!res.ok) return;
        const data = await res.json();
        setCount(data.unread || 0);
      } catch (_) {}
    }

    function buildDialog() {
      dialog = document.createElement("dialog");
      dialog.className = "xn-inbox";
      dialog.setAttribute("aria-labelledby", "xnInboxTitle");
      dialog.innerHTML =
        '<div class="xn-inbox-head"><h2 id="xnInboxTitle">Comments on your posts</h2>' +
        '<button type="button" class="xn-inbox-close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>' +
        '<div class="xn-inbox-list" aria-live="polite"></div>';
      dialog.querySelector(".xn-inbox-close").addEventListener("click", () => dialog.close());
      dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
      document.body.appendChild(dialog);
    }

    function item(n) {
      const who = n.from || {};
      const face = who.avatar
        ? '<img class="xn-inbox-face" src="' + esc(who.avatar) + '" alt="" loading="lazy">'
        : '<span class="xn-inbox-face" aria-hidden="true">' + esc(who.initial || (who.name || "?").charAt(0).toUpperCase()) + "</span>";
      const name = who.color
        ? '<b class="xn-named" style="color:' + esc(window.xnSiteColor.preview(who.color)) + '">' + esc(who.name) + "</b>"
        : "<b>" + esc(who.name) + "</b>";
      const post = (n.postText || "").trim();
      return '<a class="xn-inbox-item' + (n.unread ? " is-new" : "") + '" href="/Forum?post=' + encodeURIComponent(n.post) + '">' +
        face +
        '<span class="xn-inbox-text"><span class="xn-inbox-line">' + name + " commented" +
        '<time datetime="' + new Date(n.at).toISOString() + '">' + ago(n.at) + "</time></span>" +
        '<span class="xn-inbox-body">' + esc(n.body) + "</span>" +
        (post ? '<span class="xn-inbox-post">On: ' + esc(post.length > 90 ? post.slice(0, 90) + "…" : post) + "</span>" : "") +
        "</span></a>";
    }

    async function open() {
      if (!dialog) buildDialog();
      const list = dialog.querySelector(".xn-inbox-list");
      list.innerHTML = '<p class="xn-inbox-empty">Loading…</p>';
      dialog.showModal();
      try {
        const res = await fetch("/notifications", { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const items = data.items || [];
        list.innerHTML = items.length ? items.map(item).join("") : '<p class="xn-inbox-empty">No comments yet.</p>';
        if (data.unread > 0) {
          fetch("/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "seen" }) })
            .then((r) => { if (r.ok) setCount(0); })
            .catch(() => {});
        }
      } catch (_) {
        list.innerHTML = '<p class="xn-inbox-empty">Couldn\'t load your comments. Try again.</p>';
      }
    }
    button.addEventListener("click", open);

    check();
    setInterval(check, 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
  }

  function init() {
    const nav = document.querySelector(".xn");
    if (!nav) return;
    const toggle = nav.querySelector(".xn-toggle");
    const links = nav.querySelectorAll(".xn-links a");
    initMail(nav);
    paintNames();

    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    links.forEach((link) => {
      const target = (link.getAttribute("href") || "").replace(/\/+$/, "") || "/";
      const match = target === "/" ? path === "/" : path === target || path.startsWith(target + "/");
      if (match) link.setAttribute("aria-current", "page");
    });

    if (!toggle) return;

    function setOpen(open) {
      nav.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    }

    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(!nav.classList.contains("open"));
    });
    links.forEach((link) => link.addEventListener("click", () => setOpen(false)));
    document.addEventListener("click", (event) => {
      if (!nav.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setOpen(false);
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth >= 768) setOpen(false);
    });
  }

  // Page-leave fade for browsers without cross-document view transitions.
  // Browsers that have them (they fire "pagereveal") animate on their own.
  function initLeaveFade() {
    if ("onpagereveal" in window) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    document.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest("a[href]");
      if (!link || link.hasAttribute("download") || link.dataset.noTransition !== undefined) return;
      if (link.target && link.target !== "_self") return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (/\.[a-z0-9]{2,5}$/i.test(url.pathname) && !/\.html?$/i.test(url.pathname)) return; // file downloads

      event.preventDefault();
      document.body.classList.add("xn-leaving");
      setTimeout(() => { window.location.href = url.href; }, 150);
      // If the browser stays on this page (download, blocked nav), undo the fade.
      setTimeout(() => document.body.classList.remove("xn-leaving"), 1500);
    });

    // Back/forward cache restores the faded page; bring it back.
    window.addEventListener("pageshow", () => document.body.classList.remove("xn-leaving"));
  }

  // Smooth mouse-wheel scrolling: each wheel notch eases the page toward
  // its target instead of jumping. Touch, trackpads (small deltas), zoom,
  // inner scroll boxes and "reduce motion" all keep the browser's own scrolling.
  function initSmoothWheel() {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const root = document.scrollingElement || document.documentElement;
    const maxScroll = () => root.scrollHeight - window.innerHeight;
    let target = 0;
    let current = 0;
    let last = 0;
    let frame = 0;

    function scrollsItself(el, dy) {
      for (; el && el !== document.body && el !== root; el = el.parentElement) {
        const overflow = getComputedStyle(el).overflowY;
        if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight + 1) {
          const canMove = dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
          if (canMove) return true;
        }
      }
      return false;
    }

    function stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      root.style.scrollBehavior = "";
    }

    function step(now) {
      const dt = Math.min(64, now - last || 16);
      last = now;
      current += (target - current) * (1 - Math.exp(-dt / 90));
      if (Math.abs(target - current) < 0.5) current = target;
      window.scrollTo(0, current);
      if (current === target) stop();
      else frame = requestAnimationFrame(step);
    }

    window.addEventListener("wheel", (event) => {
      if (event.defaultPrevented || event.ctrlKey) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const dy = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
      if (Math.abs(dy) < 40) return; // trackpad: already smooth
      if (maxScroll() <= 0) return;
      const el = event.target instanceof Element ? event.target : null;
      if (el && el.closest("select, textarea, input[type=number]:focus, [data-native-scroll]")) return;
      if (scrollsItself(el, dy)) return;
      if (getComputedStyle(document.body).overflowY === "hidden" || getComputedStyle(root).overflowY === "hidden") return;

      event.preventDefault();
      if (!frame) {
        target = current = window.scrollY;
        last = performance.now();
        root.style.scrollBehavior = "auto"; // the CSS smooth setting would fight each frame
        frame = requestAnimationFrame(step);
      }
      target = Math.max(0, Math.min(maxScroll(), target + dy));
    }, { passive: false });

    // Scrollbar drags, keys and clicks take over from an animation in progress.
    ["mousedown", "keydown", "touchstart"].forEach((type) => window.addEventListener(type, stop, { passive: true }));
  }

  // Short status message at the bottom of the screen; styles live in oled.css.
  let toastEl = null;
  let toastTimer = 0;
  window.xnToast = function (message, isError) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "xn-toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.toggle("is-error", !!isError);
    requestAnimationFrame(() => toastEl.classList.add("is-on"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 3200);
  };

  initLeaveFade();
  initSmoothWheel();

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
