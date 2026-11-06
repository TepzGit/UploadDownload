// ============================================================
// pilldb.js: the Pill Database page (/Pills, mommy 2026-11-05).
// Members add pictures of pills with what they are said to contain;
// an admin checks each one (pending, approved, rejected). Contents are
// always shown as reported, apart from what an admin marks lab confirmed.
// Server: /pilldb/api/list, item, save, action (UploadDownload.go).
// ============================================================
import { avatar, paintName, profileLink, rankBadge, postTime } from "/forum.js";

const $ = (id) => document.getElementById(id);
const toast = (msg, bad) => window.xnToast && window.xnToast(msg, bad);
const STATUS = { pending: "Waiting for a check", approved: "Approved", rejected: "Rejected" };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

const state = { view: "all", items: [], offset: 0, more: false, admin: false, choices: null, open: null, category: "" };
const grid = $("pdGrid");

async function api(path, options) {
  const res = await fetch(path, { credentials: "same-origin", ...options });
  const kind = res.headers.get("content-type") || "";
  const body = kind.includes("json") ? await res.json().catch(() => ({})) : { error: (await res.text()).trim() };
  if (res.status === 401) throw Object.assign(new Error("Log in again first."), { body });
  if (!res.ok) throw Object.assign(new Error(body.error || "Something went wrong. Try again."), { body });
  return body;
}

// ---------------- List ----------------
function query(offset) {
  const p = new URLSearchParams();
  const q = $("pdQ").value.trim();
  if (q) p.set("q", q);
  for (const [id, key] of [["pdColor", "color"], ["pdShape", "shape"], ["pdKind", "form"]]) if ($(id).value) p.set(key, $(id).value);
  if ($("pdLab").checked) p.set("lab", "1");
  if (state.category) p.set("category", state.category);
  if (state.view === "mine") p.set("mine", "1");
  if (state.view === "check") p.set("status", $("pdStatus").value);
  if (offset) p.set("offset", String(offset));
  return "/pilldb/api/list?" + p;
}

let asking = 0;
async function load(append) {
  const ticket = ++asking;
  grid.setAttribute("aria-busy", "true");
  try {
    const data = await api(query(append ? state.offset : 0));
    if (ticket !== asking) return;
    fillChoices(data);
    state.admin = !!data.admin;
    $("tabCheck").hidden = !state.admin;
    $("pdLabFields").hidden = !state.admin;
    $("pendingCount").textContent = data.pending ? String(data.pending) : "";
    state.items = append ? state.items.concat(data.items) : data.items;
    state.offset = state.items.length;
    state.more = !!data.more;
    draw(data.total);
  } catch (e) {
    if (ticket === asking) toast(e.message, true);
  } finally {
    if (ticket === asking) grid.removeAttribute("aria-busy");
  }
}

// Categories (mommy 2026-11-06): worked out on the server from what each
// pill is said to contain; a row of tiles filters by one.
const CAT_NAMES = { stimulant: "Stimulants", opioid: "Opioids", benzodiazepine: "Benzos", sleep: "Sleeping pills", gabapentinoid: "Gabapentinoids", entactogen: "Ecstasy", psychedelic: "Psychedelics", dissociative: "Dissociatives", antidepressant: "Antidepressants", antipsychotic: "Antipsychotics", antihistamine: "Antihistamines", depressant: "Depressants" };
const CAT_ICONS = { sleep: "zdrug", entactogen: "xtc", benzodiazepine: "bar", gabapentinoid: "capsule", antidepressant: "oblong", antihistamine: "syrup" };
const ALL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/></svg>';
function catIcon(cat) {
  const C = window.xnClass;
  if (!C || !cat) return null;
  const key = CAT_ICONS[cat] && C.LABELS && C.LABELS[CAT_ICONS[cat]] ? CAT_ICONS[cat] : C.keyForClass(cat);
  return key ? C.icon(key, "pd-cat-icon") : null;
}
function fillCats(list) {
  const row = $("pdCats");
  if (row.childElementCount || !list || !list.length) return;
  const tile = (cat, label) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pd-cat";
    b.dataset.cat = cat;
    b.setAttribute("aria-pressed", String(cat === state.category));
    const ic = document.createElement("span");
    ic.className = "pd-cat-ic";
    const icon = catIcon(cat);
    if (icon) ic.append(icon); else ic.innerHTML = ALL_ICON;
    const name = document.createElement("span");
    name.textContent = label;
    b.append(ic, name);
    b.addEventListener("click", () => {
      state.category = cat;
      row.querySelectorAll(".pd-cat").forEach((t) => t.setAttribute("aria-pressed", String(t === b)));
      load(false);
    });
    return b;
  };
  row.append(tile("", "All"), ...list.map((c) => tile(c, CAT_NAMES[c] || cap(c))));
  row.hidden = false;
}

