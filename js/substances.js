// ============================================================
// substances.js — the admin Substances Editor (/admin/substances).
// Substances and pills are stored by the server in custom_substances,
// apart from PsychonautWiki. A pill points at its substance (parentId)
// and only keeps its own name, picture, description, half-life and
// timeline; the server fills the rest in from the substance for the
// Graph, Journal and Drug info. The preview draws with curve.js, the
// same code the Graph uses, so what you see is what the Graph draws.
// ============================================================

import { mountPreviewPics } from "/previewpics.js";
import { effectPhases, effectHours, effectCurve } from "./curve.js";

const $ = (id) => document.getElementById(id);
const API = "/admin/substances/api";
const PICTURE_API = "/admin/substances/image";
const MAX_PICTURE = 10 << 20;

// Durations are kept in hours; levels as a share of the peak (0-1).
const TIMES = [
  { key: "onset", label: "Onset", max: 6, hint: "Until the first effects" },
  { key: "comeup", label: "Come-up", max: 12, hint: "Rising to the peak" },
  { key: "peak", label: "Peak", max: 48, hint: "Full effect" },
  { key: "comedown", label: "Come-down", max: 48, hint: "Optional. Easing off before the tail" },
  { key: "comedownLevel", label: "Come-down ends at", pct: true, def: 35, hint: "Share of the peak left when the come-down ends" },
  { key: "offset", label: "Offset", max: 72, hint: "Fading out to nothing" },
];
const PEAK2 = [
  { key: "gap", label: "Time between peaks", max: 24, def: 1, hint: "From the end of the first peak" },
  { key: "dip", label: "Dip between peaks", pct: true, def: 50, hint: "How low it falls in between" },
  { key: "duration", label: "Second peak length", max: 48, def: 2 },
  { key: "level", label: "Second peak strength", pct: true, def: 80, hint: "Compared to the first peak" },
];
const PHASE_NAMES = { onset: "Onset", comeup: "Come-up", peak: "Peak", dip: "Dip", rise2: "Rise", peak2: "Second peak", comedown: "Come-down", offset: "Offset" };

// Combination warnings, in the order they're shown. The keys are the stored
// lists, which the Graph shows as Caution, Danger and Severe.
const GROUPS = [
  { key: "uncertain", title: "Caution", hint: "Effects may be unpredictable.", cls: "is-caution" },
  { key: "unsafe", title: "Dangerous", hint: "Avoid, or take extra care.", cls: "is-danger" },
  { key: "dangerous", title: "Severe / Do not combine", hint: "Never combine.", cls: "is-severe" },
];
// Groups PsychonautWiki uses in its combination lists.
const GROUP_NAMES = ["Alcohol", "Amphetamines", "Benzodiazepines", "Cannabis", "Cocaine", "DXM", "GHB", "GBL", "Ketamine", "MAOIs", "MDMA", "MXE", "Nitrous", "Opioids", "PCP", "SSRIs", "SNRIs", "Tramadol", "Lithium", "Psychedelics", "Stimulants", "Depressants", "Dissociatives", "Antipsychotics", "Caffeine", "Grapefruit", "Barbiturates", "Gabapentinoids", "Z-drugs"];

let unit = "h";
let list = [];
let loaded = false;
let filter = "";
let kind = "substance";
let editingId = 0;
const previewPics = mountPreviewPics(document.getElementById("sePreviews"));
let open = false;
let dirty = false;
// Ingestion methods of a substance: route, doses and timeline each. The form shows one at a time.
let methods = [];
let cur = 0;
// A pill: its substance, how it's taken, and whether its timeline was changed by hand.
let parentId = 0;
let timesTouched = false;
// Combination warnings: names per group, notes by lower-case name.
let ints = { uncertain: [], unsafe: [], dangerous: [] };
let intNotes = {};
// The picture: a file picked but not uploaded yet, or the current one to remove.
let pic = { file: null, url: "", remove: false, preview: "" };
// The curve's shape: "" straight lines with a flat peak, "smooth" one soft curve (curve.js).
let shape = "";
const DEFAULT_TIMES = { onset: 0.5, comeup: 0.5, peak: 2, comedown: 0, offset: 2 };
const rows = {}; // key -> { range, number, def, pct, max }

// ---------------------------------------------------------------- small helpers

function fmtHours(h) {
  if (!(h > 0)) return "0 min";
  const mins = Math.round(h * 60);
  if (mins < 60) return `${mins} min`;
  if (mins >= 48 * 60) {
    const d = Math.floor(mins / 1440), rest = Math.round((mins % 1440) / 60);
    return rest ? `${d} d ${rest} h` : `${d} d`;
  }
  const hh = Math.floor(mins / 60), mm = mins % 60;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}

