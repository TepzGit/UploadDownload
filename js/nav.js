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
  // Site background: "" = the drifting colors, a preset, or "custom" (own picture).
  const SCENE_KEY = "xn_site_bg";
  const SCENES = ["none", "aurora", "stars", "grid", "pills", "waves", "custom"];
  let scene = { scene: "", image: "", dim: 40 };
  try { if (signedIn) scene = Object.assign(scene, JSON.parse(localStorage.getItem(SCENE_KEY) || "{}")); } catch (_) {}
  if (!signedIn) { try { localStorage.removeItem(SCENE_KEY); } catch (_) {} }

  function sceneLayer(name) {
    const layer = document.createElement("div");
    layer.className = "xn-scene";
    layer.setAttribute("aria-hidden", "true");
    layer.dataset.scene = name;
    if (name === "pills") {
      // Spread the capsules over the width with their own size, speed and start.
      let seed = 7;
      const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
      for (let i = 0; i < 16; i++) {
        const pill = document.createElement("span");
        const size = 0.6 + rand() * 0.9;
        const time = 16 + rand() * 22;
        pill.style.cssText = "--x:" + (i * 6.25 + rand() * 5).toFixed(1) + "%;--s:" + size.toFixed(2) + ";--d:" + time.toFixed(1) + "s;--w:-" + (rand() * time).toFixed(1) + "s;--r:" + Math.round(rand() * 360) + "deg;--o:" + (0.18 + size * 0.22).toFixed(2) + ";--sway:" + Math.round(rand() * 120 - 60) + "px";
        layer.append(pill);
      }
    } else if (name === "grid") {
      layer.innerHTML = '<span class="s1"></span><span class="s2"><i></i></span>';
    } else if (name !== "none" && name !== "custom") {
      layer.innerHTML = '<span class="s1"></span><span class="s2"></span><span class="s3"></span>';
    }
    return layer;
  }
  function applyScene(next) {
    scene = Object.assign({ scene: "", image: "", dim: 40 }, next);
    let name = SCENES.includes(scene.scene) ? scene.scene : "";
    if (name === "custom" && !scene.image) name = "";
    const root = document.documentElement;
    if (name) root.dataset.scene = name;
    else delete root.dataset.scene;
    root.style.setProperty("--xn-scene-dim", String(Math.min(90, Math.max(0, Number(scene.dim) || 0)) / 100));
    if (name === "custom") root.style.setProperty("--xn-scene-img", 'url("' + scene.image.replace(/["\\]/g, "") + '")');
    else root.style.removeProperty("--xn-scene-img");
    placeScene(name);
  }
  // The layer goes right after the drifting colors so it stacks the same way on every page.
  function placeScene(name) {
    if (!document.body) return;
    const old = document.querySelector(".xn-scene");
    if (old && old.dataset.scene === name) return;
    if (old) old.remove();
    const fluid = document.querySelector(".xn-fluid");
    if (!name || !fluid) return;
    fluid.after(sceneLayer(name));
  }
  applyScene(scene);
  window.xnScene = {
    get: () => Object.assign({}, scene),
    apply: applyScene,
    use(next) {
      applyScene(next);
      try { localStorage.setItem(SCENE_KEY, JSON.stringify(scene)); } catch (_) {}
    },
  };

  if (signedIn) {
    fetch("/profile/appearance", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const color = data.siteColor || "";
        if (color !== cached) window.xnSiteColor.use(color);
        const next = { scene: data.siteBg || "", image: data.siteBgImage || "", dim: data.siteBgDim == null ? 40 : data.siteBgDim };
        if (JSON.stringify(next) !== JSON.stringify(scene)) window.xnScene.use(next);
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

  // Geek rank: 5 tiers, one point per Graph session and per Forum post.
  // The names match geekTiers in UploadDownload.go.
  const RANKS = ["Fresh Geek", "Geek", "Big Geek", "Mega Geek", "Geek⁴"];
  window.xnRank = {
    NAMES: RANKS,
    badge(tier, compact, level) {
      tier = Math.min(5, Math.max(1, Number(tier) || 1));
      const el = document.createElement("span");
      el.className = "xn-rank" + (compact ? " is-compact" : "");
      el.dataset.tier = String(tier);
      level = Math.max(0, Number(level) || 0);
      el.title = "Geek rank " + tier + " of 5: " + RANKS[tier - 1] + (level ? ", level " + level : "");
      el.innerHTML = '<span class="xn-rank-pips" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="xn-rank-name"></span>';
      const name = el.querySelector(".xn-rank-name");
      name.textContent = compact ? "Rank: " + RANKS[tier - 1] + (level ? ", level " + level : "") : RANKS[tier - 1];
      if (compact) name.className = "xn-rank-name xn-sr";
      if (level) {
        const lv = document.createElement("span");
        lv.className = "xn-level";
        lv.setAttribute("aria-hidden", compact ? "true" : "false");
        lv.textContent = compact ? String(level) : "Lv " + level;
        el.append(lv);
      }
      return el;
    },
  };

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
    placeScene(document.documentElement.dataset.scene || "");

    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    links.forEach((link) => {
      const target = (link.getAttribute("href") || "").replace(/\/+$/, "") || "/";
      const match = target === "/" ? path === "/" : path === target || path.startsWith(target + "/");
      if (match) link.setAttribute("aria-current", "page");
    });

    initTabs(nav, links);
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

  // Phones: the main pages sit in a tab bar along the bottom of the screen,
  // like an iPhone app, and the top bar keeps only the logo (oled.css).
  // Files is a tab only for accounts that can open it.
  const TABS = [
    { href: "/", label: "Graph", icon: '<path d="M3.5 3v15.5A2.5 2.5 0 0 0 6 21h14.5" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/><path d="M7 16c2.3 0 2.9-9.5 5.8-9.5 2.6 0 2.7 6.3 5 6.3 1 0 1.7-.8 2.4-2.1" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' },
    { href: "/journal", label: "Journal", icon: '<path d="M11 5.7C9.2 4.4 6.6 3.8 3.6 4A1.5 1.5 0 0 0 2.2 5.5v12.2c0 .9.8 1.6 1.7 1.5 2.7-.2 5 .4 7.1 1.7V5.7zM13 5.7v15.2c2.1-1.3 4.4-1.9 7.1-1.7.9.1 1.7-.6 1.7-1.5V5.5A1.5 1.5 0 0 0 20.4 4c-3-.2-5.6.4-7.4 1.7z"/>' },
    { href: "/Forum", label: "Forum", icon: '<path d="M4.5 3h10A2.5 2.5 0 0 1 17 5.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.2c-.5.4-1.3 0-1.3-.6V14A2.5 2.5 0 0 1 2 11.5v-6A2.5 2.5 0 0 1 4.5 3z"/><path d="M19 8.2a2.5 2.5 0 0 1 3 2.4v5.9a2.5 2.5 0 0 1-2 2.4v2c0 .6-.7 1-1.2.6L15.3 19H11a2.5 2.5 0 0 1-2.3-1.6l.9-.7h4.9A4.5 4.5 0 0 0 19 12.2z"/>' },
    { href: "/Files/", label: "Files", files: true, icon: '<path d="M2 6.5A2.5 2.5 0 0 1 4.5 4h4.3c.7 0 1.3.3 1.8.8L12 6.3h7.5A2.5 2.5 0 0 1 22 8.8v9.7a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5z"/>' },
    { href: "/Replications", label: "Replications", icon: '<rect x="7" y="2" width="14" height="16" rx="2.5"/><path d="M5 6v12.5A3.5 3.5 0 0 0 8.5 22H17a2 2 0 0 1-2 0H8.5A1.5 1.5 0 0 1 7 20.5V6.3A2 2 0 0 0 5 6z"/><path d="M3 6.8V19a4 4 0 0 0 4 4h9.5c.4 0 .8-.1 1.1-.3H7a2.6 2.6 0 0 1-2.6-2.6V5.6A2 2 0 0 0 3 6.8z" opacity=".55"/>' },
    { href: "/Profile", label: "Profile", icon: '<circle cx="12" cy="7.5" r="4.5"/><path d="M3.5 20.2C4.3 15.9 7.8 13.5 12 13.5s7.7 2.4 8.5 6.7c.1.7-.4 1.3-1.1 1.3H4.6c-.7 0-1.2-.6-1.1-1.3z"/>' },
  ];

  function initTabs(nav, links) {
    if (!links.length || document.querySelector(".xn-tabs")) return;
    const bar = document.createElement("nav");
    bar.className = "xn-tabs";
    bar.setAttribute("aria-label", "Main");
    const rootClass = document.documentElement.classList;
    const canFiles = rootClass.contains("xn-admin") || rootClass.contains("xn-files");
    const tabs = TABS.filter((tab) => !tab.files || canFiles);
    bar.classList.toggle("has-6", tabs.length > 5);
    tabs.forEach((tab) => {
      const link = Array.from(links).find((a) => (a.getAttribute("href") || "") === tab.href);
      const a = document.createElement("a");
      a.className = "xn-tab";
      a.href = tab.href;
      if (link) {
        link.classList.add("xn-in-tabs");
        if (link.getAttribute("aria-current")) a.setAttribute("aria-current", "page");
      }
      a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + tab.icon + '</svg><span class="xn-tab-label">' + tab.label + "</span>";
      bar.append(a);
    });
    // Tapping the tab you're on scrolls back to the top, like iOS.
    bar.addEventListener("click", (event) => {
      const a = event.target.closest("a[aria-current]");
      if (!a || window.location.hash) return;
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
      document.dispatchEvent(new CustomEvent("xn:tab-reselect", { detail: a.getAttribute("href") }));
    });
    document.body.append(bar);
    document.documentElement.classList.add("xn-has-tabs");
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