function fillChoices(data) {
  fillCats(data.categories);
  if (state.choices) return;
  state.choices = { color: data.colors || [], shape: data.shapes || [], form: data.forms || [] };
  const add = (select, list) => select.append(...list.map((v) => new Option(cap(v), v)));
  add($("pdColor"), state.choices.color);
  add($("pdShape"), state.choices.shape);
  add($("pdKind"), state.choices.form);
  const form = $("pdForm");
  add(form.elements.color, state.choices.color);
  add(form.elements.shape, state.choices.shape);
  add(form.elements.form, state.choices.form);
}

function chip(text, kind) {
  const s = document.createElement("span");
  s.className = "pd-chip pd-chip-" + kind;
  s.textContent = text;
  return s;
}

function uploaderLine(who, small) {
  const a = document.createElement("a");
  a.className = "pd-who" + (small ? " pd-who-sm" : "");
  a.href = profileLink(who.name);
  a.append(avatar(who, "pd-face"));
  const name = document.createElement("span");
  name.className = "pd-who-name";
  name.textContent = who.name;
  paintName(name, who);
  a.append(name);
  if (!small) {
    const badge = rankBadge(who);
    if (badge) a.append(badge);
  }
  return a;
}

function card(p) {
  const li = document.createElement("li");
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pd-card";
  b.dataset.id = String(p.id);
  b.setAttribute("aria-label", `${p.brand} ${p.strength}, said to contain ${p.contents}. Open details`);
  const pic = document.createElement("span");
  pic.className = "pd-card-pic";
  const img = document.createElement("img");
  img.src = p.picture;
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  pic.append(img);
  if (p.status !== "approved") pic.append(chip(p.status === "pending" ? "Waiting" : "Rejected", p.status));
  const text = document.createElement("span");
  text.className = "pd-card-text";
  const title = document.createElement("strong");
  title.className = "pd-card-title";
  title.textContent = p.brand + (p.strength ? " " + p.strength : "");
  const contents = document.createElement("span");
  contents.className = "pd-card-contents";
  contents.textContent = p.labContents ? p.labContents : p.contents;
  const tag = p.labContents ? chip("Lab confirmed", "lab") : chip("Reported", "reported");
  const tags = document.createElement("span");
  tags.className = "pd-card-tags";
  tags.append(tag);
  if (p.category) {
    const cat = chip(CAT_NAMES[p.category] || cap(p.category), "cat");
    const icon = catIcon(p.category);
    if (icon) cat.prepend(icon);
    tags.append(cat);
  }
  text.append(title, contents, tags);
  b.append(pic, text);
  li.append(b, uploaderLine(p.uploader, true));
  return li;
}

function draw(total) {
  grid.replaceChildren(...state.items.map(card));
  const filtered = state.category || $("pdQ").value.trim() || $("pdColor").value || $("pdShape").value || $("pdKind").value || $("pdLab").checked;
  $("pdCount").textContent = total ? (total === 1 ? "1 pill" : total + " pills") : "";
  const empty = $("pdEmpty");
  empty.hidden = state.items.length > 0;
  empty.textContent = filtered
    ? "No pills match that search."
    : state.view === "mine"
      ? "You haven't added a pill yet. Tap Add a pill to add your first."
      : state.view === "check"
        ? "Nothing to check here."
        : "No pills yet. Tap Add a pill to add the first.";
  $("pdMore").hidden = !state.more;
}

// ---------------- Detail ----------------
function row(label, value, cls) {
  if (!value) return null;
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  if (cls) dd.className = cls;
  return [dt, dd];
}

