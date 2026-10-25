// ============================================================
// substances.js — the admin Substances Importer (/admin/substances).
// Custom substances are stored by the server in custom_substances,
// apart from PsychonautWiki. The preview draws with curve.js, the
// same code the Graph uses, so what you see is what the Graph draws.
// ============================================================

import { effectPhases, effectHours, effectCurve } from "./curve.js";

const $ = (id) => document.getElementById(id);
const API = "/admin/substances/api";

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

let unit = "h";
let list = [];
let editingId = 0;
let dirty = false;
let inspecting = null;
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
const numOrNull = (v) => {
  const s = String(v ?? "").trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

function toast(msg, isError) {
  if (window.xnToast) window.xnToast(msg, isError);
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
      changed();
    });
    number.addEventListener("input", () => {
      const v = numOrNull(number.value);
      const bad = Number.isNaN(v) || (v != null && v < 0) || (d.pct && v > 100);
      row.classList.toggle("is-bad", bad);
      if (!bad) range.value = v == null ? 0 : Math.min(Number(range.max), v);
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

// ---------------------------------------------------------------- form <-> entry

/** The timeline as stored: hours and shares, missing values filled sensibly. */
function readDurations() {
  const h = (k) => {
    const v = readRow(k);
    return v == null || Number.isNaN(v) ? 0 : Math.max(0, v);
  };
  const durations = {
    onset: h("onset"),
    comeup: h("comeup"),
    peak: h("peak"),
    comedown: h("comedown"),
    comedownLevel: 0,
    offset: h("offset"),
  };
  if (durations.comedown > 0) {
    const lvl = readRow("comedownLevel");
    durations.comedownLevel = lvl == null || Number.isNaN(lvl) ? 0.35 : Math.min(1, Math.max(0, lvl));
  }
  if ($("fPeak2On").checked) {
    const share = (k, d) => {
      const v = readRow(k);
      return v == null || Number.isNaN(v) ? d : Math.min(1, Math.max(0, v));
    };
    durations.peak2 = { gap: h("gap"), dip: share("dip", 0.5), duration: h("duration"), level: share("level", 1) };
  }
  return durations;
}

function readForm() {
  const range = (a, b) => {
    const min = numOrNull($(a).value), max = numOrNull($(b).value);
    if (min == null && max == null) return null;
    return { ...(min != null ? { min } : {}), ...(max != null ? { max } : {}) };
  };
  const one = (id) => numOrNull($(id).value);
  return {
    id: editingId,
    name: $("fName").value.trim(),
    aliases: splitList($("fAliases").value),
    class: $("fClass").value.trim(),
    chemicalClass: $("fChem").value.trim(),
    summary: $("fSummary").value.trim(),
    halfLife: range("fHalfMin", "fHalfMax"),
    addictionPotential: $("fAddiction").value.trim(),
    risks: $("fRisks").value.trim(),
    notes: $("fNotes").value.trim(),
    interactions: { dangerous: splitList($("fDangerous").value), unsafe: splitList($("fUnsafe").value), uncertain: splitList($("fUncertain").value) },
    route: $("fRoute").value,
    units: $("fUnits").value,
    dose: {
      threshold: one("dThreshold"),
      light: range("dLightMin", "dLightMax"),
      common: range("dCommonMin", "dCommonMax"),
      strong: range("dStrongMin", "dStrongMax"),
      heavy: one("dHeavy"),
    },
    durations: readDurations(),
  };
}

/** What's wrong with the form, as [element id, message], or null. */
function validate(entry) {
  if (!entry.name) return ["fName", "Give the substance a name."];
  const bad = (v) => v != null && (Number.isNaN(v) || v < 0);
  const badRange = (r) => r && (bad(r.min) || bad(r.max) || (r.min != null && r.max != null && r.min > r.max));
  if (badRange(entry.halfLife)) return ["fHalfMin", "The half-life needs numbers from 0 up, with the lowest first."];
  const d = entry.dose;
  for (const [key, id] of [["light", "dLightMin"], ["common", "dCommonMin"], ["strong", "dStrongMin"]]) {
    if (badRange(d[key])) return [id, "Each dose range needs numbers from 0 up, with the lowest first."];
  }
  if (bad(d.threshold)) return ["dThreshold", "The threshold must be a number from 0 up."];
  if (bad(d.heavy)) return ["dHeavy", "The heavy dose must be a number from 0 up."];
  const common = d.common?.min ?? d.common?.max;
  if (!(common > 0)) return ["dCommonMin", "Enter a common dose. The Graph scales the curve with it."];
  for (const key of Object.keys(rows)) {
    const v = readRow(key);
    if (Number.isNaN(v) || (v != null && v < 0) || (rows[key].pct && v > 1)) return ["t_" + key, `${rows[key].label} must be a number${rows[key].pct ? " from 0 to 100" : " from 0 up"}.`];
    if (!rows[key].pct && v > 240) return ["t_" + key, `${rows[key].label} can be at most 240 hours.`];
  }
  const t = entry.durations;
  if (t.comeup + t.peak + t.comedown + t.offset <= 0) return ["t_comeup", "Set at least the come-up, peak or offset, so there's a curve to draw."];
  if (t.peak2 && !(t.peak2.duration > 0)) return ["t_duration", "Give the second peak a length, or untick Second peak."];
  if (t.peak2 && !(t.peak2.level > 0)) return ["t_level", "The second peak's strength must be more than 0%."];
  return null;
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
  if (id && $(id)) {
    $(id).classList.add("is-invalid");
    $(id).focus({ preventScroll: false });
  }
}

function fillForm(entry) {
  const e = entry || {};
  const set = (id, v) => ($(id).value = v == null ? "" : v);
  set("fName", e.name);
  set("fAliases", (e.aliases || []).join(", "));
  set("fClass", e.class);
  set("fChem", e.chemicalClass);
  set("fSummary", e.summary);
  set("fHalfMin", e.halfLife?.min);
  set("fHalfMax", e.halfLife?.max);
  set("fAddiction", e.addictionPotential);
  set("fRisks", e.risks);
  set("fNotes", e.notes);
  set("fDangerous", (e.interactions?.dangerous || []).join(", "));
  set("fUnsafe", (e.interactions?.unsafe || []).join(", "));
  set("fUncertain", (e.interactions?.uncertain || []).join(", "));
  $("fRoute").value = e.route || "oral";
  $("fUnits").value = e.units || "mg";
  const d = e.dose || {};
  set("dThreshold", d.threshold);
  set("dLightMin", d.light?.min); set("dLightMax", d.light?.max);
  set("dCommonMin", d.common?.min); set("dCommonMax", d.common?.max);
  set("dStrongMin", d.strong?.min); set("dStrongMax", d.strong?.max);
  set("dHeavy", d.heavy);
  const t = e.durations || { onset: 0.5, comeup: 0.5, peak: 2, comedown: 0, offset: 2 };
  ["onset", "comeup", "peak", "comedown", "offset"].forEach((k) => writeRow(k, t[k] || 0));
  writeRow("comedownLevel", t.comedown > 0 ? t.comedownLevel || 0.35 : 0.35);
  const p2 = t.peak2;
  $("fPeak2On").checked = !!p2;
  $("siPeak2").hidden = !p2;
  PEAK2.forEach((r) => writeRow(r.key, p2 ? p2[r.key] : r.pct ? r.def / 100 : r.def));

  editingId = e.id || 0;
  $("siFormTitle").textContent = editingId ? `Edit ${e.name}` : "New substance";
  $("siEditing").hidden = !editingId;
  $("siSave").textContent = editingId ? "Save changes" : "Add substance";
  $("siCancel").hidden = !editingId;
  showError(null);
  dirty = false;
  drawPreview();
  markListSelection();
}

function confirmDiscard() {
  return !dirty || confirm("Discard the changes you haven't saved?");
}

// ---------------------------------------------------------------- preview

const PHASE_TINT = { onset: "var(--si-p0)", comeup: "var(--si-p1)", peak: "var(--si-p2)", dip: "var(--si-p1)", rise2: "var(--si-p1)", peak2: "var(--si-p2)", comedown: "var(--si-p3)", offset: "var(--si-p4)" };

function niceStep(total) {
  const steps = [0.25, 0.5, 1, 2, 3, 4, 6, 12, 24, 48];
  return steps.find((s) => total / s <= 8) || 96;
}

/** An SVG of the curve, with each phase shaded. */
export function previewSvg(durations, { compact = false } = {}) {
  const W = 600, H = compact ? 150 : 210, L = 34, R = 10, T = 12, B = 26;
  const phases = effectPhases(durations);
  const total = effectHours(durations);
  if (!(total > 0)) return `<p class="si-empty">Set the durations to see the curve.</p>`;
  const iw = W - L - R, ih = H - T - B;
  const x = (h) => L + (h / total) * iw;
  const y = (v) => T + ih - (v / 100) * ih;
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="si-svg" role="img" aria-label="Effect over ${esc(fmtHours(total))}">`;
  // phase bands
  let at = 0;
  phases.forEach((p) => {
    if (p.hours <= 0) return;
    svg += `<rect x="${x(at).toFixed(1)}" y="${T}" width="${Math.max(0.5, x(at + p.hours) - x(at)).toFixed(1)}" height="${ih}" fill="${PHASE_TINT[p.name]}" class="si-band"><title>${esc(PHASE_NAMES[p.name])}: ${esc(fmtHours(p.hours))}</title></rect>`;
    at += p.hours;
  });
  // grid
  [25, 50, 75, 100].forEach((v) => {
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="si-gl"/>`;
    svg += `<text x="${L - 6}" y="${y(v) + 3}" class="si-axis" text-anchor="end">${v}%</text>`;
  });
  const step = niceStep(total);
  for (let h = 0; h <= total + 1e-9; h += step) {
    svg += `<line x1="${x(h)}" x2="${x(h)}" y1="${T + ih}" y2="${T + ih + 4}" class="si-tick"/>`;
    svg += `<text x="${x(h)}" y="${H - 8}" class="si-axis" text-anchor="middle">${h >= 48 ? Math.round(h / 24 * 10) / 10 + "d" : Math.round(h * 100) / 100 + "h"}</text>`;
  }
  // the curve itself, exactly as the Graph builds it
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
  cancelAnimationFrame(previewFrame);
  previewFrame = requestAnimationFrame(drawPreview);
}