const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const splitList = (v) => String(v || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
const lower = (s) => String(s || "").trim().toLowerCase();
const numOrNull = (v) => {
  const s = String(v ?? "").trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};
const rangeText = (r) => (r ? [r.min, r.max].filter((n) => n != null).filter((n, i, a) => a.indexOf(n) === i).join("–") : "");
const halfText = (r) => (rangeText(r) ? rangeText(r) + " h" : "");
const isPill = (e) => e?.kind === "pill";
const byId = (id) => list.find((e) => e.id === id) || null;
const pillsOf = (id) => list.filter((e) => isPill(e) && e.parentId === id);
const dayText = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

function toast(msg, isError) {
  if (window.xnToast) window.xnToast(msg, isError);
}

/** The picture of an entry, or its icon. */
function thumbFor(entry, extra) {
  const box = document.createElement("span");
  box.className = "se-tn" + (extra ? " " + extra : "");
  if (entry?.image) {
    const img = document.createElement("img");
    img.src = entry.image;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    box.append(img);
    return box;
  }
  const xc = window.xnClass;
  if (xc) {
    const parent = isPill(entry) ? byId(entry.parentId) : null;
    const key = xc.keyFor({ name: entry?.name || "", icon: entry?.icon, ingredient: entry?.ingredient || parent?.ingredient || parent?.name || "", class: { psychoactive: [entry?.class || parent?.class || ""] } }) || "";
    const icon = xc.icon(key, "", entry?.name || "");
    if (!key) {
      icon.hidden = false;
      icon.classList.add("si-noicon");
    }
    box.append(icon);
  }
  return box;
}

// ---------------------------------------------------------------- confirm dialog

let askDone = null;
/** A small in-page dialog; resolves true when the red button is pressed. */
function ask({ title, text, items, yes = "Delete", no = "Cancel" }) {
  if (askDone) askDone(false);
  $("askTitle").textContent = title;
  $("askText").textContent = text || "";
  const ul = $("askList");
  ul.replaceChildren(...(items || []).map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  ul.hidden = !items?.length;
  $("askYes").textContent = yes;
  $("askNo").textContent = no;
  const modal = $("seAsk");
  const back = document.activeElement;
  modal.hidden = false;
  document.documentElement.classList.add("xn-modal-open");
  $("askNo").focus();
  return new Promise((resolve) => {
    askDone = (value) => {
      askDone = null;
      modal.hidden = true;
      document.documentElement.classList.remove("xn-modal-open");
      if (back && back.focus) back.focus({ preventScroll: true });
      resolve(value);
    };
  });
}

async function confirmDiscard() {
  if (!open || !dirty) return true;
  return ask({ title: "Discard your changes?", text: "What you changed in the editor hasn't been saved.", yes: "Discard", no: "Keep editing" });
}

// ---------------------------------------------------------------- slider rows

function buildRows(box, defs) {
  defs.forEach((d) => {
    const id = "t_" + d.key;
    const row = document.createElement("div");
    row.className = "si-slider";
    row.innerHTML =
      `<div class="si-slider-top"><label class="xn-label" for="${id}">${esc(d.label)}</label>` +
      `<span class="si-slider-num"><input class="xn-input" id="${id}" type="number" inputmode="decimal" min="0" step="any">` +
      `<span class="si-suffix"></span></span></div>` +
      `<input type="range" min="0" aria-label="${esc(d.label)}" tabindex="-1">` +
      (d.hint ? `<span class="si-hint">${esc(d.hint)}</span>` : "");
    box.append(row);
    const number = row.querySelector('input[type="number"]');
    const range = row.querySelector('input[type="range"]');
    rows[d.key] = { ...d, number, range, suffix: row.querySelector(".si-suffix"), row };
    // Slider -> number, number -> slider: both show the same value.
    range.addEventListener("input", () => {
      number.value = range.value;
      row.classList.remove("is-bad");
      timesTouched = true;
      changed();
    });
    number.addEventListener("input", () => {
      const v = numOrNull(number.value);
      const bad = Number.isNaN(v) || (v != null && v < 0) || (d.pct && v > 100);
      row.classList.toggle("is-bad", bad);
      if (!bad) range.value = v == null ? 0 : Math.min(Number(range.max), v);
      timesTouched = true;
      changed();
    });
  });
}

function setUnitView() {
  Object.values(rows).forEach((r) => {
    if (r.pct) {
      r.range.max = 100;
      r.range.step = 1;
      r.number.max = 100;
      r.suffix.textContent = "%";
      return;
    }
    r.range.max = unit === "h" ? r.max : r.max * 60;
    r.range.step = unit === "h" ? 0.05 : 1;
    r.number.step = "any";
    r.suffix.textContent = unit === "h" ? "h" : "min";
  });
  document.querySelectorAll(".si-unit-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.unit === unit)));
}

/** Reads a row: hours, a 0-1 share, or null when empty. NaN when not a number. */
function readRow(key) {
  const r = rows[key];
  const v = numOrNull(r.number.value);
  if (v == null || Number.isNaN(v)) return v;
  if (r.pct) return v / 100;
  return unit === "h" ? v : v / 60;
}

function writeRow(key, value) {
  const r = rows[key];
  let shown = "";
  if (value != null && Number.isFinite(value)) {
    shown = r.pct ? Math.round(value * 1000) / 10 : unit === "h" ? Math.round(value * 1000) / 1000 : Math.round(value * 600) / 10;
  }
  r.number.value = shown === "" ? "" : String(shown);
  r.range.value = shown === "" ? 0 : Math.min(Number(r.range.max), Number(shown));
  r.row.classList.remove("is-bad");
}

function switchUnit(next) {
  if (next === unit) return;
  const values = {};
  Object.keys(rows).forEach((k) => (values[k] = readRow(k)));
  unit = next;
  setUnitView();
  Object.keys(rows).forEach((k) => writeRow(k, values[k]));
  try { localStorage.setItem("xn_si_unit", unit); } catch (_) {}
}

// ---------------------------------------------------------------- timeline

/** The timeline as stored: hours and shares, missing values filled sensibly. */
function readDurations() {
  const h = (k) => {
    const v = readRow(k);
    return v == null || Number.isNaN(v) ? 0 : Math.max(0, v);
  };
  const durations = { onset: h("onset"), comeup: h("comeup"), peak: h("peak"), comedown: h("comedown"), comedownLevel: 0, offset: h("offset") };
  if (durations.comedown > 0) {
    const lvl = readRow("comedownLevel");
    durations.comedownLevel = lvl == null || Number.isNaN(lvl) ? 0.35 : Math.min(1, Math.max(0, lvl));
  }
  if (shape === "smooth") durations.shape = "smooth";
  if ($("fPeak2On").checked) {
    const share = (k, d) => {
      const v = readRow(k);
      return v == null || Number.isNaN(v) ? d : Math.min(1, Math.max(0, v));
    };
    durations.peak2 = { gap: h("gap"), dip: share("dip", 0.5), duration: h("duration"), level: share("level", 1) };
  }
  return durations;
}

function writeDurations(t) {
  t = t || DEFAULT_TIMES;
  setShape(t.shape);
  ["onset", "comeup", "peak", "comedown", "offset"].forEach((k) => writeRow(k, t[k] || 0));
  writeRow("comedownLevel", t.comedown > 0 ? t.comedownLevel || 0.35 : 0.35);
  const p2 = t.peak2;
  $("fPeak2On").checked = !!p2;
  $("siPeak2").hidden = !p2;
  PEAK2.forEach((r) => writeRow(r.key, p2 ? p2[r.key] : r.pct ? r.def / 100 : r.def));
}

function setShape(next) {
  shape = next === "smooth" ? "smooth" : "";
  document.querySelectorAll(".se-shape-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.shape === shape)));
  $("feShapeHint").hidden = shape !== "smooth";
}

/** What's wrong with the timeline on screen, as [element id, message], or null. */
function validateTimes(t) {
  for (const key of Object.keys(rows)) {
    const v = readRow(key);
    if (Number.isNaN(v) || (v != null && v < 0) || (rows[key].pct && v > 1)) return ["t_" + key, `${rows[key].label} must be a number${rows[key].pct ? " from 0 to 100" : " from 0 up"}.`];
    if (!rows[key].pct && v > 240) return ["t_" + key, `${rows[key].label} can be at most 240 hours.`];
  }
  if (t.comeup + t.peak + t.comedown + t.offset <= 0) return ["t_comeup", "Set at least the come-up, peak or offset, so there's a curve to draw."];
  if (t.peak2 && !(t.peak2.duration > 0)) return ["t_duration", "Give the second peak a length, or untick Second peak."];
  if (t.peak2 && !(t.peak2.level > 0)) return ["t_level", "The second peak's strength must be more than 0%."];
  return null;
}

// ---------------------------------------------------------------- substance: methods and doses

function readMethod() {
  const range = (a, b) => {
    const min = numOrNull($(a).value), max = numOrNull($(b).value);
    if (min == null && max == null) return null;
    return { ...(min != null ? { min } : {}), ...(max != null ? { max } : {}) };
  };
  const one = (id) => numOrNull($(id).value);
  return {
    route: $("fRoute").value,
    dose: { threshold: one("dThreshold"), light: range("dLightMin", "dLightMax"), common: range("dCommonMin", "dCommonMax"), strong: range("dStrongMin", "dStrongMax"), heavy: one("dHeavy") },
    durations: readDurations(),
  };
}

function writeMethod(m) {
  const set = (id, v) => ($(id).value = v == null ? "" : v);
  $("fRoute").value = m.route || "oral";
  const d = m.dose || {};
  set("dThreshold", d.threshold);
  set("dLightMin", d.light?.min); set("dLightMax", d.light?.max);
  set("dCommonMin", d.common?.min); set("dCommonMax", d.common?.max);
  set("dStrongMin", d.strong?.min); set("dStrongMax", d.strong?.max);
  set("dHeavy", d.heavy);
  writeDurations(m.durations);
}

const routeLabel = (route) => {
  const opt = [...$("fRoute").options].find((o) => o.value === route);
  return opt ? opt.textContent : route ? route[0].toUpperCase() + route.slice(1) : "Oral";
};

function renderMethods() {
  const box = $("siMethods");
  box.replaceChildren();
  methods.forEach((m, i) => {
    const chip = document.createElement("span");
    chip.className = "si-method" + (i === cur ? " is-on" : "");
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "si-method-pick";
    pick.setAttribute("role", "tab");
    pick.setAttribute("aria-selected", String(i === cur));
    pick.textContent = routeLabel(m.route);
    pick.addEventListener("click", () => switchMethod(i));
    chip.append(pick);
    if (methods.length > 1) {
      const x = document.createElement("button");
      x.type = "button";
      x.className = "si-method-x";
      x.setAttribute("aria-label", `Remove ${routeLabel(m.route)}`);
      x.textContent = "×";
      x.addEventListener("click", () => removeMethod(i));
      chip.append(x);
    }
    box.append(chip);
  });
  const free = [...$("fRoute").options].map((o) => o.value).filter((r) => !methods.some((m) => m.route === r));
  if (free.length) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "si-method-add";
    add.textContent = "+ Add method";
    add.addEventListener("click", addMethod);
    box.append(add);
  }
  [...$("fRoute").options].forEach((o) => (o.disabled = methods.some((m, i) => i !== cur && m.route === o.value)));
  $("siTimeFor").textContent = kind === "substance" && methods.length > 1 ? `for ${routeLabel(methods[cur]?.route).toLowerCase()}` : "";
}

function switchMethod(i) {
  if (i === cur || !methods[i]) return;
  methods[cur] = readMethod();
  cur = i;
  writeMethod(methods[cur]);
  renderMethods();
  drawPreview();
}

function addMethod() {
  methods[cur] = readMethod();
  const route = [...$("fRoute").options].map((o) => o.value).find((r) => !methods.some((m) => m.route === r));
  if (!route) return;
  methods.push({ route, dose: {}, durations: JSON.parse(JSON.stringify(methods[cur].durations)) });
  cur = methods.length - 1;
  writeMethod(methods[cur]);
  renderMethods();
  drawPreview();
  dirty = true;
  $("fRoute").focus();
}

async function removeMethod(i) {
  if (methods.length < 2) return;
  const ok = await ask({ title: `Remove ${routeLabel(methods[i].route).toLowerCase()}?`, text: "Its doses and timeline go too when you save.", yes: "Remove" });
  if (!ok) return;
  methods[cur] = readMethod();
  methods.splice(i, 1);
  cur = Math.min(i === cur ? Math.max(0, i - 1) : cur > i ? cur - 1 : cur, methods.length - 1);
  writeMethod(methods[cur]);
  renderMethods();
  drawPreview();
  dirty = true;
}

function validateMethod(method) {
  const bad = (v) => v != null && (Number.isNaN(v) || v < 0);
  const badRange = (r) => r && (bad(r.min) || bad(r.max) || (r.min != null && r.max != null && r.min > r.max));
  const d = method.dose;
  for (const [key, id] of [["light", "dLightMin"], ["common", "dCommonMin"], ["strong", "dStrongMin"]]) {
    if (badRange(d[key])) return [id, "Each dose range needs numbers from 0 up, with the lowest first."];
  }
  if (bad(d.threshold)) return ["dThreshold", "The threshold must be a number from 0 up."];
  if (bad(d.heavy)) return ["dHeavy", "The heavy dose must be a number from 0 up."];
  const common = d.common?.min ?? d.common?.max;
  if (!(common > 0)) return ["dCommonMin", "Enter a common dose. The Graph scales the curve with it."];
  return validateTimes(method.durations);
}

// ---------------------------------------------------------------- combination warnings

let pwSeq = 0;
let pwNames = [];
async function catalogNames() {
  if (pwNames.length) return pwNames;
  try {
    const { allSubstances } = await import("/offline.js");
    pwNames = (await allSubstances()).map((s) => s.name).filter(Boolean);
  } catch (_) {}
  return pwNames;
}

/** Suggestions for a search: the site's entries first, then groups and PsychonautWiki names. */
async function suggestNames(q, exclude) {
  const ql = lower(q);
  const out = [];
  const seen = new Set(exclude.map(lower));
  const push = (name, entry, tag) => {
    if (!name || seen.has(lower(name))) return;
    seen.add(lower(name));
    out.push({ name, entry, tag });
  };
  const hit = (n) => !ql || lower(n).includes(ql);
  list.filter((e) => e.id !== editingId && (hit(e.name) || (e.aliases || []).some(hit))).forEach((e) => push(e.name, e, isPill(e) ? "Pill" : "On the site"));
  GROUP_NAMES.filter(hit).forEach((n) => push(n, null, "Group"));
  if (ql) (await catalogNames()).filter(hit).slice(0, 30).forEach((n) => push(n, null, "PsychonautWiki"));
  return out.slice(0, 12);
}

/** Names from PsychonautWiki's search, when it can be reached. */
async function pwSearch(q) {
  if (q.length < 2) return [];
  const mine = ++pwSeq;
  try {
    const res = await fetch("https://api.psychonautwiki.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query S($name: String!) { substances(query: $name) { name } }", variables: { name: q } }),
    });
    const data = await res.json();
    if (mine !== pwSeq) return null;
    return (data?.data?.substances || []).map((s) => s.name).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function groupOf(name) {
  const l = lower(name);
  return GROUPS.find((g) => ints[g.key].some((n) => lower(n) === l))?.key || "";
}

function addInt(groupKey, name) {
  name = String(name || "").trim().slice(0, 80);
  if (!name) return;
  const was = groupOf(name);
  if (was === groupKey) return;
  if (was) {
    ints[was] = ints[was].filter((n) => lower(n) !== lower(name));
    toast(`${name} moved to ${GROUPS.find((g) => g.key === groupKey).title}.`);
  }
  // Use the spelling of the entry on the site when there is one.
  const entry = list.find((e) => lower(e.name) === lower(name));
  ints[groupKey].push(entry ? entry.name : name);
  dirty = true;
  renderInts();
}

function removeInt(groupKey, name) {
  ints[groupKey] = ints[groupKey].filter((n) => n !== name);
  delete intNotes[lower(name)];
  dirty = true;
  renderInts();
}

function renderInts() {
  const box = $("feInts");
  const focusedGroup = document.activeElement?.closest?.(".se-int")?.dataset.group;
  box.replaceChildren();
  GROUPS.forEach((g) => {
    const wrap = document.createElement("div");
    wrap.className = "se-int " + g.cls;
    wrap.dataset.group = g.key;
    wrap.innerHTML = `<div class="se-int-head"><span class="se-int-dot"></span><b>${esc(g.title)}</b><span class="si-hint">${esc(g.hint)}</span><span class="se-int-n">${ints[g.key].length || ""}</span></div>`;
    const ul = document.createElement("ul");
    ul.className = "se-int-list";
    ints[g.key].forEach((name) => {
      const li = document.createElement("li");
      li.className = "se-int-row";
      const entry = list.find((e) => lower(e.name) === lower(name));
      const label = document.createElement("span");
      label.className = "se-int-name";
      label.append(thumbFor(entry || { name }), name);
      if (entry) label.title = "On the site";
      const note = document.createElement("input");
      note.className = "xn-input se-int-note";
      note.placeholder = "Note (optional)";
      note.maxLength = 300;
      note.value = intNotes[lower(name)] || "";
      note.setAttribute("aria-label", `Note for ${name}`);
      note.addEventListener("input", () => {
        intNotes[lower(name)] = note.value;
        dirty = true;
      });
      const x = document.createElement("button");
      x.type = "button";
      x.className = "si-method-x se-int-x";
      x.textContent = "×";
      x.setAttribute("aria-label", `Remove ${name}`);
      x.addEventListener("click", () => removeInt(g.key, name));
      li.append(label, note, x);
      ul.append(li);
    });
    wrap.append(ul, comboBox({
      placeholder: `Add to ${g.title.split(" /")[0].toLowerCase()}…`,
      label: `Add a combination to ${g.title}`,
      source: (q) => suggestNames(q, ints[g.key]),
      remote: pwSearch,
      skip: (n) => ints[g.key].some((x) => lower(x) === lower(n)),
      free: true,
      pick: (name) => {
        addInt(g.key, name);
        box.querySelector(`.se-int[data-group="${g.key}"] .se-combo input`)?.focus();
      },
    }));
    box.append(wrap);
  });
  if (focusedGroup) box.querySelector(`.se-int[data-group="${focusedGroup}"] .se-combo input`)?.focus();
}

// ---------------------------------------------------------------- a searchable picker

let comboCount = 0;
/**
 * An input with a list of suggestions. source(q) gives [{name, entry, tag, meta}];
 * remote(q) (optional) adds more names later; free lets Enter take the typed text.
 */
function comboBox({ placeholder, label, source, remote, skip, free, pick, input: given, pop: givenPop }) {
  const id = "cb" + ++comboCount;
  let box = null;
  const input = given || document.createElement("input");
  const pop = givenPop || document.createElement("ul");
  if (!given) {
    box = document.createElement("div");
    box.className = "se-combo";
    input.className = "xn-input";
    input.placeholder = placeholder || "";
    input.autocomplete = "off";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-label", label || placeholder || "");
    pop.className = "se-pop";
    pop.id = id;
    pop.setAttribute("role", "listbox");
    pop.hidden = true;
    input.setAttribute("aria-controls", id);
    input.setAttribute("aria-expanded", "false");
    box.append(input, pop);
  }
  let items = [];
  let active = -1;
  let seq = 0;
  const close = () => {
    pop.hidden = true;
    input.setAttribute("aria-expanded", "false");
    active = -1;
  };
  const choose = (i) => {
    const it = items[i];
    if (!it) return;
    close();
    if (!given) input.value = "";
    pick(it.name, it.entry);
  };
  const paint = () => {
    pop.replaceChildren();
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "se-pop-empty";
      li.textContent = free && input.value.trim() ? `Press Enter to add "${input.value.trim()}"` : "Nothing found.";
      pop.append(li);
    }
    items.forEach((it, i) => {
      const li = document.createElement("li");
      li.className = "se-pop-item" + (i === active ? " is-active" : "");
      li.setAttribute("role", "option");
      li.id = `${id}-${i}`;
      li.setAttribute("aria-selected", String(i === active));
      const name = document.createElement("span");
      name.className = "se-pop-name";
      name.textContent = it.name;
      const meta = document.createElement("span");
      meta.className = "se-pop-meta";
      meta.textContent = it.meta || "";
      const main = document.createElement("span");
      main.className = "se-pop-main";
      main.append(name, meta);
      li.append(thumbFor(it.entry || { name: it.name }), main);
      if (it.tag) {
        const tag = document.createElement("span");
        tag.className = "se-pop-tag" + (it.entry ? " is-site" : "");
        tag.textContent = it.tag;
        li.append(tag);
      }
      li.addEventListener("mousedown", (e) => e.preventDefault());
      li.addEventListener("click", () => choose(i));
      pop.append(li);
    });
    pop.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (active >= 0) input.setAttribute("aria-activedescendant", `${id}-${active}`);
    else input.removeAttribute("aria-activedescendant");
  };
  const refresh = async () => {
    const mine = ++seq;
    const q = input.value.trim();
    const found = await source(q);
    if (mine !== seq) return;
    items = found;
    active = items.length && q ? 0 : -1;
    paint();
    if (remote && q.length >= 2) {
      const more = await remote(q);
      if (mine !== seq || !more) return;
      const have = new Set(items.map((it) => lower(it.name)));
      more.forEach((n) => {
        if (have.has(lower(n)) || (skip && skip(n))) return;
        have.add(lower(n));
        items.push({ name: n, tag: "PsychonautWiki" });
      });
      items = items.slice(0, 14);
      paint();
    }
  };
  let timer = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 120);
  });
  input.addEventListener("focus", refresh);
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (pop.hidden) return refresh();
      const n = items.length;
      if (!n) return;
      active = e.key === "ArrowDown" ? (active + 1) % n : (active - 1 + n) % n;
      paint();
      pop.children[active]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && !pop.hidden) choose(active);
      else if (free && input.value.trim()) {
        const name = input.value.trim();
        close();
        input.value = "";
        pick(name, null);
      }
    } else if (e.key === "Escape" && !pop.hidden) {
      e.stopPropagation();
      close();
    }
  });
  return box || input;
}

