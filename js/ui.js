// ============================================================
// ui.js
// DOM only: reads inputs, writes the DOM, wires event listeners.
// Every piece of business logic is delegated to logic.js; every
// chart draw is delegated to plot.js. This file owns none of
// the state itself, just element references + rendering.
// ============================================================

import * as logic from "./logic.js";
import * as plot from "./plot.js";

let suggestionTimer;
let els = {}; // populated in init()

document.addEventListener("DOMContentLoaded", init);

function init() {
  els = {
    input: document.getElementById("input"),
    suggestions: document.getElementById("sug"),
    suggestionList: document.getElementById("sugC"),
    status: document.getElementById("status"),
    searchButton: document.getElementById("searchButton"),

    dosePanel: document.getElementById("dosePanel"),
    doseInput: document.getElementById("doseInput"),
    doseUnit: document.getElementById("doseUnit"),
    doseStartHour: document.getElementById("doseStartHour"),
    releaseWindowField: document.getElementById("releaseWindowField"),
    releaseWindow: document.getElementById("releaseWindow"),
    addDoseButton: document.getElementById("addDoseButton"),
    resetButton: document.getElementById("resetButton"),
    saveButton: document.getElementById("saveButton"),

    doseList: document.getElementById("doses"),
    doseCount: document.getElementById("doseCount"),

    chartEmpty: document.getElementById("chartEmpty"),

    substanceInfo: document.getElementById("substanceInfo"),
    substanceImage: document.getElementById("substanceImage"),
    substanceName: document.getElementById("substanceName"),
    substanceSummary: document.getElementById("substanceSummary"),
    addictionPotential: document.getElementById("addictionPotential"),
    substanceTimes: document.getElementById("substanceTimes"),
    layout: document.querySelector(".tl-wrap"),

    toast: document.getElementById("toast"),

    formulationInputs: Array.from(document.querySelectorAll('input[name="formulation"]')),
  };

  bindEvents();
  renderDoseList();
  initConsent();
  initRecentControls();
  initTracker();
  renderRecent();
  renderTracker();
  initExperiences();
  loadCustomColors();
}

// Colors the account picked on Profile › Preferences. Signed out, the
// server answers [] and the default palette is used.
async function loadCustomColors() {
  try {
    const res = await fetch("/graphColors", { headers: { Accept: "application/json" } });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) return;
    const list = await res.json();
    if (!Array.isArray(list) || !list.length) return;
    logic.setCustomColors(list);
    renderRecent();
    renderDoseList();
    refreshChart();
    paintAddButton();
    renderTracker();
    renderExperiences();
  } catch (_) {
    // Offline or old server: keep the default colors.
  }
}

// ------------------------------------------------------------
// Cookie consent + recent doses (stored only after "Accept")
// ------------------------------------------------------------

const RECENT_COOKIE = "xn_recent";
const CONSENT_COOKIE = "xn_consent";
const RECENT_MAX = 8;

function readCookie(name) {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(name + "="));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