// ---------------------------------------------------------------- list

function iconFor(entry) {
  const xc = window.xnClass;
  if (!xc) return document.createElement("span");
  const key = xc.keyForClass(entry.class || "") || "";
  return key ? xc.icon(key) : Object.assign(document.createElement("span"), { className: "si-noicon" });
}

function markListSelection() {
  document.querySelectorAll(".si-item").forEach((li) => li.classList.toggle("is-current", Number(li.dataset.id) === editingId));
}

function renderList() {
  const q = $("lsFind").value.trim().toLowerCase();
  const box = $("lsList");
  const shown = list.filter((e) => !q || [e.name, ...(e.aliases || []), e.class || ""].some((n) => n.toLowerCase().includes(q)));
  $("lsCount").textContent = list.length ? String(list.length) : "";
  box.replaceChildren();
  if (!shown.length) {
    const li = document.createElement("li");
    li.className = "si-empty";
    li.textContent = list.length ? "Nothing matches." : "No custom substances yet. Fill in the form to add the first one.";
    box.append(li);
    return;
  }
  shown.forEach((e) => {
    const li = document.createElement("li");
    li.className = "si-item";
    li.dataset.id = e.id;
    const main = document.createElement("button");
    main.type = "button";
    main.className = "si-item-main";
    main.setAttribute("aria-label", `Inspect ${e.name}`);
    const name = document.createElement("span");
    name.className = "si-item-name";
    name.append(iconFor(e), e.name);
    const meta = document.createElement("span");
    meta.className = "si-item-meta";
    meta.textContent = [e.class, e.route, `${fmtHours(effectHours(e.durations))}`, e.durations?.peak2 ? "2 peaks" : ""].filter(Boolean).join(" · ");
    main.append(name, meta);
    main.addEventListener("click", () => inspect(e));
    const edit = iconButton("Edit", '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>', () => startEdit(e));
    const del = iconButton("Delete", '<path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', () => remove(e));
    del.classList.add("si-del");
    li.append(main, edit, del);
    box.append(li);
  });
  markListSelection();
}

