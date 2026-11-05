// ============================================================
// logic.js
// All application state + business logic. NO DOM access here —
// this file should run unchanged in a Node test runner.
// Ported 1:1 from the old inline <script> in sub.html; math and
// control flow are unchanged, only reorganized and exported.
// ============================================================

import * as offline from "./offline.js";
import { effectCurve, effectHours } from "./curve.js";

const API_URL = "https://api.psychonautwiki.org";

const state = {
  currentSubstance: null,
  currentCommonDose: null,
  units: "",
  doseSequence: 0,
  addedDoses: [],
  baseDurations: { onset: 0, comeup: 0, peak: 0, offset: 0 },
  currentRoa: null,
  roas: [], // the substance's routes that have timings, e.g. oral, insufflated
  substanceColors: {},
  customColors: {}, // lowercased name -> color the account picked on Profile
  scientific: !!globalThis.xnScience?.isOn(), // "Scientific graph" switch (js/science.js)
};

// ------------------------------------------------------------
// Scientific graph: timelines from clinical studies (js/science.js).
// A dose keeps its PsychonautWiki profile (saved sessions are unchanged);
// when the switch is on it is drawn with the studies' timeline instead,
// if there is one for that substance and route.
// ------------------------------------------------------------

/** The studies' durations for a substance on a route, or null. */
export function scienceBase(name, route) {
  const sci = globalThis.xnScience;
  if (!sci) return null;
  // Medicines have no route on older doses: their studies are for swallowed doses.
  return sci.base(sci.find(name, String(route || "").toLowerCase() || "oral"));
}

/** The profile a dose is drawn with right now. */
function drawProfile(dose) {
  if (state.scientific && dose.sciBase) return { base: { ...dose.sciBase }, commonDose: dose.profile.commonDose };
  return dose.profile;
}

function redrawDose(dose) {
  const curve = buildDoseCurve(timeToHours(dose.time), dose.amount, dose.releaseHours, drawProfile(dose));
  dose.x = curve.x;
  dose.y = curve.y;
}

export function isScientific() {
  return state.scientific;
}

// The scientific graph's other lines for one dose (js/science.js LINES): how
// it feels, the medical effect, blood level, PsychonautWiki's timeline and,
// for the site's own substances, this site's timeline. Same scale as the
// main curve: percent of one common dose.
function timesToBase(t, shape = "smooth") {
  return { onset: t.onset, comeup: Math.max(0, t.peakStart - t.onset), peak: Math.max(0, t.peakEnd - t.peakStart), offset: Math.max(0, t.end - t.peakEnd), shape };
}

function scienceLines(dose) {
  const sci = globalThis.xnScience;
  if (!sci || !dose.sciBase || typeof sci.curveOf !== "function") return [];
  const e = sci.find(dose.substance, String(dose.route || "").toLowerCase() || "oral");
  if (!e) return [];
  const start = timeToHours(dose.time);
  const common = dose.profile.commonDose;
  const curve = (base, level = 1) => {
    const c = buildDoseCurve(start, dose.amount, dose.releaseHours, { base, commonDose: common });
    return level === 1 ? c : { x: c.x, y: c.y.map((v) => v * level) };
  };
  const custom = !!customList?.some((s) => s.name === dose.substance);
  // The studies' lines use exactly the Journal's curve (science.js curveOf):
  // flat at the top from peak start to peak end, soft rise and fall. The
  // studies measured the real product, so release type doesn't stretch them.
  const studied = (t, level = 1) => {
    const f = sci.curveOf(t, level);
    const x = [], y = [];
    const intensity = (dose.amount / common) * 100;
    for (let i = 0; i <= 400; i++) { const h = (i / 400) * t.end; x.push(start + h); y.push(Math.max(0, f(h)) * intensity); }
    return { x, y };
  };
  // PsychonautWiki's timeline for a site medicine's ingredient: straight lines, as on the Journal.
  const studiedLinear = (t) => {
    const f = sci.curveOf(t, 1, false);
    const intensity = (dose.amount / common) * 100;
    const x = [], y = [];
    for (let i = 0; i <= 400; i++) { const h = (i / 400) * t.end; x.push(start + h); y.push(Math.max(0, f(h)) * intensity); }
    return { x, y };
  };
  const out = [];
  if (e.subj) out.push({ key: "subj", ...studied(e.subj, e.subjLevel ?? 1) });
  if (e.ther) out.push({ key: "ther", ...studied(e.ther) });
  const plasma = sci.plasmaOf(e);
  if (plasma) {
    const intensity = (dose.amount / common) * 100;
    // Until about 1% is left, so the line ends at zero instead of dropping off.
    const span = Math.min(96, (e.pk?.tmax || 1) + 7 * (e.pk?.thalf || 2));
    const x = [], y = [];
    for (let i = 0; i <= 300; i++) { const t = (i / 300) * span; x.push(start + t); y.push(i === 300 ? 0 : plasma(t) * intensity); }
    out.push({ key: "pk", x, y });
  }
  if (custom) {
    if (e.pw?.end > 0) out.push({ key: "pw", ...studiedLinear(e.pw) });
    out.push({ key: "site", ...curve({ ...dose.profile.base }) });
  } else {
    out.push({ key: "pw", ...curve({ ...dose.profile.base }) });
  }
  return out;
}

