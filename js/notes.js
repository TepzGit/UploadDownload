// ============================================================
// notes.js — the Notes page (/Notes).
//  - By substance: the notes written on Graph doses (/experiences),
//    grouped by substance A–Z, newest first inside each.
//  - Trip reports: longer write-ups with up to 8 pictures, optionally
//    tied to a Graph session (/notes/reports). Opening one shows it with
//    its comments on the right; public ones can be liked.
//  - Public reports: everyone's shared reports (/notes/reports/public).
//  - Notepad: free notes that save as you type (/notes/pad).
// Needs media.js on the page (pictures).
// ============================================================

import { postTime, paintName, rankBadge, profileLink } from "/forum.js";

const $ = (id) => document.getElementById(id);
const toast = (msg, isError) => (window.xnToast ? window.xnToast(msg, isError) : console.log(msg));

async function api(url, body) {
  const res = await fetch(url, body === undefined ? { headers: { Accept: "application/json" } } : {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    location.href = "/Main?next=" + encodeURIComponent(location.pathname + location.hash);
    throw new Error("Log in again.");
  }
  if (!res.ok) throw new Error((await res.text()).trim() || "Something went wrong. Try again.");
  return res.json();
}

const dayLabel = (t, opts = { weekday: "short", day: "numeric", month: "short", year: "numeric" }) =>
  new Date(t).toLocaleDateString([], opts);
const isoDay = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ago = (t) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return dayLabel(t, { day: "numeric", month: "short", year: "numeric" });
};

// ---------------------------------------------------------------- tabs

const TABS = ["doses", "reports", "pad", "public"];
const loaded = {};

function showTab(name, { push = true } = {}) {
  if (!TABS.includes(name)) name = "doses";
  document.querySelectorAll(".nt-seg-btn").forEach((b) => {
    const on = b.dataset.tab === name;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $("paneDoses").hidden = name !== "doses";
  $("paneReports").hidden = name !== "reports";
  $("panePad").hidden = name !== "pad";
  $("panePublic").hidden = name !== "public";
  if (push) history.replaceState(null, "", name === "doses" ? location.pathname : "#" + name);
  if (!loaded[name]) {
    loaded[name] = true;
    ({ doses: loadDoses, reports: loadReports, pad: loadPad, public: loadPublic })[name]();
  }
}

document.querySelector(".nt-seg").addEventListener("click", (event) => {
  const b = event.target.closest(".nt-seg-btn");
  if (b) showTab(b.dataset.tab);
});
document.querySelector(".nt-seg").addEventListener("keydown", (event) => {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  const list = [...document.querySelectorAll(".nt-seg-btn")];
  const at = list.findIndex((b) => b.getAttribute("aria-selected") === "true");
  const next = list[(at + (event.key === "ArrowRight" ? 1 : list.length - 1)) % list.length];
  next.focus();
  showTab(next.dataset.tab);
});

// ---------------------------------------------------------------- experiences (shared)

let experiencesPromise = null;
function experiences() {
  if (!experiencesPromise) {
    experiencesPromise = api("/experiences").then((data) => data.items || []).catch((error) => {
      experiencesPromise = null;
      throw error;
    });
  }
  return experiencesPromise;
}

const sessionSubstances = (e) => {
  const seen = new Map();
  (e.doses || []).forEach((d) => {
    const key = d.substance.toLowerCase();
    const amount = `${d.amount} ${d.unit || ""}`.trim();
    seen.set(key, seen.has(key) ? `${seen.get(key)}, ${amount}` : `${d.substance} ${amount}`);
  });
  return [...seen.values()].join(" · ");
};

// ---------------------------------------------------------------- by substance

let doseNotes = [];

async function loadDoses() {
  const box = $("doseGroups");
  try {
    const items = await experiences();
    doseNotes = [];
    items.forEach((e) => (e.doses || []).forEach((d) => {
      if (d.note && d.note.trim()) {
        doseNotes.push({ ...d, startedAt: e.startedAt, sessionId: e.id });
      }
    }));
    renderDoses();
  } catch (error) {
    box.innerHTML = '<p class="nt-empty"></p>';
    box.firstChild.textContent = error.message || "Couldn't load your notes.";
  }
}

function highlight(text, q) {
  const frag = document.createDocumentFragment();
  if (!q) {
    frag.append(text);
    return frag;
  }
  const lower = text.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, at)) {
    frag.append(text.slice(at, i));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(i, i + q.length);
    frag.append(mark);
    at = i + q.length;
  }
  frag.append(text.slice(at));
  return frag;
}