// ---------------------------------------------------------------- pill: its substance

function parentChoices(q) {
  const ql = lower(q);
  return list
    .filter((e) => !isPill(e) && (!ql || lower(e.name).includes(ql) || (e.aliases || []).some((a) => lower(a).includes(ql)) || lower(e.ingredient).includes(ql)))
    .slice(0, 40)
    .map((e) => {
      const n = pillsOf(e.id).length;
      return { name: e.name, entry: e, meta: [e.ingredient ? "Medicine" : e.class, n ? `${n} pill${n === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") };
    });
}

function setParent(id, { fromUser = false } = {}) {
  parentId = id || 0;
  const p = byId(parentId);
  $("feParent").value = p ? p.name : "";
  $("feParentBox").classList.toggle("has-value", !!p);
  // Methods the substance has doses for.
  const sel = $("fePillRoute");
  const was = sel.value;
  sel.replaceChildren();
  if (p) {
    [p.route, ...(p.methods || []).map((m) => m.route)].filter(Boolean).forEach((r) => sel.append(new Option(routeLabel(r), r)));
    sel.value = [...sel.options].some((o) => o.value === was) ? was : sel.options[0]?.value || "";
  }
  $("fePillRouteBox").hidden = !p || sel.options.length < 2;
  // A new pill starts with its substance's timeline until you change it.
  if (p && fromUser && !timesTouched) {
    writeDurations(parentDurations());
    drawPreview();
  }
  renderInherit();
  renderCopyTimes();
  showIcon();
}

function parentDurations() {
  const p = byId(parentId);
  if (!p) return null;
  const route = $("fePillRoute").value;
  const m = (p.methods || []).find((x) => x.route === route);
  return JSON.parse(JSON.stringify(m ? m.durations : p.durations || DEFAULT_TIMES));
}

function renderCopyTimes() {
  const b = $("feCopyTimes");
  const p = kind === "pill" ? byId(parentId) : null;
  b.hidden = !p;
  if (p) b.textContent = `Use ${p.name}'s timeline`;
}

/** What a pill takes from its substance, read-only. */
function renderInherit() {
  const box = $("feInherit");
  const p = kind === "pill" ? byId(parentId) : null;
  box.hidden = !p;
  $("feSumHint").textContent = p ? `leave empty to use ${p.name}'s` : "";
  const ownHalf = numOrNull($("fHalfMin").value) != null || numOrNull($("fHalfMax").value) != null;
  $("feHalfNote").hidden = !(p && p.halfLife && !ownHalf) && !(p && !p.halfLife);
  $("feHalfNote").textContent = !p ? "" : p.halfLife ? `Empty uses ${p.name}'s half-life (${halfText(p.halfLife)}). Fill it in when this pill releases differently.` : `${p.name} has no half-life set. You can give this pill its own.`;
  if (!p) return;
  const route = $("fePillRoute").value || p.route;
  const m = route === p.route ? p : (p.methods || []).find((x) => x.route === route) || p;
  const d = m.dose || {};
  const u = p.units || "mg";
  const doses = [
    d.threshold != null ? `threshold ${d.threshold}` : "",
    rangeText(d.light) ? `light ${rangeText(d.light)}` : "",
    rangeText(d.common) ? `common ${rangeText(d.common)}` : "",
    rangeText(d.strong) ? `strong ${rangeText(d.strong)}` : "",
    d.heavy != null ? `heavy ${d.heavy}+` : "",
  ].filter(Boolean).join(" · ");
  const rowsHtml = [];
  const add = (label, value, cls) => {
    if (!value) return;
    rowsHtml.push(`<div class="si-dl-row${cls ? " " + cls : ""}"><dt>${esc(label)}</dt><dd>${value}</dd></div>`);
  };
  add("Class", esc([p.class, p.chemicalClass].filter(Boolean).join(" · ")));
  add("Addiction potential", esc(p.addictionPotential));
  add(`Doses, ${routeLabel(route).toLowerCase()}`, doses ? esc(`${doses} ${u}`) : "");
  GROUPS.slice().reverse().forEach((g) => {
    const names = p.interactions?.[g.key] || [];
    if (names.length) add(g.title, names.map((n) => `<span class="se-inh-chip ${g.cls}">${esc(n)}</span>`).join(""), "se-inh-ints");
  });
  add("Risks", p.risks ? esc(p.risks.length > 220 ? p.risks.slice(0, 220) + "…" : p.risks) : "");
  box.replaceChildren();
  const head = document.createElement("div");
  head.className = "se-inh-head";
  const title = document.createElement("div");
  title.innerHTML = `<b>${esc(p.name)}</b><span class="si-hint">This pill takes these from ${esc(p.name)}, so they stay in step when it changes.</span>`;
  const go = document.createElement("button");
  go.type = "button";
  go.className = "se-link";
  go.textContent = `Edit ${p.name}`;
  go.addEventListener("click", () => openEntry(p));
  head.append(thumbFor(p), title, go);
  box.append(head);
  const dl = document.createElement("dl");
  dl.className = "si-dl se-inh-dl";
  dl.innerHTML = rowsHtml.join("") || `<div class="si-dl-row"><dt>Nothing yet</dt><dd>${esc(p.name)} has no safety info or combinations set.</dd></div>`;
  box.append(dl);
}

// ---------------------------------------------------------------- picture

function showPicture() {
  const show = $("fePicShow");
  show.replaceChildren();
  const url = pic.preview || (pic.remove ? "" : pic.url);
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    show.append(img);
  } else {
    show.append(thumbFor({ name: $("fName").value.trim(), icon: $("fIcon").value, ingredient: $("fIngredient").value.trim(), class: $("fClass").value.trim(), kind, parentId }, "se-tn-big"));
  }
  $("fePicDrop").classList.toggle("has-pic", !!url);
  $("fePicHint").textContent = url ? "Change" : "Upload";
  $("fePicRemove").hidden = !url;
  const head = $("feThumb");
  head.replaceChildren(url ? Object.assign(document.createElement("img"), { src: url, alt: "" }) : thumbFor({ name: $("fName").value.trim() || "?", icon: $("fIcon").value, ingredient: $("fIngredient").value.trim(), class: $("fClass").value.trim(), kind, parentId }));
}

function takePicture(file) {
  if (!file) return;
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) return showError(["fePic", "Use a JPG, PNG, GIF or WebP picture."]);
  if (file.size > MAX_PICTURE) return showError(["fePic", "That picture is too big. Pick one under 10 MB."]);
  if (pic.preview) URL.revokeObjectURL(pic.preview);
  pic.file = file;
  pic.preview = URL.createObjectURL(file);
  pic.remove = false;
  dirty = true;
  showError(null);
  showPicture();
}

function dropPicture() {
  if (pic.preview) URL.revokeObjectURL(pic.preview);
  if (pic.file) {
    pic.file = null;
    pic.preview = "";
  } else {
    pic.remove = true;
  }
  $("fePic").value = "";
  dirty = true;
  showPicture();
}

async function uploadPicture(id) {
  if (!pic.file && !pic.remove) return "";
  const body = new FormData();
  body.append("id", String(id));
  if (pic.file) body.append("image", pic.file);
  else body.append("remove", "1");
  const res = await fetch(PICTURE_API, { method: "POST", body });
  const text = await res.text();
  if (!res.ok) throw new Error(text.trim() || "Couldn't save the picture.");
  return JSON.parse(text).image || "";
}

// ---------------------------------------------------------------- icon

function fillIconOptions() {
  const labels = window.xnClass?.LABELS || {};
  const keys = Object.keys(labels).sort((a, b) => (b.startsWith("pill-") - a.startsWith("pill-")) || labels[a].localeCompare(labels[b]));
  for (const key of keys) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = (key.startsWith("pill-") ? "Pill: " : "") + labels[key];
    $("fIcon").append(option);
  }
}

function setIcon(key) {
  const select = $("fIcon");
  select.value = key && [...select.options].some((o) => o.value === key) ? key : "";
  showIcon();
}

function showIcon() {
  const show = $("fIconShow");
  const p = kind === "pill" ? byId(parentId) : null;
  const key = $("fIcon").value || window.xnClass?.keyFor({ name: $("fName").value.trim(), ingredient: kind === "pill" ? p?.ingredient || p?.name || "" : $("fIngredient").value.trim(), class: { psychoactive: [kind === "pill" ? p?.class || "" : $("fClass").value.trim()] } }) || "";
  show.dataset.class = key;
  show.title = window.xnClass?.LABELS[key] || "";
  show.hidden = !key;
  showPicture();
}

// ---------------------------------------------------------------- scientific graph
// One per route: the medical effect and how it feels (starts, peak starts,
// peak ends, ends), the blood level, notes and sources. Until an admin
// changes it, an entry shows the evidence review's version (js/science.js);
// "No scientific graph" saves an empty list.

const SCI_TIMES = [["onset", "Starts"], ["peakStart", "Peak starts"], ["peakEnd", "Peak ends"], ["end", "Ends"]];
// mode "default": the review's version, nothing stored; "edited": sci.list is stored.
let sci = { mode: "default", list: [], cur: 0, touched: false, stored: undefined };
let mainDirty = false;
const sciApi = () => window.xnScience || null;

/** The review's entries for a name, in the stored shape. */
function sciDefaults(name, ingredient) {
  const api = sciApi();
  if (!api) return [];
  let list = api.defaults(name);
  if (!list.length && ingredient) list = api.defaults(ingredient);
  return list.map((d) => ({
    route: d.route || "oral",
    ther: d.ther ? { ...d.ther } : null,
    subj: d.subj ? { ...d.subj } : null,
    subjLevel: d.subjLevel ?? null,
    tmax: d.pk?.tmax ?? null,
    thalf: d.pk?.thalf ?? null,
    notes: [d.extra, d.pwNote, d.noSubj].filter(Boolean).join("\n"),
    sources: (d.studies || []).map((s) => ({ cite: s.cite, url: s.url || "" })),
  }));
}

function sciFill(entry) {
  const defaults = sciDefaults(entry?.name, entry?.ingredient);
  sci = {
    mode: Array.isArray(entry?.science) ? "edited" : "default",
    list: Array.isArray(entry?.science) ? structuredClone(entry.science) : defaults,
    cur: 0, touched: false,
    stored: Array.isArray(entry?.science) ? entry.science : undefined,
    hasDefaults: defaults.length > 0,
  };
  sciShow();
}

/** What the save sends: undefined keeps the review's version (nothing stored). */
function sciForSave() {
  if (!sci.touched) return sci.stored;
  sciRead();
  return sci.mode === "edited" ? sci.list : undefined;
}

function sciShow() {
  const g = sci.list[sci.cur];
  const routes = $("sciRoutes");
  routes.replaceChildren();
  sci.list.forEach((s, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "se-sci-route";
    b.textContent = routeLabel(s.route);
    b.setAttribute("aria-pressed", String(i === sci.cur));
    b.addEventListener("click", () => { sciRead(); sci.cur = i; sciShow(); });
    routes.append(b);
  });
  const add = document.createElement("select");
  add.className = "xn-input se-sci-add";
  add.setAttribute("aria-label", "Add a route");
  add.append(new Option("+ Add route", ""));
  [...$("fRoute").options].filter((o) => !sci.list.some((s) => s.route === o.value)).forEach((o) => add.append(new Option(o.textContent, o.value)));
  add.addEventListener("change", () => {
    if (!add.value) return;
    sciRead();
    sci.list.push({ route: add.value, ther: null, subj: { onset: 0.5, peakStart: 1, peakEnd: 2, end: 4 }, subjLevel: 1, tmax: null, thalf: null, notes: "", sources: [] });
    sci.cur = sci.list.length - 1;
    sciTouch();
    sciShow();
  });
  routes.append(add);
  $("sciForm").hidden = !g;
  $("sciEmpty").hidden = !!g;
  $("sciRemove").hidden = !g;
  $("sciNone").hidden = !sci.list.length;
  $("sciReset").hidden = !(sci.hasDefaults && sci.mode === "edited");
  $("sciState").textContent = sci.mode === "edited" ? (sci.list.length ? "Edited" : "None") : sci.list.length ? "From the evidence review" : "Not added yet";
  if (g) {
    const val = (id, v) => ($(id).value = v == null ? "" : String(Math.round(v * 1000) / 1000));
    ["ther", "subj"].forEach((k) => {
      $(`sci_${k}_on`).checked = !!g[k];
      SCI_TIMES.forEach(([t]) => {
        val(`sci_${k}_${t}`, g[k]?.[t]);
        $(`sci_${k}_${t}`).disabled = !g[k];
      });
    });
    val("sci_level", g.subjLevel == null ? null : g.subjLevel * 100);
    $("sci_level").disabled = !g.subj;
    val("sci_tmax", g.tmax);
    val("sci_thalf", g.thalf);
    $("sci_notes").value = g.notes || "";
    $("sci_sources").value = (g.sources || []).map((s) => (s.url ? `${s.cite} | ${s.url}` : s.cite)).join("\n");
  }
  sciPreview();
}

/** Reads the inputs into sci.list[sci.cur]. */
function sciRead() {
  const g = sci.list[sci.cur];
  if (!g) return;
  ["ther", "subj"].forEach((k) => {
    if (!$(`sci_${k}_on`).checked) { g[k] = null; return; }
    const t = {};
    SCI_TIMES.forEach(([key]) => { const v = numOrNull($(`sci_${k}_${key}`).value); t[key] = v == null ? 0 : v; });
    g[k] = t;
  });
  const lvl = numOrNull($("sci_level").value);
  g.subjLevel = lvl == null ? null : lvl / 100;
  g.tmax = numOrNull($("sci_tmax").value);
  g.thalf = numOrNull($("sci_thalf").value);
  g.notes = $("sci_notes").value.trim();
  g.sources = $("sci_sources").value.split("\n").map((line) => {
    const [cite, ...rest] = line.split("|");
    const url = rest.join("|").trim();
    return { cite: cite.trim(), url: /^https?:\/\//.test(url) ? url : "" };
  }).filter((s) => s.cite);
}

function sciTouch() {
  sci.touched = true;
  sci.mode = "edited";
  dirty = true;
  $("sciState").textContent = sci.list.length ? "Edited" : "None";
  $("sciReset").hidden = !sci.hasDefaults;
}

function sciPreview() {
  const box = $("sciChart");
  box.replaceChildren();
  const api = sciApi();
  const g = sci.list[sci.cur];
  if (!api || !g) return;
  const def = (api.defaults($("fName").value) || []).find((d) => d.route === g.route);
  const ok = (t) => t && t.end > 0 && t.onset <= t.peakStart && t.peakStart <= t.peakEnd && t.peakEnd < t.end;
  const e = { ther: ok(g.ther) ? g.ther : null, subj: ok(g.subj) ? g.subj : null, subjLevel: g.subjLevel ?? 1, pk: { tmax: g.tmax, thalf: g.thalf } };
  box.append(api.chart(e, def?.pw || null, true, "PsychonautWiki"));
}

/** What's wrong with the scientific graphs, as [element id, message], or null. */
function sciValidate(list) {
  for (let i = 0; i < (list || []).length; i++) {
    const g = list[i];
    const where = list.length > 1 ? `Scientific graph (${routeLabel(g.route)}): ` : "Scientific graph: ";
    const show = (id, msg) => { if (sci.cur !== i) { sci.cur = i; sciShow(); } return [id, where + msg]; };
    if (!g.ther && !g.subj) return show("sci_ther_on", "tick Medical effect or How it feels, or remove this route.");
    for (const k of ["ther", "subj"]) {
      const t = g[k];
      if (!t) continue;
      if (!(t.onset <= t.peakStart && t.peakStart <= t.peakEnd && t.peakEnd < t.end)) return show(`sci_${k}_end`, `${k === "ther" ? "medical effect" : "how it feels"} needs times in order, ending after the peak.`);
      if (SCI_TIMES.some(([key]) => t[key] > 240)) return show(`sci_${k}_end`, "times can be at most 240 hours.");
    }
    if (g.subjLevel != null && (g.subjLevel < 0.05 || g.subjLevel > 1)) return show("sci_level", "strength must be from 5 to 100%.");
  }
  return null;
}

function initScience() {
  document.querySelectorAll(".se-sci-times").forEach((box) => {
    const k = box.dataset.times;
    SCI_TIMES.forEach(([key, label]) => {
      const f = document.createElement("div");
      f.className = "si-field";
      f.innerHTML = `<label class="xn-label" for="sci_${k}_${key}">${label} <span class="si-hint">h</span></label><input class="xn-input" id="sci_${k}_${key}" type="number" inputmode="decimal" min="0" step="any">`;
      box.append(f);
    });
  });
  $("seSci").addEventListener("input", () => { sciTouch(); sciRead(); sciPreview(); });
  ["ther", "subj"].forEach((k) => $(`sci_${k}_on`).addEventListener("change", () => {
    sciRead();
    const g = sci.list[sci.cur];
    if (g && $(`sci_${k}_on`).checked && !g[k]) g[k] = { onset: 0.5, peakStart: 1, peakEnd: 2, end: 4 };
    sciShow();
  }));
  $("sciRemove").addEventListener("click", () => {
    sci.list.splice(sci.cur, 1);
    sci.cur = 0;
    sciTouch();
    sciShow();
  });
  $("sciNone").addEventListener("click", () => {
    sci.list = [];
    sci.cur = 0;
    sciTouch();
    sciShow();
  });
  $("sciReset").addEventListener("click", () => {
    sci.list = sciDefaults($("fName").value, $("fIngredient").value);
    sci.cur = 0;
    sci.mode = "default";
    sci.touched = true;
    dirty = true;
    sciShow();
  });
  // The review's data arrives with science.js; redraw if it came late.
  window.addEventListener("xn:science", () => { if (open) sciPreview(); });
}

// ---------------------------------------------------------------- the form

function setKind(next) {
  kind = next === "pill" ? "pill" : "substance";
  const form = $("siForm");
  form.dataset.kind = kind;
  document.querySelectorAll(".se-kind-btn").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.kind === kind)));
  $("feType").textContent = kind === "pill" ? "Pill" : "Substance";
  $("feType").dataset.kind = kind;
  if (!editingId) {
    $("siFormTitle").textContent = kind === "pill" ? "New pill" : "New substance";
    $("siSave").textContent = kind === "pill" ? "Add pill" : "Add substance";
  }
  renderMethods();
  renderInherit();
  renderCopyTimes();
  showIcon();
  checkDupe();
}

