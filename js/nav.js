// ============================================================
// nav.js
// Shared nav bar: highlights the current page and drives the
// menu button (click to open the pages as tiles; click outside, Esc or
// pick a page to close).
// ============================================================

(function () {
  document.documentElement.classList.add("xn-js");

  // Firefox (and older Safari) can't animate from one page to the next on
  // their own (cross-document view transitions, "pagereveal"). oled.css gives
  // them their own page change under html.xn-no-vt. html.xn-ff marks
  // Firefox, which also scrolls the wheel smoothly by itself.
  if (!("onpagereveal" in window)) document.documentElement.classList.add("xn-no-vt");
  if (/Firefox\//.test(navigator.userAgent)) document.documentElement.classList.add("xn-ff");

  // The desktop app's server runs on this computer (it sets this cookie).
  // The app has the same top bar as the website, without the phone tab bar.
  const LOCAL_SERVER = /(?:^|;\s*)xn_local=1(?:;|$)/.test(document.cookie);
  if (LOCAL_SERVER) document.documentElement.classList.add("xn-desk");

  // Wide screens, the desktop app and iPhones/iPads (Safari and the iOS app)
  // keep every page behind the menu button next to the logo (html.xn-menu in
  // oled.css). Other phones use the tab bar.
  const WIDE = window.matchMedia("(min-width: 768px)");
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || /Geek4uApp\/[^ ]* \(iOS\)/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (IOS) document.documentElement.classList.add("xn-ios");
  // Menu style (Profile > Preferences, mommy 2026-11-06): "" the menu button,
  // "top" every page as a link in the top bar, "side" a bar down the left.
  // Only on wide screens; phones keep their tab bar or menu button.
  let NAV_STYLE = "";
  try { const saved = JSON.parse(localStorage.getItem("xn_site_look") || "null"); if (saved && (saved.nav === "top" || saved.nav === "side")) NAV_STYLE = saved.nav; } catch (_) {}
  // Notch header (mommy 2026-11-06), a switch on the Experimental page of
  // the settings window: the page title in a black notch hanging from the
  // top. Kept on this device only (xn_exp_header).
  let EXP_HEADER = false;
  try { EXP_HEADER = localStorage.getItem("xn_exp_header") === "1"; } catch (_) {}
  const syncMenu = () => {
    const root = document.documentElement;
    root.classList.toggle("xn-exp", EXP_HEADER);
    const bar = NAV_STYLE && WIDE.matches ? NAV_STYLE : "";
    root.classList.toggle("xn-menu", !bar && (LOCAL_SERVER || IOS || WIDE.matches));
    root.classList.toggle("xn-bar-top", bar === "top");
    root.classList.toggle("xn-bar-side", bar === "side");
  };
  syncMenu();
  WIDE.addEventListener("change", syncMenu);
  window.xnExpHeader = {
    get: () => EXP_HEADER,
    set(on) {
      EXP_HEADER = !!on;
      try { if (EXP_HEADER) localStorage.setItem("xn_exp_header", "1"); else localStorage.removeItem("xn_exp_header"); } catch (_) {}
      syncMenu();
      window.dispatchEvent(new CustomEvent("xn:nav-style"));
    },
  };
  

  // Inside the Music page's frame (js/musicshell.js) the song keeps playing in
  // the page around us, so the Music link just closes the frame.
  const MUSIC_SHELL = (() => {
    try { return window.parent !== window && window.parent.xnMusicShell ? window.parent.xnMusicShell : null; } catch { return null; }
  })();
  if (MUSIC_SHELL) {
    document.documentElement.classList.add("xn-in-music");
    document.addEventListener("click", (event) => {
      const a = event.target.closest?.("a[href]");
      if (!a || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      let url;
      try { url = new URL(a.href, location.href); } catch { return; }
      if (url.origin === location.origin && /^\/music\/?$/i.test(url.pathname)) {
        event.preventDefault();
        MUSIC_SHELL.close();
      }
    }, true);
  }

  

  // Safari's page-to-page transitions can leave the new page blank (the
  // Admin page on iPhones did), so Safari changes pages without them.
  const UA = navigator.userAgent;
  if (/iP(hone|ad|od)/.test(UA) || (/AppleWebKit/.test(UA) && !/Chrome\/|Chromium\/|Edg\//.test(UA))) {
    const skip = (event) => { if (event.viewTransition) event.viewTransition.skipTransition(); };
    window.addEventListener("pageswap", skip);
    window.addEventListener("pagereveal", skip);
  }

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
  const SCENES = ["none", "aurora", "stars", "grid", "pills", "waves", "sunset", "custom"];
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
    } else if (name === "sunset") {
      layer.innerHTML = '<span class="s1"></span>';
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

  // Animations (mommy 2026-11-02 22:46, "nmr 1 priority"): her computer asks
  // for less motion (Windows "Animation effects" off), which switched off almost
  // every animation on the site. Profile > Preferences > Animations now picks:
  // "" on (the default, even when the device asks for less motion), "device"
  // follows the device, "off". It works by rewriting the
  // (prefers-reduced-motion: ...) part of every @media rule in the page's
  // stylesheets, and of matchMedia() questions scripts ask.
  (function motion() {
    const RM = /\(\s*prefers-reduced-motion\s*:\s*(no-preference|reduce)\s*\)/g;
    const YES = "(min-width: 0px)";
    const NO = "(min-width: 99999px)";
    let mode = "";
    const swap = (text) => (mode === "device" ? text : text.replace(RM, (_, kind) => ((mode === "off") === (kind === "reduce") ? YES : NO)));
    const first = new WeakMap(); // rule -> its media text as written
    function walk(rules) {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule) {
          let text = first.get(rule);
          if (text == null) { text = rule.media.mediaText; first.set(rule, text); }
          if (/prefers-reduced-motion/.test(text)) {
            const next = swap(text);
            if (rule.media.mediaText !== next) rule.media.mediaText = next;
          }
        }
        if (rule.cssRules) walk(rule.cssRules);
      }
    }
    function sweep() {
      for (const sheet of document.styleSheets) {
        try { walk(sheet.cssRules); } catch (_) {} // another site's sheet
      }
    }
    const ask = window.matchMedia.bind(window);
    window.matchMedia = (query) => ask(swap(String(query)));
    // Stylesheets that arrive later (links still loading, styles scripts add).
    new MutationObserver((list) => {
      let again = false;
      for (const m of list) for (const n of m.addedNodes) {
        if (n.nodeName === "STYLE") again = true;
        else if (n.nodeName === "LINK") n.addEventListener("load", sweep, { once: true });
      }
      if (again) sweep();
    }).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", sweep);
    window.addEventListener("load", sweep);
    window.xnMotion = {
      get: () => mode,
      set(next) {
        mode = next === "device" || next === "off" ? next : "";
        document.documentElement.dataset.motion = mode || "on";
        sweep();
        window.dispatchEvent(new CustomEvent("xn:motion"));
      },
      // True when the page should move (scripts that animate on their own).
      on: () => !ask(swap("(prefers-reduced-motion: reduce)")).matches,
    };
  })();

  // Site look (Profile > Preferences): font, text size and the menu logo.
  // { font: "" | "jetbrains" | "inter" | "grotesk" | "system" | "serif" | "rounded", size: 80-130, logo: true }
  const LOOK_KEY = "xn_site_look";
  const LOOK_FONTS = ["", "jetbrains", "consolas", "courier", "inter", "grotesk", "system", "verdana", "trebuchet", "rounded", "comic", "serif", "garamond"];
  const LOOK_AURAS = ["", "glow", "pulse", "rainbow", "fire"];
  // Friends bar look (Settings > Friends, mommy 2026-11-09).
  const cleanFbar = (raw) => {
    const f = { show: "", style: "", color: "", pos: "" };
    if (!raw || typeof raw !== "object") return f;
    if (raw.show === "online" || raw.show === "icon") f.show = raw.show;
    if (["round", "pill", "glass"].includes(raw.style)) f.style = raw.style;
    if (/^#[0-9a-f]{6}$/i.test(raw.color || "")) f.color = raw.color.toLowerCase();
    if (["center", "right", "bottom"].includes(raw.pos)) f.pos = raw.pos;
    return f;
  };
  const cleanLook = (raw) => {
    const look = { font: "", size: 100, logo: true, aura: "", ogIcons: false, motion: "", nav: "", fbar: cleanFbar(raw && raw.fbar), side: "", sideNoTips: false, drugView: "" };
    if (raw && (raw.side === "slide" || raw.side === "icons")) look.side = raw.side;
    if (raw && raw.sideNoTips === true) look.sideNoTips = true;
    if (raw && (raw.drugView === "compact" || raw.drugView === "text")) look.drugView = raw.drugView;
    look.noGraphPreview = !!(raw && raw.noGraphPreview === true);
    look.navNoText = !!(raw && raw.navNoText === true);
    look.chatOff = !!(raw && raw.chatOff === true);
    look.forumOff = !!(raw && raw.forumOff === true);
    look.chatMute = raw && Array.isArray(raw.chatMute) ? [...new Set(raw.chatMute.filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim()))].slice(0, 300) : [];
    look.groupMute = raw && Array.isArray(raw.groupMute) ? [...new Set(raw.groupMute.map(Number).filter((n) => n > 0))].slice(0, 300) : [];
    // Currency shown next to dose prices (Settings > Graph, mommy 2026-11-20); "" = kr.
    look.currency = String((raw && raw.currency) || "").replace(/[<>"]/g, "").trim().slice(0, 4);
    if (look.currency.toLowerCase() === "kr") look.currency = "";
    look.pillNotes = [...new Set(String((raw && raw.pillNotes) || "").split(",").filter((p) => p === "new" || p === "mine" || p === "review"))].join(",");
    if (raw && LOOK_FONTS.includes(raw.font)) look.font = raw.font;
    const size = Number(raw && raw.size);
    if (size >= 80 && size <= 130) look.size = Math.round(size / 5) * 5;
    if (raw && raw.logo === false) look.logo = false;
    if (raw && LOOK_AURAS.includes(raw.aura)) look.aura = raw.aura;
    if (raw && raw.ogIcons === true) look.ogIcons = true;
    if (raw && (raw.motion === "device" || raw.motion === "off")) look.motion = raw.motion;
    if (raw && (raw.nav === "top" || raw.nav === "side")) look.nav = raw.nav;
    return look;
  };
  let look = cleanLook(null);
  try { if (signedIn) look = cleanLook(JSON.parse(localStorage.getItem(LOOK_KEY) || "null")); } catch (_) {}
  if (!signedIn) { try { localStorage.removeItem(LOOK_KEY); } catch (_) {} }
  function applyLook(next) {
    look = cleanLook(next);
    const root = document.documentElement;
    if (look.font) root.dataset.font = look.font;
    else delete root.dataset.font;
    root.classList.toggle("xn-nologo", !look.logo);
    if (window.xnMotion) window.xnMotion.set(look.motion);
    // Drug icons in the pill's or powder's own color (classicons.css).
    root.classList.toggle("xn-og-icons", look.ogIcons);
    root.style.zoom = look.size === 100 ? "" : String(look.size / 100);
    // No page names: the side bar shows icons only too.
    const side = look.navNoText && look.side !== "slide" ? "icons" : look.side;
    if (side) root.dataset.side = side; else delete root.dataset.side;
    root.classList.toggle("xn-nav-notext", look.navNoText);
    root.classList.toggle("xn-side-notips", look.sideNoTips);
    if (look.drugView) root.dataset.drugView = look.drugView; else delete root.dataset.drugView;
    window.dispatchEvent(new CustomEvent("xn:drug-view"));
    root.classList.toggle("xn-no-gpreview", look.noGraphPreview);
    setTimeout(() => window.dispatchEvent(new CustomEvent("xn:look")), 0);
    const fb = look.fbar;
    if (fb.style) root.dataset.fbarStyle = fb.style; else delete root.dataset.fbarStyle;
    if (fb.pos) root.dataset.fbarPos = fb.pos; else delete root.dataset.fbarPos;
    if (fb.color) {
      const n = parseInt(fb.color.slice(1), 16);
      root.style.setProperty("--xn-fbar-rgb", (n >> 16) + ", " + ((n >> 8) & 255) + ", " + (n & 255));
    } else root.style.removeProperty("--xn-fbar-rgb");
    window.dispatchEvent(new CustomEvent("xn:fbar"));
    if (NAV_STYLE !== look.nav) {
      NAV_STYLE = look.nav;
      syncMenu();
      window.dispatchEvent(new CustomEvent("xn:nav-style"));
    }
  }
  applyLook(look);
  window.xnLook = {
    get: () => Object.assign({}, look),
    clean: cleanLook,
    use(next) {
      applyLook(next);
      try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch (_) {}
    },
  };
  // A change made in another frame or tab (the settings window's pages are
  // frames) shows here at once.
  window.addEventListener("storage", (e) => {
    try {
      if (e.key === COLOR_KEY) applySiteColor(e.newValue || "");
      else if (e.key === LOOK_KEY) applyLook(JSON.parse(e.newValue || "null"));
      else if (e.key === SCENE_KEY) { scene = Object.assign(scene, JSON.parse(e.newValue || "{}")); applyScene(scene); }
    } catch (_) {}
  });

  if (signedIn) {
    fetch("/profile/appearance", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const color = data.siteColor || "";
        if (color !== cached) window.xnSiteColor.use(color);
        const next = { scene: data.siteBg || "", image: data.siteBgImage || "", dim: data.siteBgDim == null ? 40 : data.siteBgDim };
        if (JSON.stringify(next) !== JSON.stringify(scene)) window.xnScene.use(next);
        const nextLook = cleanLook(data.siteLook);
        if (JSON.stringify(nextLook) !== JSON.stringify(look)) window.xnLook.use(nextLook);
        // Graph style (Profile > Preferences), read by js/plot.js.
        try {
          const plotStyle = JSON.stringify(data.plotStyle || {});
          if (plotStyle !== (localStorage.getItem("xn_plot_style") || "{}")) {
            localStorage.setItem("xn_plot_style", plotStyle);
            window.dispatchEvent(new CustomEvent("xn:plot-style"));
          }
        } catch (_) {}
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

  // Animated name colors (a gradient moving through the letters). The keys
  // match nameFx in UploadDownload.go; the colors are in oled.css.
  const NAME_FX = ["rainbow", "blood", "midnight", "toxic", "ember", "void", "ocean", "shadow"];
  window.xnNameFx = {
    KEYS: NAME_FX,
    is: (color) => NAME_FX.includes(color),
    apply(el, color) {
      el.classList.add("xn-named", "xn-rainbow");
      if (color === "rainbow") delete el.dataset.fx;
      else el.dataset.fx = color;
      return el;
    },
  };

  // Admin name colors: elements marked data-name-color get painted in it.
  function paintNames(root) {
    (root || document).querySelectorAll("[data-name-color]").forEach((el) => {
      if (window.xnNameFx.is(el.dataset.nameColor)) {
        window.xnNameFx.apply(el, el.dataset.nameColor);
        return;
      }
      const color = window.xnSiteColor.preview(el.dataset.nameColor);
      if (!color) return;
      el.style.color = color;
      el.classList.add("xn-named");
    });
  }
  window.xnPaintNames = paintNames;

  // Geek rank: 7 ranks picked by the geek level (0 to 100), one point per
  // Graph session and per Forum post.
  // The names match geekTiers in UploadDownload.go. The label next to a
  // name is the tier name; look is the account's rankLook (color, style, icon).
  const RANKS = ["Fresh Geeker", "Pothead", "Fiend", "Tweaker", "Dedicated Tweaker", "Crackhead", "Sensei Tweak", "Twea(king)"];
  const HEX = /^#[0-9a-f]{6}$/i;
  window.xnRank = {
    NAMES: RANKS,
    dress(el, look) {
      look = look || {};
      el.dataset.color = look.color === "tier" ? "tier" : "";
      if (HEX.test(look.color || "")) el.style.setProperty("--rank", look.color);
      else el.style.removeProperty("--rank");
      if (look.style) el.dataset.style = look.style;
      else delete el.dataset.style;
      el.dataset.icon = look.hideIcon ? "0" : "";
      return el;
    },
    badge(tier, compact, level, look) {
      tier = Math.min(RANKS.length, Math.max(1, Number(tier) || 1));
      const el = document.createElement("span");
      el.className = "xn-rank" + (compact ? " is-compact" : "");
      el.dataset.tier = String(tier);
      level = Math.max(0, Number(level) || 0);
      el.title = "Geek rank " + tier + " of " + RANKS.length + ": " + RANKS[tier - 1] + (level ? ", level " + level : "");
      el.innerHTML = '<span class="xn-rank-name"></span>';
      el.querySelector(".xn-rank-name").textContent = RANKS[tier - 1];
      this.dress(el, look);
      if (level) {
        const lv = document.createElement("span");
        lv.className = "xn-level";
        lv.textContent = "Lv " + level;
        el.append(lv);
      }
      return el;
    },
  };

  // Rank name lettering (Level pack, mommy 2026-11-01): Fresh Geeker and
  // Fiend move letter by letter, so their names are split into
  // one <i> per letter (oled.css .xn-rn).
  window.xnRank.letter = function (root) {
    (root || document).querySelectorAll(".xn-rn:not(.is-split)").forEach((el) => {
      const t = el.dataset.tier;
      if (t !== "1" && t !== "3") return;
      const text = el.textContent;
      el.textContent = "";
      Array.from(text).forEach((c, i) => {
        const s = document.createElement("i");
        s.style.setProperty("--i", String(i));
        s.textContent = c;
        el.append(s);
      });
      el.classList.add("is-split");
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => window.xnRank.letter());
  else window.xnRank.letter();

  // Levels popup (mommy 2026-11-02): pressing a level badge shows every rank,
  // its levels and its badge. Badges marked data-levels open it; their
  // data-tier and data-level mark where the account is now.
  const RANK_FROM = [0, 10, 20, 40, 50, 65, 80, 100];
  window.xnRank.hexb = function (tier, level) {
    const b = document.createElement("span");
    b.className = "xn-hexb";
    b.dataset.tier = String(tier);
    b.setAttribute("aria-hidden", "true");
    b.innerHTML = '<span class="xn-hexb-hex"><span class="xn-hexb-ring"></span><span class="xn-hexb-face"><i class="xn-lp-ico"></i></span></span><span class="xn-hexb-lv"><b></b></span><span class="xn-hexb-fx"><i></i><i></i><i></i><i></i><b></b><b></b><b></b></span>';
    b.querySelector(".xn-hexb-lv").dataset.digits = String(String(level).length);
    b.querySelector(".xn-hexb-lv b").textContent = String(level);
    return b;
  };
  window.xnRank.showLevels = function (tier, level) {
    tier = Number(tier) || 0;
    level = Number(level) || 0;
    let pop = document.getElementById("xnLvPop");
    if (pop) pop.remove();
    pop = document.createElement("div");
    pop.id = "xnLvPop";
    pop.className = "xn-lvpop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-modal", "true");
    pop.setAttribute("aria-labelledby", "xnLvPopTitle");
    pop.innerHTML = '<div class="xn-lvpop-card"><div class="xn-lvpop-head"><div><h2 id="xnLvPopTitle">Geek levels</h2><p>Every Graph session and Forum post is a point. Points raise your level from 0 to 100, and your level picks your rank.</p></div><button type="button" class="xn-lvpop-x" aria-label="Close">×</button></div><ol class="xn-lvpop-list"></ol></div>';
    const list = pop.querySelector("ol");
    RANKS.forEach((name, i) => {
      const t = i + 1, from = RANK_FROM[i], to = RANK_FROM[i + 1];
      const li = document.createElement("li");
      li.className = "xn-lvpop-row" + (t === tier ? " is-now" : t < tier ? " is-done" : "");
      const badge = window.xnRank.hexb(t, t === tier ? level : from);
      const text = document.createElement("div");
      const nm = document.createElement("span");
      nm.className = "xn-rn";
      nm.dataset.tier = String(t);
      nm.textContent = name;
      const range = document.createElement("small");
      range.textContent = to == null ? "Level " + from : "Levels " + from + " to " + (to - 1);
      text.append(nm, range);
      li.append(badge, text);
      if (t === tier) {
        const you = document.createElement("span");
        you.className = "xn-lvpop-you";
        you.textContent = "You, level " + level;
        li.append(you);
      }
      list.append(li);
    });
    document.body.append(pop);
    window.xnRank.letter(pop);
    const last = document.activeElement;
    const close = () => { pop.remove(); document.removeEventListener("keydown", key); if (last && last.focus) last.focus(); };
    const key = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", key);
    pop.addEventListener("click", (e) => { if (e.target === pop || e.target.closest(".xn-lvpop-x")) close(); });
    pop.querySelector(".xn-lvpop-x").focus();
    const now = pop.querySelector(".is-now");
    if (now) now.scrollIntoView({ block: "nearest" });
  };
  // Capture phase, so a badge inside another button (Main card) opens the
  // popup without also toggling that button.
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-levels]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const hex = b.matches(".xn-hexb") ? b : b.querySelector(".xn-hexb");
    window.xnRank.showLevels(hex && hex.dataset.tier, b.dataset.level || (hex && hex.querySelector(".xn-hexb-lv b") || {}).textContent);
  }, true);
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("span[data-levels]")) { e.preventDefault(); e.target.click(); }
  });

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

  // Chat: unread messages as a badge on the Chat link, and on phones a chat
  // bubble next to the logo (the tab bar has no room for another tab).
  function initChat(nav) {
    if (!signedIn) return;
    const onChat = /^\/Chat\b/.test(location.pathname);
    const link = nav.querySelector('.xn-links a[href="/Chat"]');
    // The menu button shows the count too, as the Chat link is in its tiles.
    const toggle = nav.querySelector(".xn-toggle");
    const brand = nav.querySelector(".xn-brand");
    let bubble = null;
    if (brand && !onChat) {
      bubble = document.createElement("a");
      bubble.href = "/Chat";
      bubble.className = "xn-chat-btn";
      bubble.setAttribute("aria-label", "Chat");
      bubble.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg><span class="xn-chat-count"></span>';
      (nav.querySelector(".xn-mail") || brand).after(bubble);
    }
    let shown = 0;
    function set(n) {
      [link, bubble, toggle].forEach((el) => {
        if (!el) return;
        let badge = el.querySelector(".xn-chat-count");
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "xn-chat-count";
          if (el === toggle) badge.setAttribute("aria-hidden", "true");
          el.append(badge);
        }
        badge.textContent = n > 99 ? "99+" : n > 0 ? String(n) : "";
        el.classList.toggle("has-unread", n > 0);
        if (n > shown) {
          el.classList.remove("is-pop");
          void el.offsetWidth;
          el.classList.add("is-pop");
        }
      });
      if (bubble) bubble.setAttribute("aria-label", n ? "Chat, " + n + " unread" : "Chat");
      shown = n;
    }
    if (onChat) return;
    // Settings > Chat (mommy 2026-11-09): notifications can be off, or muted
    // for some friends; a new message also shows a note in the corner.
    const lookNow = () => (window.xnLook ? window.xnLook.get() : {});
    let lastUnread = null;
    async function check() {
      if (document.hidden) return;
      const look = lookNow();
      if (look.chatOff) { set(0); lastUnread = null; return; }
      const mute = (look.chatMute || []).map((n) => n.toLowerCase());
      const mutes = (c) => c.kind !== "group" && (c.members || []).some((m) => mute.includes(String(m.name || "").toLowerCase()));
      try {
        const res = await fetch("/chat/updates?count=1", { headers: { Accept: "application/json" } });
        if (!res.ok) return;
        let n = (await res.json()).unread || 0;
        let chats = null;
        if (n > 0 && (mute.length || (lastUnread !== null && n > lastUnread))) {
          const full = await fetch("/chat/updates", { headers: { Accept: "application/json" } });
          if (full.ok) chats = (await full.json()).chats || [];
        }
        if (chats) n = chats.filter((c) => !mutes(c)).reduce((s, c) => s + (c.unread || 0), 0);
        if (chats && lastUnread !== null && n > lastUnread && window.xnPillNotes) {
          const c = chats.filter((x) => !mutes(x) && x.unread > 0).sort((a, b) => (b.activity || 0) - (a.activity || 0))[0];
          if (c) {
            const meName = (() => { try { return (JSON.parse(localStorage.getItem("xn_me") || "null") || {}).name || ""; } catch (_) { return ""; } })();
            const other = (c.members || []).find((m) => m.name !== meName) || {};
            const from = c.kind === "group" ? c.name || "Group chat" : other.name || c.name || "Someone";
            const body = c.last && !c.last.deleted ? (c.last.body || (c.last.image ? "Sent a picture" : "")) : "";
            window.xnPillNotes.show({ kick: "Chat", title: "New message from " + from, text: body, pic: c.kind === "group" ? "" : other.avatar || "", href: "/Chat", icon: "chat" });
          }
        }
        lastUnread = n;
        set(n);
      } catch (_) {}
    }
    window.addEventListener("xn:look", () => check());
    check();
    setInterval(check, 20000);
    document.addEventListener("visibilitychange", check);
  }

  // Log out button at the right end of the bar (phones use Profile > Sign out).
  function initLogout(nav) {
    if (!signedIn || nav.querySelector(".xn-out")) return;
    const form = document.createElement("form");
    form.method = "post";
    form.action = "/logout";
    form.className = "xn-out";
    form.innerHTML = '<button type="submit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/></svg><span>Log out</span></button>';
    nav.append(form);
  }

  // The menu panel's last row (mommy 2026-10-29): no page tiles, just Log out
  // on the far left, then your picture and name (a link to your Profile).
  // It takes the place of the Log out button in the bar (oled.css).
  function initMenuFoot(box) {
    if (!signedIn || !box || box.querySelector(".xn-menu-foot")) return;
    const foot = document.createElement("div");
    foot.className = "xn-menu-foot";
    // mommy's design 2026-11-07: level badge + rank name on the left; Admin
    // (admins only), name and picture on the right. Log out lives in the
    // settings window now.
    foot.innerHTML =
      '<span class="xn-foot-lvl"><span class="xn-foot-lv" hidden></span><span class="xn-foot-rank" hidden></span></span>' +
      (document.documentElement.classList.contains("xn-admin") ? '<form method="get" action="/admin" class="xn-foot-out xn-foot-admin"><button type="submit" aria-label="Admin" title="Admin"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.4 4.4 5.3v5.9c0 4.7 3.2 8.9 7.6 10.3 4.4-1.4 7.6-5.6 7.6-10.3V5.3z"/></svg></button></form>' : "") +
      '<a class="xn-foot-me" href="/Profile" aria-label="Your profile"><span class="xn-foot-name"></span><span class="xn-foot-face" aria-hidden="true"></span></a>';
    box.append(foot);
    // Go straight to /admin (a plain GET form would add a "?").
    foot.querySelector(".xn-foot-admin")?.addEventListener("submit", (e) => { e.preventDefault(); location.assign("/admin"); });
    const face = foot.querySelector(".xn-foot-face");
    const name = foot.querySelector(".xn-foot-name");
    const show = (me) => {
      if (!me || !me.name) return;
      name.textContent = me.name;
      foot.querySelector(".xn-foot-me").setAttribute("aria-label", "Your profile, " + me.name);
      face.textContent = "";
      if (me.avatar) {
        const img = document.createElement("img");
        img.src = me.avatar;
        img.alt = "";
        img.addEventListener("error", () => { img.remove(); face.textContent = me.name.charAt(0).toUpperCase(); });
        face.append(img);
      } else {
        face.textContent = me.name.charAt(0).toUpperCase();
      }
      if (me.nameColor) {
        name.dataset.nameColor = me.nameColor;
        paintNames(foot);
      }
      // Your geek level badge beside your name (mommy 2026-11-02).
      const lv = foot.querySelector(".xn-foot-lv");
      if (lv && typeof me.level === "number" && window.xnRank && window.xnRank.hexb) {
        lv.replaceChildren(window.xnRank.hexb(me.tier || 0, me.level));
        lv.title = (me.rank || "Geek level") + ", level " + me.level;
        lv.hidden = false;
      }
      // The rank's name on the other side of the badge (mommy 2026-11-06).
      const rank = foot.querySelector(".xn-foot-rank");
      if (rank && me.rank) {
        const rn = document.createElement("span");
        rn.className = "xn-rn";
        rn.dataset.tier = String(me.tier || 1);
        rn.textContent = me.rank;
        rank.replaceChildren(rn);
        rank.hidden = false;
        if (window.xnRank && window.xnRank.letter) window.xnRank.letter(rank);
      }
    };
    // Last seen values first so the row is filled at once, then the server's.
    try { show(JSON.parse(localStorage.getItem("xn_me") || "null")); } catch {}
    // A server from before /me answers 404: then the name and picture are
    // read from the Profile page (this page, or fetched).
    const fromProfile = (doc) => {
      const name = doc.getElementById("username");
      if (!name || !name.textContent.trim()) return null;
      const img = doc.getElementById("avatarImg");
      return {
        name: name.textContent.trim(),
        avatar: img && !img.hidden ? img.getAttribute("src") || "" : "",
        nameColor: name.dataset.nameColor || "",
      };
    };
    fetch("/me", { headers: { Accept: "application/json" } })
      .then((res) => {
        if (res.ok) return res.json();
        if (res.status === 401) return null;
        const here = document.querySelector(".xn-page.pf") && fromProfile(document);
        if (here) return here;
        return fetch("/Profile").then((page) => (page.ok ? page.text() : ""))
          .then((html) => (html ? fromProfile(new DOMParser().parseFromString(html, "text/html")) : null));
      })
      .then((me) => {
        if (!me) return;
        show(me);
        try { localStorage.setItem("xn_me", JSON.stringify(me)); } catch {}
        checkLevelUp(me);
      })
      .catch(() => {});
  }

  // Friends in the top bar (mommy 2026-11-02): each friend as a square picture
  // with when they were last online under it, and a dot for news from them
  // (public trip reports, Forum posts, messages to you). Tapping one opens a
  // small card with that news. GET /friends/bar, POST {seen} after opening.
  function initFriendsBar(nav) {
    if (!signedIn || nav.querySelector(".xn-friends")) return;
    const strip = document.createElement("div");
    strip.className = "xn-friends";
    strip.setAttribute("role", "group");
    strip.setAttribute("aria-label", "Friends");
    strip.hidden = true;
    const anchor = nav.querySelector(".xn-mail") || nav.querySelector(".xn-toggle") || nav.querySelector(".xn-brand");
    if (anchor) anchor.after(strip); else nav.append(strip);
    let card = null, openName = "", friends = [], now = Date.now();
    const ago = (t) => {
      if (!t) return "a while";
      const s = Math.max(0, (now - t) / 1000);
      if (s < 300) return "";
      if (s < 3600) return Math.round(s / 60) + "m";
      if (s < 86400) return Math.round(s / 3600) + "h";
      if (s < 86400 * 30) return Math.round(s / 86400) + "d";
      return Math.round(s / (86400 * 30)) + "mo";
    };
    const agoLong = (t) => {
      const a = ago(t);
      if (a === "") return "Online now";
      if (a === "a while") return "Not online for a while";
      const n = parseInt(a, 10), u = a.replace(/\d+/, "");
      const word = { m: "minute", h: "hour", d: "day", mo: "month" }[u];
      return "Last online " + n + " " + word + (n === 1 ? "" : "s") + " ago";
    };
    const ICON = {
      report: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5"/></svg>',
      post: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
      message: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4zM4 7l8 6 8-6"/></svg>',
    };
    const face = (f, cls) => {
      const box = document.createElement("span");
      box.className = cls;
      if (f.avatar) {
        const img = document.createElement("img");
        img.src = f.avatar;
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("error", () => { img.remove(); box.textContent = f.initial || f.name.charAt(0).toUpperCase(); }, { once: true });
        box.append(img);
      } else box.textContent = f.initial || f.name.charAt(0).toUpperCase();
      return box;
    };
    const close = () => {
      if (!card) return;
      card.remove();
      card = null;
      strip.querySelectorAll(".xn-friend[aria-expanded]").forEach((b) => b.setAttribute("aria-expanded", "false"));
      openName = "";
    };
    const open = (f, btn) => {
      if (openName === f.name) { close(); return; }
      close();
      openName = f.name;
      btn.setAttribute("aria-expanded", "true");
      card = document.createElement("div");
      card.className = "xn-friend-card";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-label", f.name);
      const head = document.createElement("a");
      head.className = "xn-friend-head";
      head.href = "/u/" + encodeURIComponent(f.name);
      const who = document.createElement("span");
      who.className = "xn-friend-who";
      const nm = document.createElement("strong");
      nm.textContent = f.name;
      if (f.color) nm.dataset.nameColor = f.color;
      const seen = document.createElement("small");
      seen.textContent = agoLong(f.lastSeen);
      if (ago(f.lastSeen) === "") seen.className = "is-on";
      who.append(nm, seen);
      head.append(face(f, "xn-friend-face"), who);
      const list = document.createElement("ul");
      list.className = "xn-friend-news";
      if (!f.news.length) {
        const li = document.createElement("li");
        li.className = "xn-friend-none";
        li.textContent = "Nothing new from " + f.name + " this week.";
        list.append(li);
      }
      f.news.forEach((n, i) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = n.url;
        if (i < f.new) a.className = "is-new";
        a.innerHTML = ICON[n.kind] || "";
        const t = document.createElement("span");
        t.textContent = n.text;
        const when = document.createElement("small");
        when.textContent = ago(n.at) === "" ? "just now" : ago(n.at) + " ago";
        t.append(when);
        a.append(t);
        li.append(a);
        list.append(li);
      });
      const foot = document.createElement("div");
      foot.className = "xn-friend-foot";
      foot.innerHTML = '<a href="/Chat?to=' + encodeURIComponent(f.name) + '">Message</a><a href="/u/' + encodeURIComponent(f.name) + '">Profile</a>';
      card.append(head, list, foot);
      document.body.append(card);
      paintNames(card);
      place(btn);
      if (f.new) {
        f.new = 0;
        btn.classList.remove("has-news");
        fetch("/friends/bar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seen: f.name }) }).catch(() => {});
      }
    };
    const GROUP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.4"/><path d="M2.8 19.5c.6-3.6 3.1-5.6 6.2-5.6s5.6 2 6.2 5.6"/><circle cx="16.8" cy="9" r="2.7"/><path d="M15.6 13.9c.4-.1.8-.1 1.2-.1 2.5 0 4.4 1.6 4.9 4.6"/></svg>';
    const cfg = () => (window.xnLook ? window.xnLook.get().fbar : null) || { show: "" };
    const isOn = (f) => ago(f.lastSeen) === "";
    const friendButton = (f) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "xn-friend" + (f.new ? " has-news" : "");
      b.setAttribute("aria-haspopup", "dialog");
      b.setAttribute("aria-expanded", "false");
      const a = ago(f.lastSeen);
      b.setAttribute("aria-label", f.name + ", " + agoLong(f.lastSeen) + (f.new ? ", " + f.new + " new" : ""));
      b.title = f.name;
      b.append(face(f, "xn-friend-pic"));
      const line = document.createElement("span");
      line.className = "xn-friend-seen" + (a === "" ? " is-on" : "");
      line.textContent = a === "" ? "online" : a;
      b.append(line);
      if (f.new) {
        const dot = document.createElement("span");
        dot.className = "xn-friend-dot";
        dot.textContent = f.new > 9 ? "9+" : String(f.new);
        b.append(dot);
      }
      b.addEventListener("click", (e) => { e.stopPropagation(); open(f, b); });
      return b;
    };
    // The group icon (mommy 2026-11-09): every friend in a list.
    const openGroup = (btn) => {
      if (openName === "*group") { close(); return; }
      close();
      openName = "*group";
      btn.setAttribute("aria-expanded", "true");
      card = document.createElement("div");
      card.className = "xn-friend-card xn-fgroup-card";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-label", "Friends");
      const h = document.createElement("div");
      h.className = "xn-fgroup-h";
      const on = friends.filter(isOn).length;
      h.innerHTML = "<strong>Friends</strong><small></small>";
      h.querySelector("small").textContent = on ? on + " online" : "Nobody online right now";
      const list = document.createElement("div");
      list.className = "xn-fgroup-list";
      [...friends].sort((x, y) => (isOn(y) - isOn(x)) || (y.lastSeen || 0) - (x.lastSeen || 0)).forEach((f) => {
        const r = document.createElement("button");
        r.type = "button";
        r.className = "xn-fgroup-row";
        const who = document.createElement("span");
        who.className = "xn-friend-who";
        const nm = document.createElement("strong");
        nm.textContent = f.name;
        if (f.color) nm.dataset.nameColor = f.color;
        const seen = document.createElement("small");
        seen.textContent = agoLong(f.lastSeen);
        if (isOn(f)) seen.className = "is-on";
        who.append(nm, seen);
        r.append(face(f, "xn-friend-face"), who);
        if (f.new) { const d = document.createElement("span"); d.className = "xn-fgroup-new"; d.textContent = f.new > 9 ? "9+" : String(f.new); r.append(d); }
        r.addEventListener("click", (e) => { e.stopPropagation(); close(); open(f, btn); });
        list.append(r);
      });
      const foot = document.createElement("div");
      foot.className = "xn-friend-foot";
      foot.innerHTML = '<button type="button">Manage friends</button>';
      foot.querySelector("button").addEventListener("click", () => { close(); if (window.xnSettings) window.xnSettings.open("friends"); });
      card.append(h, list, foot);
      document.body.append(card);
      paintNames(card);
      place(btn);
    };
    const place = (btn) => {
      const r = btn.getBoundingClientRect();
      const w = card.offsetWidth;
      if (document.documentElement.dataset.fbarPos === "bottom") card.style.top = Math.round(Math.max(8, r.top - card.offsetHeight - 10)) + "px";
      else card.style.top = Math.round(r.bottom + 8) + "px";
      card.style.left = Math.round(Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8))) + "px";
    };
    const draw = () => {
      strip.replaceChildren();
      strip.hidden = !friends.length;
      const mode = cfg().show || "";
      strip.dataset.mode = mode || "all";
      const online = friends.filter(isOn);
      const shown = mode === "icon" ? [] : mode === "online" ? online : friends;
      shown.forEach((f) => strip.append(friendButton(f)));
      if (mode && friends.length) {
        const g = document.createElement("button");
        g.type = "button";
        g.className = "xn-fgroup" + (friends.some((f) => f.new) ? " has-news" : "");
        g.setAttribute("aria-haspopup", "dialog");
        g.setAttribute("aria-expanded", "false");
        g.setAttribute("aria-label", "Friends, " + online.length + " online");
        g.title = "Friends";
        g.innerHTML = '<span class="xn-fgroup-ic">' + GROUP + "</span>";
        if (online.length) {
          const c = document.createElement("span");
          c.className = "xn-fgroup-count";
          c.textContent = String(online.length);
          g.append(c);
        }
        g.addEventListener("click", (e) => { e.stopPropagation(); openGroup(g); });
        strip.append(g);
      }
    };
    window.addEventListener("xn:fbar", () => { close(); draw(); });
    window.addEventListener("xn:friends", () => load());
    const load = () => fetch("/friends/bar", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        now = data.now || Date.now();
        friends = data.friends || [];
        if (!card) draw();
      })
      .catch(() => {});
    document.addEventListener("pointerdown", (e) => { if (card && !card.contains(e.target) && !strip.contains(e.target)) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && card) close(); });
    window.addEventListener("resize", close);
    load();
    setInterval(() => { if (!document.hidden) load(); }, 60000);
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
    // After the menu button, so the button stays right beside the logo.
    (nav.querySelector(".xn-toggle") || brand).after(button);
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
      // Settings > Forum: notifications off hides the letter.
      if (window.xnLook && window.xnLook.get().forumOff) { setCount(0); return; }
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
      const name = window.xnNameFx.is(who.color)
        ? '<b class="xn-named xn-rainbow" data-fx="' + esc(who.color) + '">' + esc(who.name) + "</b>"
        : who.color
        ? '<b class="xn-named" style="color:' + esc(window.xnSiteColor.preview(who.color)) + '">' + esc(who.name) + "</b>"
        : "<b>" + esc(who.name) + "</b>";
      const post = (n.postText || "").trim();
      // Comments on a trip report open it on the Notes page.
      const report = n.kind === "report";
      const href = report ? "/Notes?report=" + encodeURIComponent(n.post) : "/Forum?post=" + encodeURIComponent(n.post);
      return '<a class="xn-inbox-item' + (n.unread ? " is-new" : "") + '" href="' + href + '">' +
        face +
        '<span class="xn-inbox-text"><span class="xn-inbox-line">' + name + (report ? " commented on your trip report" : " commented") +
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
    const toggleIcon = toggle && (toggle.querySelector(".xn-toggle-icon") || (() => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.classList.add("menubut");
      svg.classList.add("xn-toggle-icon");
      svg.setAttribute("viewBox", "0 0 20 20");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M218,7888 L218,7886 C218,7885.448 217.552,7885 217,7885 L211,7885 C210.448,7885 210,7885.448 210,7886 L210,7892 C210,7892.552 210.448,7893 211,7893 L221,7893 C221.552,7893 222,7892.552 222,7892 L222,7882 C222,7881.448 221.552,7881 221,7881 L207,7881 C206.448,7881 206,7881.448 206,7882 L206,7896 C206,7896.552 206.448,7897 207,7897 L223,7897 C223.552,7897 224,7897.448 224,7898 C224,7898.552 223.552,7899 223,7899 L206,7899 C204.896,7899 204,7898.105 204,7897 L204,7881 C204,7879.895 204.896,7879 206,7879 L222,7879 C223.105,7879 224,7879.895 224,7881 L224,7893 C224,7894.105 223.105,7895 222,7895 L210,7895 C208.896,7895 208,7894.105 208,7893 L208,7885 C208,7883.895 208.896,7883 210,7883 L218,7883 C219.105,7883 220,7883.895 220,7885 L220,7889 C220,7890.105 219.105,7891 218,7891 L214,7891 C212.896,7891 212,7890.105 212,7889 C212,7887.895 212.896,7887 214,7887 C215.105,7887 216,7887.895 216,7889 L217,7889 C217.552,7889 218,7888.552 218,7888");
      path.setAttribute("transform", "translate(-204 -7879)");
      path.setAttribute("fill", "currentColor");
      svg.append(path);
      toggle.append(svg);
      return svg;
    })());
    if (toggleIcon) toggle.classList.add("has-icon");
    // Chat and Music sit after the Forum and Notes after the Journal on every
    // page (added here, not in each page's HTML), in the same order on every
    // page so the menu tiles keep their places.
    const linkBox = nav.querySelector(".xn-links");
    const addLink = (href, label, after) => {
      if (!linkBox || linkBox.querySelector(`a[href="${href}"]`)) return;
      const a = document.createElement("a");
      a.href = href;
      a.textContent = label;
      const prev = linkBox.querySelector(`a[href="${after}"]`);
      if (prev) prev.after(a);
      else linkBox.append(a);
    };
    if (signedIn) addLink("/Chat", "Chat", "/Forum");
    addLink("/Music", "Music", signedIn ? "/Chat" : "/Forum");
    if (signedIn) addLink("/Notes", "Notes", "/journal");
    if (signedIn) addLink("/Pills", "Pill Database", "/Notes");
    if (signedIn) addLink("/Stats", "Stats", "/Pills");
    // Tile order (mommy 2026-11-06), three to a row: Drug Database, Graph,
    // Pill Database / Chat, Profile, Forum / Notes, Music, Files. Links not
    // named here keep their place after these.
    if (linkBox) {
      const ORDER = ["/journal", "/", "/Pills", "/Chat", "/Profile", "/Forum", "/Notes", "/Music", "/Files/", "/Stats"];
      const named = ORDER.map((href) => linkBox.querySelector(`:scope > a[href="${href}"]`)).filter(Boolean);
      const rest = [...linkBox.querySelectorAll(":scope > a")].filter((a) => !named.includes(a));
      linkBox.prepend(...named, ...rest);
    }
    addIcons(linkBox);
    const links = nav.querySelectorAll(".xn-links a");
    initMenuFoot(linkBox);
    initMail(nav);
    initChat(nav);
    initFriendsBar(nav);
    initTitle(nav);
    initLogout(nav);
    initSettings(nav, linkBox);
    initSetup();
    initPillNotes();
    paintNames();
    placeScene(document.documentElement.dataset.scene || "");

    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    links.forEach((link) => {
      const target = (link.getAttribute("href") || "").replace(/\/+$/, "") || "/";
      const match = target === "/" ? path === "/" : path === target || path.startsWith(target + "/");
      if (match) link.setAttribute("aria-current", "page");
    });

    if (LOCAL_SERVER) initPrerender();
    else if (!IOS) initTabs(nav, links);
    if (!toggle) return;

    // The tiles open under the menu button, each one dropping in after the
    // one before (--i, counting only the links this account can see).
    function place() {
      nav.style.setProperty("--xn-menu-x", Math.max(8, toggle.offsetLeft - 8) + "px");
    }
    function setOpen(open) {
      if (open) {
        place();
        let i = 0;
        links.forEach((link) => {
          if (getComputedStyle(link).display !== "none") link.style.setProperty("--i", i++);
        });
      }
      nav.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    }
    const isOpen = () => nav.classList.contains("open");
    // The menu button spins on every press: a full turn one way to open and
    // back the other way to close, picking up from wherever a spin is when
    // pressed again quickly. (An SVG has no offsetWidth, so restarting a CSS
    // class only spun it the first time.) It spins even with "reduce motion"
    // on (Windows turns that on when Animation effects is off): mommy asked
    // for it, and it only moves when pressed.
    let spin = null;
    function spinIcon(opening) {
      if (!toggleIcon || !toggleIcon.animate) return;
      const now = new DOMMatrixReadOnly(getComputedStyle(toggleIcon).transform === "none" ? undefined : getComputedStyle(toggleIcon).transform);
      const from = Math.atan2(now.b, now.a) * 180 / Math.PI;
      if (spin) spin.cancel();
      spin = toggleIcon.animate(
        [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${opening ? 360 : -360}deg)` }],
        { duration: 650, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }
      );
      spin.onfinish = () => { spin = null; };
    }

    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      spinIcon(!isOpen());
      setOpen(!isOpen());
    });
    links.forEach((link) => link.addEventListener("click", () => setOpen(false)));
    // pointerdown, as iPads don't send clicks from plain parts of the page.
    document.addEventListener("pointerdown", (event) => {
      if (!nav.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !isOpen()) return;
      setOpen(false);
      toggle.focus();
    });
    // Focus moving on from the button and its tiles (Tab past the last
    // tile) closes the menu.
    nav.addEventListener("focusout", (event) => {
      const to = event.relatedTarget;
      if (isOpen() && to && to !== toggle && !(linkBox && linkBox.contains(to))) setOpen(false);
    });
    window.addEventListener("resize", () => { if (isOpen()) place(); });
    WIDE.addEventListener("change", () => setOpen(false));
  }

  // Phones: the main pages sit in a tab bar along the bottom of the screen,
  // like an iPhone app, and the top bar keeps only the logo (oled.css).
  // Files is a tab only for accounts that can open it. desc is the line
  // under the name on the menu button's tiles.
  const TABS = [
    { href: "/", label: "Graph", desc: "Dose curves over time", icon: '<path d="M3.5 3v15.5A2.5 2.5 0 0 0 6 21h14.5" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/><path d="M7 16c2.3 0 2.9-9.5 5.8-9.5 2.6 0 2.7 6.3 5 6.3 1 0 1.7-.8 2.4-2.1" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' },
    { href: "/journal", label: "Drugs", desc: "Every substance and its doses", icon: '<path d="M11 5.7C9.2 4.4 6.6 3.8 3.6 4A1.5 1.5 0 0 0 2.2 5.5v12.2c0 .9.8 1.6 1.7 1.5 2.7-.2 5 .4 7.1 1.7V5.7zM13 5.7v15.2c2.1-1.3 4.4-1.9 7.1-1.7.9.1 1.7-.6 1.7-1.5V5.5A1.5 1.5 0 0 0 20.4 4c-3-.2-5.6.4-7.4 1.7z"/>' },
    { href: "/Notes", label: "Notes", desc: "Trip reports and notepad", icon: '<path d="M6 2.5h8.6L19.5 7.4V19a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 19V5A2.5 2.5 0 0 1 6 2.5zm8 .9V7a1 1 0 0 0 1 1h3.6zM7.5 11.2a.9.9 0 0 0 0 1.8h8a.9.9 0 0 0 0-1.8zm0 3.8a.9.9 0 0 0 0 1.8h5.5a.9.9 0 0 0 0-1.8z" fill-rule="evenodd"/>' },
    { href: "/Forum", label: "Forum", desc: "Posts and comments", icon: '<path d="M4.5 3h10A2.5 2.5 0 0 1 17 5.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.2c-.5.4-1.3 0-1.3-.6V14A2.5 2.5 0 0 1 2 11.5v-6A2.5 2.5 0 0 1 4.5 3z"/><path d="M19 8.2a2.5 2.5 0 0 1 3 2.4v5.9a2.5 2.5 0 0 1-2 2.4v2c0 .6-.7 1-1.2.6L15.3 19H11a2.5 2.5 0 0 1-2.3-1.6l.9-.7h4.9A4.5 4.5 0 0 0 19 12.2z"/>' },
    { href: "/Chat", label: "Chat", desc: "Messages and groups", icon: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>' },
    { href: "/Music", label: "Music", desc: "Songs and playlists", icon: '<path d="M20 3.2v12.3a3.5 3.5 0 1 1-2-3.2V7.6l-8 2v8.9a3.5 3.5 0 1 1-2-3.2V6.4a1.5 1.5 0 0 1 1.1-1.5l9-2.3A1.5 1.5 0 0 1 20 3.2z"/>' },
    { href: "/Files/", label: "Files", files: true, desc: "Uploads and folders", icon: '<path d="M2 6.5A2.5 2.5 0 0 1 4.5 4h4.3c.7 0 1.3.3 1.8.8L12 6.3h7.5A2.5 2.5 0 0 1 22 8.8v9.7a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5z"/>' },
    { href: "/Profile", label: "Profile", desc: "Calendar, likes, settings", icon: '<circle cx="12" cy="7.5" r="4.5"/><path d="M3.5 20.2C4.3 15.9 7.8 13.5 12 13.5s7.7 2.4 8.5 6.7c.1.7-.4 1.3-1.1 1.3H4.6c-.7 0-1.2-.6-1.1-1.3z"/>' },
  ];

  // Every menu link becomes a tile: its phone tab's icon in a small box, the
  // name, and a line on what the page is for. Links that already hold a
  // picture are left as they are.
  const ADMIN = { icon: '<path d="M12 2.2 4.2 5.3v5.9c0 4.9 3.3 9.3 7.8 10.6 4.5-1.3 7.8-5.7 7.8-10.6V5.3z"/>', desc: "Accounts and site stats" };
  // The Pill Database (/Pills) is in the menu but not a phone tab.
  const PILLS = { icon: '<path d="M8.6 3.4a5.2 5.2 0 0 1 7.4 0l4.6 4.6a5.2 5.2 0 0 1-7.4 7.4l-4.6-4.6a5.2 5.2 0 0 1 0-7.4zm1.4 1.4a3.2 3.2 0 0 0 0 4.6l1.8 1.8 4.6-4.6-1.8-1.8a3.2 3.2 0 0 0-4.6 0z" fill-rule="evenodd"/><circle cx="7" cy="17" r="4.6"/>', desc: "Pictures of real pills" };
  // Stats (/Stats, mommy 2026-11-20): totals, days, classes and spending.
  const STATS = { icon: '<rect x="3" y="12" width="4.6" height="9" rx="1.3"/><rect x="9.7" y="3" width="4.6" height="18" rx="1.3"/><rect x="16.4" y="8" width="4.6" height="13" rx="1.3"/>', desc: "Your totals, days and spending" };
  const OTHER_ICON = '<circle cx="12" cy="12" r="5"/>';
  function addIcons(box) {
    if (!box) return;
    const pages = { "/admin": ADMIN, "/Pills": PILLS, "/Stats": STATS };
    TABS.forEach((tab) => { pages[tab.href] = tab; });
    box.querySelectorAll("a").forEach((a) => {
      if (a.querySelector("svg")) return;
      const page = pages[a.getAttribute("href")] || { icon: OTHER_ICON, desc: "" };
      const name = a.textContent.trim();
      a.innerHTML = '<span class="xn-link-ic"><svg class="xn-ico" viewBox="0 0 24 24" aria-hidden="true">' + page.icon + '</svg></span><span class="xn-link-text"><span class="xn-link-name"></span><span class="xn-link-desc"></span></span>';
      a.querySelector(".xn-link-name").textContent = name;
      a.dataset.name = name;
      // No line under the names (mommy 2026-11-06).
    });
  }

  // The page's name in the middle of the top bar (mommy 2026-11-06); the
  // headings at the top of the pages are gone. A page can set
  // <html data-page-title="..."> to name itself, otherwise the <title>
  // before " · " is used.
  const PAGE_TITLES = { "Substance timeline": "Graph", "Home": "Home", "Files": "Files", "Upload": "Upload" };
  function initTitle(nav) {
    if (nav.querySelector(".xn-title")) return;
    let name = document.documentElement.dataset.pageTitle || "";
    if (!name) {
      const raw = (document.title || "").split(" · ")[0].trim();
      name = PAGE_TITLES[raw] || raw;
    }
    if (!name || /geek.?u/i.test(name)) return;
    const el = document.createElement("span");
    el.className = "xn-title";
    el.textContent = name;
    nav.append(el);
  }

  // Settings (mommy 2026-11-06): a round settings button left of the logo
  // opens a window 85% of the page wide and tall. Your picture and name sit
  // in its top left corner; under them Profile, Privacy, Site theme,
  // Preferences and Experimental, then every page of the site, then Sign
  // out. Experimental is a page inside the window with switches for
  // features still being tried out, such as the notch header (html.xn-exp):
  // the page title in a black notch hanging from the top of the screen with
  // a round settings button beside it.
  const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 2.6h3.4l.5 2.6c.6.2 1.2.5 1.7.9l2.5-.9 1.7 2.9-2 1.8a7 7 0 0 1 0 2l2 1.8-1.7 2.9-2.5-.9c-.5.4-1.1.7-1.7.9l-.5 2.6h-3.4l-.5-2.6a7 7 0 0 1-1.7-.9l-2.5.9-1.7-2.9 2-1.8a7 7 0 0 1 0-2l-2-1.8 1.7-2.9 2.5.9c.5-.4 1.1-.7 1.7-.9z"/><circle cx="12" cy="12" r="3"/></svg>';
  const FLASK = '<path d="M9 2.5h6a1 1 0 0 1 0 2h-.6v4.6l5.3 9.2A2.3 2.3 0 0 1 17.7 21.7H6.3a2.3 2.3 0 0 1-2-3.4l5.3-9.2V4.5H9a1 1 0 0 1 0-2zm2.6 2v5.1l-1.6 2.8h4l-1.6-2.8V4.5z" fill-rule="evenodd"/>';
  const SET_ITEMS = [
    { pane: "profile", frame: "profile", label: "Profile", desc: "Pictures, badge, name color", icon: '<circle cx="12" cy="7.5" r="4.5"/><path d="M3.5 20.2C4.3 15.9 7.8 13.5 12 13.5s7.7 2.4 8.5 6.7c.1.7-.4 1.3-1.1 1.3H4.6c-.7 0-1.2-.6-1.1-1.3z"/>' },
    { pane: "privacy", label: "Privacy", desc: "What other people see of you", icon: '<path d="M12 2.4 4.4 5.4v5.8c0 4.8 3.2 9.1 7.6 10.4 4.4-1.3 7.6-5.6 7.6-10.4V5.4z"/><rect x="9" y="10.5" width="6" height="5" rx="1" fill="#000"/><path d="M10.2 10.5V9.3a1.8 1.8 0 0 1 3.6 0v1.2" fill="none" stroke="#000" stroke-width="1.3"/>' },
    { pane: "friends", label: "Friends", desc: "Friends and the friends bar", icon: '<circle cx="9" cy="8" r="3.6"/><path d="M2.5 20c.6-3.9 3.3-6 6.5-6s5.9 2.1 6.5 6z"/><circle cx="17" cy="9" r="2.8"/><path d="M16.3 14.1c3 .1 4.8 2 5.2 5.9h-4.3c-.2-2.4-.5-4.3-.9-5.9z"/>' },
    { pane: "theme", frame: "theme", label: "Site theme", desc: "Colors, background, see-through", icon: '<path d="M12 2.5a9.5 9.5 0 0 0 0 19c1.2 0 1.9-.9 1.9-1.9 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.3 0-1 .9-1.9 1.9-1.9h2.2a5 5 0 0 0 5-5C22 6.3 17.5 2.5 12 2.5z"/><circle cx="7" cy="11.5" r="1.5" fill="#000"/><circle cx="9.5" cy="7" r="1.5" fill="#000"/><circle cx="14.5" cy="7" r="1.5" fill="#000"/><circle cx="17.5" cy="11" r="1.5" fill="#000"/>' },
    { pane: "preferences", frame: "preferences", label: "Preferences", desc: "Font, menu style, graph", icon: '<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="15" cy="6.5" r="2.3"/><circle cx="9" cy="12" r="2.3"/><circle cx="17" cy="17.5" r="2.3"/>' },
    { pane: "data", frame: "data", label: "Data", desc: "Import from the Journal app", icon: '<ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 8.2c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V12c0 1.7-3.4 3-7.5 3s-7.5-1.3-7.5-3zM4.5 15c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v3.5c0 1.7-3.4 3-7.5 3s-7.5-1.3-7.5-3z"/>' },
    { pane: "sync", frame: "sync", label: "Phone sync", desc: "Folders copied to your phone", icon: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><rect x="10" y="17.6" width="4" height="1.4" rx=".7" fill="#000"/>' },
    { pane: "setup", label: "Quick setup", desc: "Picture, banner and preferences step by step", icon: '<path d="M12 2.5l2.4 5.6 6.1.5-4.6 4 1.4 5.9L12 15.4l-5.3 3.1 1.4-5.9-4.6-4 6.1-.5z"/>' },
    { pane: "exp", label: "Experimental", desc: "Try new features first", icon: FLASK },
  ];
  // Pages with their own settings page (mommy 2026-11-09). Their rows under
  // Pages open these instead of leaving; each page has an Open link on top.
  const PAGE_SETS = [
    { pane: "page-drugs", href: "/journal", label: "Drug Database", desc: "View mode" },
    { pane: "page-graph", href: "/", frame: "graph", label: "Graph", desc: "Drug graph colors, curve preview" },
    { pane: "page-pills", href: "/Pills", label: "Pill Database", desc: "Notifications" },
    { pane: "page-chat", href: "/Chat", label: "Chat", desc: "Notifications, per friend" },
    { pane: "page-forum", href: "/Forum", label: "Forum", desc: "Notifications, per group" },
  ];
  // Features on the Experimental page. get/set keep each one on this device.
  const EXPERIMENTS = [
    {
      label: "Notch header",
      desc: "The page title sits in a black notch hanging from the top of the screen, with a round settings button beside it.",
      get: () => EXP_HEADER,
      set: (on) => window.xnExpHeader.set(on),
    },
  ];
  // Settings > Friends (mommy 2026-11-09): manage friends (add, requests,
  // remove) and how the friends bar in the top bar looks (who shows, style,
  // color, position). The bar look is saved with the site look (siteLook.fbar).
  const FB_COLORS = ["", "#4ade80", "#60a5fa", "#2dd4bf", "#fbbf24", "#fb923c", "#f472b6", "#e879f9", "#f87171"];
  function friendsPane() {
    const view = document.createElement("div");
    view.className = "xn-set-native xn-fp";
    view.dataset.view = "friends";
    view.innerHTML =
      '<div class="xn-fp-col">' +
      '<section class="xn-fp-card"><h3 class="xn-fp-h">Add a friend</h3>' +
      '<label class="xn-fp-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input type="search" placeholder="Search by name" autocomplete="off" aria-label="Search people by name"></label>' +
      '<div class="xn-fp-results" aria-live="polite"></div></section>' +
      '<section class="xn-fp-card xn-fp-reqs" hidden><h3 class="xn-fp-h">Requests</h3><div class="xn-fp-list xn-fp-in"></div><div class="xn-fp-list xn-fp-out"></div></section>' +
      '<section class="xn-fp-card xn-fp-grow"><h3 class="xn-fp-h">Your friends <span class="xn-fp-n"></span></h3><div class="xn-fp-list xn-fp-friends"></div></section>' +
      "</div>" +
      '<div class="xn-fp-col">' +
      '<section class="xn-fp-card"><h3 class="xn-fp-h">Friends bar</h3><p class="xn-fp-note">How your friends show in the top bar. Preview:</p><div class="xn-fp-preview" aria-hidden="true"></div>' +
      '<h4 class="xn-fp-sub">Show</h4><div class="xn-fp-opts" data-key="show"></div>' +
      '<h4 class="xn-fp-sub">Style</h4><div class="xn-fp-tiles" data-key="style"></div>' +
      '<h4 class="xn-fp-sub">Color</h4><div class="xn-fp-colors" data-key="color"></div>' +
      '<h4 class="xn-fp-sub">Position</h4><div class="xn-fp-tiles xn-fp-pos" data-key="pos"></div>' +
      '<button type="button" class="xn-fp-reset">Back to default</button></section></div>';
    const $ = (sel) => view.querySelector(sel);
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const faceOf = (p) => {
      const f = el("span", "xn-fp-face");
      if (p.avatar) { const i = document.createElement("img"); i.src = p.avatar; i.alt = ""; i.loading = "lazy"; f.append(i); }
      else f.textContent = (p.initial || p.name || "?").charAt(0).toUpperCase();
      return f;
    };
    const act = async (action, user) => {
      const res = await fetch("/friends", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, user }) });
      if (!res.ok) throw new Error((await res.text()).trim() || "Couldn't do that.");
    };
    const btn = (label, cls, run) => {
      const b = el("button", "xn-fp-btn " + (cls || ""), label);
      b.type = "button";
      b.addEventListener("click", async () => {
        b.disabled = true;
        try { await run(b); } catch (err) { b.textContent = "Try again"; b.title = err.message; }
        b.disabled = false;
      });
      return b;
    };
    // Two taps for Remove.
    const removeBtn = (name) => {
      let armed = 0;
      const b = el("button", "xn-fp-btn is-danger", "Remove");
      b.type = "button";
      b.addEventListener("click", async () => {
        if (!armed) { b.textContent = "Sure?"; b.classList.add("is-armed"); armed = setTimeout(() => { armed = 0; b.textContent = "Remove"; b.classList.remove("is-armed"); }, 3000); return; }
        clearTimeout(armed); armed = 0;
        b.disabled = true;
        try { await act("remove", name); load(); } catch (_) { b.disabled = false; b.textContent = "Try again"; }
      });
      return b;
    };
    let seen = {}, lists = { friends: [], incoming: [], outgoing: [] };
    const status = (name) => {
      const t = seen[name];
      if (!t) return ["Not online for a while", false];
      const s = (Date.now() - t) / 1000;
      if (s < 300) return ["Online now", true];
      if (s < 3600) return ["Online " + Math.round(s / 60) + " min ago", false];
      if (s < 86400) return ["Online " + Math.round(s / 3600) + " h ago", false];
      return ["Online " + Math.round(s / 86400) + " d ago", false];
    };
    const person = (p, sub, on) => {
      const r = el("div", "xn-fp-row");
      const who = el("a", "xn-fp-who");
      who.href = "/u/" + encodeURIComponent(p.name);
      const face = faceOf(p);
      if (on) face.classList.add("is-on");
      const t = el("span", "xn-fp-txt");
      const nm = el("strong", "", p.name);
      if (p.color) nm.dataset.nameColor = p.color;
      const sm = el("small", on ? "is-on" : "", sub);
      t.append(nm, sm);
      who.append(face, t);
      const acts = el("span", "xn-fp-acts");
      r.append(who, acts);
      r.acts = acts;
      return r;
    };
    function drawLists() {
      const fl = $(".xn-fp-friends");
      $(".xn-fp-n").textContent = lists.friends.length ? String(lists.friends.length) : "";
      if (!lists.friends.length) fl.replaceChildren(el("p", "xn-fp-empty", "No friends yet. Search for someone above to add them."));
      else fl.replaceChildren(...[...lists.friends].sort((a, b) => (seen[b.name] || 0) - (seen[a.name] || 0)).map((p) => {
        const [sub, on] = status(p.name);
        const r = person(p, sub, on);
        const msg = el("a", "xn-fp-btn", "Message");
        msg.href = "/Chat?to=" + encodeURIComponent(p.name);
        r.acts.append(msg, removeBtn(p.name));
        return r;
      }));
      const inl = $(".xn-fp-in"), outl = $(".xn-fp-out");
      inl.replaceChildren(...lists.incoming.map((p) => {
        const r = person(p, "Wants to be your friend", false);
        r.acts.append(btn("Accept", "is-main", async () => { await act("accept", p.name); load(); }), btn("Decline", "", async () => { await act("decline", p.name); load(); }));
        return r;
      }));
      outl.replaceChildren(...lists.outgoing.map((p) => {
        const r = person(p, "Request sent", false);
        r.acts.append(btn("Cancel", "", async () => { await act("cancel", p.name); load(); }));
        return r;
      }));
      $(".xn-fp-reqs").hidden = !lists.incoming.length && !lists.outgoing.length;
      paintNames(view);
      drawPreview();
    }
    async function load() {
      try {
        const [a, b] = await Promise.all([
          fetch("/friends", { headers: { Accept: "application/json" } }).then((r) => (r.ok ? r.json() : null)),
          fetch("/friends/bar", { headers: { Accept: "application/json" } }).then((r) => (r.ok ? r.json() : null)),
        ]);
        if (a) lists = { friends: a.friends || [], incoming: a.incoming || [], outgoing: a.outgoing || [] };
        seen = {};
        if (b && b.friends) b.friends.forEach((f) => { seen[f.name] = f.lastSeen; });
        drawLists();
        window.dispatchEvent(new CustomEvent("xn:friends"));
      } catch (_) {}
    }
    // Search to add
    let qTimer = 0;
    const input = $(".xn-fp-search input");
    const results = $(".xn-fp-results");
    input.addEventListener("input", () => {
      clearTimeout(qTimer);
      const q = input.value.trim();
      if (!q) { results.replaceChildren(); return; }
      qTimer = setTimeout(async () => {
        try {
          const res = await fetch("/chat/people?q=" + encodeURIComponent(q), { headers: { Accept: "application/json" } });
          const people = res.ok ? await res.json() : [];
          const mine = new Set([...lists.friends, ...lists.outgoing].map((p) => p.name.toLowerCase()));
          const incoming = new Set(lists.incoming.map((p) => p.name.toLowerCase()));
          const list = (people || []).slice(0, 6);
          if (!list.length) { results.replaceChildren(el("p", "xn-fp-empty", "Nobody found with that name.")); return; }
          results.replaceChildren(...list.map((p) => {
            const key = (p.name || "").toLowerCase();
            const r = person(p, mine.has(key) ? (lists.friends.some((f) => f.name.toLowerCase() === key) ? "Already friends" : "Request sent") : incoming.has(key) ? "Wants to be your friend" : "", false);
            if (!mine.has(key)) r.acts.append(btn(incoming.has(key) ? "Accept" : "Add friend", "is-main", async (b) => { await act(incoming.has(key) ? "accept" : "request", p.name); b.textContent = "Sent"; load(); }));
            return r;
          }));
          paintNames(results);
        } catch (_) {}
      }, 220);
    });
    // Bar look
    const OPTS = {
      show: [["", "Everyone", "All your friends, online or not"], ["online", "Only who's online", "A group icon when nobody is online"], ["icon", "Group icon only", "Hide the bar; the icon opens the list"]],
      style: [["", "Squares"], ["round", "Circles"], ["pill", "Pill"], ["glass", "Glass"]],
      pos: [["", "Next to the menu"], ["center", "Middle"], ["right", "Right side"], ["bottom", "Bottom dock"]],
    };
    const get = () => window.xnLook.get().fbar;
    const set = (patch) => {
      const look = window.xnLook.get();
      look.fbar = Object.assign({}, look.fbar, patch);
      window.xnLook.use(look);
      fetch("/profile/appearance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteLook: window.xnLook.get() }) }).catch(() => {});
      drawOpts();
    };
    const SHAPE = { "": '<i class="s1"></i><i class="s1"></i><i class="s1"></i>', round: '<i class="s2"></i><i class="s2"></i><i class="s2"></i>', pill: '<b><i class="s2"></i><i class="s2"></i><i class="s2"></i></b>', glass: '<b class="g"><i class="s1"></i><i class="s1"></i><i class="s1"></i></b>' };
    const POS = { "": '<em class="p-l"></em>', center: '<em class="p-c"></em>', right: '<em class="p-r"></em>', bottom: '<em class="p-b"></em>' };
    function drawOpts() {
      const cur = get();
      const showBox = $('[data-key="show"]');
      showBox.replaceChildren(...OPTS.show.map(([v, t, d]) => {
        const b = el("button", "xn-fp-opt");
        b.type = "button";
        b.setAttribute("aria-pressed", String(cur.show === v));
        b.append(el("b", "", t), el("small", "", d));
        b.addEventListener("click", () => set({ show: v }));
        return b;
      }));
      ["style", "pos"].forEach((key) => {
        const box = $('[data-key="' + key + '"]');
        box.replaceChildren(...OPTS[key].map(([v, t]) => {
          const b = el("button", "xn-fp-tile");
          b.type = "button";
          b.setAttribute("aria-pressed", String(cur[key] === v));
          const art = el("span", "xn-fp-art");
          art.innerHTML = key === "style" ? SHAPE[v] : POS[v];
          b.append(art, el("span", "", t));
          b.addEventListener("click", () => set({ [key]: v }));
          return b;
        }));
      });
      const cbox = $('[data-key="color"]');
      cbox.replaceChildren(...FB_COLORS.map((c) => {
        const b = el("button", "xn-fp-sw" + (c ? "" : " is-site"));
        b.type = "button";
        b.style.setProperty("--sw", c || "var(--oled-accent)");
        b.setAttribute("aria-label", c ? "Color " + c : "Site color");
        b.title = c ? c : "Site color";
        b.setAttribute("aria-pressed", String(cur.color === c));
        b.addEventListener("click", () => set({ color: c }));
        return b;
      }));
      const custom = el("label", "xn-fp-sw is-custom");
      custom.title = "Pick any color";
      const ci = document.createElement("input");
      ci.type = "color";
      ci.value = cur.color && !FB_COLORS.includes(cur.color) ? cur.color : "#a67cff";
      ci.setAttribute("aria-label", "Pick any color");
      if (cur.color && !FB_COLORS.includes(cur.color)) { custom.setAttribute("aria-pressed", "true"); custom.style.setProperty("--sw", cur.color); }
      ci.addEventListener("change", () => set({ color: ci.value }));
      custom.append(ci);
      cbox.append(custom);
      drawPreview();
    }
    function drawPreview() {
      const cur = get();
      const pv = $(".xn-fp-preview");
      pv.dataset.style = cur.style || "squares";
      pv.dataset.show = cur.show || "all";
      const people = lists.friends.length ? lists.friends.slice(0, 5) : [{ name: "Ada" }, { name: "Bo" }, { name: "Cy" }];
      const onl = (p) => lists.friends.length ? status(p.name)[1] : p.name === "Ada";
      const shown = cur.show === "icon" ? [] : cur.show === "online" ? people.filter(onl) : people;
      const strip = el("div", "xn-fp-pstrip");
      shown.forEach((p) => {
        const it = el("span", "xn-fp-pitem");
        it.append(faceOf(p), el("small", onl(p) ? "is-on" : "", onl(p) ? "online" : "2h"));
        strip.append(it);
      });
      if (cur.show) {
        const g = el("span", "xn-fp-pgroup");
        g.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.4"/><path d="M2.8 19.5c.6-3.6 3.1-5.6 6.2-5.6s5.6 2 6.2 5.6"/><circle cx="16.8" cy="9" r="2.7"/><path d="M15.6 13.9c.4-.1.8-.1 1.2-.1 2.5 0 4.4 1.6 4.9 4.6"/></svg>';
        strip.append(g);
      }
      pv.replaceChildren(strip);
    }
    $(".xn-fp-reset").addEventListener("click", () => set({ show: "", style: "", color: "", pos: "" }));
    window.addEventListener("xn:fbar", () => { if (view.isConnected) drawOpts(); });
    drawOpts();
    view.load = load;
    return view;
  }

  function initSettings(nav, linkBox) {
    if (nav.querySelector(".xn-set-btn")) return;
    const makeGear = (cls) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "xn-set-btn" + (cls ? " " + cls : "");
      b.setAttribute("aria-label", "Settings");
      b.setAttribute("aria-haspopup", "dialog");
      b.setAttribute("aria-expanded", "false");
      b.title = "Settings";
      b.innerHTML = GEAR;
      return b;
    };
    // The button left of the logo, in every menu style.
    const btn = makeGear("");
    const brand = nav.querySelector(".xn-brand");
    if (brand) brand.before(btn); else nav.prepend(btn);
    // The notch (only shown with the notch header on): the page title in
    // the black part, the settings button beside it.
    const notch = document.createElement("div");
    notch.className = "xn-notch";
    notch.innerHTML = '<span class="xn-notch-body"><span class="xn-notch-title"></span></span>';
    const notchGear = makeGear("xn-notch-gear");
    notch.append(notchGear);
    const titleEl = nav.querySelector(".xn-title");
    notch.querySelector(".xn-notch-title").textContent = titleEl ? titleEl.textContent : "";
    if (!titleEl) notch.classList.add("is-empty");
    nav.append(notch);
    const gears = [btn, notchGear];
    let opener = btn;

    // The window (mommy's design, 2026-11-06): a side column with your
    // picture, name and Sign out on top, then the User settings and every
    // page; the picked setting's page fills the rest. Profile settings come
    // from the Profile page itself (/Profile?pane=..., in a frame), so they
    // keep working exactly as they did in its popups.
    let win = null, card = null, lastFocus = null, current = "";
    const frames = {};
    const PANE_KEY = "xn_set_pane";
    const row = (tag, label, desc, body, extra) => {
      const el = document.createElement(tag);
      el.className = "xn-set-row" + (extra ? " " + extra : "");
      if (tag === "button") el.type = "button";
      el.innerHTML = '<span class="xn-set-ic"><svg viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg></span><span class="xn-set-txt"><span class="xn-set-name"></span><span class="xn-set-desc"></span></span>';
      el.querySelector(".xn-set-name").textContent = label;
      el.querySelector(".xn-set-desc").textContent = desc || "";
      return el;
    };
    const wide = () => matchMedia("(min-width: 768px)").matches;
    function showPane(name, focus) {
      if (!win) return;
      const item = SET_ITEMS.concat(PAGE_SETS).find((it) => it.pane === name) || SET_ITEMS[0];
      name = item.pane;
      current = name;
      try { sessionStorage.setItem(PANE_KEY, name); } catch (_) {}
      win.querySelectorAll(".xn-set-row[data-pane]").forEach((r) => {
        if (r.dataset.pane === name) r.setAttribute("aria-current", "true"); else r.removeAttribute("aria-current");
      });
      win.querySelector(".xn-set-mtitle").textContent = item.label;
      const box = win.querySelector(".xn-set-pane");
      box.querySelectorAll(":scope > *").forEach((el) => { el.hidden = true; });
      let view = box.querySelector('[data-view="' + name + '"]');
      if (!view && item.frame) {
        view = document.createElement("div");
        view.className = "xn-set-framebox is-loading";
        view.dataset.view = name;
        const f = document.createElement("iframe");
        f.className = "xn-set-frame";
        f.title = item.label;
        f.src = "/Profile?pane=" + encodeURIComponent(item.frame);
        f.addEventListener("load", () => view.classList.remove("is-loading"));
        if (item.href) { view.classList.add("has-pagebar"); view.append(pageBar(item)); }
        view.append(f);
        frames[name] = f;
        box.append(view);
      }
      if (view) view.hidden = false;
      if (view && view.load) view.load();
      card.classList.add("is-pane");
      if (focus) win.querySelector(wide() ? '.xn-set-row[aria-current="true"]' : ".xn-set-back")?.focus({ preventScroll: true });
    }
    // The bar on top of a page's settings: what it is for and a way to open the page.
    function pageBar(item) {
      const bar = document.createElement("div");
      bar.className = "xn-set-pagebar";
      bar.innerHTML = '<span class="xn-set-note">Settings for the <b></b> page.</span><a class="xn-set-pill" target="_top">Open <span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></a>';
      bar.querySelector("b").textContent = item.label;
      bar.querySelector("a span").textContent = item.label;
      bar.querySelector("a").href = item.href;
      return bar;
    }
    // Settings > Drug Database: how the list of substances looks (siteLook.drugView).
    function drugsPane() {
      const view = document.createElement("div");
      view.className = "xn-set-native xn-dp";
      view.dataset.view = "page-drugs";
      const item = PAGE_SETS[0];
      view.append(pageBar(item));
      const MODES = [
        { v: "", name: "Large icons", desc: "Square cards with a big picture of each substance.", pic: '<i class="xn-dp-sq"></i><i class="xn-dp-sq"></i><i class="xn-dp-sq"></i><i class="xn-dp-sq"></i><i class="xn-dp-sq"></i><i class="xn-dp-sq"></i>' },
        { v: "compact", name: "Compact", desc: "Small rows: a little picture, the name and its class.", pic: '<i class="xn-dp-row"></i><i class="xn-dp-row"></i><i class="xn-dp-row"></i><i class="xn-dp-row"></i>' },
        { v: "text", name: "Pure text", desc: "Names only, no pictures. Loads the fastest.", pic: '<i class="xn-dp-txt"></i><i class="xn-dp-txt"></i><i class="xn-dp-txt"></i><i class="xn-dp-txt"></i><i class="xn-dp-txt"></i>' },
      ];
      const block = document.createElement("div");
      block.className = "xn-set-block";
      block.innerHTML = '<h3 class="xn-set-bh" id="xnDpLabel">View mode</h3><p class="xn-set-note">How the substances are shown in the Drug Database list.</p><div class="xn-dp-modes" role="radiogroup" aria-labelledby="xnDpLabel"></div>';
      const modes = block.querySelector(".xn-dp-modes");
      const btns = MODES.map((m) => {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.className = "xn-dp-mode";
        b.dataset.mode = m.v;
        b.innerHTML = '<span class="xn-dp-pic" data-mode="' + (m.v || "large") + '" aria-hidden="true">' + m.pic + '</span><span class="xn-dp-name"></span><span class="xn-dp-desc"></span>';
        b.querySelector(".xn-dp-name").textContent = m.name;
        b.querySelector(".xn-dp-desc").textContent = m.desc;
        b.addEventListener("click", () => {
          const look = window.xnLook.get();
          look.drugView = m.v;
          window.xnLook.use(look);
          show();
          if (signedIn) fetch("/profile/appearance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteLook: window.xnLook.get() }) }).catch(() => {});
        });
        modes.append(b);
        return b;
      });
      const show = () => {
        const cur = (window.xnLook.get().drugView) || "";
        btns.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === cur)));
      };
      view.load = show;
      view.append(block);
      return view;
    }
    // Settings > Pill Database: which pill news shows up as a note (siteLook.pillNotes).
    function pillsPane() {
      const view = document.createElement("div");
      view.className = "xn-set-native xn-pn";
      view.dataset.view = "page-pills";
      view.append(pageBar(PAGE_SETS.find((p) => p.pane === "page-pills")));
      const KINDS = [
        { k: "new", name: "New pills", desc: "When someone adds a pill to the Pill Database." },
        { k: "mine", name: "Your pills", desc: "When an admin verifies or hides a pill you added." },
        { k: "review", name: "Waiting to be verified", desc: "Admins: when new pills are added that nobody has verified yet.", admin: true },
      ];
      const block = document.createElement("div");
      block.className = "xn-set-block";
      block.innerHTML = '<h3 class="xn-set-bh">Notifications</h3><p class="xn-set-note">A small note shows in the corner of any page when there is news. It is checked every few minutes while you use the site.</p><div class="xn-set-exps"></div>' +
        '<div class="xn-pn-try"><button type="button" class="xn-set-pill">Show an example</button></div>';
      const list = block.querySelector(".xn-set-exps");
      const inputs = [];
      KINDS.forEach((kind) => {
        if (kind.admin && !document.documentElement.classList.contains("xn-admin")) return;
        const r = document.createElement("label");
        r.className = "xn-set-exp";
        r.innerHTML = '<span class="xn-set-exp-txt"><span class="xn-set-exp-name"></span><span class="xn-set-exp-desc"></span></span><span class="xn-switch"><input type="checkbox" role="switch"><span aria-hidden="true"></span></span>';
        r.querySelector(".xn-set-exp-name").textContent = kind.name;
        r.querySelector(".xn-set-exp-desc").textContent = kind.desc;
        const input = r.querySelector("input");
        input.dataset.kind = kind.k;
        input.addEventListener("change", () => {
          const on = inputs.filter((i) => i.checked).map((i) => i.dataset.kind);
          const look = window.xnLook.get();
          look.pillNotes = on.join(",");
          window.xnLook.use(look);
          fetch("/profile/appearance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteLook: window.xnLook.get() }) }).catch(() => {});
          if (window.xnPillNotes) window.xnPillNotes.check(true);
        });
        inputs.push(input);
        list.append(r);
      });
      block.querySelector(".xn-pn-try button").addEventListener("click", () => {
        if (window.xnPillNotes) window.xnPillNotes.show({ title: "2 new pills", text: "Oxycodone 20 mg and Ksalol 1 mg were added to the Pill Database.", pic: "" });
      });
      view.load = () => {
        const on = String(window.xnLook.get().pillNotes || "").split(",");
        inputs.forEach((i) => { i.checked = on.includes(i.dataset.kind); });
      };
      view.append(block);
      return view;
    }
    // One switch row like the Experimental page's. on() reads, set(v) saves.
    function switchRow(name, desc, face) {
      const r = document.createElement("label");
      r.className = "xn-set-exp" + (face !== undefined ? " has-face" : "");
      r.innerHTML = (face !== undefined ? '<span class="xn-nt-face" aria-hidden="true"></span>' : "") + '<span class="xn-set-exp-txt"><span class="xn-set-exp-name"></span><span class="xn-set-exp-desc"></span></span><span class="xn-switch"><input type="checkbox" role="switch"><span aria-hidden="true"></span></span>';
      r.querySelector(".xn-set-exp-name").textContent = name;
      r.querySelector(".xn-set-exp-desc").textContent = desc || "";
      if (face) { const img = document.createElement("img"); img.src = face; img.alt = ""; img.loading = "lazy"; r.querySelector(".xn-nt-face").append(img); }
      else if (face !== undefined) r.querySelector(".xn-nt-face").textContent = name.charAt(0).toUpperCase();
      return r;
    }
    function saveLook(patch) {
      const look = Object.assign(window.xnLook.get(), patch);
      window.xnLook.use(look);
      fetch("/profile/appearance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteLook: window.xnLook.get() }) }).catch(() => {});
    }
    // Settings > Chat and Settings > Forum (mommy 2026-11-09): a main switch
    // and one switch per friend (Chat) or per Friendz group (Forum).
    function notePane(pane, title, note, offKey, listTitle, listNote, emptyText, listOf, muteKey) {
      const view = document.createElement("div");
      view.className = "xn-set-native xn-nt";
      view.dataset.view = pane;
      view.append(pageBar(PAGE_SETS.find((p) => p.pane === pane)));
      const main = document.createElement("div");
      main.className = "xn-set-block";
      main.innerHTML = '<h3 class="xn-set-bh">Notifications</h3><p class="xn-set-note"></p><div class="xn-set-exps"></div>';
      main.querySelector(".xn-set-note").textContent = note;
      const master = switchRow(title, "");
      const masterIn = master.querySelector("input");
      masterIn.addEventListener("change", () => { saveLook({ [offKey]: !masterIn.checked }); paint(); });
      main.querySelector(".xn-set-exps").append(master);
      const per = document.createElement("div");
      per.className = "xn-set-block xn-nt-per";
      per.innerHTML = '<h3 class="xn-set-bh"></h3><p class="xn-set-note"></p><div class="xn-set-exps xn-nt-list"></div>';
      per.querySelector(".xn-set-bh").textContent = listTitle;
      per.querySelector(".xn-set-note").textContent = listNote;
      const list = per.querySelector(".xn-nt-list");
      view.append(main, per);
      let items = [];
      function paint() {
        const look = window.xnLook.get();
        masterIn.checked = !look[offKey];
        per.classList.toggle("is-off", !!look[offKey]);
        const mute = look[muteKey] || [];
        list.querySelectorAll("input[data-id]").forEach((i) => {
          const id = muteKey === "groupMute" ? Number(i.dataset.id) : i.dataset.id;
          i.checked = !mute.some((m) => (typeof m === "string" ? m.toLowerCase() === String(id).toLowerCase() : m === id));
          i.disabled = !!look[offKey];
        });
      }
      view.load = async () => {
        paint();
        try {
          const res = await fetch("/forum/groups", { headers: { Accept: "application/json" } });
          if (!res.ok) throw new Error();
          items = listOf(await res.json());
        } catch (_) { items = []; }
        list.replaceChildren();
        if (!items.length) { const p = document.createElement("p"); p.className = "xn-set-note xn-nt-empty"; p.textContent = emptyText; list.append(p); }
        items.forEach((it) => {
          const row = switchRow(it.name, it.desc, it.face);
          const input = row.querySelector("input");
          input.dataset.id = String(it.id);
          input.addEventListener("change", () => {
            const look = window.xnLook.get();
            let mute = (look[muteKey] || []).filter((m) => (typeof m === "string" ? m.toLowerCase() !== String(it.id).toLowerCase() : m !== it.id));
            if (!input.checked) mute = mute.concat(it.id);
            saveLook({ [muteKey]: mute });
          });
          list.append(row);
        });
        paint();
      };
      return view;
    }
    const chatPane = () => notePane("page-chat", "Chat notifications", "The number on the chat button and a note in the corner when a new message comes in.", "chatOff",
      "Per friend", "Turn one off and messages from that friend come in quietly.", "You have no friends added yet.",
      (d) => (d.friends || []).map((f) => ({ id: f.name, name: f.name, desc: "", face: f.avatar || "" })), "chatMute");
    const forumPane = () => notePane("page-forum", "Forum notifications", "The letter for comments on your posts, and a note when someone posts on one of your Friendz walls.", "forumOff",
      "Per group", "Which Friendz groups tell you about new posts.", "You are not in any Friendz group yet.",
      (d) => (d.groups || []).map((g) => ({ id: g.id, name: g.name, desc: (g.posts || 0) + ((g.posts || 0) === 1 ? " post" : " posts"), face: undefined })), "groupMute");
    function showList() {
      if (!card) return;
      card.classList.remove("is-pane");
      win.querySelector('.xn-set-row[aria-current="true"]')?.focus({ preventScroll: true });
    }
    function build() {
      win = document.createElement("div");
      win.className = "xn-set";
      win.hidden = true;
      win.innerHTML =
        '<div class="xn-set-card" role="dialog" aria-modal="true" aria-label="Settings">' +
        '<aside class="xn-set-side">' +
        '<div class="xn-set-head"><a class="xn-set-me" href="/Profile"><span class="xn-set-face" aria-hidden="true"></span><span class="xn-set-who"><span class="xn-set-uname">Your account</span><span class="xn-set-rank"></span></span></a><span class="xn-set-headout"></span></div>' +
        '<nav class="xn-set-list" aria-label="Settings and pages"><div class="xn-set-group xn-set-admin"></div><h2 class="xn-set-h">User</h2><div class="xn-set-group xn-set-mine"></div>' +
        '<h2 class="xn-set-h">Pages</h2><div class="xn-set-group xn-set-pages"></div></nav></aside>' +
        '<section class="xn-set-main"><div class="xn-set-mhead"><button type="button" class="xn-set-back" aria-label="Back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>' +
        '<h2 class="xn-set-h xn-set-mtitle">Settings</h2>' +
        '<button type="button" class="xn-set-x" aria-label="Close settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>' +
        '<div class="xn-set-pane"></div></section></div>';
      card = win.querySelector(".xn-set-card");
      const rc = document.documentElement.classList;
      let me = null;
      try { me = JSON.parse(localStorage.getItem("xn_me") || "null"); } catch (_) {}
      // User settings.
      const mine = win.querySelector(".xn-set-mine");
      SET_ITEMS.forEach((it) => {
        // Profile has no row (mommy 2026-11-09): the Profile page's gear opens it.
        if (it.pane === "profile") return;
        const r = row("button", it.label, it.desc, it.icon, it.pane === "exp" ? "is-exp" : "");
        r.dataset.pane = it.pane;
        mine.append(r);
      });
      // Pages, in the menu's order. (On phones the links are hidden behind
      // the tab bar, so who sees what is checked here.) Admin sits on top.
      const pages = win.querySelector(".xn-set-pages");
      const here = location.pathname.replace(/\/+$/, "") || "/";
      if (linkBox) {
        [...linkBox.querySelectorAll(":scope > a")].forEach((a) => {
          const href = a.getAttribute("href") || "";
          if (href === "/Profile") return;
          const isAdmin = a.classList.contains("xn-admin");
          if (isAdmin && !rc.contains("xn-admin")) return;
          if (/^\/Files/.test(href) && !rc.contains("xn-admin") && !rc.contains("xn-files")) return;
          const ic = a.querySelector(".xn-link-ic svg");
          const own = PAGE_SETS.find((p) => p.href === href);
          const r = row(own ? "button" : "a", a.dataset.name || a.textContent.trim(), own ? own.desc : "", ic ? ic.innerHTML : OTHER_ICON, isAdmin ? "is-admin" : own ? "has-set" : "");
          if (own) r.dataset.pane = own.pane; else r.href = href;
          const target = href.replace(/\/+$/, "") || "/";
          if (target === "/" ? here === "/" : here === target || here.startsWith(target + "/")) r.setAttribute("aria-current", "page");
          (isAdmin ? win.querySelector(".xn-set-admin") : pages).append(r);
        });
      }
      // Sign out: the small red button in the top right of the side column.
      const out = win.querySelector(".xn-set-headout");
      out.innerHTML = signedIn
        ? '<form method="post" action="/logout"><button type="submit" class="xn-set-out" aria-label="Sign out" title="Sign out"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/></svg></button></form>'
        : '<a class="xn-set-out" href="/login" aria-label="Sign in" title="Sign in"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 16l4-4-4-4M18 12H8"/></svg></a>';
      // Pages made here: Privacy and Experimental.
      const box = win.querySelector(".xn-set-pane");
      const privacy = document.createElement("div");
      privacy.className = "xn-set-native";
      privacy.dataset.view = "privacy";
      privacy.innerHTML =
        '<div class="xn-set-block"><h3 class="xn-set-bh">Your public page</h3><p class="xn-set-note">Other people see your public page: your name, picture, banner, geek level and the boxes you show on your profile.</p>' +
        '<a class="xn-set-pill" data-me-link href="/Profile" target="_top">See what others see</a></div>' +
        '<div class="xn-set-block"><h3 class="xn-set-bh">More privacy settings</h3><p class="xn-set-note">Nothing to change here yet. Settings such as who can see your doses or when you were last online will go on this page.</p></div>';
      box.append(privacy);
      if (signedIn) box.append(friendsPane());
      box.append(drugsPane());
      if (signedIn) box.append(pillsPane(), chatPane(), forumPane());
      const exp = document.createElement("div");
      exp.className = "xn-set-native";
      exp.dataset.view = "exp";
      exp.innerHTML = '<p class="xn-set-note">Features still being tried out. They are saved on this device only and can change or go away.</p><div class="xn-set-exps"></div>';
      box.append(exp);
      const exps = exp.querySelector(".xn-set-exps");
      EXPERIMENTS.forEach((x, i) => {
        const r = document.createElement("label");
        r.className = "xn-set-exp";
        r.innerHTML = '<span class="xn-set-exp-txt"><span class="xn-set-exp-name"></span><span class="xn-set-exp-desc"></span></span><span class="xn-switch"><input type="checkbox" role="switch"><span aria-hidden="true"></span></span>';
        r.querySelector(".xn-set-exp-name").textContent = x.label;
        r.querySelector(".xn-set-exp-desc").textContent = x.desc;
        const input = r.querySelector("input");
        input.id = "xnExp" + i;
        input.checked = !!x.get();
        input.addEventListener("change", () => x.set(input.checked));
        exps.append(r);
      });
      const setMe = (m) => {
        fillMe(m);
        const link = win.querySelector("[data-me-link]");
        if (link && m && m.name) link.href = "/u/" + encodeURIComponent(m.name);
      };
      setMe(me);
      if (signedIn) {
        fetch("/me", { headers: { Accept: "application/json" } })
          .then((r) => (r.ok ? r.json() : null))
          .then((m) => { if (m && m.name) setMe(m); })
          .catch(() => {});
      }
      win.addEventListener("pointerdown", (e) => { if (e.target === win) setOpen(false); });
      win.querySelector(".xn-set-x").addEventListener("click", () => setOpen(false));
      win.querySelector(".xn-set-back").addEventListener("click", showList);
      win.addEventListener("click", (e) => {
        const p = e.target.closest(".xn-set-row[data-pane]");
        if (p && p.dataset.pane === "setup") { setOpen(false); if (window.xnSetup) setTimeout(() => window.xnSetup.open(0), 200); return; }
        if (p) { showPane(p.dataset.pane, true); return; }
        if (e.target.closest("a[href]")) setOpen(false);
      });
      win.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          if (!wide() && card.classList.contains("is-pane")) showList();
          else setOpen(false);
          return;
        }
        if (e.key !== "Tab") return;
        const shown = [...card.querySelectorAll("a[href], button, input, iframe")].filter((el) => el.getClientRects().length && !el.closest("[hidden]"));
        if (!shown.length) return;
        const first = shown[0], last = shown[shown.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
      document.body.append(win);
    }
    function fillMe(m) {
      if (!win || !m || !m.name) return;
      win.querySelector(".xn-set-uname").textContent = m.name;
      const face = win.querySelector(".xn-set-face");
      face.textContent = "";
      if (m.avatar) {
        const img = document.createElement("img");
        img.src = m.avatar; img.alt = "";
        img.addEventListener("error", () => { img.remove(); face.textContent = m.name.charAt(0).toUpperCase(); });
        face.append(img);
      } else face.textContent = m.name.charAt(0).toUpperCase();
      const rank = win.querySelector(".xn-set-rank");
      rank.textContent = m.rank ? m.rank + (typeof m.level === "number" ? " · level " + m.level : "") : "";
      const uname = win.querySelector(".xn-set-uname");
      if (m.nameColor) { uname.dataset.nameColor = m.nameColor; paintNames(win); }
    }
    function setOpen(open, pane) {
      if (open && !win) build();
      if (!win) return;
      if (open && pane) showPane(pane);
      if (open === !win.hidden) return;
      gears.forEach((g) => g.setAttribute("aria-expanded", String(open && g === opener)));
      document.documentElement.classList.toggle("xn-set-open", open);
      if (open) {
        lastFocus = document.activeElement;
        win.querySelectorAll('[data-view="exp"] .xn-set-exp input').forEach((input, i) => { input.checked = !!EXPERIMENTS[i].get(); });
        if (!pane) {
          let last = "";
          try { last = sessionStorage.getItem(PANE_KEY) || ""; } catch (_) {}
          if (wide()) showPane(last || current || "privacy");
          else { if (!current) showPane(last || "privacy"); card.classList.remove("is-pane"); }
        }
        win.hidden = false;
        win.querySelectorAll(".xn-set-row").forEach((t, i) => t.style.setProperty("--i", i));
        requestAnimationFrame(() => {
          win.classList.add("is-open");
          (win.querySelector('.xn-set-row[aria-current="true"]') || card.querySelector(".xn-set-x")).focus({ preventScroll: true });
        });
      } else {
        win.classList.remove("is-open");
        const done = () => { if (!win.classList.contains("is-open")) win.hidden = true; };
        const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
        setTimeout(done, reduce ? 0 : 220);
        if (lastFocus && lastFocus.focus && lastFocus.getClientRects().length) lastFocus.focus({ preventScroll: true });
        // Your picture or name may have changed in a settings page.
        if (signedIn) fetch("/me", { headers: { Accept: "application/json" } }).then((r) => (r.ok ? r.json() : null)).then((m) => { if (m && m.name) { fillMe(m); try { localStorage.setItem("xn_me", JSON.stringify(m)); } catch (_) {} } }).catch(() => {});
      }
    }
    gears.forEach((g) => g.addEventListener("click", (e) => {
      e.stopPropagation();
      opener = g;
      setOpen(!win || win.hidden);
    }));
    // Other code (the Profile page's gear) opens a settings page directly.
    window.xnSettings = {
      open(pane) { opener = btn; setOpen(true, pane || ""); },
      close() { setOpen(false); },
    };
  }

  // Desktop app: pages load ahead of the click.
  function initPrerender() {
    // Pages open at once: Chrome and Edge load a page while the pointer
    // rests on its link (speculation rules), so the click just shows it.
    if (HTMLScriptElement.supports && HTMLScriptElement.supports("speculationrules")) {
      const rules = document.createElement("script");
      rules.type = "speculationrules";
      rules.textContent = JSON.stringify({
        prerender: [{
          where: { and: [{ href_matches: "/*" }, { not: { href_matches: "/Files/*" } }, { not: { href_matches: "/music/*" } }, { not: { href_matches: "/logout" } }, { not: { href_matches: "/download*" } }, { not: { selector_matches: "[download], [data-no-prerender]" } }] },
          eagerness: "moderate",
        }],
      });
      document.head.append(rules);
    }
  }

  function initTabs(nav, links) {
    if (!links.length || document.querySelector(".xn-tabs")) return;
    const bar = document.createElement("nav");
    bar.className = "xn-tabs";
    bar.setAttribute("aria-label", "Main");
    const rootClass = document.documentElement.classList;
    const canFiles = rootClass.contains("xn-admin") || rootClass.contains("xn-files");
    const tabs = TABS.filter((tab) => (!tab.files || canFiles) && (tab.href !== "/Chat" || signedIn));
    bar.classList.toggle("has-6", tabs.length > 5);
    bar.classList.toggle("has-7", tabs.length > 6);
    bar.classList.toggle("has-8", tabs.length > 7);
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
    // Firefox already eases each wheel notch itself; doing it twice feels slow.
    if (document.documentElement.classList.contains("xn-ff")) return;
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

  // Level up (mommy 2026-11-20): when /me shows a higher geek level than
  // this browser saw last time, the new badge pops in with a burst of
  // little squares and a card says the new level (and the new rank when it
  // changed). The first visit only remembers the level.
  function checkLevelUp(me) {
    if (!me || !me.name || !(Number(me.level) >= 0)) return;
    const key = "xn_lv_" + String(me.name).toLowerCase();
    let prev = null;
    try { prev = JSON.parse(localStorage.getItem(key) || "null"); } catch (_) {}
    const now = { level: Number(me.level) || 0, tier: Number(me.tier) || 1 };
    try { localStorage.setItem(key, JSON.stringify(now)); } catch (_) {}
    if (!prev || !(now.level > prev.level)) return;
    showLevelUp(now.level, now.tier, me.rank || "", now.tier > (prev.tier || 0));
  }
  function showLevelUp(level, tier, rank, newRank) {
    const old = document.getElementById("xnLevelUp");
    if (old) old.remove();
    const box = document.createElement("div");
    box.id = "xnLevelUp";
    box.className = "xn-lvup";
    box.setAttribute("role", "status");
    box.innerHTML = '<div class="xn-lvup-card"><div class="xn-lvup-badge"></div><div class="xn-lvup-txt"><span class="xn-lvup-kick">Level up</span><strong></strong><span class="xn-lvup-rank"></span></div><button type="button" class="xn-lvup-x" aria-label="Close">×</button><span class="xn-lvup-fx" aria-hidden="true"></span></div>';
    const badge = window.xnRank && window.xnRank.hexb ? window.xnRank.hexb(tier, level) : null;
    if (badge) box.querySelector(".xn-lvup-badge").append(badge);
    box.querySelector("strong").textContent = "You reached level " + level;
    box.querySelector(".xn-lvup-rank").textContent = newRank && rank ? "New rank: " + rank : rank ? "Rank: " + rank : "";
    // Confetti: small rounded squares in the site color and a few others.
    const fx = box.querySelector(".xn-lvup-fx");
    const colors = ["var(--oled-accent)", "#fab219", "#3987e5", "#d55181", "#199e70", "#f5f3fa"];
    for (let i = 0; i < 18; i++) {
      const bit = document.createElement("i");
      const ang = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 60 + Math.random() * 70;
      bit.style.setProperty("--dx", Math.round(Math.cos(ang) * dist) + "px");
      bit.style.setProperty("--dy", Math.round(Math.sin(ang) * dist) + "px");
      bit.style.setProperty("--r", Math.round(Math.random() * 360) + "deg");
      bit.style.setProperty("--d", (Math.random() * 0.15).toFixed(2) + "s");
      bit.style.background = colors[i % colors.length];
      fx.append(bit);
    }
    document.body.append(box);
    const close = () => { box.classList.remove("is-on"); setTimeout(() => box.remove(), 400); };
    box.querySelector(".xn-lvup-x").addEventListener("click", close);
    requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add("is-on")));
    setTimeout(close, 6500);
  }
  window.xnLevelUp = showLevelUp;

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

  // Offline, the Graph and Profile still work (the app keeps them
  // on the phone), but these pages need the server. Say so instead of
  // opening a page that can't load.
  // The phone app keeps the Journal on the phone, so only the website needs internet for it.
  const IN_APP = /Geek4uApp/.test(navigator.userAgent);
  // The desktop app serves every page from this computer, so none need internet (LOCAL_SERVER).
  const ONLINE_ONLY = [
    ...(IN_APP ? [] : [[/^\/journal(\/|$)/i, "the Drug Database"]]),
    [/^\/(Files\/|Uploader)/i, "Files"],
    [/^\/(Forum|u\/)/i, "the Forum"],
    ...(IN_APP ? [] : [[/^\/Music/i, "Music"]]),
    [/^\/admin/i, "the Admin page"],
    [/^\/Notes/i, "Notes"],
  ];
  let offlineBox = null;
  function showNeedsInternet(what) {
    if (!offlineBox) {
      offlineBox = document.createElement("div");
      offlineBox.className = "xn-offline";
      offlineBox.setAttribute("role", "alertdialog");
      offlineBox.setAttribute("aria-modal", "true");
      offlineBox.setAttribute("aria-labelledby", "xnOfflineTitle");
      offlineBox.innerHTML = '<div class="xn-offline-card"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 8.8a15 15 0 0 1 20 0M5.2 12.3a10.5 10.5 0 0 1 13.6 0M8.5 15.8a6 6 0 0 1 7 0"/><circle cx="12" cy="19.2" r="1.3"/><path d="M3 3l18 18"/></svg><h2 id="xnOfflineTitle">You need internet</h2><p></p><button type="button" class="xn-btn xn-btn-primary">OK</button></div>';
      const close = () => offlineBox.classList.remove("is-on");
      offlineBox.querySelector("button").addEventListener("click", close);
      offlineBox.addEventListener("click", (event) => { if (event.target === offlineBox) close(); });
      document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
      document.body.appendChild(offlineBox);
    }
    offlineBox.querySelector("p").textContent = `Connect to Wi-Fi or mobile data to use ${what}. ${IN_APP ? "The Graph, Drug Database and your Profile" : "The Graph and your Profile"} work without internet.`;
    offlineBox.classList.add("is-on");
    offlineBox.querySelector("button").focus();
  }
  window.xnNeedsInternet = showNeedsInternet;
  window.addEventListener("click", (event) => {
    if (LOCAL_SERVER || navigator.onLine !== false || event.defaultPrevented || event.button) return;
    const link = event.target.closest && event.target.closest("a[href]");
    if (!link || link.target === "_blank") return;
    let url;
    try { url = new URL(link.href, location.href); } catch { return; }
    if (url.origin !== location.origin) return;
    const hit = ONLINE_ONLY.find(([re]) => re.test(url.pathname));
    if (!hit) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showNeedsInternet(hit[1]);
  }, true);

  // The desktop app quits a while after its last page stops checking in
  // (only needed when it opened in the default browser).
  if (LOCAL_SERVER) {
    const beat = () => fetch("/desktop/alive", { method: "POST", keepalive: true }).catch(() => {});
    beat();
    setInterval(beat, 30000);
  }

  initLeaveFade();
  initSmoothWheel();
  initReveal();

  // Cards further down a page float up as they scroll into view (oled.css
  // .xn-rv). Only ones below the screen when they appear; the rest keep the
  // page's own entrance.
  function initReveal() {
    if (!("IntersectionObserver" in window)) return;
    const SEL = ".xn-page > .xn-card, .xn-page > section, main .pf-grid > *, .fm-feed > article, .gp-news-item, .nt-report, .nt-pubwall > *, .exp-card, .fx-list > .item, .mu-songs > li";
    const shown = new WeakSet();
    let batch = 0;
    const io = new IntersectionObserver((entries) => {
      let n = 0;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target;
        io.unobserve(el);
        el.style.setProperty("--rv-d", Math.min(n++, 6) * 70 + "ms");
        el.classList.add("xn-rv-in");
        const done = () => { el.classList.remove("xn-rv", "xn-rv-in"); el.style.removeProperty("--rv-d"); };
        el.addEventListener("transitionend", (t) => { if (t.target === el && t.propertyName === "translate") done(); });
        setTimeout(done, 1400);
      }
    }, { rootMargin: "0px 0px -6% 0px" });
    function look(root) {
      if (!window.xnMotion || !window.xnMotion.on()) return;
      const list = [];
      if (root.matches && root.matches(SEL)) list.push(root);
      if (root.querySelectorAll) list.push(...root.querySelectorAll(SEL));
      const bottom = window.innerHeight;
      for (const el of list) {
        if (shown.has(el) || el.closest("dialog, .xn-links, [popover]")) continue;
        shown.add(el);
        const r = el.getBoundingClientRect();
        if (!r.height || r.top < bottom) continue; // on screen or not drawn
        el.classList.add("xn-rv");
        io.observe(el);
      }
    }
    const added = new Set();
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) added.add(n);
      if (batch) return;
      batch = requestAnimationFrame(() => {
        batch = 0;
        added.forEach(look);
        added.clear();
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
    const start = () => look(document);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
    // Turned off from Preferences: show everything still waiting.
    window.addEventListener("xn:motion", () => {
      if (window.xnMotion.on()) return;
      document.querySelectorAll(".xn-rv").forEach((el) => { io.unobserve(el); el.classList.remove("xn-rv", "xn-rv-in"); });
    });
    window.addEventListener("beforeprint", () => document.querySelectorAll(".xn-rv").forEach((el) => el.classList.add("xn-rv-in")));
  }

  // Quick setup (mommy's design 2026-11-09): a card with steps, like a
  // wizard. Step 1 sets the profile picture and banner; the others are the
  // Preferences, one question per step: pick a row and it is saved at once
  // and the next step slides in. Opens by itself once after signing up, and
  // from Settings > Quick setup. window.xnSetup.open().
  const SETUP_NEW = "xn_setup_new";
  const SU_ICONS = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5"/>',
    font: '<path d="M4 19 9.5 5h1L16 19M6.3 14h7.4M15.5 19h5M18 19V10.5"/>',
    size: '<path d="M3 19 7 8l4 11M4.3 15.5h5.4M13 19l3.5-9 3.5 9M14.2 16h4.6"/>',
    menu: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    motion: '<path d="M3 12c3-6 6-6 9 0s6 6 9 0"/>',
    pill: '<rect x="2.8" y="8.2" width="18.4" height="7.6" rx="3.8" transform="rotate(-35 12 12)"/><path d="m9.6 8.6 4.8 6.8"/>',
    done: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    skip: '<path d="M5 6l7 6-7 6M13 6l7 6-7 6"/>',
    camera: '<path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3v10H4z"/><circle cx="12" cy="13.2" r="3.3"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 5-4.5 3.5 3 3-2.5L20 17"/>',
    up: '<path d="M12 16V5M7 10l5-5 5 5M5 19h14"/>',
    menuTop: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M6.5 6.5h5"/>',
    menuSide: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M5 8h2M5 11h2M5 14h2"/>',
    menuBtn: '<rect x="3" y="4" width="18" height="16" rx="3"/><rect x="5.5" y="6.5" width="4" height="3" rx="1"/>',
    on: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
    device: '<rect x="6" y="2.8" width="12" height="18.4" rx="2.6"/><path d="M10.5 17.8h3"/>',
    off: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
    color: '<circle cx="8.5" cy="9" r="4.5"/><circle cx="15.5" cy="9" r="4.5"/><circle cx="12" cy="15" r="4.5"/>',
    purple: '<circle cx="12" cy="12" r="7.5"/>',
  };
  const suSvg = (k) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (SU_ICONS[k] || "") + "</svg>";
  const SU_FONTS = [["", "Default", "The font the site comes with"], ["jetbrains", "JetBrains Mono", ""], ["inter", "Inter", ""], ["grotesk", "Space Grotesk", ""], ["system", "System", "Your device's own font"], ["rounded", "Rounded", ""], ["consolas", "Consolas", ""], ["courier", "Courier", ""], ["verdana", "Verdana", ""], ["trebuchet", "Trebuchet", ""], ["comic", "Comic", ""], ["serif", "Serif", ""], ["garamond", "Garamond", ""]];
  const SU_STEPS = [
    { key: "profile", icon: "user", title: "Make it yours", sub: "Add a profile picture and a banner so people know it's you." },
    { key: "font", icon: "font", title: "Pick a font", sub: "Used for every page. You can change it later in Preferences.", scroll: true,
      options: SU_FONTS.map(([v, name, d]) => ({ value: v, title: name, sub: d || "The quick brown fox jumps over the lazy dog", sample: v })) },
    { key: "size", icon: "size", title: "Text size", sub: "How big should the text be?",
      options: [{ value: 90, title: "Smaller", sub: "More fits on the screen", glyph: "Aa", small: true }, { value: 100, title: "Normal", sub: "The size the site comes with", glyph: "Aa" }, { value: 115, title: "Bigger", sub: "Easier to read", glyph: "Aa", big: true }] },
    { key: "nav", icon: "menu", title: "Choose your menu", sub: "How do you want to get around the site on a wide screen?",
      options: [{ value: "", title: "Menu button", sub: "One button that opens every page as tiles", icon: "menuBtn" }, { value: "top", title: "Top bar", sub: "Every page in a bar along the top", icon: "menuTop" }, { value: "side", title: "Side bar", sub: "Every page in a bar on the left", icon: "menuSide" }] },
    { key: "motion", icon: "motion", title: "Animations", sub: "Should things move when you open and change pages?",
      options: [{ value: "", title: "On", sub: "All animations", icon: "on" }, { value: "device", title: "Follow my device", sub: "Calm when your device asks for less motion", icon: "device" }, { value: "off", title: "Off", sub: "Nothing moves", icon: "off" }] },
    { key: "ogIcons", icon: "pill", title: "Drug icons", sub: "Which colors should the pill and powder icons have?",
      options: [{ value: true, title: "Real colors", sub: "Each pill or powder in its own color", icon: "color" }, { value: false, title: "Site color", sub: "Every icon in your site color", icon: "purple" }] },
  ];
  // Pill Database notes (Settings > Pill Database, mommy 2026-11-09): every
  // few minutes the newest pills are compared with what this browser saw
  // last time, and news shows as a small note in the corner.
  function initPillNotes() {
    const EVERY = 3 * 60 * 1000;
    let card = null, hideT = 0;
    function show(n) {
      if (!card) {
        card = document.createElement("div");
        card.className = "xn-pnote";
        card.setAttribute("role", "status");
        card.innerHTML = '<a class="xn-pnote-link" href="/Pills"><span class="xn-pnote-pic" aria-hidden="true"></span><span class="xn-pnote-txt"><span class="xn-pnote-kick"></span><strong></strong><span class="xn-pnote-text"></span></span></a>' +
          '<button type="button" class="xn-pnote-x" aria-label="Dismiss"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
        card.querySelector(".xn-pnote-x").addEventListener("click", () => card.classList.remove("is-on"));
        document.body.append(card);
      }
      card.querySelector("strong").textContent = n.title;
      card.querySelector(".xn-pnote-kick").textContent = n.kick || "Pill Database";
      card.querySelector(".xn-pnote-link").href = n.href || "/Pills";
      card.querySelector(".xn-pnote-text").textContent = n.text || "";
      const pic = card.querySelector(".xn-pnote-pic");
      pic.replaceChildren();
      if (n.pic) { const img = document.createElement("img"); img.src = n.pic; img.alt = ""; pic.append(img); }
      else pic.innerHTML = n.icon === "chat" ? '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>'
        : n.icon === "forum" ? '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.6"/><path d="M2.5 20c.6-3.9 3.3-6 6.5-6s5.9 2.1 6.5 6z"/><circle cx="17" cy="9" r="2.8"/><path d="M16 14.2c3 .1 5 2 5.5 5.8H17"/></svg>'
        : '<svg viewBox="0 0 24 24"><rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-35 12 12)"/><path d="M12 6.3 9.6 9.7l4.7 3.3 2.4-3.4" opacity=".5"/></svg>';
      requestAnimationFrame(() => card.classList.add("is-on"));
      clearTimeout(hideT);
      hideT = setTimeout(() => card.classList.remove("is-on"), 12000);
    }
    const kinds = () => String((window.xnLook && window.xnLook.get().pillNotes) || "").split(",").filter(Boolean);
    const who = () => { try { return (JSON.parse(localStorage.getItem("xn_me") || "null") || {}).name || ""; } catch (_) { return ""; } };
    const keyOf = () => "xn_pillnotes_" + who().toLowerCase();
    const label = (p) => [p.brand, p.strength].filter(Boolean).join(" ") || "A pill";
    async function check(force) {
      const on = kinds();
      if (!signedIn || !on.length || !who()) return;
      let seen = null;
      try { seen = JSON.parse(localStorage.getItem(keyOf()) || "null"); } catch (_) {}
      if (!force && seen && Date.now() - (seen.at || 0) < EVERY) return;
      let data;
      try {
        const res = await fetch("/pilldb/api/list", { headers: { Accept: "application/json" } });
        if (!res.ok) return;
        data = await res.json();
      } catch (_) { return; }
      const items = Array.isArray(data.items) ? data.items : [];
      const others = items.filter((p) => !p.mine && p.status === "approved");
      const mineNow = {};
      // Pills are public at once (mommy 2026-11-20); what changes is verified or hidden.
      const stateOf = (p) => (p.status === "rejected" ? "rejected" : p.verified ? "verified" : "shown");
      items.filter((p) => p.mine).forEach((p) => { mineNow[p.id] = stateOf(p); });
      const next = { at: Date.now(), newest: Math.max(0, ...others.map((p) => p.createdAt || 0)), mine: mineNow, pending: data.pending || 0 };
      try { localStorage.setItem(keyOf(), JSON.stringify(next)); } catch (_) {}
      // On the Pill Database itself everything is in view: just remember it.
      if (!seen || /^\/Pills/.test(location.pathname)) return;
      const notes = [];
      if (on.includes("mine")) {
        items.filter((p) => p.mine && seen.mine && seen.mine[p.id] && seen.mine[p.id] !== stateOf(p) && stateOf(p) !== "shown").forEach((p) => {
          const st = stateOf(p);
          notes.push({ title: label(p) + (st === "verified" ? " was verified" : " was hidden"), text: st === "verified" ? "An admin checked it. It has a Verified badge now." : (p.modNote || "Open it to see why."), pic: p.picture });
        });
      }
      if (on.includes("new")) {
        const fresh = others.filter((p) => (p.createdAt || 0) > (seen.newest || 0));
        if (fresh.length) notes.push({ title: fresh.length === 1 ? "New pill: " + label(fresh[0]) : fresh.length + " new pills", text: fresh.length === 1 ? "Added to the Pill Database." : fresh.slice(0, 3).map(label).join(", ") + (fresh.length > 3 ? " and more" : ""), pic: fresh[0].picture });
      }
      if (on.includes("review") && data.admin && (data.pending || 0) > (seen.pending || 0)) {
        const n = data.pending - (seen.pending || 0);
        notes.push({ title: n === 1 ? "A new pill isn't verified yet" : n + " new pills aren't verified yet", text: data.pending + " not verified in total.", pic: "" });
      }
      if (notes.length) show(notes.length === 1 ? notes[0] : { title: notes[0].title, text: notes.slice(1).map((n) => n.title).join(" · "), pic: notes[0].pic });
    }
    // Friendz groups (Settings > Forum): a new post on a group wall you are in.
    async function checkGroups(force) {
      const look = window.xnLook ? window.xnLook.get() : {};
      if (!signedIn || look.forumOff || !who()) return;
      const key = "xn_groupnotes_" + who().toLowerCase();
      let seen = null;
      try { seen = JSON.parse(localStorage.getItem(key) || "null"); } catch (_) {}
      if (!force && seen && Date.now() - (seen.at || 0) < EVERY) return;
      let groups;
      try {
        const res = await fetch("/forum/groups", { headers: { Accept: "application/json" } });
        if (!res.ok) return;
        groups = (await res.json()).groups || [];
      } catch (_) { return; }
      const counts = {};
      groups.forEach((g) => { counts[g.id] = g.posts || 0; });
      try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), counts })); } catch (_) {}
      if (!seen || /^\/Forum/.test(location.pathname)) return;
      const mute = look.groupMute || [];
      const fresh = groups.filter((g) => !mute.includes(g.id) && seen.counts && g.id in seen.counts && (g.posts || 0) > seen.counts[g.id]);
      if (!fresh.length) return;
      const n = fresh.reduce((s, g) => s + g.posts - seen.counts[g.id], 0);
      show({ kick: "Forum", title: (n === 1 ? "New post in " : n + " new posts in ") + fresh.map((g) => g.name).join(", "), text: "On your Friendz wall.", href: "/Forum", icon: "forum" });
    }
    window.xnPillNotes = { check, show, checkGroups };
    setTimeout(() => checkGroups(false), 4000);
    setInterval(() => { if (!document.hidden) checkGroups(false); }, EVERY + 9000);
    setTimeout(() => check(false), 2500);
    setInterval(() => { if (!document.hidden) check(false); }, EVERY + 5000);
  }

  function initSetup() {
    if (!signedIn || window.xnSetup) return;
    let wrap = null, step = 0, dir = 1, me = null, lastFocus = null;
    const save = (patch) => {
      const next = Object.assign(window.xnLook.get(), patch);
      window.xnLook.use(next);
      fetch("/profile/appearance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteLook: window.xnLook.get() }) }).catch(() => {});
    };
    const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
    function close() {
      if (!wrap) return;
      try { localStorage.removeItem(SETUP_NEW); } catch (_) {}
      const w = wrap;
      wrap = null;
      w.classList.add("is-closing");
      document.documentElement.classList.remove("xn-su-open");
      setTimeout(() => w.remove(), 260);
      document.removeEventListener("keydown", onKey, true);
      if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Tab" && wrap) {
        const f = [...wrap.querySelectorAll("button:not([disabled]), input, [tabindex='0']")].filter((n) => n.offsetParent);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    }
    function go(n) {
      dir = n >= step ? 1 : -1;
      step = Math.max(0, Math.min(SU_STEPS.length, n));
      draw();
    }
    function pictureBox(kind, label, icon) {
      const b = el("button", "xn-su-pic xn-su-" + kind);
      b.type = "button";
      b.setAttribute("aria-label", "Change " + label.toLowerCase());
      b.innerHTML = '<span class="xn-su-pic-img"></span><span class="xn-su-pic-ic">' + suSvg(icon) + '</span><span class="xn-su-pic-busy"></span>';
      const input = el("input");
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/gif,image/webp,image/*";
      input.hidden = true;
      const show = (url) => {
        const img = b.querySelector(".xn-su-pic-img");
        img.style.backgroundImage = url ? "url(" + JSON.stringify(url) + ")" : "";
        b.classList.toggle("has-pic", !!url);
      };
      const cur = me && (kind === "avatar" ? me.avatar : me.banner);
      if (cur && !/default/i.test(cur)) show(cur);
      b.addEventListener("click", () => input.click());
      input.addEventListener("change", async () => {
        const f = input.files && input.files[0];
        if (!f) return;
        const fd = new FormData();
        fd.append("kind", kind);
        fd.append("image", f);
        b.classList.add("is-busy");
        msg.textContent = "";
        try {
          const res = await fetch("/profile/picture", { method: "POST", body: fd });
          if (!res.ok) throw new Error((await res.text()).trim());
          const out = await res.json();
          show(out.url);
          if (me) me[kind] = out.url;
          if (kind === "avatar") { try { const m = JSON.parse(localStorage.getItem("xn_me") || "{}"); m.avatar = out.url; localStorage.setItem("xn_me", JSON.stringify(m)); } catch (_) {} }
          wrap && wrap.querySelector(".xn-su-skip span") && (wrap.querySelector(".xn-su-skip span").textContent = "Next");
        } catch (err) {
          msg.textContent = err.message || "Couldn't save that picture.";
        }
        b.classList.remove("is-busy");
        input.value = "";
      });
      const box = el("div", "xn-su-picwrap xn-su-picwrap-" + kind);
      box.append(b, el("span", "xn-su-pic-label", ""), input);
      box.querySelector(".xn-su-pic-label").textContent = label;
      return box;
    }
    let msg = null;
    function draw() {
      if (!wrap) return;
      const card = wrap.querySelector(".xn-su-card");
      const body = card.querySelector(".xn-su-body");
      const old = body.firstElementChild;
      const view = el("div", "xn-su-view");
      view.style.setProperty("--dir", dir);
      const s = SU_STEPS[step];
      // Progress dashes
      card.querySelectorAll(".xn-su-dash").forEach((d, i) => { d.classList.toggle("is-on", i === step); d.classList.toggle("is-done", i < step || step === SU_STEPS.length); });
      const done = !s;
      view.append(el("div", "xn-su-art", suSvg(done ? "done" : s.icon)));
      const h = el("h2", "xn-su-title");
      h.id = "xnSuTitle";
      h.textContent = done ? "All set" : s.title;
      const p = el("p", "xn-su-sub");
      p.textContent = done ? "You can change all of this later in Settings." : s.sub;
      view.append(h, p);
      msg = el("p", "xn-su-msg");
      msg.setAttribute("role", "status");
      if (done) {
        const fin = el("button", "xn-su-finish", "<span>Start exploring</span>" + suSvg("arrow"));
        fin.type = "button";
        fin.addEventListener("click", close);
        view.append(fin);
      } else if (s.key === "profile") {
        const pics = el("div", "xn-su-pics");
        pics.append(pictureBox("avatar", "Profile picture", "camera"), pictureBox("banner", "Banner", "image"));
        view.append(pics, msg);
      } else {
        const list = el("div", "xn-su-list" + (s.scroll ? " is-scroll" : ""));
        list.setAttribute("role", "radiogroup");
        list.setAttribute("aria-labelledby", "xnSuTitle");
        const cur = window.xnLook.get()[s.key];
        s.options.forEach((o) => {
          const r = el("button", "xn-su-opt");
          r.type = "button";
          r.setAttribute("role", "radio");
          const picked = o.value === cur || (s.key === "font" && (o.value || "") === (cur || ""));
          r.setAttribute("aria-checked", picked ? "true" : "false");
          const ic = el("span", "xn-su-opt-ic");
          if (o.icon) ic.innerHTML = suSvg(o.icon);
          else {
            ic.textContent = o.glyph || "Aa";
            ic.classList.add("is-glyph");
            if (o.small) ic.classList.add("is-small");
            if (o.big) ic.classList.add("is-big");
            if (o.sample != null) ic.dataset.fontSample = o.sample;
          }
          const t = el("span", "xn-su-opt-txt");
          const b1 = el("b"); b1.textContent = o.title;
          const b2 = el("small"); b2.textContent = o.sub;
          if (o.sample != null) { b1.dataset.fontSample = o.sample; b2.dataset.fontSample = o.sample; }
          t.append(b1, b2);
          r.append(ic, t, el("span", "xn-su-go", suSvg("arrow")));
          r.addEventListener("click", () => {
            list.querySelectorAll(".xn-su-opt").forEach((x) => x.setAttribute("aria-checked", x === r ? "true" : "false"));
            save({ [s.key]: o.value });
            r.classList.add("is-picked");
            setTimeout(() => go(step + 1), 260);
          });
          list.append(r);
        });
        view.append(list, msg);
      }
      if (old) {
        old.classList.add("is-leaving");
        old.style.setProperty("--dir", dir);
        setTimeout(() => old.remove(), 280);
      }
      body.append(view);
      // Bottom buttons
      const back = card.querySelector(".xn-su-back");
      back.disabled = step === 0;
      const skip = card.querySelector(".xn-su-skip");
      skip.hidden = done;
      const hasPic = s && s.key === "profile" && me && ((me.avatar && !/default/i.test(me.avatar)) || me.banner);
      skip.querySelector("span").textContent = hasPic ? "Next" : "Skip";
      const first = view.querySelector('.xn-su-opt[aria-checked="true"], .xn-su-opt, .xn-su-pic, .xn-su-finish');
      if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
      const picked = view.querySelector('.xn-su-list.is-scroll .xn-su-opt[aria-checked="true"]');
      if (picked) picked.scrollIntoView({ block: "center" });
    }
    function open(at) {
      if (wrap) return;
      lastFocus = document.activeElement;
      step = at || 0;
      dir = 1;
      wrap = el("div", "xn-su");
      wrap.innerHTML =
        '<div class="xn-su-card" role="dialog" aria-modal="true" aria-labelledby="xnSuTitle">' +
        '<button type="button" class="xn-su-x" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
        '<div class="xn-su-dashes" aria-hidden="true">' + SU_STEPS.map(() => '<span class="xn-su-dash"></span>').join("") + "</div>" +
        '<div class="xn-su-body"></div>' +
        '<div class="xn-su-foot"><button type="button" class="xn-su-btn xn-su-back"><i>' + suSvg("back") + "</i><span>Back</span></button>" +
        '<button type="button" class="xn-su-btn xn-su-skip"><i>' + suSvg("skip") + "</i><span>Skip</span></button></div></div>";
      document.body.append(wrap);
      document.documentElement.classList.add("xn-su-open");
      wrap.addEventListener("pointerdown", (e) => { if (e.target === wrap) close(); });
      wrap.querySelector(".xn-su-x").addEventListener("click", close);
      wrap.querySelector(".xn-su-back").addEventListener("click", () => go(step - 1));
      wrap.querySelector(".xn-su-skip").addEventListener("click", () => go(step + 1));
      document.addEventListener("keydown", onKey, true);
      try { me = JSON.parse(localStorage.getItem("xn_me") || "null"); } catch (_) {}
      draw();
      fetch("/me", { headers: { Accept: "application/json" } }).then((r) => (r.ok ? r.json() : null)).then((m) => {
        if (!m) return;
        me = m;
        if (step === 0 && wrap) { dir = 0; const v = wrap.querySelector(".xn-su-view"); if (v) v.remove(); draw(); }
      }).catch(() => {});
      requestAnimationFrame(() => wrap && wrap.classList.add("is-open"));
    }
    window.xnSetup = { open, close };
    let fresh = false;
    try { fresh = localStorage.getItem(SETUP_NEW) === "1"; } catch (_) {}
    if (fresh) setTimeout(() => open(0), 600);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