/** How many substances are on the Graph (line buttons go neutral with several). */
export function substanceCount() {
  return new Set(state.addedDoses.map((dose) => dose.substance)).size;
}

/** The scientific lines on the Graph now (for its line buttons), in LINES order. */
export function scienceLineKeys() {
  if (!state.scientific) return [];
  const keys = new Set();
  state.addedDoses.forEach((dose) => scienceLines(dose).forEach((l) => keys.add(l.key)));
  return (globalThis.xnScience?.LINES || []).map((l) => l.key).filter((k) => keys.has(k));
}

/** Turns the Scientific graph on or off and redraws every dose on the timeline. */
export function setScientific(on) {
  state.scientific = !!on;
  // The editor's versions may have just arrived (js/science.js), so look again.
  state.addedDoses.forEach((dose) => {
    if (dose.substance) dose.sciBase = scienceBase(dose.substance, dose.route);
    redrawDose(dose);
  });
}

/**
 * Read-only snapshot of state for ui.js to render from.
 * ui.js should never mutate the returned object directly —
 * all mutation goes through the functions below.
 */
export function getState() {
  return {
    currentSubstance: state.currentSubstance,
    currentCommonDose: state.currentCommonDose,
    units: state.units,
    addedDoses: state.addedDoses,
    baseDurations: state.baseDurations,
    currentRoa: state.currentRoa,
    roas: state.roas,
    scientific: state.scientific,
  };
}

// ------------------------------------------------------------
// GraphQL (unchanged from the old fetchGraphQL/getData/searchSuggestions)
// ------------------------------------------------------------

function fetchGraphQL(query, variables = {}) {
  return fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  }).then((response) => {
    if (!response.ok) throw new Error("Substance service unavailable");
    return response.json();
  });
}

// ------------------------------------------------------------
// Custom substances: added by an admin in the Substances Importer
// (/admin/substances), kept in our own database, apart from the
// PsychonautWiki data. They are turned into the same shape as a
// PsychonautWiki substance (with custom: true) so the Graph,
// Journal and Drug info treat them alike.
// ------------------------------------------------------------

let customList = null;