function fillForm(entry, newKind) {
  const e = entry || {};
  const set = (id, v) => ($(id).value = v == null ? "" : v);
  editingId = e.id || 0;
  set("fName", e.name);
  set("fAliases", (e.aliases || []).join(", "));
  set("fIngredient", e.ingredient);
  setIcon(e.icon);
  set("fClass", e.class);
  set("fChem", e.chemicalClass);
  set("fSummary", e.summary);
  set("fHalfMin", e.halfLife?.min);
  set("fHalfMax", e.halfLife?.max);
  set("fAddiction", e.addictionPotential);
  set("fRisks", e.risks);
  set("fNotes", e.notes);
  $("fUnits").value = e.units || "mg";
  ints = { uncertain: [...(e.interactions?.uncertain || [])], unsafe: [...(e.interactions?.unsafe || [])], dangerous: [...(e.interactions?.dangerous || [])] };
  intNotes = { ...(e.interactionNotes || {}) };
  methods = [{ route: e.route || "oral", dose: e.dose || {}, durations: e.durations || DEFAULT_TIMES }, ...(e.methods || [])];
  cur = 0;
  writeMethod(methods[0]);
  if (pic.preview) URL.revokeObjectURL(pic.preview);
  pic = { file: null, url: e.image || "", remove: false, preview: "" };
  $("fePic").value = "";
  timesTouched = !!editingId;

  $("feKind").hidden = !!editingId;
  setKind(entry ? (isPill(e) ? "pill" : "substance") : newKind);
  if (kind === "pill") {
    $("fePillRoute").replaceChildren(new Option("", e.route || ""));
    $("fePillRoute").value = e.route || "";
    setParent(e.parentId || 0);
    writeDurations(e.durations || DEFAULT_TIMES);
  } else {
    setParent(0);
  }
  renderInts();
  $("siFormTitle").textContent = editingId ? e.name : kind === "pill" ? "New pill" : "New substance";
  $("siSave").textContent = editingId ? "Save changes" : kind === "pill" ? "Add pill" : "Add substance";
  $("feDelete").hidden = !editingId;
  const by = e.createdBy || (e.id && !e.createdBy ? (e.source === "psychonautwiki" || (!e.ingredient && !e.icon) ? "copying PsychonautWiki" : "the medicines list") : "");
  $("feMeta").textContent = editingId
    ? [`Added ${dayText(e.createdAt)}${by ? " by " + by : ""}`, e.updatedAt && e.updatedAt !== e.createdAt ? `changed ${dayText(e.updatedAt)}` : ""].filter(Boolean).join(" · ")
    : kind === "pill" ? "Links to a substance and takes its safety info from it." : "Fill in what you know. Only the name, a common dose and a timeline are needed.";
  $("feSaved").hidden = true;
  showError(null);
  sciFill(entry ? (isPill(e) ? null : e) : null);
  previewPics.show(editingId && kind !== "pill" ? e.name : "");
  dirty = false;
  mainDirty = false;
  drawPreview();
}

