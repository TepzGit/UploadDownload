// ============================================================
// journalimport.js
// Turns a PsychonautWiki Journal export (the app's Settings ›
// Export file, JSON) into Graph sessions for this site, with a
// trip report for each experience that has notes, and the
// Journal's substance colors. translateJournal has no DOM access,
// so it also runs in Node; setupJournalImport wires Profile ›
// Data › Import data.
// ============================================================

const HOUR = 3600000;

// Journal's color names (AdaptiveColor) as hex colors.
const JOURNAL_COLORS = {
  RED: "#ff3b30", ORANGE: "#ff9500", YELLOW: "#ffcc00", GREEN: "#34c759", MINT: "#00c7be",
  TEAL: "#30b0c7", CYAN: "#32ade6", BLUE: "#007aff", INDIGO: "#5856d6", PURPLE: "#af52de",
  PINK: "#ff2d55", BROWN: "#a2845e", FIRE_ENGINE_RED: "#ce2029", CORAL: "#ff7f50",
  TOMATO: "#ff6347", CINNABAR: "#e34234", RUST: "#b7410e", ORANGE_RED: "#ff4500",
  AUBURN: "#a52a2a", SADDLE_BROWN: "#8b4513", DARK_ORANGE: "#ff8c00", DARK_GOLD: "#b8860b",
  KHAKI: "#c3b091", BRONZE: "#cd7f32", GOLD: "#ffd700", OLIVE: "#808000",
  OLIVE_DRAB: "#6b8e23", DARK_OLIVE_GREEN: "#556b2f", MOSS_GREEN: "#8a9a5b",
  LIME_GREEN: "#32cd32", LIME: "#bfff00", FOREST_GREEN: "#228b22", SEA_GREEN: "#2e8b57",
  JUNGLE_GREEN: "#29ab87", LIGHT_SEA_GREEN: "#20b2aa", DARK_TURQUOISE: "#00ced1",
  DODGER_BLUE: "#1e90ff", ROYAL_BLUE: "#4169e1", DEEP_LAVENDER: "#9370db",
  BLUE_VIOLET: "#8a2be2", DARK_VIOLET: "#9400d3", HELIOTROPE: "#df73ff", BYZANTIUM: "#702963",
  MAGENTA: "#ff00ff", DARK_MAGENTA: "#8b008b", FUCHSIA: "#c154c1", DEEP_PINK: "#ff1493",
  GRAYISH_MAGENTA: "#a87ca0", HOT_PINK: "#ff69b4", JAZZBERRY_JAM: "#a50b5e", MAROON: "#800000",
};

// Journal's shulgin rating options on the site's 1-5 report stars.
const RATINGS = { MINUS: 1, PLUS_MINUS: 1, PLUS: 2, TWO_PLUS: 3, THREE_PLUS: 4, FOUR_PLUS: 5 };
const RATING_LABELS = { MINUS: "-", PLUS_MINUS: "±", PLUS: "+", TWO_PLUS: "++", THREE_PLUS: "+++", FOUR_PLUS: "++++" };

// Used when neither PsychonautWiki nor the custom substances have timings,
// so the session still draws: a plain five hour curve.
export const FALLBACK_BASE = { onset: 0.5, comeup: 0.5, peak: 2, offset: 2 };

const MASS = { "g": 1000, "mg": 1, "µg": 0.001 };

function unitKey(unit) {
  const u = String(unit || "").trim().toLowerCase().replace(/^μ/, "µ");
  if (u === "ug" || u === "mcg" || u === "µg") return "µg";
  if (u === "milligrams") return "mg";
  if (u === "ml" || u === "milliliter" || u === "millilitre") return "mL";
  return u;
}

/** How many `to` one `from` is, for mass units; null when they don't convert. */
export function unitFactor(from, to) {
  const a = MASS[unitKey(from)];
  const b = MASS[unitKey(to)];
  if (unitKey(from) === unitKey(to)) return 1;
  return a && b ? a / b : null;
}

/** Epoch ms from what Journal wrote: ms, seconds, or an ISO date. */
export function journalTime(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e11 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "object" && value.epochSeconds !== undefined) return journalTime(Number(value.epochSeconds));
  const n = Number(value);
  if (String(value).trim() !== "" && Number.isFinite(n)) return journalTime(n);
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : 0;
}