function renderDoses() {
  const box = $("doseGroups");
  const q = $("doseFind").value.trim().toLowerCase();
  const list = doseNotes.filter((n) => !q || n.substance.toLowerCase().includes(q) || n.note.toLowerCase().includes(q));
  $("doseCount").textContent = doseNotes.length ? `${list.length} ${list.length === 1 ? "note" : "notes"}` : "";
  box.replaceChildren();
  if (!doseNotes.length) {
    box.innerHTML = '<p class="nt-empty">No dose notes yet. On the <a href="/">Graph</a>, tap the pencil on a dose and write how it felt. Every note shows up here, sorted by substance.</p>';
    return;
  }
  if (!list.length) {
    box.innerHTML = '<p class="nt-empty">Nothing matches that.</p>';
    return;
  }
  const groups = new Map();
  list.forEach((n) => {
    const key = n.substance.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: n.substance, notes: [] });
    groups.get(key).notes.push(n);
  });
  [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach((g) => {
    g.notes.sort((a, b) => b.startedAt - a.startedAt || b.time.localeCompare(a.time));
    const det = document.createElement("details");
    det.className = "xn-card nt-group";
    det.open = groups.size <= 6 || !!q;
    const sum = document.createElement("summary");
    const name = document.createElement("span");
    name.className = "nt-group-name";
    name.append(highlight(g.name, q));
    const count = document.createElement("span");
    count.className = "nt-group-count";
    count.textContent = String(g.notes.length);
    sum.append(name, count);
    const ul = document.createElement("ul");
    ul.className = "nt-notes";
    g.notes.forEach((n) => {
      const li = document.createElement("li");
      li.className = "nt-note";
      const bar = document.createElement("span");
      bar.className = "nt-note-bar";
      const meta = document.createElement("div");
      meta.className = "nt-note-meta";
      const when = document.createElement("strong");
      when.textContent = `${dayLabel(n.startedAt)} · ${n.time}`;
      const what = document.createElement("span");
      what.textContent = [`${n.amount} ${n.unit || ""}`.trim(), n.route, n.formulation].filter(Boolean).join(" · ");
      meta.append(when, what);
      const text = document.createElement("p");
      text.className = "nt-note-text";
      text.append(highlight(n.note, q));
      const body = document.createElement("div");
      body.append(meta, text);
      li.append(bar, body);
      ul.append(li);
    });
    det.append(sum, ul);
    box.append(det);
  });
}
$("doseFind").addEventListener("input", renderDoses);

// ---------------------------------------------------------------- trip reports

let reports = [];
let editing = null;
let rating = 0;
const MAX_PICS = 8;
const touch = matchMedia("(pointer: coarse)");
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3c-.3 0-.6-.1-.8-.3C6.9 16.4 3 13.2 3 8.9 3 6.2 5.1 4 7.7 4c1.7 0 3.3.9 4.3 2.3C13 4.9 14.6 4 16.3 4 18.9 4 21 6.2 21 8.9c0 4.3-3.9 7.5-8.2 11.1-.2.2-.5.3-.8.3z"/></svg>';
const BUBBLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v10H9l-5 4v-14z"/></svg>';
const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);

async function loadReports() {
  try {
    reports = (await api("/notes/reports")).items || [];
    renderReports();
  } catch (error) {
    $("repList").innerHTML = '<p class="nt-empty"></p>';
    $("repList").firstChild.textContent = error.message;
  }
}

function srText(text) {
  const span = document.createElement("span");
  span.className = "xn-sr";
  span.textContent = text;
  return span;
}

/** A small heart or speech bubble with a number, for the report cards. */
function stat(icon, n, word, on = false) {
  const span = document.createElement("span");
  span.className = "nt-stat" + (on ? " is-on" : "");
  span.innerHTML = icon;
  span.append(String(n || 0), srText(` ${word}${n === 1 ? "" : "s"}`));
  return span;
}

/**
 * A report in the lists: its first picture, who wrote it (public list), the
 * day, title, stars, substances, the start of the text, likes and comments.
 */
function reportCard(r, { author = null } = {}) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "xn-card nt-report";
  card.dataset.id = String(r.id);
  const pics = r.pictures || [];
  if (pics.length) {
    const cover = document.createElement("span");
    cover.className = "nt-report-cover";
    const img = document.createElement("img");
    img.src = pics[0];
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => cover.classList.add("is-broken"), { once: true });
    cover.append(img);
    if (pics.length > 1) {
      const more = document.createElement("span");
      more.className = "nt-report-more";
      more.textContent = `+${pics.length - 1}`;
      more.append(srText(" more pictures"));
      cover.append(more);
    }
    card.append(cover);
  }
  if (author) card.append(authorChip(author));
  const day = document.createElement("span");
  day.className = "nt-report-day";
  day.textContent = dayLabel(r.happenedAt);
  if (!author && r.public) {
    const tag = document.createElement("span");
    tag.className = "nt-tag";
    tag.textContent = "Public";
    day.append(tag);
  }
  const title = document.createElement("h3");
  title.className = "nt-report-title";
  title.textContent = r.title || "Untitled report";
  card.append(day, title);
  if (r.rating) {
    const s = document.createElement("span");
    s.className = "nt-report-stars";
    s.textContent = stars(r.rating);
    s.setAttribute("aria-label", `${r.rating} of 5`);
    card.append(s);
  }
  if (r.substances) {
    const subs = document.createElement("span");
    subs.className = "nt-report-subs";
    subs.textContent = r.substances;
    card.append(subs);
  }
  if (r.body) {
    const text = document.createElement("p");
    text.className = "nt-report-text";
    text.textContent = r.body;
    card.append(text);
  }
  // Likes and comments: public reports, or a private one that got some while it was public.
  if (r.public || r.likes || r.comments) {
    const foot = document.createElement("span");
    foot.className = "nt-report-foot";
    foot.append(stat(HEART, r.likes, "like", r.liked), stat(BUBBLE, r.comments, "comment"));
    card.append(foot);
  }
  return card;
}