function readForm() {
  const range = (a, b) => {
    const min = numOrNull($(a).value), max = numOrNull($(b).value);
    if (min == null && max == null) return null;
    return { ...(min != null ? { min } : {}), ...(max != null ? { max } : {}) };
  };
  const base = {
    id: editingId,
    name: $("fName").value.trim(),
    aliases: splitList($("fAliases").value),
    icon: $("fIcon").value,
    summary: $("fSummary").value.trim(),
    halfLife: range("fHalfMin", "fHalfMax"),
    notes: $("fNotes").value.trim(),
  };
  if (kind === "pill") {
    return { ...base, kind: "pill", parentId, route: $("fePillRoute").value, durations: readDurations() };
  }
  methods[cur] = readMethod();
  const [first, ...more] = methods;
  const notes = {};
  GROUPS.forEach((g) => ints[g.key].forEach((n) => {
    const note = String(intNotes[lower(n)] || "").trim();
    if (note) notes[lower(n)] = note;
  }));
  return {
    ...base,
    ingredient: $("fIngredient").value.trim(),
    class: $("fClass").value.trim(),
    chemicalClass: $("fChem").value.trim(),
    addictionPotential: $("fAddiction").value.trim(),
    risks: $("fRisks").value.trim(),
    interactions: { dangerous: [...ints.dangerous], unsafe: [...ints.unsafe], uncertain: [...ints.uncertain] },
    interactionNotes: notes,
    units: $("fUnits").value,
    route: first.route,
    dose: first.dose,
    durations: first.durations,
    methods: more,
    science: sciForSave(),
  };
}