function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtAmount(n) {
  return String(Math.round(n * 1000) / 1000);
}

function colorFor(value) {
  const v = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  return JOURNAL_COLORS[v.toUpperCase()] || "";
}

/** Reads the file's text as a Journal export, or throws with a message for the person. */
export function parseJournal(text) {
  let data;
  try {
    data = JSON.parse(String(text).replace(/^﻿/, ""));
  } catch {
    throw new Error("That file isn't a Journal export (it isn't JSON).");
  }
  if (Array.isArray(data)) data = { experiences: data };
  if (!data || !Array.isArray(data.experiences)) {
    throw new Error("That file has no experiences. In the Journal app use Settings › Export file.");
  }
  return data;
}

/**
 * Journal export -> what POST /experiences/import takes.
 * profileFor(name, route) resolves to { name, base, commonDose, units } or
 * null when the substance has no timings; it is called once per name+route.
 */
export async function translateJournal(data, profileFor, options = {}) {
  const reports = options.reports !== false;
  const customUnits = new Map((data.customUnits || []).map((u) => [String(u.id), u]));
  const profiles = new Map();
  const getProfile = async (name, route) => {
    const key = name.toLowerCase() + "|" + route;
    if (!profiles.has(key)) {
      profiles.set(key, Promise.resolve().then(() => profileFor(name, route)).catch(() => null));
    }
    return profiles.get(key);
  };

  const stats = { experiences: data.experiences.length, sessions: 0, doses: 0, reports: 0, others: 0, noTiming: new Set(), noDose: 0, cut: 0, empty: 0 };
  const items = [];

  for (const exp of data.experiences) {
    const all = (Array.isArray(exp?.ingestions) ? exp.ingestions : [])
      .map((ing) => ({ ing, at: journalTime(ing?.time) }))
      .filter((x) => x.at > 0 && String(x.ing?.substanceName || "").trim())
      .sort((a, b) => a.at - b.at);
    // Doses logged for someone else (Journal's "consumer") aren't yours.
    const mine = all.filter((x) => !String(x.ing.consumerName || "").trim());
    stats.others += all.length - mine.length;
    if (!mine.length) {
      stats.empty++;
      continue;
    }
    if (mine.length > 100) stats.cut += mine.length - 100;
    const list = mine.slice(0, 100);
    const startedAt = list[0].at;

    const doses = [];
    for (const { ing, at } of list) {
      const journalName = String(ing.substanceName).trim();
      const route = String(ing.administrationRoute || "").trim().toLowerCase();
      const notes = [];
      let amount = Number(ing.dose);
      let unit = String(ing.units || "").trim();
      const cu = ing.customUnitId !== null && ing.customUnitId !== undefined ? customUnits.get(String(ing.customUnitId)) : null;
      if (cu) {
        const per = Number(cu.dose);
        const count = amount;
        notes.push(`${fmtAmount(count)} ${count === 1 ? cu.unit || cu.name : cu.unitPlural || cu.unit || cu.name}${cu.name && cu.name !== cu.unit ? ` (${cu.name})` : ""}`);
        amount = per > 0 && count > 0 ? per * count : NaN;
        unit = String(cu.originalUnit || unit || "").trim();
      }
      const p = await getProfile(journalName, route);
      const name = p?.name || journalName;
      let base = p?.base ? { ...p.base } : { ...FALLBACK_BASE };
      let common = Number(p?.commonDose) || 0;
      if (!p) stats.noTiming.add(journalName);
      if (!unit) unit = p?.units || "";
      if (common > 0 && p?.units) {
        const f = unitFactor(p.units, unit);
        if (f) common *= f;
      }
      if (!(amount > 0)) {
        stats.noDose++;
        notes.push("Dose not recorded in Journal");
        amount = common > 0 ? common : 1;
      } else if (ing.isDoseAnEstimate) {
        const sd = Number(ing.estimatedDoseStandardDeviation);
        notes.push(sd > 0 ? `Estimated (± ${fmtAmount(sd)} ${unit})` : "Estimated dose");
      }
      if (!(common > 0)) common = amount;
      const end = journalTime(ing.endTime);
      const releaseHours = end > at ? Math.min(48, Math.round(((end - at) / HOUR) * 100) / 100) : 0;
      if (ing.stomachFullness && !/^(empty|null|)$/i.test(String(ing.stomachFullness))) {
        notes.push(`Stomach: ${String(ing.stomachFullness).toLowerCase().replace(/_/g, " ")}`);
      }
      if (String(ing.notes || "").trim()) notes.push(String(ing.notes).trim());
      doses.push({
        substance: name.slice(0, 80),
        amount,
        unit: unit.slice(0, 12),
        formulation: releaseHours > 0 ? "Over time" : "",
        releaseHours,
        route,
        time: clock(at),
        note: notes.join("\n").slice(0, 2000),
        profile: { base, commonDose: common },
      });
    }

    const item = { startedAt, doses };
    if (reports) {
      const report = experienceReport(exp, doses, startedAt);
      if (report) {
        item.report = report;
        stats.reports++;
      }
    }
    items.push(item);
    stats.sessions++;
    stats.doses += doses.length;
  }

  const colors = (data.substanceCompanions || [])
    .map((c) => ({ name: String(c?.substanceName || "").trim(), color: colorFor(c?.color) }))
    .filter((c) => c.name && c.color);

  return { items, colors, stats: { ...stats, noTiming: [...stats.noTiming] } };
}