function renderReports() {
  const box = $("repList");
  const q = $("repFind").value.trim().toLowerCase();
  box.replaceChildren();
  if (!reports.length) {
    box.innerHTML = '<p class="nt-empty">No trip reports yet. Press New report to write one, about a Graph session or any day you remember.</p>';
    return;
  }
  const list = reports.filter((r) => !q || [r.title, r.substances, r.setting, r.body].some((v) => (v || "").toLowerCase().includes(q)));
  if (!list.length) {
    box.innerHTML = '<p class="nt-empty">Nothing matches that.</p>';
    return;
  }
  list.forEach((r) => box.append(reportCard(r)));
}
$("repFind").addEventListener("input", renderReports);
$("repList").addEventListener("click", (event) => {
  const card = event.target.closest(".nt-report");
  const r = card && reports.find((x) => x.id === Number(card.dataset.id));
  if (r) openReader({ ...r, mine: true });
});
$("repNew").addEventListener("click", () => openReport(null));

function paintStars() {
  $("repStars").querySelectorAll(".nt-star").forEach((b, i) => {
    b.classList.toggle("is-on", i < rating);
    b.setAttribute("aria-checked", String(i + 1 === rating));
  });
}
for (let i = 1; i <= 5; i++) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "nt-star";
  b.setAttribute("role", "radio");
  b.setAttribute("aria-label", `${i} of 5`);
  b.textContent = "★";
  b.addEventListener("click", () => {
    rating = rating === i ? 0 : i;
    paintStars();
  });
  $("repStars").append(b);
}

// Pictures in the report form: the ones it has ({url}) and new ones ({file, url}).
let picState = [];

function paintPics() {
  const box = $("repPics");
  box.replaceChildren();
  picState.forEach((p, i) => {
    const cell = document.createElement("div");
    cell.className = "nt-pic-edit";
    const img = document.createElement("img");
    img.src = p.url;
    img.alt = "";
    const x = document.createElement("button");
    x.type = "button";
    x.className = "nt-pic-x";
    x.textContent = "×";
    x.setAttribute("aria-label", `Remove picture ${i + 1}`);
    x.addEventListener("click", () => {
      if (p.file) URL.revokeObjectURL(p.url);
      picState.splice(i, 1);
      paintPics();
      ($("repPics").querySelectorAll(".nt-pic-x")[i] || $("repPics").querySelector(".nt-pic-x, .nt-pic-add"))?.focus();
    });
    cell.append(img, x);
    box.append(cell);
  });
  if (picState.length < MAX_PICS) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "nt-pic-add";
    add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/></svg><span></span>';
    add.querySelector("span").textContent = picState.length ? "Add more" : "Add pictures";
    add.addEventListener("click", () => $("repFiles").click());
    box.append(add);
  }
  $("repPicsCount").textContent = picState.length ? `${picState.length} of ${MAX_PICS}` : "";
}

function addPictureFiles(files) {
  const images = [...files].filter((f) => f.type.startsWith("image/"));
  if (!images.length) return;
  const room = MAX_PICS - picState.length;
  if (images.length > room) toast(room ? `A report holds ${MAX_PICS} pictures, so only the first ${room} were added.` : `A report holds ${MAX_PICS} pictures.`);
  images.slice(0, room).forEach((file) => picState.push({ file, url: URL.createObjectURL(file) }));
  paintPics();
}

function dropNewPictures() {
  picState.forEach((p) => p.file && URL.revokeObjectURL(p.url));
  picState = [];
}

$("repFiles").addEventListener("change", () => {
  addPictureFiles($("repFiles").files || []);
  $("repFiles").value = "";
});
// The report box grows with what's written in it, so the form scrolls
// instead of the text hiding inside a fixed box.
function fitBody() {
  const box = $("repForm").elements.body;
  if (!box.offsetParent) return; // the form isn't showing
  const cs = getComputedStyle(box);
  const top = window.scrollY;
  const form = $("repForm");
  const formTop = form.scrollTop;
  box.style.height = "auto";
  box.style.height = box.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) + "px";
  // Shrinking for a moment mustn't jump the form or the page.
  form.scrollTop = formTop;
  if (window.scrollY !== top) window.scrollTo(0, top);
}
$("repForm").elements.body.addEventListener("input", fitBody);
window.addEventListener("resize", () => { if ($("repDlg").open) fitBody(); });

// Pictures can also be pasted into the report or dropped on the form.
$("repForm").elements.body.addEventListener("paste", (event) => {
  const files = [...(event.clipboardData?.files || [])];
  if (files.some((f) => f.type.startsWith("image/"))) {
    event.preventDefault();
    addPictureFiles(files);
  }
});
$("repForm").addEventListener("dragover", (event) => {
  if ([...(event.dataTransfer?.items || [])].some((i) => i.kind === "file")) {
    event.preventDefault();
    $("repPics").classList.add("is-drop");
  }
});
$("repForm").addEventListener("dragleave", (event) => {
  if (!event.currentTarget.contains(event.relatedTarget)) $("repPics").classList.remove("is-drop");
});
$("repForm").addEventListener("drop", (event) => {
  $("repPics").classList.remove("is-drop");
  const files = [...(event.dataTransfer?.files || [])];
  if (!files.length) return;
  event.preventDefault();
  addPictureFiles(files);
});

let backToReader = false;