function iconButton(label, path, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "si-icon-btn";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  b.addEventListener("click", onClick);
  return b;
}

async function load() {
  try {
    const res = await fetch(API, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(await res.text());
    list = await res.json();
  } catch (error) {
    $("lsList").innerHTML = `<li class="si-empty">Couldn't load the list. ${esc(error.message || "")}</li>`;
    return;
  }
  renderList();
}

function startEdit(entry) {
  if (!confirmDiscard()) return;
  closeInspect();
  fillForm(entry);
  $("siForm").scrollIntoView({ behavior: "smooth", block: "start" });
  $("fName").focus({ preventScroll: true });
}

async function remove(entry) {
  if (!confirm(`Delete ${entry.name}? Graph sessions that already use it keep their curves.`)) return;
  try {
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: entry.id, delete: true }) });
    if (!res.ok) throw new Error((await res.text()).trim());
  } catch (error) {
    toast(error.message || "Couldn't delete that.", true);
    return;
  }
  closeInspect();
  if (editingId === entry.id) fillForm(null);
  toast(`${entry.name} deleted.`);
  await load();
}

// ---------------------------------------------------------------- inspect

function inspect(entry) {
  inspecting = entry;
  $("inTitle").textContent = entry.name;
  const rowsHtml = [];
  const add = (label, value) => {
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) return;
    rowsHtml.push(`<div class="si-dl-row"><dt>${esc(label)}</dt><dd>${Array.isArray(value) ? value.map(esc).join(", ") : esc(value)}</dd></div>`);
  };
  const r = (v) => (v ? [v.min, v.max].filter((n) => n != null).join("–") : "");
  const u = entry.units || "";
  add("Other names", entry.aliases);
  add("Class", [entry.class, entry.chemicalClass].filter(Boolean).join(" · "));
  add("Half-life", r(entry.halfLife) ? r(entry.halfLife) + " h" : "");
  add("Addiction potential", entry.addictionPotential);
  add("Route", entry.route);
  const d = entry.dose || {};
  add("Doses", [
    d.threshold != null ? `threshold ${d.threshold} ${u}` : "",
    r(d.light) ? `light ${r(d.light)} ${u}` : "",
    r(d.common) ? `common ${r(d.common)} ${u}` : "",
    r(d.strong) ? `strong ${r(d.strong)} ${u}` : "",
    d.heavy != null ? `heavy ${d.heavy}+ ${u}` : "",
  ].filter(Boolean).join(" · "));
  add("Dangerous with", entry.interactions?.dangerous);
  add("Unsafe with", entry.interactions?.unsafe);
  add("Caution with", entry.interactions?.uncertain);
  add("Added by", entry.createdBy);
  add("Last changed", entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : "");
  const text = (label, v) => (v ? `<h3 class="si-legend">${esc(label)}</h3><p class="si-para">${esc(v)}</p>` : "");
  $("inBody").innerHTML =
    previewSvg(entry.durations, { compact: true }) +
    `<ol class="si-pv-legend">${legendHtml(entry.durations)}</ol>` +
    text("Summary", entry.summary) +
    `<dl class="si-dl">${rowsHtml.join("")}</dl>` +
    text("Risks", entry.risks) +
    text("Notes", entry.notes);
  const modal = $("siInspect");
  modal.hidden = false;
  document.documentElement.classList.add("xn-modal-open");
  modal.querySelector("[data-close]").focus();
}