/** A custom entry from /substances/custom in PsychonautWiki's shape. */
export function customToSubstance(c) {
  const hours = (v) => (Number(v) > 0 ? { min: Number(v), max: Number(v), units: "hours" } : null);
  const range = (r) => (r && (r.min != null || r.max != null) ? { min: r.min ?? r.max, max: r.max ?? r.min } : null);
  // Combination notes (Substances Editor) ride along on each name.
  const notes = c.interactionNotes || {};
  const named = (list) => (list || []).map((name) => ({ name, note: notes[String(name).toLowerCase()] || "" }));
  // The first ingestion method sits on the substance itself, more in methods.
  const methods = [{ route: c.route, dose: c.dose, durations: c.durations }, ...(Array.isArray(c.methods) ? c.methods : [])];
  const roa = (m) => {
    const d = m.durations || {};
    return {
      name: m.route || "oral",
      dose: {
        units: c.units || "mg",
        threshold: m.dose?.threshold ?? null,
        heavy: m.dose?.heavy ?? null,
        light: range(m.dose?.light),
        common: range(m.dose?.common),
        strong: range(m.dose?.strong),
      },
      duration: {
        onset: hours(d.onset), comeup: hours(d.comeup), peak: hours(d.peak), offset: hours(d.offset),
        total: hours(effectHours(d)),
      },
      extended: { comedown: d.comedown, comedownLevel: d.comedownLevel, peak2: d.peak2, shape: d.shape },
    };
  };
  return {
    name: c.name,
    custom: true,
    customId: c.id,
    ingredient: c.ingredient || "", // medicines only: what is really in it
    icon: c.icon || "", // medicines only: a pill picture key (js/classicons.js)
    kind: c.kind || "", // "pill": a product of a custom substance, named in parent
    parent: c.parent || "",
    commonNames: c.aliases || [],
    class: { psychoactive: c.class ? [c.class] : [], chemical: c.chemicalClass ? [c.chemicalClass] : [] },
    images: c.image ? [{ thumb: c.image }] : [], // its own picture from the Substances Editor
    summary: c.summary || "",
    addictionPotential: c.addictionPotential || "",
    halfLife: c.halfLife || null,
    risks: c.risks || "",
    notes: c.notes || "",
    dangerousInteractions: named(c.interactions?.dangerous),
    unsafeInteractions: named(c.interactions?.unsafe),
    uncertainInteractions: named(c.interactions?.uncertain),
    roas: methods.map(roa),
  };
}

/** Every custom substance (kept on the phone for offline use). */
export async function customSubstances() {
  if (customList) return customList;
  try {
    const { data } = await offline.cachedJson("/substances/custom", "xn_custom_substances");
    customList = Array.isArray(data) ? data.map(customToSubstance) : [];
    customList.forEach((sub) => rememberClass(sub));
  } catch {
    customList = [];
  }
  return customList;
}

function customMatches(text) {
  const q = String(text || "").trim().toLowerCase();
  return (customList || []).filter((s) => [s.name, ...s.commonNames].some((n) => String(n).toLowerCase().includes(q)));
}

/** The custom substance with this name or alias, or null. */
export async function customByName(name) {
  const q = String(name || "").trim().toLowerCase();
  const list = await customSubstances();
  return list.find((s) => [s.name, ...s.commonNames].some((n) => String(n).toLowerCase() === q)) || null;
}

/** Typeahead suggestions. Old name: searchSuggestions() (network part only). */
export async function searchSuggestions(name) {
  await customSubstances();
  const custom = customMatches(name);
  const wiki = (await wikiSuggestions(name)).filter((s) => !custom.some((c) => c.name.toLowerCase() === s.name.toLowerCase()));
  // Best matches first: names starting with the search, then brand or street
  // names starting with it, then the rest. On a tie custom entries go first.
  const q = String(name || "").trim().toLowerCase();
  const rank = (s) => {
    const own = String(s.name).toLowerCase();
    if (own.startsWith(q)) return 0;
    if ((s.commonNames || []).some((n) => String(n).toLowerCase().startsWith(q))) return 1;
    return own.includes(q) ? 2 : 3;
  };
  return [...custom, ...wiki].map((s, i) => [rank(s), i, s]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , s]) => s);
}

async function wikiSuggestions(name) {
  const query = `query Suggestions($name: String!) {
        substances(query: $name) { name class { psychoactive chemical } }
    }`;
  let result;
  try {
    if (offline.isOffline()) throw new TypeError("offline");
    result = await fetchGraphQL(query, { name });
  } catch (error) {
    if (!offline.isNetworkError(error)) throw error;
    return offline.searchNames(name); // substances saved on this phone
  }
  const substances = result?.data?.substances || [];
  substances.forEach((s) => rememberClass(s));
  return substances;
}

// ------------------------------------------------------------
// Drug class icons (depressant, stimulant, ...). The class comes from
// PsychonautWiki and is kept in localStorage so lists don't refetch it.
// ------------------------------------------------------------

const CLASS_KEY = "gp-classes-3"; // -3: per-drug icons (blotter, bar, leaf...)
let classCache = null;
const classRequests = new Map();

function readClassCache() {
  if (classCache) return classCache;
  try { classCache = JSON.parse(localStorage.getItem(CLASS_KEY)) || {}; localStorage.removeItem("gp-classes"); localStorage.removeItem("gp-classes-2"); } catch { classCache = {}; }
  return classCache;
}

