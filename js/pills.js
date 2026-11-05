// ============================================================
// pills.js: pictures of real pills (assets/pills, mommy 2026-11-05).
// Each file is named brand + dose ("elvanse70.png"). The brand is
// matched to a medicine by its name or aliases ("Elvanse" ->
// "Elvanse (lisdexamfetamine)"), so the Graph can add that dose and
// the Journal can show the pills on the right page.
// window.xnPills: load, match, matches, forSubstance, label, amount, pick
// ============================================================
(function () {
  "use strict";

  // Brands that aren't an alias of a medicine yet: brand -> an alias it shares a product with.
  const SAME_AS = { oxydolor: "oxycontin" };
  const CACHE = "xn_pill_pictures";
  let loading = null;

  const low = (v) => String(v || "").trim().toLowerCase();

  /** The pill pictures on the server, [{file, url, brand, dose, unit}]. Kept for offline use. */
  function load() {
    if (loading) return loading;
    loading = fetch("/pill-pictures", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then((list) => {
        list = Array.isArray(list) ? list : [];
        try { localStorage.setItem(CACHE, JSON.stringify(list)); } catch {}
        return list;
      })
      .catch(() => {
        try { return JSON.parse(localStorage.getItem(CACHE) || "[]") || []; } catch { return []; }
      });
    return loading;
  }

  function namesOf(sub) {
    return [sub.name, ...(sub.commonNames || sub.aliases || [])].map(low).filter(Boolean);
  }

  /**
   * Gives each pill the substance it belongs to.
   * subs: substances with name, commonNames/aliases and ingredient (logic.customSubstances()).
   * Adds substance, ingredient and brandName ("OxyContin" as the alias writes it).
   */
  function match(pills, subs) {
    subs = (subs || []).filter((s) => s && s.name);
    return (pills || []).map((p) => {
      const brand = low(p.brand);
      const wanted = [brand, SAME_AS[brand]].filter(Boolean);
      let sub = null;
      let alias = "";
      for (const w of wanted) {
        // An exact alias or name first, then a name that contains the brand.
        sub = subs.find((s) => namesOf(s).includes(w));
        if (!sub) sub = subs.find((s) => low(s.name).split(/[^a-z0-9]+/).includes(w));
        if (sub) {
          if (w === brand) alias = [sub.name, ...(sub.commonNames || sub.aliases || [])].find((n) => low(n) === brand) || "";
          break;
        }
      }
      const brandName = alias || brand.charAt(0).toUpperCase() + brand.slice(1);
      return { ...p, brandName, substance: sub ? sub.name : brandName, ingredient: sub ? sub.ingredient || "" : "", names: sub ? namesOf(sub) : [] };
    });
  }

  /** The pills of a substance: a medicine by its name, a PsychonautWiki substance by what the medicine contains. */
  function forSubstance(pills, sub) {
    if (!sub) return [];
    const name = low(typeof sub === "string" ? sub : sub.name);
    return (pills || []).filter((p) => low(p.substance) === name || low(p.ingredient).split(/\s*\+\s*/).includes(name));
  }

  function amount(p) {
    return `${String(p.dose).replace(/\.0+$/, "")} ${p.unit || "mg"}`;
  }

  /** True when every word of a search ("elvanse 70", "oxycodone") is in the pill's names, brand or dose. */
  function matches(p, query) {
    const words = low(query).split(/[^a-z0-9.]+/).filter(Boolean);
    if (!words.length) return true;
    const text = [p.brandName, p.brand, p.substance, p.ingredient, ...(p.names || [])].map(low).join(" ");
    // A number is a dose ("80" finds 80 mg pills, not every name with 80 in it).
    const dose = String(p.dose);
    return words.every((w) => (/^\d/.test(w) ? dose === w.replace(/mg$/, "") || dose.startsWith(w) : text.includes(w)) || (w === "mg" || w === low(p.unit)));
  }

  /** "Elvanse 70 mg" */
  function label(p) {
    return `${p.brandName || p.brand} ${amount(p)}`;
  }

  /** One picture to stand for a substance: its strongest pill. */
  function pick(pills) {
    return (pills || []).reduce((best, p) => (!best || p.dose > best.dose ? p : best), null);
  }

  window.xnPills = { load, match, matches, forSubstance, label, amount, pick };
})();