function dupeOf(name) {
  const l = lower(name);
  return l ? list.find((e) => e.id !== editingId && (lower(e.name) === l)) : null;
}

function checkDupe() {
  const box = $("feDupe");
  const hit = dupeOf($("fName").value);
  box.hidden = !hit;
  box.replaceChildren();
  if (!hit) return;
  box.append(`There's already a ${isPill(hit) ? "pill" : "substance"} called ${hit.name}. `);
  const b = document.createElement("button");
  b.type = "button";
  b.className = "se-link";
  b.textContent = "Open it";
  b.addEventListener("click", () => openEntry(hit));
  box.append(b);
}

/** What's wrong with the form, as [element id, message], or null. */
function validate(entry) {
  if (!entry.name) return ["fName", `Give the ${kind} a name.`];
  if (dupeOf(entry.name)) return ["fName", `There's already something called ${dupeOf(entry.name).name}. Pick another name or edit that one.`];
  const bad = (v) => v != null && (Number.isNaN(v) || v < 0);
  const badRange = (r) => r && (bad(r.min) || bad(r.max) || (r.min != null && r.max != null && r.min > r.max));
  if (badRange(entry.halfLife)) return ["fHalfMin", "The half-life needs numbers from 0 up, with the lowest first."];
  if (kind === "pill") {
    if (!byId(entry.parentId)) return ["feParent", "Pick the substance this pill contains."];
    return validateTimes(entry.durations);
  }
  const order = [cur, ...methods.map((_, i) => i).filter((i) => i !== cur)];
  for (const i of order) {
    if (i !== cur) switchMethod(i);
    const problem = validateMethod(methods[i]);
    if (problem) {
      if (methods.length > 1) problem[1] = `${routeLabel(methods[i].route)}: ${problem[1]}`;
      return problem;
    }
  }
  if (order[0] !== cur) switchMethod(order[0]);
  return sciValidate(entry.science);
}