/** Turns a PsychonautWiki substance into one icon key (js/classicons.js), or "". */
export function classKeyFor(substance) {
  return window.xnClass ? window.xnClass.keyFor(substance) : "";
}

function rememberClass(substance, name = substance?.name) {
  if (!name) return;
  const cache = readClassCache();
  cache[name.toLowerCase()] = classKeyFor(substance);
  try { localStorage.setItem(CLASS_KEY, JSON.stringify(cache)); } catch {}
}

/** The icon key for a substance name; looks it up once when it isn't cached. */
export function classKeyOf(name) {
  const key = String(name || "").toLowerCase();
  const cache = readClassCache();
  if (key in cache) return Promise.resolve(cache[key]);
  if (!classRequests.has(key)) {
    const query = `query Class($name: String!) {
        substances(query: $name) { name class { psychoactive chemical } }
    }`;
    if (offline.isOffline()) {
      return offline.getSubstance(name).then((hit) => (hit ? classKeyFor(hit) : ""));
    }
    classRequests.set(key, fetchGraphQL(query, { name }).then((result) => {
      const hit = (result?.data?.substances || []).find((s) => s.name.toLowerCase() === key) || result?.data?.substances?.[0];
      if (!hit) return "";
      rememberClass(hit, key);
      return classKeyFor(hit);
    }).catch(() => ""));
  }
  return classRequests.get(key);
}

/** The cached icon key, without a network call. */
export function cachedClassKey(name) {
  return readClassCache()[String(name || "").toLowerCase()] || "";
}

/**
 * Full substance lookup. Old name: getData() + the state-assignment
 * half of search(). Updates internal state and returns the same
 * shape the UI needs to render the substance panel.
 */
// Everything the Graph needs about a substance. The weekly catalog download
// asks for the same fields so any substance can be drawn offline.
const SUBSTANCE_FIELDS = `
            name
            commonNames
            class { psychoactive chemical }
            images { thumb }
            summary
            addictionPotential
            uncertainInteractions { name }
            unsafeInteractions { name }
            dangerousInteractions { name }
            roas {
                name
                duration {
                    onset { min max units }
                    comeup { min max units }
                    peak { min max units }
                    offset { min max units }
                    total { min max units }
                }
                dose { units common { min } }
            }`;

// What the Journal's Drug info page shows, kept in the offline catalog too.
const CATALOG_FIELDS = `
            name
            commonNames
            systematicName
            class { psychoactive chemical }
            images { thumb }
            summary
            addictionPotential
            toxicity
            crossTolerances
            tolerance { full half zero }
            effects { name url }
            uncertainInteractions { name }
            unsafeInteractions { name }
            dangerousInteractions { name }
            roas {
                name
                dose { units threshold heavy common { min max } light { min max } strong { min max } }
                duration {
                    afterglow { min max units }
                    comeup { min max units }
                    duration { min max units }
                    offset { min max units }
                    onset { min max units }
                    peak { min max units }
                    total { min max units }
                }
                bioavailability { min max }
            }`;

/** Downloads the whole catalog once a week for offline use (see offline.js). */
export function refreshOfflineCatalog(options) {
  let fields = CATALOG_FIELDS;
  return offline.refreshCatalog(async (offset) => {
    const ask = () => fetchGraphQL(`{ substances(limit: 250 offset: ${offset}) { ${fields} } }`);
    let result;
    try {
      result = await ask();
    } catch (error) {
      if (offline.isNetworkError(error) || fields === SUBSTANCE_FIELDS) throw error;
      result = { errors: [error] };
    }
    if (result?.errors && fields !== SUBSTANCE_FIELDS) {
      // PsychonautWiki turned down a detail field: keep what the Graph needs.
      fields = SUBSTANCE_FIELDS;
      result = await ask();
    }
    const page = result?.data?.substances;
    if (Array.isArray(page)) {
      const cache = readClassCache();
      page.forEach((s) => { if (s?.name) cache[s.name.toLowerCase()] = classKeyFor(s); });
      try { localStorage.setItem(CLASS_KEY, JSON.stringify(cache)); } catch {}
    }
    return page;
  }, options);
}