function writeCookie(name, value, days = 365) {
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${days * 86400}; path=/; SameSite=Lax`;
}

function hasConsent() {
  return readCookie(CONSENT_COOKIE) === "yes";
}

function initConsent() {
  const box = document.getElementById("cookieConsent");
  if (!box) return;
  const consent = readCookie(CONSENT_COOKIE);
  box.hidden = consent !== null;
  // Safari (all iOS browsers) expires cookies set from JavaScript after 7 days,
  // so re-save them on each visit to keep the choice and the recent list alive.
  if (consent === "yes" || consent === "no") writeCookie(CONSENT_COOKIE, consent);
  const recent = consent === "yes" ? readCookie(RECENT_COOKIE) : null;
  if (recent) writeCookie(RECENT_COOKIE, recent);
  document.getElementById("cookieAccept").addEventListener("click", () => {
    writeCookie(CONSENT_COOKIE, "yes");
    box.hidden = true;
    renderRecent();
    renderTracker();
    experiencesConsentChanged();
  });
  document.getElementById("cookieDecline").addEventListener("click", () => {
    writeCookie(CONSENT_COOKIE, "no");
    document.cookie = `${RECENT_COOKIE}=; max-age=0; path=/`;
    clearLog();
    box.hidden = true;
    renderRecent();
    renderTracker();
    experiencesConsentChanged();
  });
}

function getRecent() {
  if (!hasConsent()) return [];
  let list;
  try {
    list = JSON.parse(readCookie(RECENT_COOKIE) || "[]");
  } catch {
    list = null;
  }
  if (!Array.isArray(list)) {
    // Corrupt or hand-edited cookie: drop it rather than fail.
    document.cookie = `${RECENT_COOKIE}=; max-age=0; path=/`;
    return [];
  }
  const known = new Set(els.formulationInputs.map((c) => c.value));
  return list
    .filter((d) => d && typeof d.substance === "string" && d.substance.trim())
    .filter((d) => Number.isFinite(Number(d.amount)) && Number(d.amount) > 0)
    .map((d) => ({
      substance: d.substance.trim().slice(0, 80),
      amount: Number(d.amount),
      unit: typeof d.unit === "string" ? d.unit.slice(0, 12) : "",
      formulation: known.has(d.formulation) ? d.formulation : "immediate",
      label: typeof d.label === "string" ? d.label.slice(0, 40) : "",
      releaseHours: Number.isFinite(Number(d.releaseHours)) ? Number(d.releaseHours) : 0,
    }))
    .slice(0, RECENT_MAX);
}

function rememberDose(entry) {
  if (!hasConsent()) return;
  const key = (d) => `${d.substance}|${d.amount}|${d.formulation}`;
  const list = [entry, ...getRecent().filter((d) => key(d) !== key(entry))].slice(0, RECENT_MAX);
  writeCookie(RECENT_COOKIE, JSON.stringify(list));
}

const recentKey = (d) => `${d.substance}|${d.amount}|${d.formulation}`;

function initRecentControls() {
  document.getElementById("recentClear")?.addEventListener("click", () => {
    document.cookie = `${RECENT_COOKIE}=; max-age=0; path=/`;
    renderRecent();
    showToast("Recent doses cleared.");
  });
}

function removeRecent(entry) {
  const list = getRecent().filter((d) => recentKey(d) !== recentKey(entry));
  if (list.length) writeCookie(RECENT_COOKIE, JSON.stringify(list));
  else document.cookie = `${RECENT_COOKIE}=; max-age=0; path=/`;
  renderRecent();
}

function renderRecent() {
  const wrap = document.getElementById("recentDoses");
  if (!wrap) return;
  const list = getRecent();
  const box = wrap.querySelector("[data-recent-list]");
  box.replaceChildren();
  wrap.hidden = list.length === 0;
  list.forEach((d) => {
    // Same color the substance gets on the graph (assigned now if it has none yet).
    const color = logic.colorForSubstance(d.substance);
    const item = document.createElement("div");
    item.className = "recent-item";
    item.style.setProperty("--c", color);
    item.style.setProperty("--ct", `${color}14`);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "recent-dose";
    const name = document.createElement("strong");
    name.textContent = d.substance;
    const meta = document.createElement("span");
    meta.textContent = `${d.amount} ${d.unit || ""} · ${d.label || d.formulation}`;
    btn.append(name, meta);
    btn.addEventListener("click", () => useRecent(d));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "recent-del";
    del.textContent = "×";
    del.setAttribute("aria-label", `Remove ${d.substance} ${d.amount} ${d.unit || ""} from recent doses`);
    del.addEventListener("click", () => removeRecent(d));

    item.append(btn, del);
    box.appendChild(item);
  });
}

// ------------------------------------------------------------
// Total consumed tracker. The timeline view needs no storage; the
// today / 7 days views read a dose log kept in localStorage, only
// after the cookie popup was accepted.
// ------------------------------------------------------------

const LOG_KEY = "xn_dose_log";
const LOG_DAYS = 30;
const LOG_MAX = 500;
const logIdsByDose = new Map(); // timeline dose id -> log entry id (this visit only)
let trackerRange = "today"; // pane range: timeline | today | week | month

function readLog() {
  if (!hasConsent()) return [];
  try {
    const list = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    if (!Array.isArray(list)) throw new Error("bad log");
    return list.filter((e) => e && typeof e.s === "string" && Number.isFinite(e.a) && e.a > 0 && Number.isFinite(e.t));
  } catch {
    try { localStorage.removeItem(LOG_KEY); } catch {}
    return [];
  }
}

function writeLog(list) {
  const cutoff = Date.now() - LOG_DAYS * 86400000;
  const kept = list.filter((e) => e.t >= cutoff).slice(-LOG_MAX);
  try { localStorage.setItem(LOG_KEY, JSON.stringify(kept)); } catch {}
}

function clearLog() {
  logIdsByDose.clear();
  try { localStorage.removeItem(LOG_KEY); } catch {}
}

/** The dose's time today, or yesterday if that would be more than an hour from now. */
function doseTimestamp(time) {
  const [h, m] = String(time || "").split(":").map(Number);
  const d = new Date();
  if (Number.isFinite(h) && Number.isFinite(m)) d.setHours(h, m, 0, 0);
  if (d.getTime() - Date.now() > 3600000) d.setDate(d.getDate() - 1);
  return d.getTime();
}

function logDose(dose) {
  if (!hasConsent()) return;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  writeLog([...readLog(), { id, s: dose.substance, a: dose.amount, u: dose.unit || "", f: dose.formulation || "", t: doseTimestamp(dose.time) }]);
  logIdsByDose.set(dose.id, id);
}

function relogDose(dose) {
  const id = logIdsByDose.get(dose.id);
  if (!id) return;
  writeLog(readLog().map((e) => (e.id === id ? { ...e, a: dose.amount, t: doseTimestamp(dose.time) } : e)));
}

function unlogDose(doseId) {
  const id = logIdsByDose.get(doseId);
  if (!id) return;
  logIdsByDose.delete(doseId);
  writeLog(readLog().filter((e) => e.id !== id));
}

// ---- Total consumed pane --------------------------------------------------

const RANGES = {
  timeline: { label: "Timeline", days: 0 },
  today: { label: "Today", days: 1 },
  week: { label: "7 days", days: 7 },
  month: { label: "30 days", days: 30 },
};
const DAY = 86400000;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const fmtAmount = (a, u) => `${Number(Number(a).toFixed(2))} ${u || ""}`.trim();
const fmtClock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDay = (t) => new Date(t).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

function fmtAgo(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 0) return "upcoming";
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60 ? `${m % 60} min ` : ""}ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Entries for a range, newest first: { id?, s, a, u, f, t, onTimeline } */
function entriesFor(range) {
  if (range === "timeline") {
    return logic.getState().addedDoses
      .map((d) => ({ s: d.substance, a: d.amount, u: d.unit || "", f: d.formulation, t: doseTimestamp(d.time), onTimeline: true }))
      .sort((x, y) => y.t - x.t);
  }
  const from = range === "today" ? startOfDay(Date.now()) : startOfDay(Date.now() - (RANGES[range].days - 1) * DAY);
  return readLog().filter((e) => e.t >= from).sort((x, y) => y.t - x.t);
}

function summarize(entries) {
  const groups = new Map();
  entries.forEach((e) => {
    const key = `${e.s}|${e.u}`;
    const g = groups.get(key) || { s: e.s, u: e.u, total: 0, n: 0, max: 0, first: Infinity, last: 0, list: [] };
    g.total += Number(e.a);
    g.n += 1;
    g.max = Math.max(g.max, Number(e.a));
    g.first = Math.min(g.first, e.t);
    g.last = Math.max(g.last, e.t);
    g.list.push(e);
    groups.set(key, g);
  });
  return [...groups.values()].sort((x, y) => y.last - x.last);
}

function initTracker() {
  const pane = document.getElementById("trackerPane");
  document.getElementById("trackerOpen")?.addEventListener("click", openTrackerPane);
  if (!pane) return;
  pane.querySelectorAll("[data-range]").forEach((btn) =>
    btn.addEventListener("click", () => {
      trackerRange = btn.dataset.range;
      renderTrackerPane();
    })
  );
  pane.querySelector("[data-close]")?.addEventListener("click", closeTrackerPane);
  // Tap on the dimmed backdrop closes the pane.
  pane.addEventListener("click", (event) => { if (event.target === pane) closeTrackerPane(); });
  pane.addEventListener("close", () => document.documentElement.classList.remove("xn-modal-open"));
  document.getElementById("trackerClear")?.addEventListener("click", () => {
    if (!window.confirm("Delete your whole dose history on this device?")) return;
    clearLog();
    renderTracker();
    showToast("Dose history cleared.");
  });
  pane.addEventListener("click", (event) => {
    const del = event.target.closest("[data-del-log]");
    if (!del) return;
    const id = del.dataset.delLog;
    writeLog(readLog().filter((e) => e.id !== id));
    for (const [doseId, logId] of logIdsByDose) if (logId === id) logIdsByDose.delete(doseId);
    renderTracker();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) renderTracker(); });
}

function openTrackerPane() {
  const pane = document.getElementById("trackerPane");
  if (!pane) return;
  renderTrackerPane();
  document.documentElement.classList.add("xn-modal-open");
  if (typeof pane.showModal === "function") pane.showModal();
  else pane.setAttribute("open", "");
}

function closeTrackerPane() {
  const pane = document.getElementById("trackerPane");
  if (!pane) return;
  if (typeof pane.close === "function") pane.close();
  else pane.removeAttribute("open");
  document.documentElement.classList.remove("xn-modal-open");
}

/** Updates the small button in the card and, if it is open, the pane. */
function renderTracker() {
  const consent = hasConsent();
  const peek = document.getElementById("trackerPeek");
  if (peek) {
    const range = consent ? "today" : "timeline";
    const entries = entriesFor(range);
    const subs = new Set(entries.map((e) => e.s)).size;
    peek.textContent = entries.length
      ? `${RANGES[range].label} · ${entries.length} dose${entries.length === 1 ? "" : "s"} · ${subs} substance${subs === 1 ? "" : "s"}`
      : `${RANGES[range].label} · nothing yet`;
  }
  const pane = document.getElementById("trackerPane");
  if (pane?.open) renderTrackerPane();
}

function renderTrackerPane() {
  const pane = document.getElementById("trackerPane");
  if (!pane) return;
  const consent = hasConsent();
  if (!consent) trackerRange = "timeline";

  pane.querySelectorAll("[data-range]").forEach((btn) => {
    btn.setAttribute("aria-selected", String(btn.dataset.range === trackerRange));
    btn.disabled = btn.dataset.range !== "timeline" && !consent;
  });

  const entries = entriesFor(trackerRange);
  const groups = summarize(entries);

  // Headline tiles
  const stats = pane.querySelector("[data-stats]");
  stats.replaceChildren();
  const tile = (label, value, sub) => {
    const t = el("div", "pane-stat");
    t.append(el("span", "pane-stat-label", label), el("strong", "pane-stat-value", value));
    if (sub) t.append(el("span", "pane-stat-sub", sub));
    stats.append(t);
  };
  const last = entries[0];
  tile("Doses", String(entries.length));
  tile("Substances", String(groups.length));
  tile("Last dose", last ? fmtAgo(last.t) : "-", last ? `${last.s} · ${fmtClock(last.t)}` : "");

  // Per-substance cards
  const cards = pane.querySelector("[data-substances]");
  cards.replaceChildren();
  if (!groups.length) {
    cards.append(el("p", "dose-list-empty", trackerRange === "timeline" ? "Nothing on the timeline yet." : "No doses logged in this period."));
  }
  const days = RANGES[trackerRange].days;
  groups.forEach((g) => {
    const color = logic.colorForSubstance(g.s); // same color as on the graph
    const card = el("article", "pane-sub");
    card.style.setProperty("--c", color);

    const head = el("div", "pane-sub-head");
    const name = el("h3", "pane-sub-name");
    const dot = el("span", "pane-dot");
    name.append(dot, document.createTextNode(g.s));
    head.append(name, el("strong", "pane-sub-total", fmtAmount(g.total, g.u)));
    card.append(head);

    const facts = el("dl", "pane-facts");
    const fact = (k, v, wide) => { const w = el("div", wide ? "wide" : ""); w.append(el("dt", "", k), el("dd", "", v)); facts.append(w); };
    fact("Doses", String(g.n));
    fact("Average", fmtAmount(g.total / g.n, g.u));
    fact("Largest", fmtAmount(g.max, g.u));
    fact("Last", `${fmtAgo(g.last)} · ${days > 1 ? `${fmtDay(g.last)}, ` : ""}${fmtClock(g.last)}`, true);
    if (g.n > 1) fact("First", `${days > 1 ? `${fmtDay(g.first)}, ` : ""}${fmtClock(g.first)}`, true);
    card.append(facts);

    // Daily bars for multi-day ranges (one column per day, oldest left).
    if (days > 1) {
      const today = startOfDay(Date.now());
      const perDay = Array.from({ length: days }, (_, i) => ({ t: today - (days - 1 - i) * DAY, a: 0, n: 0 }));
      g.list.forEach((e) => {
        const i = days - 1 - Math.round((today - startOfDay(e.t)) / DAY);
        if (perDay[i]) { perDay[i].a += Number(e.a); perDay[i].n += 1; }
      });
      const peak = Math.max(...perDay.map((d) => d.a)) || 1;
      const chart = el("div", "pane-bars");
      chart.setAttribute("role", "img");
      chart.setAttribute("aria-label", `${g.s} per day: ${perDay.filter((d) => d.a).map((d) => `${fmtDay(d.t)} ${fmtAmount(d.a, g.u)}`).join(", ") || "none"}`);
      perDay.forEach((d) => {
        const col = el("div", "pane-bar");
        const tip = `${fmtDay(d.t)}: ${d.a ? `${fmtAmount(d.a, g.u)} in ${d.n} dose${d.n === 1 ? "" : "s"}` : "none"}`;
        col.title = tip;
        col.dataset.tip = tip;
        const fill = el("span");
        fill.style.height = d.a ? `${Math.max(6, (d.a / peak) * 100)}%` : "0";
        col.append(fill);
        chart.append(col);
      });
      const axis = el("div", "pane-bars-axis");
      axis.append(el("span", "", fmtDay(perDay[0].t)), el("span", "", "Today"));
      card.append(chart, axis);
    }
    cards.append(card);
  });

  // Every dose, newest first
  const log = pane.querySelector("[data-log]");
  log.replaceChildren();
  pane.querySelector("[data-log-wrap]").hidden = entries.length === 0;
  entries.forEach((e) => {
    const row = el("li", "pane-log-row");
    row.style.setProperty("--c", logic.colorForSubstance(e.s));
    const when = el("span", "pane-log-when", days > 1 ? `${fmtDay(e.t)} ${fmtClock(e.t)}` : fmtClock(e.t));
    const what = el("span", "pane-log-what");
    what.append(el("span", "pane-dot"), document.createTextNode(e.s));
    const amt = el("span", "pane-log-amt", fmtAmount(e.a, e.u));
    const rel = el("span", "pane-log-rel", e.f || "");
    row.append(when, what, amt, rel);
    if (e.id) {
      const del = el("button", "remove-dose pane-log-del", "×");
      del.type = "button";
      del.dataset.delLog = e.id;
      del.setAttribute("aria-label", `Delete ${e.s} ${fmtAmount(e.a, e.u)} at ${fmtClock(e.t)} from history`);
      row.append(del);
    }
    log.append(row);
  });

  const note = pane.querySelector("[data-note]");
  note.textContent = !consent
    ? "Accept cookies to keep a daily, weekly and monthly history on this device."
    : trackerRange === "timeline"
      ? "Doses currently on the graph."
      : "Every dose you add is logged on this device for 30 days. Removing it from the timeline removes it here too.";
  document.getElementById("trackerClear").hidden = !consent || readLog().length === 0;
}

async function useRecent(d) {
  els.input.value = d.substance;
  await handleSearch();
  if (els.dosePanel.hidden) return;
  els.doseInput.value = d.amount;
  const box = els.formulationInputs.find((c) => c.value === d.formulation);
  if (box) {
    box.checked = true;
    selectFormulation(box);
    if (d.formulation !== "immediate" && d.releaseHours) els.releaseWindow.value = d.releaseHours;
  }
  els.doseStartHour.focus({ preventScroll: true });
  els.doseStartHour.classList.remove("tl-attn");
  void els.doseStartHour.offsetWidth; // restart the highlight if it is already running
  els.doseStartHour.classList.add("tl-attn");
  setTimeout(() => els.doseStartHour.classList.remove("tl-attn"), 3000);
  if (window.matchMedia("(max-width: 1279px)").matches) {
    els.doseStartHour.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function bindEvents() {
  els.input.addEventListener("input", () => {
    clearTimeout(suggestionTimer);
    const value = els.input.value.trim();
    if (value.length < 2) {
      els.suggestions.hidden = true;
      return;
    }
    suggestionTimer = setTimeout(handleSuggestions, 350);
  });

  els.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSearch();
    }
  });

  els.searchButton.addEventListener("click", handleSearch);

  els.formulationInputs.forEach((checkbox) => {
    checkbox.addEventListener("change", () => selectFormulation(checkbox));
  });

  els.addDoseButton.addEventListener("click", handleAddDose);
  els.resetButton.addEventListener("click", handleReset);
  els.saveButton.addEventListener("click", handleSave);

  // event delegation for the per-dose edit / remove buttons rendered dynamically
  els.doseList.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-dose]");
    if (edit) {
      openDoseEditor(Number(edit.dataset.editDose));
      return;
    }
    const cancel = event.target.closest("[data-edit-cancel]");
    if (cancel) {
      const id = Number(cancel.dataset.editCancel);
      renderDoseList();
      els.doseList.querySelector(`[data-edit-dose="${id}"]`)?.focus();
      return;
    }
    const button = event.target.closest("[data-remove-dose]");
    if (!button) return;
    const id = Number(button.dataset.removeDose);
    logic.removeDoseFromState(id);
    unlogDose(id);
    renderDoseList();
    refreshChart();
    renderTracker();
    experienceChanged();
  });

  els.doseList.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-edit-form]");
    if (!form) return;
    event.preventDefault();
    const id = Number(form.dataset.editForm);
    try {
      const dose = logic.updateDoseInState(id, {
        amount: form.querySelector("[name=amount]").value,
        time: form.querySelector("[name=time]").value,
      });
      relogDose(dose);
      renderDoseList();
      refreshChart();
      renderTracker();
      experienceChanged();
      els.doseList.querySelector(`[data-edit-dose="${id}"]`)?.focus();
      showToast(`${dose.substance} dose updated.`);
    } catch (error) {
      showToast(error.message, true);
    }
  });
  els.doseList.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const form = event.target.closest("[data-edit-form]");
    if (!form) return;
    const id = Number(form.dataset.editForm);
    renderDoseList();
    els.doseList.querySelector(`[data-edit-dose="${id}"]`)?.focus();
  });

  window.addEventListener("resize", () => plot.resizePlot("myPlot"));
  window.addEventListener("orientationchange", () => setTimeout(() => refreshChart(), 250));
}

// ------------------------------------------------------------
// Experiences: every time the graph is used it is saved as a session
// that can be opened again. Signed in, sessions are kept on the account
// (/experiences); signed out, on this device after the cookie popup was
// accepted.
// ------------------------------------------------------------

const EXP_KEY = "xn_experiences";
const EXP_LOCAL_MAX = 100;
let expMode = "loading"; // account | local | off
let expUnreachable = false; // the server didn't answer /experiences (offline, or still running an older version)
let experiences = []; // newest first: { id, startedAt, updatedAt, doses, people }
let sharedExperiences = []; // friends' sessions they added this account to: { ..., owner }
let activeExp = null; // the session on the timeline now: { id, startedAt, viewOnly?, owner? }
let expTimer = null;
let expQueue = Promise.resolve();

async function initExperiences() {
  if (!document.getElementById("experiences")) return;
  window.addEventListener("pagehide", flushExperience);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushExperience();
  });
  renderExperiences();
  try {
    const res = await fetch("/experiences", { headers: { Accept: "application/json" } });
    if (res.ok && (res.headers.get("content-type") || "").includes("json")) {
      const data = await res.json();
      if (data?.signedIn) {
        expMode = "account";
        experiences = Array.isArray(data.items) ? data.items : [];
        sharedExperiences = Array.isArray(data.shared) ? data.shared : [];
      }
    } else {
      expUnreachable = true;
    }
  } catch (_) {
    expUnreachable = true; // offline: fall back to this device
  }
  if (expMode !== "account") {
    expMode = hasConsent() ? "local" : "off";
    experiences = readLocalExperiences();
  }
  renderExperiences();
  // /?exp=<id> comes from "Open in the Graph" on the Profile page.
  const wanted = new URLSearchParams(location.search).get("exp");
  if (wanted) {
    history.replaceState(null, "", location.pathname + location.hash);
    const entry = experiences.find((e) => String(e.id) === wanted);
    const shared = sharedExperiences.find((e) => String(e.id) === wanted);
    if ((entry || shared) && !logic.getState().addedDoses.length) {
      await (entry ? openExperience(entry.id) : openSharedExperience(shared.id));
      return;
    }
    if (shared) return;
    if (!entry) showToast("That Graph session isn't saved on this account any more.", true);
  }
  // A dose added while the list was still loading.
  if (logic.getState().addedDoses.length) experienceChanged();
}

function experiencesConsentChanged() {
  if (expMode === "account" || expMode === "loading") return;
  expMode = hasConsent() ? "local" : "off";
  if (expMode === "off") {
    try { localStorage.removeItem(EXP_KEY); } catch {}
    experiences = [];
    if (activeExp) activeExp.id = null;
  } else {
    experienceChanged(); // keep the timeline that is on screen now
  }
  renderExperiences();
}

function readLocalExperiences() {
  if (!hasConsent()) return [];
  try {
    const list = JSON.parse(localStorage.getItem(EXP_KEY) || "[]");
    if (!Array.isArray(list)) throw new Error("bad list");
    return list
      .filter((e) => e && typeof e.id === "string" && Number.isFinite(e.startedAt) && Array.isArray(e.doses) && e.doses.length)
      .sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    try { localStorage.removeItem(EXP_KEY); } catch {}
    return [];
  }
}

function writeLocalExperiences() {
  try {
    localStorage.setItem(EXP_KEY, JSON.stringify(experiences.slice(0, EXP_LOCAL_MAX)));
  } catch {
    showToast("This device is out of space, so this session wasn't saved.", true);
  }
}

async function storeExperience(entry) {
  if (expMode === "account") {
    const res = await fetch("/experiences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entry.id || 0, startedAt: entry.startedAt, doses: entry.doses }),
      keepalive: true,
    });
    if (res.status === 401) throw new Error("Log in again to keep saving your experiences.");
    if (!res.ok) throw new Error((await res.text()).trim() || "This session couldn't be saved.");
    return res.json();
  }
  const saved = {
    id: entry.id || `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    startedAt: entry.startedAt,
    updatedAt: Date.now(),
    doses: entry.doses,
  };
  experiences = [saved, ...experiences.filter((e) => e.id !== saved.id)].sort((a, b) => b.startedAt - a.startedAt);
  writeLocalExperiences();
  return saved;
}