async function openReport(report, { fromReader = false } = {}) {
  editing = report;
  backToReader = fromReader;
  const form = $("repForm");
  form.reset();
  $("repError").hidden = true;
  $("repDelete").hidden = !report;
  $("repDelete").textContent = "Delete";
  $("repDelete").classList.remove("is-armed");
  $("repDlgTitle").textContent = report ? "Edit trip report" : "New trip report";
  form.elements.title.value = report?.title || "";
  form.elements.day.value = isoDay(report?.happenedAt || Date.now());
  form.elements.day.max = isoDay(Date.now());
  form.elements.substances.value = report?.substances || "";
  form.elements.setting.value = report?.setting || "";
  form.elements.body.value = report?.body || "";
  form.elements.public.checked = Boolean(report?.public);
  rating = report?.rating || 0;
  paintStars();
  dropNewPictures();
  picState = (report?.pictures || []).map((url) => ({ url }));
  paintPics();

  // The account's Graph sessions, to tie the report to one.
  const select = form.elements.experience;
  select.replaceChildren(new Option("None", "0"));
  try {
    (await experiences()).forEach((e) => {
      const subs = sessionSubstances(e);
      select.append(new Option(`${dayLabel(e.startedAt)} · ${subs.length > 60 ? subs.slice(0, 57) + "…" : subs}`, String(e.id)));
    });
  } catch (_) {
    // Sessions are optional here.
  }
  select.value = String(report?.experienceId || 0);
  if (select.value !== String(report?.experienceId || 0)) select.value = "0";

  const dlg = $("repDlg");
  if (!dlg.open) dlg.showModal();
  form.elements.body.style.height = "";
  fitBody();
  form.scrollTop = 0;
  (report ? form.elements.body : form.elements.title).focus({ preventScroll: true });
}

$("repForm").elements.experience.addEventListener("change", async (event) => {
  const id = Number(event.target.value);
  if (!id) return;
  const e = (await experiences()).find((x) => x.id === id);
  if (!e) return;
  const form = $("repForm");
  form.elements.day.value = isoDay(e.startedAt);
  if (!form.elements.substances.value.trim()) form.elements.substances.value = sessionSubstances(e);
});

const closeReport = () => $("repDlg").close();
$("repClose").addEventListener("click", closeReport);
$("repCancel").addEventListener("click", closeReport);
$("repDlg").addEventListener("close", () => {
  dropNewPictures();
  const back = backToReader && editing;
  backToReader = false;
  // Cancel from Edit goes back to reading the report.
  if (back && !$("repDlg").dataset.saved) {
    const r = reports.find((x) => x.id === editing.id);
    if (r) openReader({ ...r, mine: true });
  }
  delete $("repDlg").dataset.saved;
});

$("repForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const [y, m, d] = form.elements.day.value.split("-").map(Number);
  const report = {
    id: editing?.id || 0,
    experienceId: Number(form.elements.experience.value) || 0,
    title: form.elements.title.value,
    substances: form.elements.substances.value,
    setting: form.elements.setting.value,
    body: form.elements.body.value,
    rating,
    happenedAt: y ? new Date(y, m - 1, d, 12).getTime() : Date.now(),
    public: form.elements.public.checked,
    keep: picState.filter((p) => !p.file).map((p) => p.url),
  };
  const save = $("repSave");
  save.disabled = true;
  save.textContent = picState.some((p) => p.file) ? "Uploading…" : "Saving…";
  try {
    // Photos are made smaller (and lose their location data) before they go up.
    const body = new FormData();
    body.append("report", JSON.stringify(report));
    for (const p of picState.filter((x) => x.file)) {
      const small = await window.xnShrinkPicture(p.file, [1600, 1600]);
      body.append("image", small, small === p.file ? p.file.name : "picture.jpg");
    }
    const res = await fetch("/notes/reports", { method: "POST", body });
    if (res.status === 401) {
      location.href = "/Main?next=" + encodeURIComponent(location.pathname + location.hash);
      throw new Error("Log in again.");
    }
    if (!res.ok) throw new Error((await res.text()).trim() || "Couldn't save that report. Try again.");
    const saved = await res.json();
    reports = [saved, ...reports.filter((r) => r.id !== saved.id)].sort((a, b) => b.happenedAt - a.happenedAt || b.id - a.id);
    renderReports();
    const reopen = backToReader;
    $("repDlg").dataset.saved = "1";
    closeReport();
    toast(saved.public ? "Report saved. Everyone can read it under Public reports." : editing ? "Report saved." : "Report added.");
    // The public list shows it (or drops it) the next time it opens.
    loaded.public = false;
    if (reopen) openReader({ ...saved, mine: true });
  } catch (error) {
    $("repError").textContent = error.message;
    $("repError").hidden = false;
  } finally {
    save.disabled = false;
    save.textContent = "Save";
  }
});

$("repDelete").addEventListener("click", async (event) => {
  const b = event.currentTarget;
  if (!editing) return;
  if (!b.classList.contains("is-armed")) {
    b.classList.add("is-armed");
    b.textContent = "Delete for good?";
    return;
  }
  try {
    await api("/notes/reports", { id: editing.id, delete: true });
    reports = reports.filter((r) => r.id !== editing.id);
    pubItems = pubItems.filter((r) => r.id !== editing.id);
    renderReports();
    if (loaded.public) renderPublic();
    $("repDlg").dataset.saved = "1";
    closeReport();
    toast("Report deleted.");
  } catch (error) {
    toast(error.message, true);
  }
});