export async function fetchSubstanceData(name) {
  const query = `query Substance($name: String!) {
        substances(query: $name) { ${SUBSTANCE_FIELDS} }
    }`;

  // A custom substance (Substances Importer) comes from our server, not PsychonautWiki.
  let substance = await customByName(name);
  if (!substance) {
    try {
      if (offline.isOffline()) throw new TypeError("offline");
      const result = await fetchGraphQL(query, { name });
      substance = result?.data?.substances?.[0];
      if (substance) offline.putSubstances([substance]);
    } catch (error) {
      if (!offline.isNetworkError(error)) throw error;
      substance = await offline.getSubstance(name);
      if (!substance) throw new Error("You're offline and this substance isn't saved on this phone yet.");
    }
  }
  // Every route with timings can be drawn. A route without its own common
  // dose borrows one from a route that has it, so the curve still has a scale.
  const withDose = substance?.roas?.find((item) => item.duration && item.dose?.common?.min);
  const roas = (substance?.roas || []).filter((item) => item.duration && (item.dose?.common?.min || withDose));

  if (!substance || !withDose || !roas.length) {
    throw new Error("No usable dose and duration data was found for this substance.");
  }

  state.currentSubstance = substance;
  state.roas = roas;
  rememberClass(substance);
  return selectRoa(withDose.name);
}

/**
 * Picks the route of administration (oral, insufflated, ...) for the
 * substance loaded now. Each route has its own timings and common dose.
 */
export function selectRoa(name) {
  const substance = state.currentSubstance;
  const roa = state.roas.find((item) => item.name === name) || state.roas[0];
  const fallback = state.roas.find((item) => item.dose?.common?.min);
  const dose = roa.dose?.common?.min ? roa.dose : fallback.dose;
  state.currentRoa = roa;
  state.currentCommonDose = Number(dose.common.min);
  state.units = dose.units || "";
  state.baseDurations = {
    onset: averageHours(roa.duration.onset),
    comeup: averageHours(roa.duration.comeup),
    peak: averageHours(roa.duration.peak),
    offset: averageHours(roa.duration.offset),
    ...extendedBase(roa.extended), // custom substances only
  };

  return {
    substance,
    roa,
    roas: state.roas,
    commonDose: state.currentCommonDose,
    units: state.units,
    durations: state.baseDurations,
  };
}

// ------------------------------------------------------------
// Pure time / curve math — byte-for-byte the same formulas as
// the original file. Do not "simplify" these without re-checking
// against old output; the shapes of the curves depend on them.
// ------------------------------------------------------------

export function averageHours(duration) {
  if (!duration) return 0;
  const average = (Number(duration.min || 0) + Number(duration.max || duration.min || 0)) / 2;
  if (duration.units === "minutes") return average / 60;
  if (duration.units === "seconds") return average / 3600;
  if (duration.units === "days") return average * 24;
  return average;
}

export function timeToHours(value) {
  if (!value) {
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
  }
  const [hours, minutes] = value.split(":").map(Number);
  return hours + minutes / 60;
}

export function currentTimeValue() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/** profile = the substance's { base, commonDose }; defaults to the one loaded now. */
export function buildDoseCurve(startHour, doseAmount, releaseHours, profile = currentProfile()) {
  const intensity = doseAmount / profile.commonDose;
  // Extended release stretches the curve. comedown and a second peak (custom
  // substances from the admin Substances Importer, see curve.js) stretch too.
  const adjusted = {
    ...profile.base,
    onset: profile.base.onset + releaseHours * 0.15,
    comeup: profile.base.comeup + releaseHours * 0.25,
    peak: profile.base.peak + releaseHours * 0.45,
    offset: profile.base.offset + releaseHours * 0.15,
  };
  if (adjusted.comedown > 0) adjusted.comedown += releaseHours * 0.1;
  const step = Math.max(0.05, effectHours(adjusted) / 650);
  return effectCurve(adjusted, startHour, intensity, step);
}

export function formatChartTime(value) {
  const totalMinutes = Math.round(value * 60);
  const dayOffset = Math.floor(totalMinutes / 1440);
  const minutesInDay = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(minutesInDay / 60);
  const minutes = minutesInDay % 60;
  const suffix = dayOffset > 0 ? ` +${dayOffset}d` : "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}${suffix}`;
}