async function dropExperience(id) {
  if (expMode === "account") {
    const res = await fetch("/experiences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, delete: true }),
      keepalive: true,
    });
    if (res.status === 401) throw new Error("Log in again to change your experiences.");
    if (!res.ok) throw new Error("That couldn't be deleted. Try again.");
  }
  experiences = experiences.filter((e) => e.id !== id);
  if (expMode === "local") writeLocalExperiences();
}

/** Runs store writes one after another so a new session gets its id before the next save. */
function queueExperience(task) {
  expQueue = expQueue.then(task).catch((error) => showToast(error.message || "This session couldn't be saved.", true));
  return expQueue;
}

/** Call after any change to the timeline; saves it a moment later. */
function experienceChanged() {
  if (activeExp?.viewOnly) {
    // A friend's session stays theirs; changing it starts your own copy.
    activeExp.viewOnly = false;
    if (expMode === "account" || expMode === "local") showToast(`Saved as your own copy of ${activeExp.owner}'s session.`);
  }
  clearTimeout(expTimer);
  expTimer = setTimeout(flushExperience, 400);
}

/** Saves the timeline on screen now (the doses are read right away). */
function flushExperience() {
  clearTimeout(expTimer);
  expTimer = null;
  if (expMode !== "account" && expMode !== "local") return expQueue;
  if (activeExp?.viewOnly) return expQueue; // a friend's session, opened to look at
  const doses = logic.snapshotDoses();
  if (!doses.length && !activeExp) return expQueue;
  if (!activeExp) activeExp = { id: null, startedAt: Date.now() };
  const target = activeExp;
  return queueExperience(async () => {
    if (!doses.length) {
      // Every dose was removed, so the session is gone too.
      if (target.id) await dropExperience(target.id);
      target.id = null;
      if (activeExp === target) activeExp = null;
    } else {
      const saved = await storeExperience({ id: target.id, startedAt: target.startedAt, doses });
      if (!saved.people) saved.people = experiences.find((e) => e.id === saved.id)?.people || [];
      target.id = saved.id;
      target.startedAt = saved.startedAt;
      experiences = [saved, ...experiences.filter((e) => e.id !== saved.id)].sort((a, b) => b.startedAt - a.startedAt);
    }
    renderExperiences();
  });
}