// ---------------------------------------------------------------- public reports

let pubItems = [];
let pubMore = false;

async function loadPublic({ older = false } = {}) {
  const last = pubItems[pubItems.length - 1];
  const url = "/notes/reports/public" + (older && last ? `?before=${last.happenedAt}_${last.id}` : "");
  $("pubMore").disabled = true;
  try {
    const data = await api(url);
    pubItems = older ? [...pubItems, ...(data.items || [])] : data.items || [];
    pubMore = Boolean(data.more);
    renderPublic();
  } catch (error) {
    $("pubList").innerHTML = '<p class="nt-empty"></p>';
    $("pubList").firstChild.textContent = error.message;
  } finally {
    $("pubMore").disabled = false;
  }
}

function authorChip(a) {
  const span = document.createElement("span");
  span.className = "nt-author-chip";
  const img = document.createElement("img");
  img.alt = "";
  img.src = a.avatar || "/profiles/Default/default.png";
  img.loading = "lazy";
  img.addEventListener("error", () => (img.style.visibility = "hidden"), { once: true });
  const name = document.createElement("span");
  name.textContent = a.name;
  paintName(name, a);
  span.append(img, name);
  return span;
}

function renderPublic() {
  const box = $("pubList");
  const q = $("pubFind").value.trim().toLowerCase();
  box.replaceChildren();
  $("pubMore").hidden = !pubMore;
  if (!pubItems.length) {
    box.innerHTML = '<p class="nt-empty">No public trip reports yet. Turn on Public when you save one of yours and it shows here.</p>';
    return;
  }
  const list = pubItems.filter((r) => !q || [r.title, r.substances, r.setting, r.body, r.author.name].some((v) => (v || "").toLowerCase().includes(q)));
  if (!list.length) {
    box.innerHTML = '<p class="nt-empty">Nothing matches that.</p>';
    return;
  }
  list.forEach((r) => box.append(reportCard(r, { author: r.author })));
}
$("pubFind").addEventListener("input", renderPublic);
$("pubMore").addEventListener("click", () => loadPublic({ older: true }));
$("pubList").addEventListener("click", (event) => {
  const card = event.target.closest(".nt-report");
  if (card) openReader(pubItems.find((r) => r.id === Number(card.dataset.id)));
});

// ---------------------------------------------------------------- reading a report
// The report on the left, its comments in a card on the right (under it on
// phones), and the like button under the report.

let reading = null; // the report open in the reader
let readSeq = 0;

/** Keeps both lists in step after a like, a comment or an edit. */
function patchReport(id, fields) {
  [reports, pubItems].forEach((list) => list.forEach((r) => r.id === id && Object.assign(r, fields)));
  if (reports.length) renderReports();
  if (pubItems.length) renderPublic();
}

function setReportParam(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("report", String(id));
  else url.searchParams.delete("report");
  history.replaceState(null, "", url);
}

function openReader(r) {
  if (!r) return;
  const mine = r.mine ?? reports.some((x) => x.id === r.id);
  reading = { likers: [], ...r, mine };
  const seq = ++readSeq;
  paintReader();
  $("talkList").replaceChildren(talkNote("Loading comments…"));
  $("talkCount").textContent = "";
  $("talkNote").hidden = true;
  $("talkForm").hidden = !reading.public;
  $("talkText").value = "";
  growTalk();
  const dlg = $("readDlg");
  if (!dlg.open) dlg.showModal();
  dlg.querySelector(".nt-read-main").scrollTop = 0;
  $("readClose").focus({ preventScroll: true });
  setReportParam(r.id);
  loadTalk(seq);
}

function paintReader() {
  const r = reading;
  const author = $("readAuthor");
  author.hidden = r.mine || !r.author;
  if (!author.hidden) {
    author.replaceChildren(authorChip(r.author));
    author.href = profileLink(r.author.name);
  }
  $("readMine").hidden = !r.mine;
  $("readMine").textContent = r.public ? "Your report · Public" : "Your report · Only you";
  $("readEdit").hidden = !r.mine;
  $("readDay").textContent = dayLabel(r.happenedAt);
  $("readTitle").textContent = r.title || "Untitled report";
  $("readStars").textContent = r.rating ? stars(r.rating) : "";
  $("readStars").hidden = !r.rating;
  const facts = $("readFacts");
  facts.replaceChildren();
  [["Substances", r.substances], ["Set and setting", r.setting]].forEach(([k, v]) => {
    if (!v) return;
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    facts.append(dt, dd);
  });
  facts.hidden = !facts.children.length;
  paintGallery($("readPics"), r.pictures || []);
  $("readBody").textContent = r.body || "";
  $("readBody").hidden = !r.body;
  paintLikes();
}

function paintGallery(box, pics) {
  box.replaceChildren();
  box.hidden = !pics.length;
  box.dataset.count = String(Math.min(pics.length, 5));
  pics.forEach((url, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "nt-pic";
    b.setAttribute("aria-label", `Open picture ${i + 1} of ${pics.length}`);
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => b.classList.add("is-broken"), { once: true });
    b.append(img);
    b.addEventListener("click", () => window.xnViewer && window.xnViewer.open(pics, i));
    box.append(b);
  });
}