function interpolateDose(dose, point) {
  if (point < dose.x[0] || point > dose.x[dose.x.length - 1]) return 0;
  let low = 0;
  let high = dose.x.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (dose.x[middle] === point) return dose.y[middle];
    if (dose.x[middle] < point) low = middle + 1;
    else high = middle - 1;
  }
  const right = Math.min(low, dose.x.length - 1);
  const left = Math.max(0, right - 1);
  const span = dose.x[right] - dose.x[left];
  if (!span) return dose.y[left];
  const progress = (point - dose.x[left]) / span;
  return dose.y[left] + (dose.y[right] - dose.y[left]) * progress;
}

function currentProfile() {
  return { base: { ...state.baseDurations }, commonDose: state.currentCommonDose };
}

/** The optional come-down and second-peak parts of a saved profile, checked. */
function extendedBase(raw) {
  const out = {};
  const hours = (v) => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 240 ? Number(v) : 0;
  const share = (v, d) => Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : d;
  if (hours(raw?.comedown)) {
    out.comedown = hours(raw.comedown);
    out.comedownLevel = share(raw.comedownLevel, 0.35);
  }
  const p2 = raw?.peak2;
  if (p2 && hours(p2.duration)) {
    out.peak2 = { gap: hours(p2.gap), dip: share(p2.dip, 0.5), duration: hours(p2.duration), level: share(p2.level, 1) };
  }
  if (raw?.shape === "smooth") out.shape = "smooth"; // one soft curve, see curve.js
  return out;
}

// ------------------------------------------------------------
// State mutation — required functions
// ------------------------------------------------------------

/**
 * Old name: addDose() (state half only — DOM reads/toast moved to ui.js).
 * formulation = { key, label, releaseHours } — read from the DOM by ui.js
 * and passed in as plain data, same shape as the old selectedFormulation().
 * Throws Error with the same messages the old toasts showed, so ui.js can
 * catch and display them without duplicating validation rules.
 */
export function addDoseToState({ amount, time, formulation }) {
  if (!state.currentSubstance) {
    throw new Error("Select a substance before adding a dose.");
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("Enter a dose greater than zero.");
  }
  if (!Number.isFinite(formulation.releaseHours) || formulation.releaseHours < 0) {
    throw new Error("Enter a valid release window.");
  }

  const doseTime = time || currentTimeValue();
  // Kept on the dose so it can be redrawn after an edit, even once another substance is loaded.
  const profile = currentProfile();
  const sciBase = scienceBase(state.currentSubstance.name, state.currentRoa?.name);
  const drawWith = state.scientific && sciBase ? { base: { ...sciBase }, commonDose: profile.commonDose } : profile;
  const curve = buildDoseCurve(timeToHours(doseTime), numericAmount, formulation.releaseHours, drawWith);

  const dose = {
    id: ++state.doseSequence,
    x: curve.x,
    y: curve.y,
    time: doseTime,
    amount: numericAmount,
    unit: state.units,
    formulation: formulation.label,
    releaseHours: formulation.releaseHours,
    route: state.currentRoa?.name || "",
    substance: state.currentSubstance.name,
    color: colorForSubstance(state.currentSubstance.name),
    profile,
    sciBase,
  };

  state.addedDoses.push(dose);
  return dose;
}

/** Changes an added dose's amount and/or time and redraws its curve. */
export function updateDoseInState(id, { amount, time, note }) {
  const dose = state.addedDoses.find((item) => item.id === id);
  if (!dose) throw new Error("That dose is no longer on the timeline.");
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("Enter a dose greater than zero.");
  }
  if (!/^\d{1,2}:\d{2}$/.test(String(time || ""))) {
    throw new Error("Enter a time like 08:30.");
  }
  dose.amount = numericAmount;
  dose.time = time;
  if (note !== undefined) dose.note = String(note).trim().slice(0, 2000);
  redrawDose(dose);
  return dose;
}

/**
 * Graph sessions ("Experiences"). A saved dose keeps the duration profile
 * it was drawn with, so an old session redraws exactly as it looked.
 */
export function snapshotDoses() {
  return state.addedDoses.map((dose) => ({
    substance: dose.substance,
    amount: dose.amount,
    unit: dose.unit || "",
    formulation: dose.formulation || "",
    releaseHours: dose.releaseHours || 0,
    route: dose.route || "",
    time: dose.time,
    note: dose.note || "",
    profile: { base: { ...dose.profile.base }, commonDose: dose.profile.commonDose },
  }));
}