async function openExperience(id) {
  await flushExperience();
  const entry = experiences.find((e) => e.id === id);
  if (!entry) return;
  const doses = logic.loadDoses(entry.doses);
  if (!doses.length) {
    showToast("That session can't be drawn any more.", true);
    return;
  }
  activeExp = { id: entry.id, startedAt: entry.startedAt };
  showOpenedSession();
  showToast(`Opened your session from ${expDayLabel(entry.startedAt).toLowerCase()}.`);
}

/** Opens a friend's session to look at. Changing it saves your own copy. */
async function openSharedExperience(id) {
  await flushExperience();
  const entry = sharedExperiences.find((e) => e.id === id);
  if (!entry) return;
  const doses = logic.loadDoses(entry.doses);
  if (!doses.length) {
    showToast("That session can't be drawn any more.", true);
    return;
  }
  const owner = entry.owner?.name || "a friend";
  activeExp = { id: null, startedAt: entry.startedAt, viewOnly: true, owner };
  showOpenedSession();
  showToast(`Opened ${owner}'s session from ${expDayLabel(entry.startedAt).toLowerCase()}.`);
}

function showOpenedSession() {
  logIdsByDose.clear(); // these doses were counted when they were first added
  renderDoseList();
  refreshChart();
  renderRecent();
  paintAddButton();
  renderTracker();
  if (window.matchMedia("(max-width: 1279px)").matches) {
    document.getElementById("chartCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// ---- Who was there: friends added to a session (account mode only)

function peopleText(people) {
  const names = (people || []).map((p) => p.name);
  if (!names.length) return "";
  if (names.length <= 3) return "With " + names.join(", ");
  return "With " + names.slice(0, 2).join(", ") + " and " + (names.length - 2) + " more";
}

let peopleDialog = null;

async function editPeople(entry) {
  if (!peopleDialog) {
    peopleDialog = document.createElement("dialog");
    peopleDialog.className = "ppl";
    peopleDialog.setAttribute("aria-labelledby", "pplTitle");
    peopleDialog.innerHTML = `
      <form method="dialog" class="ppl-case">
        <div>
          <p class="ppl-eyebrow" data-ppl-day></p>
          <h2 id="pplTitle">Who was with you?</h2>
          <p class="ppl-sub">Friends you add see this session under "Shared with you" on their Graph page.</p>
        </div>
        <div class="ppl-list" data-ppl-list></div>
        <div class="ppl-bar">
          <button type="submit" value="cancel" class="ppl-btn">Cancel</button>
          <button type="submit" value="save" class="ppl-btn ppl-primary" data-ppl-save>Save</button>
        </div>
      </form>`;
    peopleDialog.addEventListener("click", (event) => {
      if (event.target === peopleDialog) peopleDialog.close("cancel");
    });
    document.body.appendChild(peopleDialog);
  }
  const list = peopleDialog.querySelector("[data-ppl-list]");
  const save = peopleDialog.querySelector("[data-ppl-save]");
  peopleDialog.querySelector("[data-ppl-day]").textContent = "Session from " + expDayLabel(entry.startedAt).toLowerCase();
  list.innerHTML = '<p class="ppl-note">Loading your friends…</p>';
  save.hidden = true;
  peopleDialog.showModal();

  let friends = null;
  try {
    const res = await fetch("/friends", { headers: { Accept: "application/json" } });
    if (res.ok && (res.headers.get("content-type") || "").includes("json")) friends = (await res.json()).friends || [];
  } catch {}
  // Closed while the friends were loading.
  if (!peopleDialog.open) return;
  if (!friends) {
    list.innerHTML = '<p class="ppl-note">Couldn\'t load your friends. Try again in a moment.</p>';
    return;
  }
  const chosen = new Set((entry.people || []).map((p) => p.name.toLowerCase()));
  if (!friends.length) {
    list.innerHTML = '<p class="ppl-note">You have no friends added yet. Open someone\'s profile from the <a href="/Forum">Forum</a> and tap Add friend.</p>';
    return;
  }
  list.replaceChildren(...friends.map((friend) => {
    const row = el("label", "ppl-row");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = friend.name;
    box.checked = chosen.has(friend.name.toLowerCase());
    const face = el("span", "ppl-face");
    if (friend.avatar) {
      const img = document.createElement("img");
      img.src = friend.avatar;
      img.alt = "";
      face.appendChild(img);
    } else {
      face.textContent = friend.initial || "?";
    }
    row.append(box, face, el("span", "ppl-name", friend.name));
    return row;
  }));
  save.hidden = false;
  list.querySelector("input")?.focus();

  const answer = await new Promise((done) => peopleDialog.addEventListener("close", () => done(peopleDialog.returnValue), { once: true }));
  if (answer !== "save") return;
  const people = [...list.querySelectorAll("input:checked")].map((box) => box.value);
  try {
    const res = await fetch("/experiences/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entry.id, people }),
    });
    if (res.status === 401) throw new Error("Log in again to change who was there.");
    if (!res.ok) throw new Error((await res.text()).trim() || "Couldn't save who was there. Try again.");
    entry.people = (await res.json()).people || [];
    renderExperiences();
    showToast(entry.people.length ? peopleText(entry.people) + "." : "Nobody else is on this session now.");
  } catch (error) {
    showToast(error.message, true);
  }
}

function expDayLabel(t) {
  const day = startOfDay(t);
  const today = startOfDay(Date.now());
  if (day === today) return "Today";
  if (day === startOfDay(today - DAY / 2)) return "Yesterday";
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** A tiny line per substance, scaled to the session's own peak. */
function experienceSpark(preview, colors) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "exp-spark");
  svg.setAttribute("viewBox", "0 0 100 34");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const base = document.createElementNS(SVG_NS, "line");
  base.setAttribute("x1", "0");
  base.setAttribute("x2", "100");
  base.setAttribute("y1", "33");
  base.setAttribute("y2", "33");
  svg.appendChild(base);
  preview.series.forEach((item, index) => {
    const step = 100 / (item.y.length - 1);
    const d = item.y
      .map((value, i) => `${i ? "L" : "M"}${(i * step).toFixed(2)} ${(33 - (value / preview.peak) * 30).toFixed(2)}`)
      .join("");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.style.setProperty("--c", colors[index]);
    svg.appendChild(path);
  });
  return svg;
}

function renderExperiences() {
  const wrap = document.getElementById("experiences");
  if (!wrap) return;
  const list = wrap.querySelector("[data-exp-list]");
  const note = wrap.querySelector("[data-exp-note]");
  const count = wrap.querySelector("[data-exp-count]");
  list.replaceChildren();
  count.textContent = experiences.length ? String(experiences.length) : "";

  note.hidden = true;
  if (expMode === "off" && expUnreachable) {
    note.hidden = false;
    note.textContent = "Couldn't reach your saved experiences. Reload the page to try again.";
  } else if (expMode === "off") {
    note.hidden = false;
    const undecided = readCookie(CONSENT_COOKIE) === null;
    note.innerHTML = 'Your sessions aren\'t being saved. <a href="/Main?next=/">Log in</a> to keep them on your account' +
      (undecided ? ", or accept the cookie popup to keep them on this device." : ".");
  } else if (expMode === "local" && expUnreachable) {
    note.hidden = false;
    note.textContent = "Couldn't reach your saved experiences, so new ones stay on this device for now. Reload the page to try again.";
  } else if (expMode === "local") {
    note.hidden = false;
    note.innerHTML = 'Saved on this device only. <a href="/Main?next=/">Log in</a> to keep them on your account.';
  }

  if (!experiences.length) {
    if (expMode === "off") return;
    const empty = el("p", "exp-empty", expMode === "loading" ? "Loading your experiences…" : "Each time you use the graph it's saved here, so you can open it again later.");
    list.appendChild(empty);
  }

  experiences.forEach((entry) => {
    const preview = logic.previewTimeline(entry.doses);
    if (!preview) return;
    const colors = logic.previewColors(preview.names);
    const times = entry.doses.map((d) => d.time).filter(Boolean).sort();
    const first = times[0] || "";
    const last = times[times.length - 1] || "";
    const day = expDayLabel(entry.startedAt);
    const doseWord = `${entry.doses.length} dose${entry.doses.length === 1 ? "" : "s"}`;

    const item = el("div", "exp-item");
    item.setAttribute("role", "listitem");
    item.style.setProperty("--c", colors[0]);

    const open = el("button", "exp-open");
    open.type = "button";
    open.setAttribute("aria-label", `Open session from ${day}, ${first}${last !== first ? ` to ${last}` : ""}: ${preview.names.join(", ")}, ${doseWord}`);
    const top = el("span", "exp-top");
    top.append(el("strong", "", day), el("span", "", last !== first ? `${first}–${last}` : first));
    const subs = el("span", "exp-subs");
    preview.names.forEach((name, index) => {
      const tag = el("span");
      const dot = el("i");
      dot.style.setProperty("--c", colors[index]);
      tag.append(dot, document.createTextNode(name));
      subs.appendChild(tag);
    });
    const length = formatHours(preview.hours);
    open.append(top, experienceSpark(preview, colors), subs, el("span", "exp-meta", length ? `${doseWord} · about ${length}` : doseWord));
    if (entry.people?.length) open.appendChild(el("span", "exp-with", peopleText(entry.people)));
    open.addEventListener("click", () => openExperience(entry.id));

    const del = el("button", "recent-del", "×");
    del.type = "button";
    const label = `Delete the session from ${day}${first ? ` at ${first}` : ""}`;
    del.setAttribute("aria-label", label);
    let armed = null;
    const disarm = () => {
      clearTimeout(armed);
      armed = null;
      del.classList.remove("is-confirm");
      del.textContent = "×";
      del.setAttribute("aria-label", label);
    };
    del.addEventListener("blur", disarm);
    del.addEventListener("click", () => {
      if (!armed) {
        // First tap asks, second tap deletes.
        del.classList.add("is-confirm");
        del.textContent = "Delete?";
        del.setAttribute("aria-label", `${label}? Tap again to delete`);
        armed = setTimeout(disarm, 4000);
        return;
      }
      disarm();
      queueExperience(async () => {
        await dropExperience(entry.id);
        if (activeExp?.id === entry.id) activeExp = null;
        renderExperiences();
        showToast("Session deleted.");
        document.querySelector("#experiences .exp-open, #experiences .exp-empty")?.focus?.();
      });
    });

    item.append(open, del);
    if (expMode === "account") {
      const ppl = el("button", "exp-ppl");
      ppl.type = "button";
      ppl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.3c1.7.6 2.8 2.2 3.1 4.7"/></svg>';
      ppl.setAttribute("aria-label", `Who was with you, session from ${day}`);
      ppl.title = "Who was with you";
      if (entry.people?.length) ppl.classList.add("has-people");
      ppl.addEventListener("click", () => editPeople(entry));
      item.appendChild(ppl);
    }
    list.appendChild(item);
  });

  if (!sharedExperiences.length) return;
  list.appendChild(el("p", "exp-shared-title", "Shared with you"));
  sharedExperiences.forEach((entry) => {
    const preview = logic.previewTimeline(entry.doses);
    if (!preview) return;
    const colors = logic.previewColors(preview.names);
    const times = entry.doses.map((d) => d.time).filter(Boolean).sort();
    const first = times[0] || "";
    const last = times[times.length - 1] || "";
    const day = expDayLabel(entry.startedAt);
    const owner = entry.owner?.name || "A friend";
    const item = el("div", "exp-item is-shared");
    item.setAttribute("role", "listitem");
    item.style.setProperty("--c", colors[0]);
    const open = el("button", "exp-open");
    open.type = "button";
    open.setAttribute("aria-label", `Open ${owner}'s session from ${day}: ${preview.names.join(", ")}`);
    const top = el("span", "exp-top");
    top.append(el("strong", "", day), el("span", "", last !== first ? `${first}–${last}` : first));
    const subs = el("span", "exp-subs");
    preview.names.forEach((name, index) => {
      const tag = el("span");
      const dot = el("i");
      dot.style.setProperty("--c", colors[index]);
      tag.append(dot, document.createTextNode(name));
      subs.appendChild(tag);
    });
    const others = entry.people || []; // the server leaves you out
    open.append(el("span", "exp-from", `${owner}'s session`), top, experienceSpark(preview, colors), subs);
    if (others.length) open.appendChild(el("span", "exp-with", peopleText(others).replace(/^With/, "Also with")));
    open.addEventListener("click", () => openSharedExperience(entry.id));
    item.appendChild(open);
    list.appendChild(item);
  });
}

// ------------------------------------------------------------
// Search / suggestions
// ------------------------------------------------------------

async function handleSuggestions() {
  const value = els.input.value.trim();
  if (value.length < 2) return;
  try {
    const substances = await logic.searchSuggestions(value);
    showSuggestions(substances);
  } catch (_) {
    els.suggestions.hidden = true;
  }
}

function showSuggestions(substances) {
  els.suggestionList.replaceChildren();
  substances.slice(0, 8).forEach((substance) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "suggestion";
    option.setAttribute("role", "option");
    option.textContent = substance.name;
    option.addEventListener("click", () => {
      els.input.value = substance.name;
      els.suggestions.hidden = true;
      handleSearch();
    });
    els.suggestionList.appendChild(option);
  });
  els.suggestions.hidden = substances.length === 0;
}