function openView(p) {
  state.open = p;
  const box = $("pdViewBody");
  const pic = document.createElement("button");
  pic.type = "button";
  pic.className = "pd-view-pic";
  pic.setAttribute("aria-label", "Show the picture full size");
  const img = document.createElement("img");
  img.src = p.picture;
  img.alt = `${p.brand} ${p.strength}`.trim();
  pic.append(img);
  pic.addEventListener("click", () => window.xnViewer && window.xnViewer.open([p.picture], 0));

  const main = document.createElement("div");
  main.className = "pd-view-main";
  const h = document.createElement("h2");
  h.className = "xn-h2 pd-view-title";
  h.id = "pdViewTitle";
  h.textContent = p.brand + (p.strength ? " " + p.strength : "");
  const chips = document.createElement("div");
  chips.className = "pd-view-chips";
  if (p.status !== "approved") chips.append(chip(STATUS[p.status] || p.status, p.status));
  chips.append(p.labContents ? chip("Lab confirmed", "lab") : chip("Reported, not lab tested", "reported"));

  const said = document.createElement("div");
  said.className = "pd-said";
  const saidLabel = document.createElement("span");
  saidLabel.className = "xn-label";
  saidLabel.textContent = "Said to contain (reported by a member)";
  const saidText = document.createElement("p");
  saidText.textContent = p.contents;
  said.append(saidLabel, saidText);
  const blocks = [said];
  if (p.labContents) {
    const lab = document.createElement("div");
    lab.className = "pd-said pd-said-lab";
    const l = document.createElement("span");
    l.className = "xn-label";
    l.textContent = "Lab confirmed contents";
    const t = document.createElement("p");
    t.textContent = p.labContents;
    lab.append(l, t);
    if (p.labSource) {
      const s = document.createElement("small");
      s.textContent = "Source: " + p.labSource;
      lab.append(s);
    }
    blocks.push(lab);
  }

  const dl = document.createElement("dl");
  dl.className = "pd-facts";
  for (const r of [row("Imprint", p.imprint, "pd-imprint"), row("Color", cap(p.color)), row("Shape", cap(p.shape)), row("Form", cap(p.form)), row("Country", p.country)]) if (r) dl.append(...r);

  const note = document.createElement("p");
  note.className = "pd-view-notes";
  note.textContent = p.notes;
  note.hidden = !p.notes;

  const warn = document.createElement("p");
  warn.className = "pd-view-warn";
  warn.textContent = "A pill that looks like this can still hold something else. Only a lab test tells you what is in it.";

  const by = document.createElement("div");
  by.className = "pd-view-by";
  const when = document.createElement("small");
  when.textContent = "Added " + postTime(p.createdAt) + (p.updatedAt > p.createdAt + 60000 ? ", changed " + postTime(p.updatedAt) : "");
  by.append(uploaderLine(p.uploader, false), when);

  main.append(h, chips, ...blocks, dl, note, warn, by);
  if (p.modNote && (p.mine || state.admin)) {
    const m = document.createElement("p");
    m.className = "pd-modnote";
    m.textContent = "Admin note: " + p.modNote;
    main.append(m);
  }

  const acts = document.createElement("div");
  acts.className = "pd-view-acts";
  if (p.mine || state.admin) {
    acts.append(button("Edit", "", () => { $("pdView").close(); openEdit(p); }));
    acts.append(confirmButton("Delete", "Delete this pill?", async () => {
      await api("/pilldb/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: p.id }) });
      $("pdView").close();
      toast("Pill deleted.");
      load(false);
    }));
  }
  if (state.admin) {
    const mod = document.createElement("div");
    mod.className = "pd-mod";
    const noteIn = document.createElement("input");
    noteIn.className = "xn-input";
    noteIn.placeholder = "Note to the member (optional)";
    noteIn.maxLength = 300;
    noteIn.value = p.modNote || "";
    noteIn.setAttribute("aria-label", "Note to the member");
    const act = (action, label, primary) => button(label, primary ? "xn-btn-primary" : "", async () => {
      try {
        const next = await api("/pilldb/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id: p.id, note: noteIn.value }) });
        toast(action === "approve" ? "Approved." : action === "reject" ? "Rejected." : "Back to waiting.");
        openView(next);
        load(false);
      } catch (e) { toast(e.message, true); }
    });
    const btns = document.createElement("div");
    btns.className = "pd-mod-btns";
    if (p.status !== "approved") btns.append(act("approve", "Approve", true));
    if (p.status !== "rejected") btns.append(act("reject", "Reject"));
    if (p.status !== "pending") btns.append(act("pending", "Back to waiting"));
    mod.append(noteIn, btns);
    main.append(mod);
  }
  if (acts.childElementCount) main.append(acts);
  box.replaceChildren(pic, main);
  const dlg = $("pdView");
  if (!dlg.open) dlg.showModal();
}

function button(label, cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "xn-btn " + cls;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function confirmButton(label, ask, onConfirm) {
  let armed = 0;
  const b = button(label, "xn-btn-danger", async () => {
    if (!armed) {
      b.textContent = ask;
      armed = setTimeout(() => { armed = 0; b.textContent = label; }, 4000);
      return;
    }
    clearTimeout(armed);
    armed = 0;
    b.disabled = true;
    try { await onConfirm(); } catch (e) { b.disabled = false; b.textContent = label; toast(e.message, true); }
  });
  return b;
}

async function openById(id) {
  try { openView(await api("/pilldb/api/item?id=" + encodeURIComponent(id))); } catch (e) { toast(e.message, true); }
}

grid.addEventListener("click", (e) => {
  const b = e.target.closest(".pd-card");
  if (!b) return;
  const p = state.items.find((x) => String(x.id) === b.dataset.id);
  if (p) openView(p);
});

// ---------------- Add / edit ----------------
const form = $("pdForm");
let editing = null;
let picked = null;

function setPicture(url) {
  $("pdPicPreview").hidden = !url;
  if (url) $("pdPicPreview").src = url;
  $("pdPicText").hidden = !!url;
}

function openEdit(p) {
  editing = p || null;
  picked = null;
  form.reset();
  $("pdFormError").hidden = true;
  $("pdEditTitle").textContent = p ? "Change this pill" : "Add a pill";
  $("pdSave").textContent = state.admin ? "Save" : "Send for checking";
  if (p) for (const k of ["brand", "strength", "contents", "imprint", "color", "shape", "form", "country", "notes", "labContents", "labSource"]) if (form.elements[k]) form.elements[k].value = p[k] || "";
  setPicture(p ? p.picture : "");
  $("pdEdit").showModal();
  form.elements.brand.focus();
}

$("pdAdd").addEventListener("click", () => openEdit(null));
$("pdPicBtn").addEventListener("click", () => $("pdPicFile").click());
$("pdPicFile").addEventListener("change", () => {
  const f = $("pdPicFile").files[0];
  $("pdPicFile").value = "";
  if (!f) return;
  if (!/^image\/(jpeg|png|gif|webp)$/.test(f.type)) return showError("Use a JPG, PNG, GIF or WebP picture.");
  if (f.size > 10 * 1024 * 1024 && f.type !== "image/jpeg") return showError("The picture is too big. Use one under 10 MB.");
  picked = f;
  $("pdFormError").hidden = true;
  setPicture(URL.createObjectURL(f));
});

function showError(msg, dupe) {
  const box = $("pdFormError");
  box.replaceChildren(msg);
  if (dupe) {
    const a = document.createElement("button");
    a.type = "button";
    a.className = "pd-link";
    a.textContent = "Open it";
    a.addEventListener("click", () => { $("pdEdit").close(); openById(dupe); });
    box.append(" ", a);
  }
  box.hidden = false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = form.elements;
  if (!el.brand.value.trim()) return showError("Write the brand or name on the pack."), el.brand.focus();
  if (!el.contents.value.trim()) return showError("Write what the pill is said to contain."), el.contents.focus();
  if (!editing && !picked) return showError("Add a picture of the pill.");
  const body = new FormData(form);
  body.delete("image");
  if (editing) body.set("id", String(editing.id));
  if (picked) {
    // Photos are made smaller (and lose their location data); PNG cut-outs keep their see-through background.
    const keep = picked.type === "image/png" || picked.type === "image/gif" || picked.size < 1.5 * 1024 * 1024;
    const file = keep ? picked : await window.xnShrinkPicture(picked, [1600, 1600]);
    body.append("image", file, file === picked ? picked.name : "pill.jpg");
  }
  const save = $("pdSave");
  save.disabled = true;
  try {
    const p = await api("/pilldb/api/save", { method: "POST", body });
    $("pdEdit").close();
    toast(p.status === "approved" ? "Saved." : "Sent. An admin checks it before others can see it.");
    load(false);
    openView(p);
  } catch (err) {
    showError(err.message, err.body && err.body.duplicate);
  } finally {
    save.disabled = false;
  }
});

document.querySelectorAll(".pd-dialog").forEach((d) => {
  d.addEventListener("click", (e) => {
    if (e.target === d || e.target.closest("[data-close]")) d.close();
  });
});

// ---------------- Tabs and filters ----------------
document.querySelectorAll(".pd-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    state.view = tab.dataset.view;
    document.querySelectorAll(".pd-tab").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    $("pdStatusBox").hidden = state.view !== "check";
    load(false);
  });
});
let typing = 0;
$("pdQ").addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(() => load(false), 250); });
for (const id of ["pdColor", "pdShape", "pdKind", "pdLab", "pdStatus"]) $(id).addEventListener("change", () => load(false));
$("pdMore").addEventListener("click", () => load(true));

const start = new URLSearchParams(location.search);
if (start.get("q")) $("pdQ").value = start.get("q");
load(false).then(() => { if (start.get("id")) openById(start.get("id")); });
