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
  });
  document.getElementById("cookieDecline").addEventListener("click", () => {
    writeCookie(CONSENT_COOKIE, "no");
    document.cookie = `${RECENT_COOKIE}=; max-age=0; path=/`;
    clearLog();
    box.hidden = true;
    renderRecent();
    renderTracker();
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

  // event delegation for the per-dose remove buttons rendered dynamically
  els.doseList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-dose]");
    if (!button) return;
    const id = Number(button.dataset.removeDose);
    logic.removeDoseFromState(id);
    unlogDose(id);
    renderDoseList();
    refreshChart();
    renderTracker();
  });

  window.addEventListener("resize", () => plot.resizePlot("myPlot"));
  window.addEventListener("orientationchange", () => setTimeout(() => refreshChart(), 250));
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
    const { substance, commonDose, units } = await logic.fetchSubstanceData(substanceName);

    els.doseInput.value = commonDose;
    els.doseUnit.textContent = units;
    els.doseStartHour.value = logic.currentTimeValue();
    els.dosePanel.hidden = false;
    els.status.textContent = `${substance.name} loaded · common dose ${commonDose} ${units}`;
    renderSubstanceInfo(substance);
    paintAddButton();
  } catch (error) {
    els.dosePanel.hidden = true;
    els.substanceInfo.hidden = true;
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

function renderSubstanceInfo(substance) {
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
  els.substanceInfo.hidden = false;
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
  logic.resetState();
  renderDoseList();
  plot.clearPlot("myPlot");
  els.chartEmpty.hidden = false;
  logIdsByDose.clear(); // the doses still count as consumed
  renderRecent(); // colors were reset, so hand them out again in recent-list order
  paintAddButton();
  renderTracker();
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

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-dose";
    remove.dataset.removeDose = String(dose.id);
    remove.setAttribute("aria-label", `Remove ${dose.substance} dose at ${dose.time}`);
    remove.textContent = "×";

    card.append(time, details, remove);
    els.doseList.appendChild(card);
  });
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

  // The journal stores one entry per substance, so send one request each.
  const now = new Date();
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
