// ============================================================
// notes.js — the Notes page (/Notes).
//  - By substance: the notes written on Graph doses (/experiences),
//    grouped by substance A–Z, newest first inside each.
//  - Trip reports: longer write-ups, optionally tied to a Graph
//    session (/notes/reports).
//  - Notepad: free notes that save as you type (/notes/pad).
// ============================================================

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

async function loadReports() {
  try {
    reports = (await api("/notes/reports")).items || [];
    renderReports();
  } catch (error) {
    $("repList").innerHTML = '<p class="nt-empty"></p>';
    $("repList").firstChild.textContent = error.message;
  }
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
  list.forEach((r) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "xn-card nt-report";
    card.dataset.id = String(r.id);
    const day = document.createElement("span");
    day.className = "nt-report-day";
    day.textContent = dayLabel(r.happenedAt);
    const title = document.createElement("h3");
    title.className = "nt-report-title";
    title.textContent = r.title || "Untitled report";
    card.append(day, title);
    if (r.public) {
      const tag = document.createElement("span");
      tag.className = "nt-tag";
      tag.textContent = "Public";
      day.append(tag);
    }
    if (r.rating) {
      const stars = document.createElement("span");
      stars.className = "nt-report-stars";
      stars.textContent = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
      stars.setAttribute("aria-label", `${r.rating} of 5`);
      card.append(stars);
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
    box.append(card);
  });
}
$("repFind").addEventListener("input", renderReports);
$("repList").addEventListener("click", (event) => {
  const card = event.target.closest(".nt-report");
  if (card) openReport(reports.find((r) => r.id === Number(card.dataset.id)));
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

async function openReport(report) {
  editing = report;
  const form = $("repForm");
  form.reset();
  $("repError").hidden = true;
  $("repDelete").hidden = !report;
  $("repDelete").textContent = "Delete";
  $("repDelete").classList.remove("is-armed");
  $("repDlgTitle").textContent = report ? "Trip report" : "New trip report";
  form.elements.title.value = report?.title || "";
  form.elements.day.value = isoDay(report?.happenedAt || Date.now());
  form.elements.day.max = isoDay(Date.now());
  form.elements.substances.value = report?.substances || "";
  form.elements.setting.value = report?.setting || "";
  form.elements.body.value = report?.body || "";
  form.elements.public.checked = Boolean(report?.public);
  rating = report?.rating || 0;
  paintStars();

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
  (report ? form.elements.body : form.elements.title).focus();
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

$("repForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const [y, m, d] = form.elements.day.value.split("-").map(Number);
  const body = {
    id: editing?.id || 0,
    experienceId: Number(form.elements.experience.value) || 0,
    title: form.elements.title.value,
    substances: form.elements.substances.value,
    setting: form.elements.setting.value,
    body: form.elements.body.value,
    rating,
    happenedAt: y ? new Date(y, m - 1, d, 12).getTime() : Date.now(),
    public: form.elements.public.checked,
  };
  $("repSave").disabled = true;
  try {
    const saved = await api("/notes/reports", body);
    reports = [saved, ...reports.filter((r) => r.id !== saved.id)].sort((a, b) => b.happenedAt - a.happenedAt || b.id - a.id);
    renderReports();
    closeReport();
    toast(saved.public ? "Report saved. Everyone can read it under Public reports." : editing ? "Report saved." : "Report added.");
    // The public list shows it (or drops it) the next time it opens.
    loaded.public = false;
  } catch (error) {
    $("repError").textContent = error.message;
    $("repError").hidden = false;
  } finally {
    $("repSave").disabled = false;
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
    renderReports();
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
  span.append(img, a.name);
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
  list.forEach((r) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "xn-card nt-report";
    card.dataset.id = String(r.id);
    const day = document.createElement("span");
    day.className = "nt-report-day";
    day.textContent = dayLabel(r.happenedAt);
    const title = document.createElement("h3");
    title.className = "nt-report-title";
    title.textContent = r.title || "Untitled report";
    card.append(authorChip(r.author), day, title);
    if (r.rating) {
      const stars = document.createElement("span");
      stars.className = "nt-report-stars";
      stars.textContent = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
      stars.setAttribute("aria-label", `${r.rating} of 5`);
      card.append(stars);
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
    box.append(card);
  });
}
$("pubFind").addEventListener("input", renderPublic);
$("pubMore").addEventListener("click", () => loadPublic({ older: true }));
$("pubList").addEventListener("click", (event) => {
  const card = event.target.closest(".nt-report");
  if (card) openPublic(pubItems.find((r) => r.id === Number(card.dataset.id)));
});

function openPublic(r) {
  if (!r) return;
  const author = $("pubAuthor");
  author.replaceChildren(authorChip(r.author));
  author.href = "/u/" + encodeURIComponent(r.author.name);
  $("pubDay").textContent = dayLabel(r.happenedAt);
  $("pubTitle").textContent = r.title || "Untitled report";
  $("pubStars").textContent = r.rating ? "★".repeat(r.rating) + "☆".repeat(5 - r.rating) : "";
  $("pubStars").hidden = !r.rating;
  const facts = $("pubFacts");
  facts.replaceChildren();
  [["Substances", r.substances], ["Set and setting", r.setting]].forEach(([k, v]) => {
    if (!v) return;
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    facts.append(dt, dd);
  });
  $("pubBody").textContent = r.body || "";
  $("pubDlg").showModal();
  $("pubClose").focus();
}
$("pubClose").addEventListener("click", () => $("pubDlg").close());
$("pubDlg").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});

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