function closeInspect() {
  $("siInspect").hidden = true;
  document.documentElement.classList.remove("xn-modal-open");
  inspecting = null;
}

// ---------------------------------------------------------------- save

async function save(event) {
  event.preventDefault();
  const entry = readForm();
  const problem = validate(entry);
  showError(problem);
  if (problem) return;
  const btn = $("siSave");
  btn.disabled = true;
  try {
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) });
    const text = await res.text();
    if (!res.ok) throw new Error(text.trim() || "Couldn't save that.");
    const out = JSON.parse(text);
    toast(editingId ? `${out.name} saved.` : `${out.name} added. It's in the Graph search now.`);
    await load();
    fillForm(list.find((e) => e.id === out.id) || null);
  } catch (error) {
    showError(error.message || "Couldn't save that.");
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- start

function init() {
  try { unit = localStorage.getItem("xn_si_unit") === "min" ? "min" : "h"; } catch (_) {}
  buildRows($("siTimes"), TIMES);
  buildRows($("siPeak2"), PEAK2);
  setUnitView();
  fillForm(null);

  $("siForm").addEventListener("submit", save);
  $("siForm").addEventListener("input", (e) => {
    if (!e.target.closest(".si-slider")) dirty = true;
    if (e.target.classList.contains("is-invalid")) e.target.classList.remove("is-invalid");
    if (!$("siError").hidden) showError(null);
  });
  document.querySelectorAll(".si-unit-btn").forEach((b) => b.addEventListener("click", () => switchUnit(b.dataset.unit)));
  $("fPeak2On").addEventListener("change", () => {
    $("siPeak2").hidden = !$("fPeak2On").checked;
    changed();
  });
  $("siNew").addEventListener("click", () => {
    if (!confirmDiscard()) return;
    fillForm(null);
    $("fName").focus();
  });
  $("siCancel").addEventListener("click", () => {
    if (confirmDiscard()) fillForm(null);
  });
  $("lsFind").addEventListener("input", renderList);
  $("inEdit").addEventListener("click", () => inspecting && startEdit(inspecting));
  $("inDelete").addEventListener("click", () => inspecting && remove(inspecting));
  $("siInspect").addEventListener("click", (e) => {
    if (e.target === $("siInspect") || e.target.closest("[data-close]")) closeInspect();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("siInspect").hidden) closeInspect();
  });
  window.addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });
  load();
}

init();