/** A saved dose in a shape buildDoseCurve can draw, or null if it can't be drawn. */
function savedDose(raw) {
  if (!raw || typeof raw.substance !== "string" || !raw.substance.trim()) return null;
  const amount = Number(raw.amount);
  const releaseHours = Number(raw.releaseHours) || 0;
  const commonDose = Number(raw.profile?.commonDose);
  const base = {};
  for (const key of ["onset", "comeup", "peak", "offset"]) {
    base[key] = Number(raw.profile?.base?.[key]) || 0;
    if (base[key] < 0 || base[key] > 240) return null;
  }
  Object.assign(base, extendedBase(raw.profile?.base));
  if (!(amount > 0) || !(commonDose > 0) || releaseHours < 0 || releaseHours > 48) return null;
  if (!/^\d{1,2}:\d{2}$/.test(String(raw.time || ""))) return null;
  return {
    substance: raw.substance.trim().slice(0, 80),
    amount,
    unit: String(raw.unit || "").slice(0, 12),
    formulation: String(raw.formulation || "").slice(0, 40),
    releaseHours,
    route: String(raw.route || "").slice(0, 30),
    time: raw.time,
    note: String(raw.note || "").slice(0, 2000),
    profile: { base, commonDose },
  };
}

/** Replaces the timeline with a saved session's doses. Returns the doses drawn. */
export function loadDoses(list) {
  state.addedDoses = [];
  state.substanceColors = {};
  (Array.isArray(list) ? list : []).map(savedDose).filter(Boolean).forEach((saved) => {
    const dose = {
      ...saved,
      id: ++state.doseSequence,
      sciBase: scienceBase(saved.substance, saved.route),
      color: colorForSubstance(saved.substance),
    };
    redrawDose(dose);
    state.addedDoses.push(dose);
  });
  return state.addedDoses;
}

/** The colors a saved session's substances get once it is opened (same order rules as the graph). */
export function previewColors(names) {
  let next = 0;
  return names.map((name) => state.customColors[String(name).toLowerCase()] || SERIES_COLORS[next++ % SERIES_COLORS.length]);
}

/** A small summary curve per substance for a saved session, sampled at `points` steps. */
export function previewTimeline(list, points = 64) {
  const curves = (Array.isArray(list) ? list : []).map(savedDose).filter(Boolean).map((saved) => ({
    name: saved.substance,
    ...buildDoseCurve(timeToHours(saved.time), saved.amount, saved.releaseHours, saved.profile),
  }));
  if (!curves.length) return null;
  const start = Math.min(...curves.map((curve) => curve.x[0]));
  const end = Math.max(...curves.map((curve) => curve.x[curve.x.length - 1]));
  const span = end - start || 1;
  const xs = Array.from({ length: points }, (_, index) => start + (span * index) / (points - 1));
  const names = [...new Set(curves.map((curve) => curve.name))];
  const series = names.map((name) => {
    const mine = curves.filter((curve) => curve.name === name);
    return { name, y: xs.map((point) => mine.reduce((sum, curve) => sum + interpolateDose(curve, point), 0)) };
  });
  const peak = Math.max(1, ...series.flatMap((item) => item.y));
  return { names, series, peak, hours: end - start };
}

/** Old name: deleteDose(id) (state half only). */
export function removeDoseFromState(id) {
  state.addedDoses = state.addedDoses.filter((dose) => dose.id !== id);
}

/** Old name: resetGraph() (state half only). Matches old behavior:
 *  only clears addedDoses — currentSubstance/baseDurations persist. */
export function resetState() {
  state.addedDoses = [];
  state.substanceColors = {};
}

// ------------------------------------------------------------
// Combined timeline — identical math to the old drawChart()'s
// data-prep section (allX / combinedY / tick calc), just without
// the Plotly trace/layout objects, which now live in plot.js.
// ------------------------------------------------------------

// One colour per substance, in the order they were first added.
export const SERIES_COLORS = ["#a67cff", "#2dd4bf", "#fbbf24", "#f472b6", "#60a5fa", "#a3e635", "#fb923c", "#e879f9"];

/** Colors picked on Profile › Preferences, as [{ name, color }]. */
export function setCustomColors(list) {
  state.customColors = {};
  (list || []).forEach((item) => {
    if (item && typeof item.name === "string" && /^#[0-9a-f]{6}$/i.test(item.color || "")) {
      state.customColors[item.name.trim().toLowerCase()] = item.color;
    }
  });
  // Doses already on the timeline take the new colors too.
  state.addedDoses.forEach((dose) => { dose.color = colorForSubstance(dose.substance); });
}