async function handleSearch() {
  const substanceName = els.input.value.trim();
  if (!substanceName) return;

  clearTimeout(suggestionTimer);
  els.suggestions.hidden = true;
  setLoading(true);
  els.status.textContent = "Loading substance data…";

  try {
    const { substance, roa, commonDose, units } = await logic.fetchSubstanceData(substanceName);

    els.doseInput.value = commonDose;
    els.doseUnit.textContent = units;
    els.doseStartHour.value = logic.currentTimeValue();
    els.dosePanel.hidden = false;
    els.status.textContent = `${substance.name} loaded · common dose ${commonDose} ${units}`;
    renderSubstanceInfo(substance, roa);
    paintAddButton();
  } catch (error) {
    els.dosePanel.hidden = true;
    els.substanceInfo.hidden = true;
    els.layout?.classList.remove("has-info");
    els.status.textContent = error.message || "Unable to load substance data.";
  } finally {
    setLoading(false);
  }
}

/** The add button takes the color this substance has (or will get) on the graph. */
function paintAddButton() {
  const current = logic.getState().currentSubstance;
  if (current?.name) els.addDoseButton.style.setProperty("--violet", logic.colorForSubstance(current.name));
  else els.addDoseButton.style.removeProperty("--violet");
}

function setLoading(loading) {
  els.searchButton.classList.toggle("loading", loading);
  els.searchButton.disabled = loading;
}