/** "Liked by you, anna and 3 others" */
function likersText(r) {
  const total = r.likes || 0;
  if (!total) return r.mine && r.public ? "No likes yet." : "";
  const names = (r.likers || []).map((p) => p.name);
  const shown = [...(r.liked ? ["you"] : []), ...names].slice(0, r.liked ? 3 : 2);
  const rest = total - shown.length;
  if (!shown.length) return `${total} ${total === 1 ? "like" : "likes"}`;
  if (rest > 0) return `Liked by ${shown.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
  return "Liked by " + (shown.length > 1 ? shown.slice(0, -1).join(", ") + " and " + shown[shown.length - 1] : shown[0]);
}

function paintLikes() {
  const r = reading;
  const like = $("readLike");
  like.hidden = r.mine || !r.public;
  like.setAttribute("aria-pressed", String(!!r.liked));
  like.querySelector(".nt-like-label").textContent = r.liked ? "Liked" : "Like";
  like.querySelector(".nt-like-count").textContent = r.likes ? String(r.likes) : "";
  like.setAttribute("aria-label", `${r.liked ? "Unlike" : "Like"} this report${r.likes ? `, ${r.likes} ${r.likes === 1 ? "like" : "likes"}` : ""}`);
  const who = $("readLikers");
  who.replaceChildren();
  const text = likersText(r);
  if (r.mine && r.likes) who.insertAdjacentHTML("afterbegin", HEART);
  who.append(text);
  who.hidden = !text;
}

function talkNote(text) {
  const li = document.createElement("li");
  li.className = "nt-talk-empty";
  li.textContent = text;
  return li;
}

async function loadTalk(seq) {
  const r = reading;
  try {
    const data = await api("/notes/reports/comments?report=" + encodeURIComponent(r.id));
    if (seq !== readSeq) return;
    const comments = data.comments || [];
    Object.assign(r, { likes: data.likes, liked: data.liked, likers: data.likers || [], public: data.public, comments: comments.length });
    paintReader();
    renderTalk(comments);
    patchReport(r.id, { likes: r.likes, liked: r.liked, comments: r.comments, public: r.public });
  } catch (error) {
    if (seq !== readSeq) return;
    $("talkList").replaceChildren(talkNote(error.message));
    $("talkForm").hidden = true;
  }
}

function renderTalk(comments) {
  const r = reading;
  const list = $("talkList");
  list.replaceChildren(...comments.map(commentItem));
  if (!comments.length && r.public) list.append(talkNote(r.mine ? "No comments yet." : "No comments yet. Write the first one."));
  $("talkCount").textContent = comments.length ? String(comments.length) : "";
  $("talkForm").hidden = !r.public;
  const note = $("talkNote");
  note.hidden = r.public;
  note.textContent = r.public ? "" : "Only you can see this report. Turn on Public under Edit so others can like it and comment.";
}

function face(who) {
  const span = document.createElement("span");
  span.className = "nt-face";
  span.setAttribute("aria-hidden", "true");
  if (who.avatar) {
    const img = document.createElement("img");
    img.src = who.avatar;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => img.replaceWith(who.initial || "?"), { once: true });
    span.append(img);
  } else {
    span.textContent = who.initial || (who.name || "?").charAt(0).toUpperCase();
  }
  return span;
}

function commentItem(c) {
  const li = document.createElement("li");
  li.className = "nt-comment";
  const pic = document.createElement("a");
  pic.className = "nt-comment-face";
  pic.href = profileLink(c.author.name);
  pic.setAttribute("aria-label", c.author.name + "'s profile");
  pic.append(face(c.author));
  const main = document.createElement("div");
  main.className = "nt-comment-main";
  const head = document.createElement("div");
  head.className = "nt-comment-head";
  const name = document.createElement("a");
  name.className = "nt-comment-name";
  name.href = profileLink(c.author.name);
  name.textContent = c.author.name;
  paintName(name, c.author);
  head.append(name);
  const badge = rankBadge(c.author);
  if (badge) head.append(badge);
  const when = document.createElement("time");
  when.className = "nt-time";
  when.dateTime = new Date(c.createdAt).toISOString();
  when.title = new Date(c.createdAt).toLocaleString();
  when.textContent = postTime(c.createdAt);
  head.append(when);
  if (c.canDelete) head.append(commentDelete(c, li));
  const body = document.createElement("p");
  body.className = "nt-comment-body";
  body.textContent = c.body;
  main.append(head, body);
  li.append(pic, main);
  return li;
}

/** Delete asks once ("Delete?") before it removes the comment. */
function commentDelete(c, li) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "nt-comment-del";
  b.textContent = "Delete";
  let armed = null;
  const disarm = () => {
    clearTimeout(armed);
    armed = null;
    b.classList.remove("is-armed");
    b.textContent = "Delete";
  };
  b.addEventListener("blur", disarm);
  b.addEventListener("click", async () => {
    if (!armed) {
      b.classList.add("is-armed");
      b.textContent = "Delete?";
      armed = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    b.disabled = true;
    try {
      await api("/notes/reports/comments", { action: "delete", id: c.id });
      li.remove();
      commentsChanged(-1);
    } catch (error) {
      b.disabled = false;
      toast(error.message, true);
    }
  });
  return b;
}

function commentsChanged(by) {
  if (!reading) return;
  reading.comments = Math.max(0, (reading.comments || 0) + by);
  $("talkCount").textContent = reading.comments ? String(reading.comments) : "";
  if (!reading.comments && reading.public) $("talkList").append(talkNote("No comments yet."));
  patchReport(reading.id, { comments: reading.comments });
}

const talkText = $("talkText");
function growTalk() {
  talkText.style.height = "auto";
  talkText.style.height = Math.max(44, Math.min(talkText.scrollHeight + 2, 200)) + "px";
  $("talkSend").disabled = !talkText.value.trim();
}
talkText.addEventListener("input", growTalk);
talkText.addEventListener("keydown", (event) => {
  // Enter sends on computers; phones keep Enter for new lines.
  if (event.key === "Enter" && !event.shiftKey && (!touch.matches || event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    $("talkForm").requestSubmit();
  }
});
$("talkForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const r = reading;
  if (!r || !talkText.value.trim()) return;
  $("talkSend").disabled = true;
  talkText.disabled = true;
  try {
    const c = await api("/notes/reports/comments", { action: "add", report: r.id, body: talkText.value });
    if (reading !== r) return;
    const list = $("talkList");
    list.querySelectorAll(".nt-talk-empty").forEach((n) => n.remove());
    list.append(commentItem(c));
    list.lastElementChild.scrollIntoView({ block: "nearest" });
    talkText.value = "";
    commentsChanged(1);
  } catch (error) {
    toast(error.message, true);
  } finally {
    talkText.disabled = false;
    growTalk();
    if (reading === r) talkText.focus({ preventScroll: true });
  }
});

let liking = false;
$("readLike").addEventListener("click", async () => {
  const r = reading;
  if (!r || r.mine || liking) return;
  const before = { likes: r.likes || 0, liked: !!r.liked };
  const next = !before.liked;
  liking = true;
  Object.assign(r, { liked: next, likes: Math.max(0, before.likes + (next ? 1 : -1)) });
  paintLikes();
  const like = $("readLike");
  if (next) {
    like.classList.remove("is-pop");
    void like.offsetWidth;
    like.classList.add("is-pop");
  }
  try {
    const data = await api("/notes/reports/like", { report: r.id, liked: next });
    Object.assign(r, { likes: data.likes, liked: data.liked, likers: data.likers || r.likers });
  } catch (error) {
    Object.assign(r, before);
    toast(error.message, true);
  } finally {
    liking = false;
    if (reading === r) paintLikes();
    patchReport(r.id, { likes: r.likes, liked: r.liked });
  }
});

$("readEdit").addEventListener("click", () => {
  const r = reading && reports.find((x) => x.id === reading.id);
  if (!r) return;
  $("readDlg").close();
  openReport(r, { fromReader: true });
});
$("readClose").addEventListener("click", () => $("readDlg").close());
$("readDlg").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
$("readDlg").addEventListener("close", () => {
  reading = null;
  readSeq++;
  setReportParam(0);
});

// /Notes?report=<id> (the comment letter links here) opens that report.
async function openLinkedReport() {
  const id = Number(new URLSearchParams(location.search).get("report"));
  if (!id) return;
  try {
    const item = await api("/notes/reports/one?id=" + id);
    showTab(item.mine ? "reports" : "public");
    openReader(item);
  } catch (error) {
    setReportParam(0);
    toast(error.message, true);
  }
}

// ---------------------------------------------------------------- notepad

let notes = [];
let current = null; // the open note (a copy that is edited)
let saveTimer = null;
let saving = Promise.resolve();
const MONO_KEY = "xn_pad_mono";

async function loadPad() {
  try {
    notes = (await api("/notes/pad")).items || [];
  } catch (error) {
    $("padList").innerHTML = '<li class="nt-empty"></li>';
    $("padList").firstChild.textContent = error.message;
    $("padEditor").hidden = true;
    return;
  }
  let mono = false;
  try { mono = localStorage.getItem(MONO_KEY) === "1"; } catch {}
  setMono(mono);
  renderPadList();
  // Phones start on the list (like the iPhone Notes app); wider screens
  // open the newest note beside it.
  if (notes.length && !matchMedia("(max-width: 760px)").matches) openNote(notes[0].id, { focus: false });
  else showPadEmpty();
}

function firstLine(text) {
  return (text || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
}
const noteTitle = (n) => n.title || firstLine(n.body).slice(0, 80) || "New note";

function renderPadList() {
  const q = $("padFind").value.trim().toLowerCase();
  const ul = $("padList");
  ul.replaceChildren();
  const list = notes.filter((n) => !q || (n.title + "\n" + n.body).toLowerCase().includes(q));
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "nt-empty";
    li.textContent = notes.length ? "Nothing matches that." : "No notes yet.";
    ul.append(li);
    return;
  }
  list.forEach((n) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "nt-pad-item";
    b.dataset.id = String(n.id);
    if (current && current.id === n.id) b.setAttribute("aria-current", "true");
    const title = document.createElement("strong");
    if (n.pinned) title.innerHTML = '<svg viewBox="0 0 24 24" aria-label="Pinned"><path d="M9 3h6l-1 6 4 4H6l4-4zM11 13h2v8h-2z"/></svg>';
    title.append(noteTitle(n));
    const sub = document.createElement("span");
    const rest = n.title ? firstLine(n.body) : firstLine((n.body || "").split("\n").slice(1).join("\n"));
    sub.textContent = `${ago(n.updatedAt)}${rest ? " · " + rest : ""}`;
    b.append(title, sub);
    li.append(b);
    ul.append(li);
  });
}

function showPadEmpty() {
  current = null;
  $("padTitle").value = "";
  $("padText").value = "";
  $("padTitle").disabled = true;
  $("padText").disabled = true;
  $("padText").placeholder = "Press + to start a note.";
  $("padSaved").textContent = "";
  $("padFoot").textContent = "";
  $("pad").classList.remove("is-editing");
}

function openNote(id, { focus = true } = {}) {
  flushNote();
  const n = notes.find((x) => x.id === id);
  if (!n) return;
  current = { ...n };
  $("padTitle").disabled = false;
  $("padText").disabled = false;
  $("padText").placeholder = "Write anything…";
  $("padTitle").value = n.title;
  $("padText").value = n.body;
  $("padPin").setAttribute("aria-pressed", String(!!n.pinned));
  disarmDelete();
  $("padSaved").textContent = `Saved ${ago(n.updatedAt)}`;
  countWords();
  $("pad").classList.add("is-editing");
  renderPadList();
  if (focus) $("padText").focus();
}

function countWords() {
  const text = $("padText").value;
  const words = (text.match(/\S+/g) || []).length;
  $("padFoot").textContent = `${words} ${words === 1 ? "word" : "words"} · ${text.length} characters`;
}

function noteChanged() {
  if (!current) return;
  current.title = $("padTitle").value;
  current.body = $("padText").value;
  $("padSaved").textContent = "Saving…";
  countWords();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushNote, 600);
}

function flushNote() {
  if (!saveTimer || !current) return saving;
  clearTimeout(saveTimer);
  saveTimer = null;
  const snapshot = { ...current };
  saving = saving.then(async () => {
    try {
      const saved = await api("/notes/pad", snapshot);
      notes = notes.map((n) => (n.id === saved.id ? saved : n));
      sortNotes();
      if (current && current.id === saved.id) $("padSaved").textContent = "Saved";
      renderPadList();
    } catch (error) {
      if (current && current.id === snapshot.id) $("padSaved").textContent = "Not saved: " + error.message;
    }
  });
  return saving;
}

const sortNotes = () => notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);

$("padTitle").addEventListener("input", noteChanged);
$("padText").addEventListener("input", noteChanged);
// Tab types a tab in the notepad instead of leaving it.
$("padText").addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  const t = event.target;
  t.setRangeText("\t", t.selectionStart, t.selectionEnd, "end");
  noteChanged();
});
$("padTitle").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    $("padText").focus();
  }
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && !$("panePad").hidden) {
    event.preventDefault();
    flushNote();
  }
});
window.addEventListener("pagehide", () => {
  if (!saveTimer || !current) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  // keepalive lets the last few keystrokes reach the server as the page closes.
  fetch("/notes/pad", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(current) });
});

$("padList").addEventListener("click", (event) => {
  const b = event.target.closest(".nt-pad-item");
  if (b) openNote(Number(b.dataset.id));
});
$("padFind").addEventListener("input", renderPadList);
$("padNew").addEventListener("click", async () => {
  await flushNote();
  try {
    const saved = await api("/notes/pad", { id: 0, title: "", body: "" });
    notes.unshift(saved);
    sortNotes();
    $("padFind").value = "";
    openNote(saved.id, { focus: false });
    $("padTitle").focus();
  } catch (error) {
    toast(error.message, true);
  }
});
$("padBack").addEventListener("click", () => {
  flushNote();
  $("pad").classList.remove("is-editing");
  renderPadList();
});
$("padPin").addEventListener("click", () => {
  if (!current) return;
  current.pinned = !current.pinned;
  $("padPin").setAttribute("aria-pressed", String(current.pinned));
  noteChanged();
  flushNote();
});

function setMono(on) {
  $("padText").classList.toggle("is-mono", on);
  $("padMono").setAttribute("aria-pressed", String(on));
  try { localStorage.setItem(MONO_KEY, on ? "1" : "0"); } catch {}
}
$("padMono").addEventListener("click", () => setMono(!$("padText").classList.contains("is-mono")));

function disarmDelete() {
  $("padDelete").classList.remove("is-armed");
  $("padDelete").title = "Delete note";
}
$("padDelete").addEventListener("click", async () => {
  if (!current) return;
  const b = $("padDelete");
  if (!b.classList.contains("is-armed")) {
    b.classList.add("is-armed");
    b.title = "Press again to delete";
    toast("Press the bin again to delete this note.");
    setTimeout(disarmDelete, 4000);
    return;
  }
  const id = current.id;
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    await api("/notes/pad", { id, delete: true });
    notes = notes.filter((n) => n.id !== id);
    current = null;
    renderPadList();
    if (notes.length && !matchMedia("(max-width: 760px)").matches) openNote(notes[0].id, { focus: false });
    else showPadEmpty();
    toast("Note deleted.");
  } catch (error) {
    toast(error.message, true);
  }
});

// ---------------------------------------------------------------- start

showTab(location.hash.slice(1) || "doses", { push: false });
window.addEventListener("hashchange", () => showTab(location.hash.slice(1) || "doses", { push: false }));
openLinkedReport();