/** The trip report for an experience: its text, timed notes and rating, or null if it has none. */
function experienceReport(exp, doses, startedAt) {
  const parts = [];
  const text = String(exp.text || "").trim();
  if (text) parts.push(text);
  const timed = (Array.isArray(exp.timedNotes) ? exp.timedNotes : [])
    .map((n) => ({ at: journalTime(n?.time), note: String(n?.note || "").trim() }))
    .filter((n) => n.note)
    .sort((a, b) => a.at - b.at);
  if (timed.length) {
    parts.push("Timed notes:\n" + timed.map((n) => (n.at ? clock(n.at) + "  " : "") + n.note).join("\n"));
  }
  const ratings = Array.isArray(exp.ratings) ? exp.ratings.filter((r) => RATINGS[String(r?.option || "").toUpperCase()]) : [];
  const overall = ratings.find((r) => r.time === null || r.time === undefined) || null;
  const timedRatings = ratings.filter((r) => r !== overall && journalTime(r.time));
  if (timedRatings.length) {
    parts.push("Ratings:\n" + timedRatings.map((r) => clock(journalTime(r.time)) + "  " + RATING_LABELS[String(r.option).toUpperCase()]).join("\n"));
  }
  const best = overall || timedRatings.reduce((a, r) => (!a || RATINGS[String(r.option).toUpperCase()] > RATINGS[String(a.option).toUpperCase()] ? r : a), null);
  const rating = best ? RATINGS[String(best.option).toUpperCase()] : 0;
  if (!parts.length && !rating) return null;
  const names = [...new Set(doses.map((d) => d.substance))];
  return {
    title: String(exp.title || "").trim().slice(0, 120) || "Journal experience " + new Date(startedAt).toLocaleDateString(),
    substances: names.join(", ").slice(0, 300),
    setting: String(exp.location?.name || "").trim().slice(0, 300),
    body: parts.join("\n\n").slice(0, 50000),
    rating,
  };
}

// ------------------------------------------------------------
// Profile › Data › Import data
// ------------------------------------------------------------

/** A profileFor that asks PsychonautWiki (and the custom substances) like the Graph does. */
export async function siteProfileFor() {
  const logic = await import("./logic.js");
  return async (name, route) => {
    let loaded;
    try {
      loaded = await logic.fetchSubstanceData(name);
    } catch {
      return null;
    }
    // fetchSubstanceData takes the best search match; only use it when it is this substance.
    const sub = loaded.substance;
    const names = [sub?.name, ...(sub?.commonNames || [])].map((n) => String(n || "").toLowerCase());
    if (!names.includes(name.toLowerCase())) return null;
    const roa = route && loaded.roas.some((r) => r.name === route) ? logic.selectRoa(route) : loaded;
    return { name: sub.name, base: { ...roa.durations }, commonDose: roa.commonDose, units: roa.units };
  };
}

