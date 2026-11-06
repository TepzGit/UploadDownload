// ============================================================
// explorer.js: the Files page works like a file explorer (mommy 2026-11-06).
// Adds, on top of script.js (which still opens, renames, moves, deletes):
//  - a folder tree on the left, with the storage server switch above it
//    (Server 1 is this site; Server 2 is the storage server still to come),
//  - Back / Forward / Up next to the folder path,
//  - Details or Icons view and sorting by name, date, type or size,
//  - click to select and double-click to open (with a mouse; a tap still
//    opens on phones), arrow keys, Backspace for the folder above,
//  - a status bar with the number of items and what is selected.
// ============================================================
(function () {
  "use strict";
  const page = document.querySelector(".xn-page.fx");
  const list = document.getElementById("itemsresults");
  const card = page && page.querySelector(".fx-card");
  const layout = page && page.querySelector(".fx-layout");
  if (!page || !list || !card || !layout) return;

  const store = {
    get(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (_) {} },
  };
  const svg = (id, cls) => `<svg class="fx-ico${cls ? " " + cls : ""}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const size = (b) => { const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return (i ? b.toFixed(b < 10 ? 1 : 0) : b) + " " + u[i]; };
  const MOUSE = window.matchMedia("(hover: hover) and (pointer: fine)");
  const here = window.location.pathname.replace(/\/+$/, "") || "/Files";
  const relHere = decodeURIComponent(here.split("/").slice(2).join("/")); // "" at the top
  const TYPE_NAME = { Dir: "Folder", Image: "Picture", Video: "Video", Audio: "Music", None: "File" };

  // ---------------- Storage server switch ----------------
  const nav = document.createElement("aside");
  nav.className = "xn-card fx-nav";
  nav.setAttribute("aria-label", "Storage and folders");
  const drive = '<span class="fx-drive" aria-hidden="true"><i></i><i></i><i></i></span>';
  nav.innerHTML =
    '<div class="fx-servers" role="radiogroup" aria-label="Storage server">' +
    '<span class="fx-server-glide" aria-hidden="true"></span>' +
    `<button type="button" role="radio" class="fx-server" data-server="1" aria-label="Server 1, this site">${drive}<b>1</b></button>` +
    `<button type="button" role="radio" class="fx-server" data-server="2" aria-label="Server 2, storage server">${drive}<b>2</b></button>` +
    "</div>" +
    '<p class="fx-server-name" id="fxServerName"></p>' +
    '<h2 class="xn-label fx-nav-title">Folders</h2>' +
    '<ul class="fx-tree" id="fxTree" role="tree" aria-label="Folders"></ul>';
  layout.prepend(nav);
  const servers = [...nav.querySelectorAll(".fx-server")];
  const off = document.createElement("div");
  off.className = "fx-offline";
  off.hidden = true;
  off.innerHTML = '<span class="fx-offline-ic">' + drive + '</span><strong>Server 2 is not connected yet</strong><span>Your storage server shows up here once it is set up.</span>';
  card.append(off);
  function useServer(n, save) {
    const two = n === "2";
    servers.forEach((b) => {
      const on = b.dataset.server === n;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    nav.querySelector(".fx-servers").dataset.on = n;
    document.getElementById("fxServerName").textContent = two ? "Storage server" : "This site";
    page.classList.toggle("fx-on-server2", two);
    off.hidden = !two;
    if (save) store.set("xn_files_server", n);
  }
  servers.forEach((b, i) => {
    b.addEventListener("click", () => useServer(b.dataset.server, true));
    b.addEventListener("keydown", (e) => {
      if (!/Arrow(Left|Right|Up|Down)/.test(e.key)) return;
      e.preventDefault();
      const next = servers[(i + 1) % servers.length];
      next.focus();
      next.click();
    });
  });
  useServer(store.get("xn_files_server", "1") === "2" ? "2" : "1", false);

  // ---------------- Folder tree ----------------
  const tree = document.getElementById("fxTree");
  async function foldersIn(rel) {
    try {
      const res = await fetch("/getFolders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPath: ".", FolderToGet: rel || "." }) });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.Folders || []).slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    } catch (_) { return []; }
  }
  const hrefOf = (rel) => "/Files/" + (rel ? rel.split("/").map(encodeURIComponent).join("/") + "/" : "");
  function node(name, rel, depth) {
    const li = document.createElement("li");
    li.setAttribute("role", "treeitem");
    li.dataset.rel = rel;
    const onPath = rel === "" || relHere === rel || relHere.startsWith(rel + "/");
    const current = relHere === rel;
    li.innerHTML =
      `<div class="fx-tree-row${current ? " is-here" : ""}" style="--d:${depth}">` +
      `<button type="button" class="fx-tree-tog" aria-label="Show folders in ${esc(name)}">${svg("i-chevron")}</button>` +
      `<a href="${esc(hrefOf(rel))}"${current ? ' aria-current="page"' : ""}>${svg("i-folder")}<span>${esc(name)}</span></a></div>` +
      '<ul role="group" hidden></ul>';
    const tog = li.querySelector(".fx-tree-tog");
    const sub = li.querySelector("ul");
    let loaded = false;
    async function open(show) {
      if (show && !loaded) {
        loaded = true;
        const kids = await foldersIn(rel);
        sub.replaceChildren(...kids.map((k) => node(k, rel ? rel + "/" + k : k, depth + 1)));
        if (!kids.length) li.classList.add("is-leaf");
      }
      sub.hidden = !show;
      li.setAttribute("aria-expanded", String(show));
    }
    tog.addEventListener("click", () => open(sub.hidden));
    if (onPath) open(true);
    return li;
  }
  tree.append(node("Files", "", 0));

  // ---------------- Address bar: Back, Forward, Up ----------------
  const toolbar = card.querySelector(".fx-toolbar");
  const crumbs = document.getElementById("fxCrumbs");
  const bar = document.createElement("div");
  bar.className = "fx-address";
  const up = relHere ? hrefOf(relHere.split("/").slice(0, -1).join("/")) : "";
  bar.innerHTML =
    `<button type="button" class="fx-nav-btn" id="fxBack" aria-label="Back">${svg("i-back")}</button>` +
    `<button type="button" class="fx-nav-btn fx-fwd" id="fxFwd" aria-label="Forward">${svg("i-back")}</button>` +
    `<button type="button" class="fx-nav-btn fx-up" id="fxUp" aria-label="Folder above"${up ? "" : " disabled"}>${svg("i-back")}</button>` +
    '<div class="fx-path"></div>';
  if (crumbs) bar.querySelector(".fx-path").append(crumbs);
  bar.querySelector("#fxBack").addEventListener("click", () => history.back());
  bar.querySelector("#fxFwd").addEventListener("click", () => history.forward());
  bar.querySelector("#fxUp").addEventListener("click", () => { if (up) location.href = up; });
  if (toolbar) toolbar.prepend(bar);

  // ---------------- View and sort ----------------
  const tools = document.createElement("div");
  tools.className = "fx-view";
  tools.setAttribute("role", "group");
  tools.setAttribute("aria-label", "View");
  tools.innerHTML =
    '<button type="button" class="fx-nav-btn" data-view="details" aria-label="Details"><svg class="fx-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>' +
    '<button type="button" class="fx-nav-btn" data-view="icons" aria-label="Large icons"><svg class="fx-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg></button>';
  if (toolbar) toolbar.append(tools);
  const head = document.createElement("div");
  head.className = "fx-cols-head";
  head.innerHTML = [["name", "Name"], ["date", "Date modified"], ["type", "Type"], ["size", "Size"]]
    .map(([k, label]) => `<button type="button" class="fx-sort" data-sort="${k}">${label}<svg class="fx-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>`).join("");
  list.before(head);
  const status = document.createElement("div");
  status.className = "fx-status";
  status.setAttribute("aria-live", "polite");
  card.append(status);

  let view = store.get("xn_files_view", "details") === "icons" ? "icons" : "details";
  let sortKey = store.get("xn_files_sort", "name");
  let sortDir = store.get("xn_files_dir", "1") === "-1" ? -1 : 1;
  function setView(v) {
    view = v;
    store.set("xn_files_view", v);
    page.dataset.view = v;
    tools.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  }
  tools.addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b) setView(b.dataset.view); });
  setView(view);

  const dateOf = (item) => {
    const t = item.querySelector(".uploadtime");
    const m = t && t.textContent.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : 0;
  };
  const bytesOf = (item) => {
    const s = item.querySelector(".filesize");
    if (s && s.dataset.bytes) return +s.dataset.bytes;
    const m = s && s.textContent.trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)/i);
    return m ? parseFloat(m[1]) * Math.pow(1024, ["B", "KB", "MB", "GB", "TB"].indexOf(m[2].toUpperCase())) : 0;
  };
  // Each row gets its own Date, Type and Size cells for the Details view.
  function decorate(item) {
    if (item.querySelector(".fx-cols")) return;
    const type = item.dataset.type;
    const cols = document.createElement("span");
    cols.className = "fx-cols";
    const t = item.querySelector(".uploadtime");
    const s = item.querySelector(".filesize");
    const ext = type === "Dir" ? "" : (item.querySelector(".filename").textContent.match(/\.([a-z0-9]{1,6})$/i) || [, ""])[1].toUpperCase();
    cols.innerHTML = `<span class="fx-c-date">${esc(t ? t.textContent : "")}</span><span class="fx-c-type">${esc(ext ? ext + " " + TYPE_NAME[type].toLowerCase() : TYPE_NAME[type] || "File")}</span><span class="fx-c-size">${esc(type === "Dir" ? "" : s ? s.textContent : "")}</span>`;
    item.querySelector(".fileinfo").after(cols);
  }
  function rows() { return [...list.querySelectorAll(":scope > .item")]; }
  function sortRows() {
    const items = rows();
    if (!items.length) return;
    const val = {
      name: (i) => i.querySelector(".filename").textContent.toLowerCase(),
      date: dateOf,
      type: (i) => i.querySelector(".fx-c-type")?.textContent || "",
      size: bytesOf,
    }[sortKey] || ((i) => i.querySelector(".filename").textContent.toLowerCase());
    items.sort((a, b) => {
      const dirs = (b.dataset.type === "Dir") - (a.dataset.type === "Dir");
      if (dirs) return dirs; // folders first, like Explorer
      const x = val(a), y = val(b);
      const c = typeof x === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
      return c * sortDir;
    });
    if (items.some((it, i) => list.children[i] !== it)) list.append(...items);
    head.querySelectorAll(".fx-sort").forEach((b) => {
      const on = b.dataset.sort === sortKey;
      b.classList.toggle("is-on", on);
      b.classList.toggle("is-desc", on && sortDir === -1);
      b.setAttribute("aria-sort", on ? (sortDir === 1 ? "ascending" : "descending") : "none");
    });
  }
  head.addEventListener("click", (e) => {
    const b = e.target.closest(".fx-sort");
    if (!b) return;
    if (sortKey === b.dataset.sort) sortDir = -sortDir;
    else { sortKey = b.dataset.sort; sortDir = sortKey === "date" || sortKey === "size" ? -1 : 1; }
    store.set("xn_files_sort", sortKey);
    store.set("xn_files_dir", String(sortDir));
    sortRows();
  });

  // ---------------- Selection ----------------
  let selected = null;
  function select(item, focus) {
    rows().forEach((r) => r.classList.toggle("is-selected", r === item));
    selected = item || null;
    if (item && focus) item.focus({ preventScroll: false });
    showStatus();
  }
  function showStatus() {
    const items = rows();
    const dirs = items.filter((i) => i.dataset.type === "Dir").length;
    const files = items.length - dirs;
    let text = items.length === 1 ? "1 item" : items.length + " items";
    if (items.length) text += ` (${dirs} folder${dirs === 1 ? "" : "s"}, ${files} file${files === 1 ? "" : "s"})`;
    if (selected && document.contains(selected)) {
      text += " · 1 selected";
      if (selected.dataset.type !== "Dir") text += " · " + size(bytesOf(selected));
    }
    status.textContent = text;
  }
  // With a mouse: one click selects, a double click opens. Taps still open.
  list.addEventListener("click", (e) => {
    if (!MOUSE.matches || e.detail === 0) return; // keyboard and item.click() go on to script.js
    const item = e.target.closest(".item");
    if (!item || item.classList.contains("is-editing") || e.target.closest(".fx-more, .down, input")) return;
    e.stopPropagation();
    select(item);
  }, true);
  list.addEventListener("dblclick", (e) => {
    if (!MOUSE.matches) return;
    const item = e.target.closest(".item");
    if (!item || item.classList.contains("is-editing") || e.target.closest(".fx-more, .down, input")) return;
    item.click();
  });
  list.addEventListener("contextmenu", (e) => { const item = e.target.closest(".item"); if (item) select(item); });
  list.addEventListener("focusin", (e) => { const item = e.target.closest(".item"); if (item && e.target === item) select(item); });
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".item, .fx-menu, .fx-modal, .fx-status")) select(null);
  });
  list.addEventListener("keydown", (e) => {
    const item = e.target.closest(".item");
    if (!item || e.target !== item) return;
    const items = rows();
    const at = items.indexOf(item);
    let step = 0;
    if (e.key === "ArrowDown") step = view === "icons" ? perRow() : 1;
    else if (e.key === "ArrowUp") step = view === "icons" ? -perRow() : -1;
    else if (e.key === "ArrowRight" && view === "icons") step = 1;
    else if (e.key === "ArrowLeft" && view === "icons") step = -1;
    else if (e.key === "Home") step = -at;
    else if (e.key === "End") step = items.length - 1 - at;
    if (!step) return;
    e.preventDefault();
    select(items[Math.max(0, Math.min(items.length - 1, at + step))], true);
  });
  function perRow() {
    const items = rows();
    if (items.length < 2) return 1;
    const top = items[0].offsetTop;
    const n = items.findIndex((i) => i.offsetTop !== top);
    return n > 0 ? n : items.length;
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Backspace" || !up || e.target.closest("input, textarea, select, [contenteditable]")) return;
    if (!document.getElementById("previewModal")?.hidden) return;
    e.preventDefault();
    location.href = up;
  });

  // Search results and renames swap rows in and out: dress them the same way.
  function refresh() {
    rows().forEach(decorate);
    sortRows();
    if (selected && !document.contains(selected)) selected = null;
    showStatus();
  }
  let busy = false;
  const watch = new MutationObserver(() => {
    if (busy) return;
    busy = true;
    requestAnimationFrame(() => { refresh(); watch.takeRecords(); busy = false; });
  });
  watch.observe(list, { childList: true });
  refresh();
  page.classList.add("fx-explorer");
})();