const PHASES = [["onset", "Onset"], ["comeup", "Come up"], ["peak", "Peak"], ["offset", "Offset"]];
const UNIT_SHORT = { seconds: "s", minutes: "min", hours: "h", days: "d" };

function formatRange(part) {
  if (!part) return "";
  const has = (v) => v !== null && v !== undefined && v !== "";
  const unit = UNIT_SHORT[part.units] || part.units || "";
  let text = "";
  if (has(part.min) && has(part.max)) text = Number(part.min) === Number(part.max) ? `${part.min}` : `${part.min}–${part.max}`;
  else if (has(part.min)) text = `${part.min}+`;
  else if (has(part.max)) text = `up to ${part.max}`;
  return text ? `${text} ${unit}`.trim() : "";
}

function formatHours(hours) {
  if (!(hours > 0)) return "";
  const minutes = Math.round(hours * 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Onset, come up, peak and offset for the route the timeline uses. */
function renderDurations(substance, roa) {
  const box = els.substanceTimes;
  if (!box) return;
  const duration = roa?.duration;
  if (!duration) {
    box.hidden = true;
    return;
  }
  const color = logic.colorForSubstance(substance.name);
  box.style.setProperty("--c", color);
  box.querySelector("[data-route]").textContent = roa.name ? `${roa.name} route` : "";
  const hours = PHASES.map(([key]) => logic.averageHours(duration[key]));
  const sum = hours.reduce((a, b) => a + b, 0);
  PHASES.forEach(([key], i) => {
    box.querySelector(`[data-phase="${key}"]`).textContent = formatRange(duration[key]) || "Unknown";
    const seg = box.querySelector(`[data-seg="${key}"]`);
    seg.style.flexGrow = sum ? String(hours[i] / sum) : "1";
    seg.hidden = !hours[i];
  });
  const total = formatRange(duration.total) || (sum ? `about ${formatHours(sum)}` : "");
  box.querySelector("[data-total]").textContent = total || "Unknown";
  box.hidden = false;
}

function renderSubstanceInfo(substance, roa) {
  const imageUrl = substance?.images?.[0]?.thumb;
  els.substanceImage.hidden = !imageUrl;
  if (imageUrl) {
    els.substanceImage.src = imageUrl;
    els.substanceImage.alt = `${substance.name} reference`;
  }

  els.substanceName.textContent = substance.name;
  els.substanceSummary.textContent = substance.summary || "No summary available.";
  els.addictionPotential.textContent = substance.addictionPotential || "Unknown";
  setPills("caution", substance.uncertainInteractions);
  setPills("danger", substance.unsafeInteractions);
  setPills("severe", substance.dangerousInteractions);
  renderDurations(substance, roa);
  els.substanceInfo.hidden = false;
  els.layout?.classList.add("has-info");
}

function setPills(type, items) {
  const container = document.querySelector(`[data-interaction="${type}"]`);
  container.replaceChildren();
  if (!items?.length) {
    const empty = document.createElement("span");
    empty.className = "pill empty";
    empty.textContent = "None listed";
    container.appendChild(empty);
    return;
  }
  items.forEach((item) => {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = item.name || item;
    container.appendChild(pill);
  });
}

// ------------------------------------------------------------
// Formulation toggle group
// ------------------------------------------------------------

function selectFormulation(selected) {
  if (!selected.checked) selected.checked = true;
  els.formulationInputs.forEach((checkbox) => {
    if (checkbox !== selected) checkbox.checked = false;
    checkbox.closest(".check-card").classList.toggle("selected", checkbox.checked);
  });

  const summary = document.getElementById("releaseSummary");
  if (summary) summary.textContent = selected.closest(".check-card").querySelector("strong").textContent;

  const isImmediate = selected.value === "immediate";
  els.releaseWindowField.hidden = isImmediate;
  if (!isImmediate) els.releaseWindow.value = selected.dataset.hours;
}

function selectedFormulation() {
  const selected = els.formulationInputs.find((checkbox) => checkbox.checked) || els.formulationInputs[0];
  return {
    key: selected.value,
    label: selected.dataset.label,
    releaseHours: selected.value === "immediate" ? 0 : Number(els.releaseWindow.value),
  };
}

// ------------------------------------------------------------
// Doses: add / remove / reset
// ------------------------------------------------------------

function handleAddDose() {
  try {
    const dose = logic.addDoseToState({
      amount: els.doseInput.value,
      time: els.doseStartHour.value,
      formulation: selectedFormulation(),
    });
    const f = selectedFormulation();
    rememberDose({ substance: dose.substance, amount: dose.amount, unit: dose.unit, formulation: f.key, label: f.label, releaseHours: f.releaseHours });
    logDose(dose);
    renderRecent();
    renderTracker();
    renderDoseList();
    refreshChart();
    experienceChanged();
    showToast(`${dose.formulation} dose added.`);
    // On phones the chart sits below the form, so bring it into view.
    if (window.matchMedia("(max-width: 1279px)").matches) {
      document.getElementById("chartCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (error) {
    showToast(error.message, true);
  }
}

function handleReset() {
  flushExperience(); // the timeline stays under Experiences
  activeExp = null;
  logic.resetState();
  renderDoseList();
  plot.clearPlot("myPlot");
  els.chartEmpty.hidden = false;
  logIdsByDose.clear(); // the doses still count as consumed
  renderRecent(); // colors were reset, so hand them out again in recent-list order
  paintAddButton();
  renderTracker();
  renderExperiences();
  showToast("Timeline reset.");
}

function renderDoseList() {
  const { addedDoses } = logic.getState();

  els.doseList.replaceChildren();
  els.doseCount.textContent = addedDoses.length;
  els.saveButton.disabled = addedDoses.length === 0;

  if (!addedDoses.length) {
    const empty = document.createElement("p");
    empty.className = "dose-list-empty";
    empty.textContent = "No doses added yet.";
    els.doseList.appendChild(empty);
    return;
  }

  addedDoses.forEach((dose) => {
    const card = document.createElement("article");
    card.className = "dose-card";

    const time = document.createElement("time");
    time.textContent = dose.time;
    time.style.color = dose.color;
    card.style.borderLeft = `3px solid ${dose.color}`;

    const details = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = dose.substance;
    const meta = document.createElement("span");
    meta.textContent = `${dose.amount} ${dose.unit} · ${dose.formulation}`;
    details.append(name, meta);

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "remove-dose edit-dose";
    edit.dataset.editDose = String(dose.id);
    edit.setAttribute("aria-label", `Edit ${dose.substance} dose at ${dose.time}`);
    edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/></svg>';

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-dose";
    remove.dataset.removeDose = String(dose.id);
    remove.setAttribute("aria-label", `Remove ${dose.substance} dose at ${dose.time}`);
    remove.textContent = "×";

    card.dataset.doseId = String(dose.id);
    card.append(time, details, edit, remove);
    els.doseList.appendChild(card);
  });
}

/** Swaps a dose card for a small form to change its amount and time. */
function openDoseEditor(id) {
  const dose = logic.getState().addedDoses.find((item) => item.id === id);
  const card = els.doseList.querySelector(`[data-dose-id="${id}"]`);
  if (!dose || !card) return;
  renderDoseList(); // closes any other open editor
  const fresh = els.doseList.querySelector(`[data-dose-id="${id}"]`);

  const form = document.createElement("form");
  form.className = "dose-card dose-edit";
  form.dataset.editForm = String(id);
  form.style.borderLeft = `3px solid ${dose.color}`;
  form.setAttribute("aria-label", `Edit ${dose.substance} dose`);
  form.innerHTML = `
    <p class="dose-edit-title"><strong></strong><span></span></p>
    <label class="dose-edit-field"><span>Dose</span><span class="dose-edit-amount"><input name="amount" type="number" inputmode="decimal" min="0" step="any" required class="input input-sm bg-[var(--bg)] border-[var(--line)] font-mono w-full" /><em></em></span></label>
    <label class="dose-edit-field"><span>Time</span><input name="time" type="time" required class="input input-sm bg-[var(--bg)] border-[var(--line)] font-mono w-full" /></label>
    <div class="dose-edit-actions">
      <button type="button" class="btn btn-sm btn-ghost font-mono" data-edit-cancel="${id}">Cancel</button>
      <button type="submit" class="btn btn-sm border-none text-[#160f24] font-mono font-medium dose-edit-save">Save</button>
    </div>`;
  form.querySelector(".dose-edit-title strong").textContent = dose.substance;
  form.querySelector(".dose-edit-title span").textContent = dose.formulation;
  form.querySelector("[name=amount]").value = dose.amount;
  form.querySelector(".dose-edit-amount em").textContent = dose.unit || "";
  form.querySelector("[name=time]").value = dose.time;
  form.querySelector(".dose-edit-save").style.background = dose.color;
  fresh.replaceWith(form);
  const amount = form.querySelector("[name=amount]");
  amount.focus({ preventScroll: true });
  amount.select();
  form.scrollIntoView({ block: "nearest" });
}

// ------------------------------------------------------------
// Chart refresh — bridges logic.computeTimeline() -> plot.renderPlot()
// ------------------------------------------------------------

function refreshChart() {
  const timeline = logic.computeTimeline();
  if (!timeline) {
    plot.clearPlot("myPlot");
    els.chartEmpty.hidden = false;
    return;
  }
  els.chartEmpty.hidden = true;
  plot.renderPlot(timeline, "myPlot");
}

// ------------------------------------------------------------
// Save
// ------------------------------------------------------------

async function handleSave() {
  const { addedDoses } = logic.getState();
  if (!addedDoses.length) return;
  if (activeExp?.viewOnly) {
    showToast(`These are ${activeExp.owner}'s doses, so they weren't saved to your journal.`, true);
    return;
  }

  // The journal stores one entry per substance, so send one request each.
  // An opened experience keeps the day it happened on.
  const now = activeExp?.startedAt ? new Date(activeExp.startedAt) : new Date();
  const bySubstance = new Map();
  addedDoses.forEach((dose) => {
    if (!bySubstance.has(dose.substance)) bySubstance.set(dose.substance, []);
    bySubstance.get(dose.substance).push(dose);
  });
  const payloads = [...bySubstance].map(([name, doses]) => ({
    DrugName: name,
    Unit: doses[0].unit,
    Doses: doses.map((dose) => {
      const [hours, minutes] = dose.time.split(":").map(Number);
      const takenAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
      return {
        Time: takenAt.toISOString(),
        DoseAmount: String(dose.amount),
        Unit: dose.unit,
        Method: dose.formulation,
      };
    }),
  }));

  els.saveButton.disabled = true;
  els.saveButton.textContent = "Saving…";
  try {
    for (const data of payloads) {
      const response = await fetch("/sub/saveData", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Save failed");
    }
    showToast("Timeline saved to your journal.");
  } catch (_) {
    showToast("The timeline could not be saved. Please try again.", true);
  } finally {
    els.saveButton.disabled = false;
    els.saveButton.textContent = "Save data";
  }
}

// ------------------------------------------------------------
// Toast
// ------------------------------------------------------------

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle("error", isError);
  els.toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("visible"), 2800);
}