export function setupJournalImport(root) {
  if (!root) return;
  const file = root.querySelector("#jiFile");
  const pick = root.querySelector("#jiPick");
  const summary = root.querySelector("#jiSummary");
  const go = root.querySelector("#jiGo");
  const status = root.querySelector("#jiStatus");
  const withReports = root.querySelector("#jiReports");
  const withColors = root.querySelector("#jiColors");
  let parsed = null;
  let busy = false;

  const say = (text, kind = "") => {
    status.textContent = text;
    status.dataset.kind = kind;
  };

  pick.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files && file.files[0];
    parsed = null;
    go.hidden = true;
    summary.hidden = true;
    if (!f) return;
    try {
      parsed = parseJournal(await f.text());
    } catch (error) {
      say(error.message, "error");
      return;
    }
    const n = parsed.experiences.length;
    const ingestions = parsed.experiences.reduce((t, e) => t + (Array.isArray(e?.ingestions) ? e.ingestions.length : 0), 0);
    const times = parsed.experiences.flatMap((e) => (e?.ingestions || []).map((i) => journalTime(i?.time))).filter(Boolean);
    const range = times.length
      ? ` from ${new Date(Math.min(...times)).toLocaleDateString()} to ${new Date(Math.max(...times)).toLocaleDateString()}`
      : "";
    summary.textContent = `${f.name}: ${n} ${n === 1 ? "experience" : "experiences"} with ${ingestions} ${ingestions === 1 ? "dose" : "doses"}${range}.`;
    summary.hidden = false;
    go.hidden = false;
    say("");
  });

  go.addEventListener("click", async () => {
    if (!parsed || busy) return;
    busy = true;
    go.disabled = true;
    pick.disabled = true;
    try {
      say("Looking up the substances on PsychonautWiki…");
      const profileFor = await siteProfileFor();
      const out = await translateJournal(parsed, profileFor, { reports: withReports.checked });
      const total = { added: 0, skipped: 0, invalid: 0, reports: 0 };
      for (let i = 0; i < out.items.length; i += 50) {
        say(`Saving sessions ${i + 1} to ${Math.min(out.items.length, i + 50)} of ${out.items.length}…`);
        const res = await fetch("/experiences/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: out.items.slice(i, i + 50) }),
        });
        if (!res.ok) throw new Error((await res.text()).trim() || "Couldn't save the import.");
        const got = await res.json();
        for (const k of Object.keys(total)) total[k] += got[k] || 0;
      }
      let colored = 0;
      if (withColors.checked && out.colors.length) {
        say("Adding your Journal colors…");
        let have = [];
        try { have = await (await fetch("/graphColors")).json(); } catch {}
        const taken = new Set((Array.isArray(have) ? have : []).map((c) => String(c.name).toLowerCase()));
        for (const c of out.colors) {
          if (taken.has(c.name.toLowerCase())) continue;
          const res = await fetch("/graphColors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
          if (res.ok) colored++;
        }
      }
      const lines = [`Added ${total.added} ${total.added === 1 ? "session" : "sessions"} to your Graph experiences`];
      if (total.reports) lines[0] += ` and ${total.reports} trip ${total.reports === 1 ? "report" : "reports"} to Notes`;
      lines[0] += ".";
      if (total.skipped) lines.push(total.skipped === 1 ? "1 was already imported." : `${total.skipped} were already imported.`);
      if (colored) lines.push(`${colored} substance ${colored === 1 ? "color" : "colors"} added.`);
      if (out.stats.noTiming.length) lines.push(`No timings found for ${out.stats.noTiming.join(", ")}, so those draw a standard 5 hour curve.`);
      if (out.stats.others) lines.push(out.stats.others === 1 ? "1 dose logged for someone else was left out." : `${out.stats.others} doses logged for other people were left out.`);
      if (total.invalid) lines.push(total.invalid === 1 ? "1 session couldn't be drawn and was left out." : `${total.invalid} sessions couldn't be drawn and were left out.`);
      say(lines.join(" "), "done");
      document.dispatchEvent(new CustomEvent("xn-doses-changed"));
      go.hidden = true;
    } catch (error) {
      say(error.message || "Couldn't import that file.", "error");
    } finally {
      busy = false;
      go.disabled = false;
      pick.disabled = false;
    }
  });
}

// Node: `node js/journalimport.js export.json` prints what would be sent,
// with every substance on the standard curve (no PsychonautWiki lookups).
if (typeof process !== "undefined" && process.argv && /journalimport\.js$/.test(process.argv[1] || "")) {
  const fs = await import("node:fs");
  const data = parseJournal(fs.readFileSync(process.argv[2], "utf8"));
  const out = await translateJournal(data, () => null);
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}