function showError(problem) {
  const box = $("siError");
  document.querySelectorAll(".is-invalid").forEach((el) => el.classList.remove("is-invalid"));
  if (!problem) {
    box.hidden = true;
    return;
  }
  const [id, message] = Array.isArray(problem) ? problem : [null, problem];
  box.textContent = message;
  box.hidden = false;
  const target = id === "fePic" ? $("fePicDrop") : id && $(id);
  if (target) {
    target.classList.add("is-invalid");
    if (target.focus) target.focus({ preventScroll: false });
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  } else {
    box.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

// ---------------------------------------------------------------- preview

const PHASE_TINT = { onset: "var(--si-p0)", comeup: "var(--si-p1)", peak: "var(--si-p2)", dip: "var(--si-p1)", rise2: "var(--si-p1)", peak2: "var(--si-p2)", comedown: "var(--si-p3)", offset: "var(--si-p4)" };

function niceStep(total) {
  const steps = [0.25, 0.5, 1, 2, 3, 4, 6, 12, 24, 48];
  return steps.find((s) => total / s <= 8) || 96;
}

/** An SVG of the curve, with each phase shaded. */
export function previewSvg(durations, { compact = false } = {}) {
  const W = 600, H = compact ? 150 : 200, L = 34, R = 10, T = 12, B = 26;
  const phases = effectPhases(durations);
  const total = effectHours(durations);
  if (!(total > 0)) return `<p class="si-empty">Set the durations to see the curve.</p>`;
  const iw = W - L - R, ih = H - T - B;
  const x = (h) => L + (h / total) * iw;
  const y = (v) => T + ih - (v / 100) * ih;
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="si-svg" role="img" aria-label="Effect over ${esc(fmtHours(total))}">`;
  let at = 0;
  phases.forEach((p) => {
    if (p.hours <= 0) return;
    svg += `<rect x="${x(at).toFixed(1)}" y="${T}" width="${Math.max(0.5, x(at + p.hours) - x(at)).toFixed(1)}" height="${ih}" fill="${PHASE_TINT[p.name]}" class="si-band"><title>${esc(PHASE_NAMES[p.name])}: ${esc(fmtHours(p.hours))}</title></rect>`;
    at += p.hours;
  });
  [25, 50, 75, 100].forEach((v) => {
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="si-gl"/>`;
    svg += `<text x="${L - 6}" y="${y(v) + 3}" class="si-axis" text-anchor="end">${v}%</text>`;
  });
  const step = niceStep(total);
  for (let h = 0; h <= total + 1e-9; h += step) {
    svg += `<line x1="${x(h)}" x2="${x(h)}" y1="${T + ih}" y2="${T + ih + 4}" class="si-tick"/>`;
    svg += `<text x="${x(h)}" y="${H - 8}" class="si-axis" text-anchor="middle">${h >= 48 ? Math.round(h / 24 * 10) / 10 + "d" : Math.round(h * 100) / 100 + "h"}</text>`;
  }
  const curve = effectCurve(durations, 0, 1, Math.max(0.01, total / 400));
  const pts = curve.x.map((hx, i) => `${x(hx).toFixed(1)},${y(curve.y[i]).toFixed(1)}`);
  svg += `<path d="M${x(0)},${y(0)} L${pts.join(" L")} L${x(total)},${y(0)} Z" class="si-area"/>`;
  svg += `<path d="M${pts.join(" L")}" class="si-line"/>`;
  svg += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="si-base"/>`;
  return svg + "</svg>";
}

function legendHtml(durations) {
  return effectPhases(durations)
    .filter((p) => p.hours > 0)
    .map((p) => `<li><i style="background:${PHASE_TINT[p.name]}"></i><span>${esc(PHASE_NAMES[p.name])}</span><b>${esc(fmtHours(p.hours))}</b></li>`)
    .join("");
}

function drawPreview() {
  const durations = readDurations();
  $("pvChart").innerHTML = previewSvg(durations);
  $("pvLegend").innerHTML = legendHtml(durations);
  const total = effectHours(durations);
  $("pvTotal").textContent = total > 0 ? `Total ${fmtHours(total)}` : "";
}

let previewFrame = 0;
function changed() {
  dirty = true;
  mainDirty = true;
  cancelAnimationFrame(previewFrame);
  previewFrame = requestAnimationFrame(drawPreview);
}

// ---------------------------------------------------------------- overview

function halfOf(e) {
  if (e.halfLife && rangeText(e.halfLife)) return { text: halfText(e.halfLife), from: "" };
  const p = isPill(e) ? byId(e.parentId) : null;
  if (p?.halfLife && rangeText(p.halfLife)) return { text: halfText(p.halfLife), from: p.name };
  return { text: "", from: "" };
}

/** True when the entry has a scientific graph, its own or the evidence review's. */
function hasScience(e) {
  if (isPill(e)) return false;
  if (Array.isArray(e.science)) return e.science.length > 0;
  const api = sciApi();
  return !!api && (api.defaults(e.name).length > 0 || (!!e.ingredient && api.defaults(e.ingredient).length > 0));
}

function subLine(e) {
  if (isPill(e)) return `Pill of ${e.parent || byId(e.parentId)?.name || "a deleted substance"}`;
  const n = pillsOf(e.id).length;
  return [e.ingredient ? `Medicine · ${e.ingredient}` : e.class, n ? `${n} pill${n === 1 ? "" : "s"}` : "", hasScience(e) ? "Scientific graph" : "", e.source === "psychonautwiki" ? "PsychonautWiki copy" : ""].filter(Boolean).join(" · ");
}

function shownList() {
  const q = lower($("ovFind").value);
  const sort = $("ovSort").value;
  const hay = (e) => [e.name, ...(e.aliases || []), e.class || "", e.ingredient || "", e.parent || "", e.chemicalClass || ""].map(lower);
  const fits = (e) => !filter || (filter === "pw" ? e.source === "psychonautwiki" : filter === "sci" ? hasScience(e) : (filter === "pill") === isPill(e));
  const out = list.filter((e) => fits(e) && (!q || hay(e).some((n) => n.includes(q))));
  const name = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const hl = (e) => {
    const h = isPill(e) && !e.halfLife ? byId(e.parentId)?.halfLife : e.halfLife;
    return h ? h.min ?? h.max ?? Infinity : Infinity;
  };
  if (sort === "new") out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || name(a, b));
  else if (sort === "half") out.sort((a, b) => hl(a) - hl(b) || name(a, b));
  else if (sort === "type") out.sort((a, b) => isPill(a) - isPill(b) || name(a, b));
  else out.sort(name);
  return out;
}

function renderList() {
  const box = $("ovList");
  box.setAttribute("aria-busy", "false");
  const pills = list.filter(isPill).length;
  $("ovNAll").textContent = list.length || "";
  $("ovNSub").textContent = list.length - pills || "";
  $("ovNPill").textContent = pills || "";
  $("ovNPw").textContent = list.filter((e) => e.source === "psychonautwiki").length || "";
  $("ovNSci").textContent = list.filter(hasScience).length || "";
  const shown = shownList();
  box.replaceChildren();
  if (!shown.length) {
    const li = document.createElement("li");
    li.className = "si-empty se-empty";
    li.textContent = list.length ? "Nothing matches." : "Nothing added yet. Start with New Substance.";
    box.append(li);
    return;
  }
  shown.forEach((e) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "se-row" + (open && e.id === editingId ? " is-current" : "");
    b.dataset.id = e.id;
    b.setAttribute("aria-current", String(open && e.id === editingId));
    const half = halfOf(e);
    const main = document.createElement("span");
    main.className = "se-row-main";
    main.innerHTML = `<span class="se-row-name">${esc(e.name)}</span><span class="se-row-sub">${esc(subLine(e))}</span><span class="se-row-small">${esc([half.text ? "½ " + half.text : "", dayText(e.createdAt)].filter(Boolean).join(" · "))}</span>`;
    const hcell = document.createElement("span");
    hcell.className = "se-row-half" + (half.from ? " is-inherited" : "");
    hcell.textContent = half.text || "–";
    if (half.from) hcell.title = `From ${half.from}`;
    const dcell = document.createElement("span");
    dcell.className = "se-row-date";
    dcell.textContent = dayText(e.createdAt) || "–";
    const type = document.createElement("span");
    type.className = "se-type";
    type.dataset.kind = isPill(e) ? "pill" : "substance";
    type.textContent = isPill(e) ? "Pill" : "Substance";
    b.append(thumbFor(e), main, hcell, dcell, type);
    b.addEventListener("click", () => openEntry(e));
    li.append(b);
    box.append(li);
  });
}

async function load() {
  try {
    const res = await fetch(API, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new Error((await res.text()).trim() || `Error ${res.status}`);
    list = await res.json();
    loaded = true;
  } catch (error) {
    const box = $("ovList");
    box.setAttribute("aria-busy", "false");
    box.innerHTML = `<li class="si-empty se-empty">Couldn't load the list. ${esc(error.message || "")} <button type="button" class="se-link" id="ovRetry">Try again</button></li>`;
    $("ovRetry").addEventListener("click", load);
    return false;
  }
  renderList();
  return true;
}