/** The graph color a substance already has, without assigning a new one. */
export function peekColor(name) {
  return state.customColors[String(name).toLowerCase()] || state.substanceColors[name] || null;
}

export function colorForSubstance(name) {
  const custom = state.customColors[String(name).toLowerCase()];
  if (custom) return custom;
  if (!state.substanceColors[name]) {
    const used = Object.keys(state.substanceColors).length;
    state.substanceColors[name] = SERIES_COLORS[used % SERIES_COLORS.length];
  }
  return state.substanceColors[name];
}

/**
 * Returns one series per substance (its doses summed), all sampled on a
 * shared time axis so the lines line up, plus the hourly tick values.
 */
export function computeTimeline() {
  if (!state.addedDoses.length) return null;

  // Scientific graph on: each dose with studies draws every line that isn't
  // hidden (the line buttons); the first one shown is the filled main curve.
  const sci = globalThis.xnScience;
  const lineInfo = Object.fromEntries((sci?.LINES || []).map((l, i) => [l.key, { ...l, order: i }]));
  const sciByDose = new Map(); // dose -> visible lines
  if (state.scientific && sci) {
    state.addedDoses.forEach((dose) => {
      const lines = scienceLines(dose).filter((l) => !sci.isHidden(l.key));
      if (lines.length || scienceLines(dose).length) sciByDose.set(dose, lines);
    });
  }

  const allX = Array.from(
    new Set([
      ...state.addedDoses.filter((dose) => !sciByDose.has(dose)).flatMap((dose) => dose.x.map((value) => Number(value.toFixed(4)))),
      ...[...sciByDose.values()].flat().flatMap((l) => l.x.map((value) => Number(value.toFixed(4)))),
    ])
  ).sort((a, b) => a - b);
  if (!allX.length) allX.push(...state.addedDoses[0].x.map((value) => Number(value.toFixed(4))));

  const names = [];
  state.addedDoses.forEach((dose) => {
    if (!names.includes(dose.substance)) names.push(dose.substance);
  });

  const series = [];
  names.forEach((name) => {
    const doses = state.addedDoses.filter((dose) => dose.substance === name);
    const plain = doses.filter((dose) => !sciByDose.has(dose));
    const color = colorForSubstance(name);
    if (plain.length) {
      series.push({ name, color, y: allX.map((point) => plain.reduce((sum, dose) => sum + interpolateDose(dose, point), 0)) });
    }
    const keys = [...new Set(doses.flatMap((dose) => (sciByDose.get(dose) || []).map((l) => l.key)))].sort((a, b) => lineInfo[a].order - lineInfo[b].order);
    keys.forEach((key, i) => {
      const lines = doses.flatMap((dose) => (sciByDose.get(dose) || []).filter((l) => l.key === key));
      // One substance: each line in its own color (as on its button). Several:
      // the substance's color, told apart by the dash pattern.
      const main = i === 0 && !plain.length;
      series.push({
        name: `${name} · ${lineInfo[key].label}`,
        color: names.length === 1 ? lineInfo[key].color : color,
        dash: main ? "" : lineInfo[key].dash || (names.length === 1 ? "solid" : "longdash"),
        secondary: !main,
        y: allX.map((point) => lines.reduce((sum, l) => sum + interpolateDose(l, point), 0)),
      });
    });
  });

  const hoverTimes = allX.map(formatChartTime);
  const minimum = Math.floor(Math.min(...allX));
  const maximum = Math.ceil(Math.max(...allX));
  // One grid line per hour; only very long timelines (over 2 days) step wider.
  const span = maximum - minimum;
  const tickStep = span <= 48 ? 1 : Math.ceil(span / 24);
  // Hours run well past both ends so the clock labels and grid still show
  // when the Graph is zoomed out beyond the doses.
  const extra = Math.ceil(Math.max(8, span * 3) / tickStep) * tickStep;
  const tickValues = [];
  for (let hour = minimum - extra; hour <= maximum + extra; hour += tickStep) tickValues.push(hour);

  return {
    x: allX,
    series,
    hoverTimes,
    tickValues,
    tickText: tickValues.map(formatChartTime),
  };
}
