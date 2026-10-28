// ============================================================
// logic.js
// All application state + business logic. NO DOM access here —
// this file should run unchanged in a Node test runner.
// Ported 1:1 from the old inline <script> in sub.html; math and
// control flow are unchanged, only reorganized and exported.
// ============================================================

const API_URL = "https://api.psychonautwiki.org";

const state = {
  currentSubstance: null,
  currentCommonDose: null,
  units: "",
  doseSequence: 0,
  addedDoses: [],
  baseDurations: { onset: 0, comeup: 0, peak: 0, offset: 0 },
  substanceColors: {},
};

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

/** Typeahead suggestions. Old name: searchSuggestions() (network part only). */
export async function searchSuggestions(name) {
  const query = `query Suggestions($name: String!) {
        substances(query: $name) { name }
    }`;
  const result = await fetchGraphQL(query, { name });
  return result?.data?.substances || [];
}

/**
 * Full substance lookup. Old name: getData() + the state-assignment
 * half of search(). Updates internal state and returns the same
 * shape the UI needs to render the substance panel.
 */
export async function fetchSubstanceData(name) {
  const query = `query Substance($name: String!) {
        substances(query: $name) {
            name
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
                }
                dose { units common { min } }
            }
        }
    }`;

  const result = await fetchGraphQL(query, { name });
  const substance = result?.data?.substances?.[0];
  const roa =
    substance?.roas?.find((item) => item.duration && item.dose?.common?.min) ||
    substance?.roas?.[0];

  if (!substance || !roa?.duration || !roa?.dose?.common?.min) {
    throw new Error("No usable dose and duration data was found for this substance.");
  }

  state.currentSubstance = substance;
  state.currentCommonDose = Number(roa.dose.common.min);
  state.units = roa.dose.units || "";
  state.baseDurations = {
    onset: averageHours(roa.duration.onset),
    comeup: averageHours(roa.duration.comeup),
    peak: averageHours(roa.duration.peak),
    offset: averageHours(roa.duration.offset),
  };

  return {
    substance,
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

export function buildDoseCurve(startHour, doseAmount, releaseHours) {
  const intensity = doseAmount / state.currentCommonDose;
  const adjusted = {
    onset: state.baseDurations.onset + releaseHours * 0.15,
    comeup: state.baseDurations.comeup + releaseHours * 0.25,
    peak: state.baseDurations.peak + releaseHours * 0.45,
    offset: state.baseDurations.offset + releaseHours * 0.15,
  };
  const total = Object.values(adjusted).reduce((sum, value) => sum + value, 0);
  const step = Math.max(0.05, total / 650);
  const x = [startHour];
  const y = [0];
  let cursor = startHour;

  appendSegment(adjusted.onset, () => 0);
  appendSegment(adjusted.comeup, (progress) => progress * 100 * intensity);
  appendSegment(adjusted.peak, () => 100 * intensity);
  appendSegment(adjusted.offset, (progress) => (1 - progress) * 100 * intensity);

  function appendSegment(duration, valueAt) {
    if (duration <= 0) return;
    const count = Math.max(1, Math.ceil(duration / step));
    for (let index = 1; index <= count; index += 1) {
      const progress = index / count;
      x.push(cursor + duration * progress);
      y.push(Math.max(0, valueAt(progress)));
    }
    cursor += duration;
  }

  return { x, y };
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
  const curve = buildDoseCurve(timeToHours(doseTime), numericAmount, formulation.releaseHours);

  const dose = {
    id: ++state.doseSequence,
    x: curve.x,
    y: curve.y,
    time: doseTime,
    amount: numericAmount,
    unit: state.units,
    formulation: formulation.label,
    releaseHours: formulation.releaseHours,
    substance: state.currentSubstance.name,
    color: colorForSubstance(state.currentSubstance.name),
  };

  state.addedDoses.push(dose);
  return dose;
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

export function colorForSubstance(name) {
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

  const allX = Array.from(
    new Set(state.addedDoses.flatMap((dose) => dose.x.map((value) => Number(value.toFixed(4)))))
  ).sort((a, b) => a - b);

  const names = [];
  state.addedDoses.forEach((dose) => {
    if (!names.includes(dose.substance)) names.push(dose.substance);
  });

  const series = names.map((name) => {
    const doses = state.addedDoses.filter((dose) => dose.substance === name);
    return {
      name,
      color: colorForSubstance(name),
      y: allX.map((point) => doses.reduce((sum, dose) => sum + interpolateDose(dose, point), 0)),
    };
  });

  const hoverTimes = allX.map(formatChartTime);
  const minimum = Math.floor(Math.min(...allX));
  const maximum = Math.ceil(Math.max(...allX));
  // One grid line per hour; only very long timelines (over 2 days) step wider.
  const span = maximum - minimum;
  const tickStep = span <= 48 ? 1 : Math.ceil(span / 24);
  const tickValues = [];
  for (let hour = minimum; hour <= maximum; hour += tickStep) tickValues.push(hour);

  return {
    x: allX,
    series,
    hoverTimes,
    tickValues,
    tickText: tickValues.map(formatChartTime),
  };
}
