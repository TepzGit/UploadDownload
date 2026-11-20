// graphplus.js: the Graph page additions from mommy's 2026-11-20 list.
// - Top bar: day the doses were taken, totals per substance (graph color dot
//   + amount) and what the session cost.
// - Safety card: interactions between doses whose effects overlap (and the
//   drug picked in the form, if it were added now), tolerance for the picked
//   drug that fades over days, and cross-tolerance from related drugs.
// - "What's in this mix" card for pills and mixes with several compounds.
// Knowledge comes from js/drugfacts.js (window.xnFacts).
import * as logic from "./logic.js";

const DAY = 86400000;
let getSession = () => null; // ui.js: the open session ({startedAt}) or null
let history = null; // [{name, at, amount, common}] from /stats/api, signed in
let historyAsked = false;

const $ = (sel) => document.querySelector(sel);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const fmtNum = (n) => String(Math.round(Number(n) * 100) / 100);

export function currency() {
  return window.xnLook?.get?.().currency || "kr";
}

/** "kr 120" / "€12.50": symbols go first, letters (kr, DKK) after. */
export function money(v) {
  const c = currency();
  const n = (Math.round(Number(v) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return /^[a-z]/i.test(c) ? `${n} ${c}` : `${c}${n}`;
}

export function initGraphPlus({ session }) {
  getSession = session || getSession;
  const cur = document.getElementById("priceCur");
  const paintCurrency = () => { if (cur) cur.textContent = currency(); renderSessionBar(); };
  paintCurrency();
  window.addEventListener("xn:look", paintCurrency);
  loadHistory();
}

async function loadHistory() {
  if (historyAsked) return;
  historyAsked = true;
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const res = await fetch("/stats/api?zone=" + encodeURIComponent(zone), { headers: { Accept: "application/json" } });
    if (!res.ok) return;
    const data = await res.json();
    history = (data.doses || []).map((d) => ({ name: d.name, at: d.at, amount: d.amount, common: d.common || 0 }));
    renderSafety();
  } catch (_) {}
}

/** Start of the session's day (ms): the open session, or today. */
function sessionDay() {
  const s = getSession();
  const t = s?.startedAt || Date.now();
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** When a dose on the graph was taken (ms). x is in hours from the session's midnight. */
function doseAt(dose) {
  return sessionDay() + (Number(dose.x?.[0]) || 0) * 3600000;
}

// ---------- Top bar ----------

export function renderSessionBar() {
  const bar = document.getElementById("sessBar");
  if (!bar) return;
  const { addedDoses } = logic.getState();
  const day = new Date(sessionDay());
  const dayText = day.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const first = addedDoses.length ? [...addedDoses].sort((a, b) => a.x[0] - b.x[0])[0] : null;
  bar.querySelector("[data-gs-day]").textContent = first ? `${dayText} · from ${first.time}` : dayText;

  const totals = new Map();
  for (const d of addedDoses) {
    const key = d.substance.toLowerCase() + "|" + (d.unit || "");
    if (!totals.has(key)) totals.set(key, { name: d.substance, unit: d.unit || "", amount: 0, color: d.color, count: 0 });
    const t = totals.get(key);
    t.amount += Number(d.amount) || 0;
    t.count++;
  }
  const list = bar.querySelector("[data-gs-totals]");
  list.replaceChildren();
  if (!totals.size) list.append(el("span", "gs-empty", "No doses yet"));
  for (const t of totals.values()) {
    const chip = el("span", "gs-chip");
    chip.setAttribute("role", "listitem");
    const dot = el("i", "gs-dot");
    dot.style.background = t.color;
    chip.append(dot, el("span", "gs-name", t.name), el("b", "gs-amt", `${fmtNum(t.amount)} ${t.unit}`.trim()));
    chip.title = `${t.name}: ${fmtNum(t.amount)} ${t.unit} in ${t.count} dose${t.count === 1 ? "" : "s"}`;
    list.append(chip);
  }
  const priced = addedDoses.filter((d) => d.price > 0);
  const sum = priced.reduce((s, d) => s + d.price, 0);
  const price = bar.querySelector("[data-gs-price]");
  price.textContent = priced.length ? money(sum) : "–";
  price.title = priced.length ? `${priced.length} of ${addedDoses.length} doses have a price` : "Add a price when you add a dose";
}

// ---------- Safety card ----------

const LEVEL_TEXT = { severe: "Do not combine", danger: "Dangerous", caution: "Caution" };
const LEVEL_ICON = {
  severe: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/></svg>',
  danger: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/></svg>',
  caution: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v5M12 16h.01"/></svg>',
};

function factsFor(name) {
  const pw = logic.interactionsOf(name);
  return { name, classKey: logic.cachedClassKey(name), ingredient: pw?.ingredient || "", pw };
}

function fmtHour(h) {
  const m = Math.round(h * 60);
  const day = Math.floor(m / 1440);
  const mm = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}${day > 0 ? ` +${day}d` : ""}`;
}

/** Pairs of different substances whose curves overlap, worst first. */
function overlaps() {
  const facts = window.xnFacts;
  const { addedDoses, currentSubstance } = logic.getState();
  const items = addedDoses.map((d) => ({ name: d.substance, start: d.x[0], end: d.x[d.x.length - 1] }));
  // The drug picked in the form, as if it were added at the time in the Time field.
  if (currentSubstance && !document.getElementById("dosePanel")?.hidden) {
    const time = document.getElementById("doseStartHour")?.value;
    try {
      const curve = logic.buildDoseCurve(logic.timeToHours(time), Number(logic.getState().currentCommonDose) || 1, 0);
      const parts = logic.mixParts();
      const names = parts.length ? parts.map((p) => p.name) : [currentSubstance.name];
      names.forEach((n) => items.push({ name: n, start: curve.x[0], end: curve.x[curve.x.length - 1], planned: true }));
    } catch (_) {}
  }
  const seen = new Map();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.name.toLowerCase() === b.name.toLowerCase()) continue;
      if (a.planned && b.planned) continue;
      const from = Math.max(a.start, b.start), to = Math.min(a.end, b.end);
      if (to <= from) continue;
      const hit = facts.combo(factsFor(a.name), factsFor(b.name));
      if (!hit) continue;
      const key = [a.name, b.name].map((n) => n.toLowerCase()).sort().join("|");
      const prev = seen.get(key);
      if (!prev || facts.LEVEL_RANK[hit.level] > facts.LEVEL_RANK[prev.level]) {
        seen.set(key, { ...hit, a: a.name, b: b.name, from, to, planned: a.planned || b.planned });
      }
    }
  }
  return [...seen.values()].sort((x, y) => facts.LEVEL_RANK[y.level] - facts.LEVEL_RANK[x.level]);
}

/** History plus the doses on the graph now (not counted twice). */
function allDoses() {
  const { addedDoses } = logic.getState();
  const base = history ? history.slice() : [];
  const keys = new Set(base.map((d) => d.name.toLowerCase() + "|" + d.amount + "|" + Math.round(d.at / 60000)));
  for (const d of addedDoses) {
    const at = doseAt(d);
    const key = d.substance.toLowerCase() + "|" + d.amount + "|" + Math.round(at / 60000);
    if (!keys.has(key)) base.push({ name: d.substance, at, amount: Number(d.amount), common: Number(d.profile?.commonDose) || 0 });
  }
  return base;
}

function agoText(t) {
  const days = Math.floor((Date.now() - t) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function renderSafety() {
  const box = document.getElementById("gpSafety");
  const facts = window.xnFacts;
  if (!box || !facts) return;

  // Interactions
  const ix = overlaps();
  const ixBlock = box.querySelector('[data-sf="ix"]');
  const ixList = box.querySelector("[data-sf-ix]");
  ixList.replaceChildren(...ix.map((h) => {
    const li = el("li", "sf-ix");
    li.dataset.level = h.level;
    const head = el("div", "sf-ix-head");
    const badge = el("span", "sf-badge");
    badge.innerHTML = LEVEL_ICON[h.level];
    badge.append(LEVEL_TEXT[h.level]);
    head.append(badge, el("strong", "sf-pair", `${h.a} + ${h.b}`));
    li.append(head, el("p", "sf-why", h.why));
    li.append(el("small", "sf-when", h.planned ? "If you add it now: the effects overlap" : `Effects overlap ${fmtHour(h.from)}–${fmtHour(h.to)}`));
    return li;
  }));
  ixBlock.hidden = !ix.length;

  // Tolerance for the picked drug (or the last one added)
  const { currentSubstance, addedDoses } = logic.getState();
  const name = currentSubstance?.name || addedDoses[addedDoses.length - 1]?.substance || "";
  const tolBlock = box.querySelector('[data-sf="tol"]');
  let showTol = false;
  if (name) {
    const doses = allDoses();
    const t = facts.tolerance(name, doses, { classOf: (n) => logic.cachedClassKey(n), ingredient: currentSubstance?.ingredient });
    const pct = Math.round(t.level * 100);
    showTol = pct > 0 || doses.some((d) => d.name.toLowerCase() === name.toLowerCase());
    box.querySelector("[data-sf-tolname]").textContent = "· " + name;
    const meter = box.querySelector("[data-sf-meter]");
    meter.setAttribute("aria-valuenow", String(pct));
    meter.setAttribute("aria-label", `Tolerance to ${name}: about ${pct}%`);
    meter.style.setProperty("--lv", pct + "%");
    meter.dataset.band = pct >= 60 ? "high" : pct >= 25 ? "mid" : "low";
    const clearDays = t.clearAt > Date.now() ? Math.ceil((t.clearAt - Date.now()) / DAY) : 0;
    const text = pct === 0 ? "No tolerance left: a normal dose works as usual." :
      `About ${pct}% tolerance${t.own ? ` (last dose ${agoText(t.last)})` : ""}. ` +
      (clearDays ? `Back to normal in about ${clearDays} day${clearDays === 1 ? "" : "s"}.` : "");
    box.querySelector("[data-sf-toltext]").textContent = text;
    box.querySelector("[data-sf-toltext]").title = t.profile.how;
    const cross = box.querySelector("[data-sf-cross]");
    cross.replaceChildren(...t.from.slice(0, 4).map((f) => {
      const li = el("li", "sf-crossrow");
      li.append(el("strong", "", "Cross-tolerance"), el("span", "", `${f.name} ${agoText(f.last)} makes ${name} about ${Math.round(f.level * 100)}% weaker.`));
      return li;
    }));
    if (t.from.length) showTol = true;
    if (pct > 0 && !history) box.querySelector("[data-sf-toltext]").textContent += " (from this graph only)";
  }
  tolBlock.hidden = !showTol;
  box.hidden = ixBlock.hidden && tolBlock.hidden;
}

// ---------- What's in this mix ----------

export function renderMix() {
  const card = document.getElementById("mixCard");
  if (!card || !window.xnFacts) return;
  const { currentSubstance } = logic.getState();
  const parts = currentSubstance?.contents || [];
  card.hidden = !parts.length;
  if (!parts.length) return;
  card.querySelector("[data-mix]").replaceChildren(...parts.map((p) => window.xnFacts.mixRow(p)));
  const active = parts.filter((p) => p.psychoactive);
  card.querySelector("[data-mix-sub]").textContent = active.length >= 2
    ? `${active.length} psychoactive parts: each one gets its own curve on the graph.`
    : active.length === 1 ? `${active[0].name} is the psychoactive part; the rest isn't.` : "None of it is psychoactive.";
}

/** The dose form when a mix with 2+ psychoactive parts is loaded: count pills instead. */
export function syncMixForm() {
  const note = document.getElementById("mixNote");
  const parts = logic.mixParts();
  if (!note) return parts;
  note.hidden = !parts.length;
  if (parts.length) {
    note.textContent = `Dose = how many you took. Adds ${parts.map((p) => `${p.name}${p.amount ? " " + fmtNum(p.amount) + " " + (p.unit || "mg") : ""}`).join(", ")} each.`;
  }
  return parts;
}
