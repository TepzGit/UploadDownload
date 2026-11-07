// ============================================================
// explorer.js: the Files page works like a file explorer (mommy 2026-11-06).
// Adds, on top of script.js (which still opens, renames, moves, deletes):
//  - a folder tree on the left, with the storage server switch above it
//    (Server 1 is this site; Server 2 is the storage server still to come),
//  - Back / Forward / Up next to the folder path,
//  - Details, Icons or Large icons view (cards with a big folder picture
//    and how much the folder holds) and sorting by name, date, type or size,
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
  const serverico2 = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path fill-rule="evenodd" clip-rule="evenodd" d="M4.97475 2.25H19.0253C19.4697 2.24999 19.8408 2.24999 20.1454 2.27077C20.4625 2.29241 20.762 2.33905 21.0524 2.45933C21.7262 2.73844 22.2616 3.27379 22.5407 3.94762C22.661 4.23801 22.7076 4.53754 22.7292 4.85464C22.75 5.15925 22.75 5.53028 22.75 5.97474V6.02526C22.75 6.46972 22.75 6.84075 22.7292 7.14537C22.7076 7.46247 22.661 7.76199 22.5407 8.05238C22.3908 8.41428 22.1669 8.73624 21.8875 9C22.1669 9.26377 22.3908 9.58572 22.5407 9.94762C22.661 10.238 22.7076 10.5375 22.7292 10.8546C22.75 11.1592 22.75 11.5303 22.75 11.9747V12.0253C22.75 12.4697 22.75 12.8408 22.7292 13.1454C22.7076 13.4625 22.661 13.762 22.5407 14.0524C22.3908 14.4143 22.1669 14.7362 21.8875 15C22.1669 15.2638 22.3908 15.5857 22.5407 15.9476C22.661 16.238 22.7076 16.5375 22.7292 16.8546C22.75 17.1592 22.75 17.5303 22.75 17.9747V18.0253C22.75 18.4697 22.75 18.8408 22.7292 19.1454C22.7076 19.4625 22.661 19.762 22.5407 20.0524C22.2616 20.7262 21.7262 21.2616 21.0524 21.5407C20.762 21.661 20.4625 21.7076 20.1454 21.7292C19.8408 21.75 19.4697 21.75 19.0253 21.75H4.97474C4.53028 21.75 4.15925 21.75 3.85464 21.7292C3.53754 21.7076 3.23801 21.661 2.94762 21.5407C2.27379 21.2616 1.73844 20.7262 1.45933 20.0524C1.33905 19.762 1.29241 19.4625 1.27077 19.1454C1.24999 18.8408 1.24999 18.4697 1.25 18.0253V17.9748C1.24999 17.5303 1.24999 17.1592 1.27077 16.8546C1.29241 16.5375 1.33905 16.238 1.45933 15.9476C1.60924 15.5857 1.83305 15.2638 2.11254 15C1.83305 14.7362 1.60924 14.4143 1.45933 14.0524C1.33905 13.762 1.29241 13.4625 1.27077 13.1454C1.24999 12.8408 1.24999 12.4697 1.25 12.0253V11.9748C1.24999 11.5303 1.24999 11.1592 1.27077 10.8546C1.29241 10.5375 1.33905 10.238 1.45933 9.94762C1.60924 9.58572 1.83305 9.26377 2.11254 9C1.83305 8.73623 1.60924 8.41428 1.45933 8.05238C1.33905 7.76199 1.29241 7.46247 1.27077 7.14537C1.24999 6.84075 1.24999 6.46971 1.25 6.02525V5.97475C1.24999 5.53029 1.24999 5.15925 1.27077 4.85464C1.29241 4.53754 1.33905 4.23801 1.45933 3.94762C1.73844 3.27379 2.27379 2.73844 2.94762 2.45933C3.23801 2.33905 3.53754 2.29241 3.85464 2.27077C4.15925 2.24999 4.53029 2.24999 4.97475 2.25ZM5 8.25C4.5238 8.25 4.20421 8.24959 3.95674 8.23271C3.71602 8.21629 3.5988 8.18681 3.52165 8.15485C3.21536 8.02798 2.97202 7.78464 2.84515 7.47835C2.81319 7.4012 2.78372 7.28399 2.76729 7.04326C2.75041 6.79579 2.75 6.4762 2.75 6C2.75 5.5238 2.75041 5.20421 2.76729 4.95674C2.78372 4.71602 2.81319 4.5988 2.84515 4.52165C2.97202 4.21536 3.21536 3.97202 3.52165 3.84515C3.5988 3.81319 3.71602 3.78372 3.95674 3.76729C4.20421 3.75041 4.5238 3.75 5 3.75H19C19.4762 3.75 19.7958 3.75041 20.0433 3.76729C20.284 3.78372 20.4012 3.81319 20.4784 3.84515C20.7846 3.97202 21.028 4.21536 21.1549 4.52165C21.1868 4.5988 21.2163 4.71602 21.2327 4.95674C21.2496 5.20421 21.25 5.5238 21.25 6C21.25 6.4762 21.2496 6.79579 21.2327 7.04326C21.2163 7.28399 21.1868 7.4012 21.1549 7.47835C21.028 7.78464 20.7846 8.02798 20.4784 8.15485C20.4012 8.18681 20.284 8.21629 20.0433 8.23271C19.7958 8.24959 19.4762 8.25 19 8.25H5ZM5 9.75C4.5238 9.75 4.20421 9.75041 3.95674 9.76729C3.71602 9.78372 3.5988 9.81319 3.52165 9.84515C3.21536 9.97202 2.97202 10.2154 2.84515 10.5216C2.81319 10.5988 2.78372 10.716 2.76729 10.9567C2.75041 11.2042 2.75 11.5238 2.75 12C2.75 12.4762 2.75041 12.7958 2.76729 13.0433C2.78372 13.284 2.81319 13.4012 2.84515 13.4784C2.97202 13.7846 3.21536 14.028 3.52165 14.1549C3.5988 14.1868 3.71602 14.2163 3.95674 14.2327C4.20421 14.2496 4.5238 14.25 5 14.25H19C19.4762 14.25 19.7958 14.2496 20.0433 14.2327C20.284 14.2163 20.4012 14.1868 20.4784 14.1549C20.7846 14.028 21.028 13.7846 21.1549 13.4784C21.1868 13.4012 21.2163 13.284 21.2327 13.0433C21.2496 12.7958 21.25 12.4762 21.25 12C21.25 11.5238 21.2496 11.2042 21.2327 10.9567C21.2163 10.716 21.1868 10.5988 21.1549 10.5216C21.028 10.2154 20.7846 9.97202 20.4784 9.84515C20.4012 9.81319 20.284 9.78372 20.0433 9.76729C19.7958 9.75041 19.4762 9.75 19 9.75H5ZM5 15.75C4.5238 15.75 4.20421 15.7504 3.95674 15.7673C3.71602 15.7837 3.5988 15.8132 3.52165 15.8452C3.21536 15.972 2.97202 16.2154 2.84515 16.5216C2.81319 16.5988 2.78372 16.716 2.76729 16.9567C2.75041 17.2042 2.75 17.5238 2.75 18C2.75 18.4762 2.75041 18.7958 2.76729 19.0433C2.78372 19.284 2.81319 19.4012 2.84515 19.4784C2.97202 19.7846 3.21536 20.028 3.52165 20.1549C3.5988 20.1868 3.71602 20.2163 3.95674 20.2327C4.20421 20.2496 4.5238 20.25 5 20.25H19C19.4762 20.25 19.7958 20.2496 20.0433 20.2327C20.284 20.2163 20.4012 20.1868 20.4784 20.1549C20.7846 20.028 21.028 19.7846 21.1549 19.4784C21.1868 19.4012 21.2163 19.284 21.2327 19.0433C21.2496 18.7958 21.25 18.4762 21.25 18C21.25 17.5238 21.2496 17.2042 21.2327 16.9567C21.2163 16.716 21.1868 16.5988 21.1549 16.5216C21.028 16.2154 20.7846 15.972 20.4784 15.8452C20.4012 15.8132 20.284 15.7837 20.0433 15.7673C19.7958 15.7504 19.4762 15.75 19 15.75H5Z" fill="#000000" style="--darkreader-inline-fill: var(--darkreader-background-1c274c, #000000);" data-darkreader-inline-fill=""></path> <path d="M6 12C6 12.5523 5.55229 13 5 13C4.44772 13 4 12.5523 4 12C4 11.4477 4.44772 11 5 11C5.55229 11 6 11.4477 6 12Z" fill="#000000" style="--darkreader-inline-fill: var(--darkreader-text-1c274c, #acc4e0);" data-darkreader-inline-fill=""></path> <path d="M6 6C6 6.55229 5.55229 7 5 7C4.44772 7 4 6.55229 4 6C4 5.44772 4.44772 5 5 5C5.55229 5 6 5.44772 6 6Z" fill="#000000" style="--darkreader-inline-fill: var(--darkreader-text-1c274c, #acc4e0);" data-darkreader-inline-fill=""></path> <path d="M6 18C6 18.5523 5.55229 19 5 19C4.44772 19 4 18.5523 4 18C4 17.4477 4.44772 17 5 17C5.55229 17 6 17.4477 6 18Z" fill="#000000" style="--darkreader-inline-fill: var(--darkreader-text-1c274c, #000000);" data-darkreader-inline-fill=""></path> </g></svg>';
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
        // No folders inside: say so instead of an empty space (the arrow stays).
        if (!kids.length) {
          li.classList.add("is-leaf");
          const none = document.createElement("li");
          none.className = "fx-tree-none";
          none.setAttribute("role", "none");
          none.style.setProperty("--d", String(depth + 1));
          none.textContent = "No folders inside";
          sub.append(none);
        }
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
    '<button type="button" class="fx-nav-btn" data-view="details" aria-label="Details" title="Details"><svg class="fx-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>' +
    '<button type="button" class="fx-nav-btn" data-view="icons" aria-label="Icons" title="Icons"><svg class="fx-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg></button>' +
    '<button type="button" class="fx-nav-btn" data-view="large" aria-label="Large icons" title="Large icons"><svg class="fx-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="12" rx="2"/><path d="M7 20h10"/></svg></button>';
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

  const VIEWS = ["details", "icons", "large"];
  let view = VIEWS.includes(store.get("xn_files_view", "details")) ? store.get("xn_files_view", "details") : "details";
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
    if (item.dataset.bytes) return +item.dataset.bytes;
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
    if (e.key === "ArrowDown") step = view !== "details" ? perRow() : 1;
    else if (e.key === "ArrowUp") step = view !== "details" ? -perRow() : -1;
    else if (e.key === "ArrowRight" && view !== "details") step = 1;
    else if (e.key === "ArrowLeft" && view !== "details") step = -1;
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

  // How much each folder holds (/files/sizes, worked out on the server): shown
  // under the name on the Large icons cards and in the Size column.
  const sizes = {};
  function showSize(item) {
    if (item.dataset.type !== "Dir") return;
    const s = sizes[item.querySelector(".filename")?.textContent.trim()];
    if (!s) return;
    item.dataset.bytes = String(s.bytes);
    const text = size(s.bytes) + " · " + s.files + (s.files === 1 ? " file" : " files");
    const meta = item.querySelector(".fx-meta");
    if (meta && meta.textContent !== text) meta.textContent = text;
    const col = item.querySelector(".fx-c-size");
    if (col && col.textContent !== size(s.bytes)) col.textContent = size(s.bytes);
  }
  {
    fetch("/files/sizes?dir=" + encodeURIComponent(here), { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => { Object.assign(sizes, data || {}); rows().forEach(showSize); if (sortKey === "size") sortRows(); })
      .catch(() => {});
  }

  // Search results and renames swap rows in and out: dress them the same way.
  function refresh() {
    rows().forEach(decorate);
    rows().forEach(showSize);
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