/** Adds every PsychonautWiki substance the database doesn't have yet. */
async function importPw() {
  const btn = $("ovImport");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Copying from PsychonautWiki…";
  try {
    const res = await fetch("/admin/substances/import-pw", { method: "POST" });
    const text = await res.text();
    if (!res.ok) throw new Error(text.trim() || `Error ${res.status}`);
    const r = JSON.parse(text);
    toast(r.added ? `Added ${r.added} substance${r.added === 1 ? "" : "s"} from PsychonautWiki (${r.skipped} were already here).` : `All ${r.total} PsychonautWiki substances are already here.`);
    await load();
  } catch (error) {
    toast(error.message || "Couldn't reach PsychonautWiki.", true);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------------------------------------------------------------- open / close

function showEditor(on) {
  open = on;
  $("siForm").hidden = !on;
  $("seStart").hidden = on;
  renderList();
}

function setUrl(params) {
  const url = new URL(location.href);
  url.search = "";
  Object.entries(params).forEach(([k, v]) => v && url.searchParams.set(k, v));
  history.replaceState(null, "", url);
}

function scrollToEditor() {
  if (window.matchMedia("(max-width: 1000px)").matches) $("siForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function openEntry(entry) {
  if (open && entry.id === editingId && !dirty) return scrollToEditor();
  if (!(await confirmDiscard())) return;
  fillForm(entry);
  showEditor(true);
  setUrl({ id: entry.id });
  scrollToEditor();
}

async function openNew(newKind) {
  if (!(await confirmDiscard())) return;
  fillForm(null, newKind);
  showEditor(true);
  setUrl({ new: newKind });
  scrollToEditor();
  $("fName").focus({ preventScroll: true });
}

async function closeEditor() {
  if (!(await confirmDiscard())) return;
  dirty = false;
  editingId = 0;
  showEditor(false);
  setUrl({});
}

// ---------------------------------------------------------------- save / delete

async function save(event) {
  event.preventDefault();
  if (!loaded) return showError("The list hasn't loaded yet, so duplicates can't be checked. Try again in a moment.");
  const entry = readForm();
  // A PsychonautWiki copy where only the scientific graph changed stays a copy
  // (the site keeps reading PsychonautWiki for the rest).
  const current = byId(editingId);
  const scienceOnly = current?.source === "psychonautwiki" && !mainDirty && !pic.file && !pic.remove;
  const problem = scienceOnly ? sciValidate(entry.science) : validate(entry);
  showError(problem);
  if (problem) return;
  const btn = $("siSave");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving…";
  $("siForm").setAttribute("aria-busy", "true");
  let saved = null;
  let picError = "";
  try {
    const body = scienceOnly ? { id: editingId, scienceOnly: true, science: entry.science ?? null } : entry;
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(text.trim() || "Couldn't save that.");
    saved = JSON.parse(text);
    try {
      await uploadPicture(saved.id);
    } catch (error) {
      picError = error.message || "Couldn't save the picture.";
    }
  } catch (error) {
    showError(error.message || "Couldn't save that.");
  } finally {
    btn.disabled = false;
    btn.textContent = label;
    $("siForm").removeAttribute("aria-busy");
  }
  if (!saved) return;
  const wasNew = !editingId;
  dirty = false;
  await load();
  const fresh = byId(saved.id);
  if (fresh) {
    fillForm(fresh);
    setUrl({ id: fresh.id });
    renderList();
  }
  if (picError) {
    showError(`${saved.name} was saved, but the picture wasn't: ${picError}`);
    toast(`Picture not saved: ${picError}`, true);
  } else {
    toast(wasNew ? `${saved.name} added. It's in the Graph search now.` : `${saved.name} saved.`);
  }
  const flag = $("feSaved");
  flag.hidden = false;
  flag.classList.remove("is-on");
  void flag.offsetWidth;
  flag.classList.add("is-on");
}

async function remove() {
  const entry = byId(editingId);
  if (!entry) return;
  const pills = isPill(entry) ? [] : pillsOf(entry.id);
  const ok = await ask({
    title: `Delete ${entry.name}?`,
    text: pills.length
      ? `Its ${pills.length === 1 ? "pill goes" : `${pills.length} pills go`} too. Graph sessions that already use them keep their curves.`
      : "Graph sessions that already use it keep their curves. This can't be undone.",
    items: pills.map((p) => p.name),
    yes: pills.length ? `Delete all ${pills.length + 1}` : "Delete",
  });
  if (!ok) return;
  const btn = $("feDelete");
  btn.disabled = true;
  try {
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: entry.id, delete: true, withPills: pills.length > 0 }) });
    if (!res.ok) throw new Error((await res.text()).trim());
  } catch (error) {
    toast(error.message || "Couldn't delete that.", true);
    showError(error.message || "Couldn't delete that.");
    return;
  } finally {
    btn.disabled = false;
  }
  dirty = false;
  editingId = 0;
  showEditor(false);
  setUrl({});
  toast(pills.length ? `${entry.name} and its pills deleted.` : `${entry.name} deleted.`);
  await load();
}

// ---------------------------------------------------------------- start

function init() {
  const form = $("siForm");
  fillIconOptions();
  try { unit = localStorage.getItem("xn_si_unit") === "min" ? "min" : "h"; } catch (_) {}
  initScience();
  buildRows($("siTimes"), TIMES);
  buildRows($("siPeak2"), PEAK2);
  setUnitView();

  comboBox({
    input: $("feParent"),
    pop: $("feParentList"),
    source: async (q) => parentChoices(q),
    pick: (name, entry) => {
      setParent(entry?.id || 0, { fromUser: true });
      dirty = true;
      showError(null);
    },
  });
  $("feParent").addEventListener("input", () => {
    if (parentId && $("feParent").value.trim() !== byId(parentId)?.name) {
      parentId = 0;
      $("feParentBox").classList.remove("has-value");
      renderInherit();
      renderCopyTimes();
    }
  });
  $("fePillRoute").addEventListener("change", () => {
    dirty = true;
    renderInherit();
  });
  $("feCopyTimes").addEventListener("click", () => {
    const t = parentDurations();
    if (!t) return;
    writeDurations(t);
    timesTouched = true;
    changed();
  });

  form.addEventListener("submit", save);
  form.addEventListener("input", (e) => {
    if (!e.target.closest(".si-slider") && e.target.id !== "feParent") dirty = true;
    if (!e.target.closest("#seSci")) mainDirty = true;
    if (["fIcon", "fName", "fIngredient", "fClass"].includes(e.target.id)) showIcon();
    if (e.target.id === "fName") checkDupe();
    if (["fHalfMin", "fHalfMax"].includes(e.target.id)) renderInherit();
    if (e.target.classList.contains("is-invalid")) e.target.classList.remove("is-invalid");
    if (!$("siError").hidden) showError(null);
  });
  form.addEventListener("change", (e) => {
    if (e.target.id === "fIcon") showIcon();
  });
  document.querySelectorAll(".si-unit-btn").forEach((b) => b.addEventListener("click", () => switchUnit(b.dataset.unit)));
  document.querySelectorAll(".se-shape-btn").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.shape === shape) return;
    setShape(b.dataset.shape);
    timesTouched = true;
    changed();
  }));
  document.querySelectorAll(".se-kind-btn").forEach((b) => b.addEventListener("click", () => {
    if (editingId || b.dataset.kind === kind) return;
    setKind(b.dataset.kind);
    setUrl({ new: kind });
    if (kind === "pill" && !parentId) $("feParent").focus();
  }));
  $("fRoute").addEventListener("change", () => {
    methods[cur] = readMethod();
    renderMethods();
  });
  $("fPeak2On").addEventListener("change", () => {
    $("siPeak2").hidden = !$("fPeak2On").checked;
    timesTouched = true;
    changed();
  });
  document.querySelectorAll("[data-new]").forEach((b) => b.addEventListener("click", () => openNew(b.dataset.new)));
  $("siCancel").addEventListener("click", closeEditor);
  $("feClose").addEventListener("click", closeEditor);
  $("feDelete").addEventListener("click", remove);

  // Picture: pick, drop or remove.
  $("fePic").addEventListener("change", () => takePicture($("fePic").files[0]));
  $("fePicRemove").addEventListener("click", dropPicture);
  const drop = $("fePicDrop");
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("is-over");
    takePicture(e.dataTransfer?.files?.[0]);
  });

  // Overview: search, filters, sort.
  $("ovFind").addEventListener("input", renderList);
  $("ovImport").addEventListener("click", importPw);
  $("ovSort").addEventListener("change", () => {
    renderList();
    try { localStorage.setItem("xn_se_sort", $("ovSort").value); } catch (_) {}
  });
  try { $("ovSort").value = localStorage.getItem("xn_se_sort") || "name"; } catch (_) {}
  if (!$("ovSort").value) $("ovSort").value = "name";
  document.querySelectorAll(".se-filter").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.filter;
    document.querySelectorAll(".se-filter").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderList();
  }));

  // The confirm dialog.
  $("askYes").addEventListener("click", () => askDone && askDone(true));
  $("askNo").addEventListener("click", () => askDone && askDone(false));
  $("seAsk").addEventListener("click", (e) => {
    if (e.target === $("seAsk") && askDone) askDone(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && askDone) askDone(false);
  });
  window.addEventListener("beforeunload", (e) => {
    if (open && dirty) e.preventDefault();
  });

  load().then((ok) => {
    if (!ok) return;
    // ?id=<n> opens that entry, ?new=pill a new pill.
    const params = new URLSearchParams(location.search);
    const entry = byId(Number(params.get("id")));
    if (entry) openEntry(entry);
    else if (params.get("new") === "pill" || params.get("new") === "substance") openNew(params.get("new"));
  });
}

init();
