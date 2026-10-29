// notedrugs.js: drug names in profile notes get the drug's icon in front
// (css/classicons.css, js/classicons.js). Names come from the substances
// this browser has from PsychonautWiki (offline.js), the site's custom
// substances and a short built-in list, so it works on a fresh browser too.
import { allSubstances } from "/offline.js";
import { customSubstances } from "/logic.js";

// Common names and slang -> the name the icon is picked by.
const BUILT_IN = {
  lsd: "LSD", acid: "LSD", "1p-lsd": "1P-LSD", "1cp-lsd": "1cP-LSD", "al-lad": "AL-LAD",
  mushrooms: "Psilocybin mushrooms", mushroom: "Psilocybin mushrooms", shrooms: "Psilocybin mushrooms", psilocybin: "Psilocybin mushrooms",
  mdma: "MDMA", ecstasy: "MDMA", molly: "MDMA", mda: "MDA", "2c-b": "2C-B", "2c-i": "2C-I", "2c-e": "2C-E",
  cocaine: "Cocaine", coke: "Cocaine", crack: "Crack",
  ketamine: "Ketamine", ket: "Ketamine", "3-mmc": "3-MMC", "4-mmc": "4-MMC", mephedrone: "Mephedrone",
  amphetamine: "Amphetamine", speed: "Amphetamine", methamphetamine: "Methamphetamine", meth: "Methamphetamine",
  dmt: "DMT", "5-meo-dmt": "5-MeO-DMT", ayahuasca: "DMT", mescaline: "Mescaline", peyote: "Mescaline", "san pedro": "Mescaline",
  cannabis: "Cannabis", weed: "Cannabis", marijuana: "Cannabis", thc: "THC", cbd: "CBD", hhc: "HHC", hash: "Cannabis",
  alcohol: "Alcohol", beer: "Alcohol", wine: "Alcohol", vodka: "Alcohol",
  caffeine: "Caffeine", coffee: "Caffeine", nicotine: "Nicotine", tobacco: "Nicotine", cigarettes: "Nicotine",
  nitrous: "Nitrous", "nitrous oxide": "Nitrous", "laughing gas": "Nitrous", poppers: "Poppers",
  ghb: "GHB", gbl: "GBL", dxm: "DXM", dextromethorphan: "DXM", salvia: "Salvia", kratom: "Kratom",
  xanax: "Alprazolam", alprazolam: "Alprazolam", diazepam: "Diazepam", valium: "Diazepam", clonazepam: "Clonazepam", klonopin: "Clonazepam",
  lorazepam: "Lorazepam", etizolam: "Etizolam", bromazolam: "Bromazolam",
  zolpidem: "Zolpidem", ambien: "Zolpidem", zopiclone: "Zopiclone",
  gabapentin: "Gabapentin", pregabalin: "Pregabalin", lyrica: "Pregabalin", phenibut: "Phenibut",
  heroin: "Heroin", oxycodone: "Oxycodone", oxy: "Oxycodone", codeine: "Codeine", morphine: "Morphine", tramadol: "Tramadol",
  methadone: "Methadone", fentanyl: "Fentanyl", hydrocodone: "Hydrocodone", lean: "Codeine",
  adderall: "Adderall", ritalin: "Methylphenidate", methylphenidate: "Methylphenidate", modafinil: "Modafinil", vyvanse: "Lisdexamfetamine",
  "o-pce": "O-PCE", "2-fdck": "2-FDCK", pcp: "PCP", mxe: "Methoxetamine", "3-meo-pcp": "3-MeO-PCP",
};
// Classes for built-in names the icon list doesn't cover by name.
const BUILT_IN_CLASS = {
  Diazepam: "Benzodiazepine", Clonazepam: "Benzodiazepine", Lorazepam: "Benzodiazepine", Etizolam: "Benzodiazepine", Bromazolam: "Benzodiazepine",
  Fentanyl: "Opioid", "1P-LSD": "Psychedelic", "1cP-LSD": "Psychedelic", "AL-LAD": "Psychedelic", "2C-I": "Psychedelic", "2C-E": "Psychedelic",
};
// Everyday words that are also slang somewhere; never marked from other names.
const SKIP = new Set(["ice", "glass", "snow", "tina", "crystal", "dope", "smack", "tea", "spice", "pot", "grass", "herb", "candy", "x", "e", "k", "g", "h", "m", "t", "the", "and", "special k", "green", "white", "blue", "rock", "rocks", "pills", "pill", "powder", "base", "black", "brown", "gear", "horse", "junk", "skunk", "bars", "bar", "beans", "molly"]);

let index = null;

async function buildIndex() {
  const terms = new Map(); // lower-case term -> substance-like { name, class }
  const add = (term, sub, isMain) => {
    const key = String(term || "").trim().toLowerCase();
    if (!key || terms.has(key)) return;
    if (!isMain && (key.length < 4 || SKIP.has(key))) return;
    if (isMain && key.length < 3) return;
    terms.set(key, sub);
  };
  const [custom, catalog] = await Promise.all([customSubstances().catch(() => []), allSubstances().catch(() => [])]);
  [...custom, ...catalog].forEach((sub) => {
    add(sub.name, sub, true);
    (sub.commonNames || []).forEach((n) => add(n, sub, false));
  });
  Object.entries(BUILT_IN).forEach(([term, name]) => {
    const key = term.toLowerCase();
    if (terms.has(key)) return;
    const known = terms.get(name.toLowerCase());
    terms.set(key, known || { name, class: { psychoactive: BUILT_IN_CLASS[name] ? [BUILT_IN_CLASS[name]] : [] } });
  });
  const escaped = [...terms.keys()].sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = escaped.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join("|")})(?![\\p{L}\\p{N}])`, "giu") : null;
  return { terms, re };
}

function getIndex() {
  if (!index) index = buildIndex().catch(() => ({ terms: new Map(), re: null }));
  return index;
}

/** Writes text into el, then puts an icon in front of each drug name in it. */
export function markDrugs(el, text) {
  el.textContent = text;
  if (!text || !window.xnClass) return;
  getIndex().then(({ terms, re }) => {
    if (!re || el.textContent !== text) return;
    const frag = document.createDocumentFragment();
    let at = 0;
    let found = false;
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const sub = terms.get(m[0].toLowerCase());
      const key = sub ? window.xnClass.keyFor(sub) : "";
      if (!key) continue;
      found = true;
      frag.append(text.slice(at, m.index));
      const span = document.createElement("span");
      span.className = "nd-drug";
      span.title = sub.name;
      span.append(window.xnClass.icon(key, "nd-icon", sub.name), m[0]);
      frag.append(span);
      at = m.index + m[0].length;
    }
    if (!found) return;
    frag.append(text.slice(at));
    el.replaceChildren(frag);
  });
}
