// drugfacts.js: what the site knows about drugs beyond PsychonautWiki
// (mommy 2026-11-20). Tolerance that fades over days, cross-tolerance,
// combination warnings, harm reduction tips and legal status by country.
// Used by the Graph, the Stats page and the Drug Database (window.xnFacts).
// Everything here is a rough guide built from PsychonautWiki's tolerance
// notes, TripSit's combination chart and public drug laws, not advice.
(() => {
  const low = (s) => String(s || "").toLowerCase();

  // ---------- What kind of drug a name is (tags) ----------
  // First match wins; a name can also get tags from its PsychonautWiki class.
  const NAME_TAGS = [
    [/\b(alcohol|ethanol|beer|wine|vodka|whisky|liquor)\b/, ["depressant", "alcohol"]],
    [/\b(ghb|gbl|1,4-butanediol|oxybate|xyrem)\b/, ["depressant", "ghb"]],
    [/pregabalin|lyrica|gabapentin|neurontin|phenibut/, ["depressant", "gabapentinoid"]],
    [/zolpidem|zopiclone|eszopiclone|zaleplon|imovane|stilnox|ambien/, ["depressant", "zdrug"]],
    [/az[eo]pam|azolam|etizolam|clobazam|chlordiazepoxide|xanax|ksalol|valium|stesolid|frisium|rivotril|klonopin|ativan|alprox/, ["depressant", "benzo"]],
    [/barbital|phenobarb|secobarb|pentobarb/, ["depressant", "barbiturate"]],
    [/tramadol|tradolan|ultram/, ["opioid", "serotonergic", "tramadol"]],
    [/dextromethorphan|\bdxm\b/, ["dissociative", "serotonergic", "dxm"]],
    [/\b(mdma|mda|mdea|methylone|ecstasy|molly|mdai)\b/, ["empathogen", "serotonergic", "stimulant"]],
    [/ayahuasca|harmal|harmine|moclobemide|phenelzine|tranylcypromine|selegiline|syrian rue|\bmaoi/, ["maoi"]],
    [/sertraline|fluoxetine|citalopram|escitalopram|paroxetine|fluvoxamine|venlafaxine|duloxetine|\bssri/, ["ssri", "serotonergic"]],
    [/lithium/, ["lithium"]],
    [/cocaine|\bcrack\b/, ["stimulant", "cocaine"]],
    [/caffeine|coffee/, ["stimulant", "caffeine"]],
    [/nicotine|tobacco|snus/, ["stimulant", "nicotine"]],
    [/(^|[^-])\bdmt\b|5-meo-dmt|n,n-dmt/, ["psychedelic", "dmt"]],
    [/cannabis|\bthc\b|marijuana|\bhhc\b|delta-8|\bweed\b|\bhash|jwh-|synthetic cannabinoid|\bcbd\b/, ["cannabinoid"]],
    [/nitrous|laughing gas/, ["dissociative", "nitrous"]],
    [/ketamine|\bpcp\b|methoxetamine|\bmxe\b|3-meo-pcp|deschloroketamine|2-fdck|o-pce|memantine/, ["dissociative"]],
    [/kratom|mitragyn/, ["opioid", "kratom"]],
    [/modafinil|armodafinil/, ["stimulant", "eugeroic"]],
    [/methylphenidate|ritalin|concerta|medikinet|amphetamin|amfetamin|elvanse|vyvanse|adderall|lisdex|dexedrine|methamphet|phentermine|ephedrine|mephedrone|cathinone|a-pvp|α-pvp|3-mmc|4-mmc|4-fa\b/, ["stimulant"]],
    [/\blsd\b|\blsa\b|1p-lsd|al-lad|1cp-lsd|psilocyb|psilocin|mushroom|truffle|mescaline|peyote|san pedro|\b2c-|nbome|\bdo[bcim]\b|4-aco-|4-ho-/, ["psychedelic"]],
    [/oxycod|oxycontin|oxynorm|morphin|hydrocod|codeine|kodimagnyl|heroin|fentanyl|methadone|buprenorph|subutex|hydromorph|oxymorph|dihydrocod|pethidine|opium|nitazene|tapentadol|palexia/, ["opioid"]],
    [/diphenhydramine|dimenhydrinate|benadryl|datura|scopolamine|promethazine/, ["deliriant", "depressant"]],
    [/quetiapine|seroquel|olanzapine|risperidone|haloperidol|aripiprazole/, ["depressant", "antipsychotic"]],
    [/mirtazapine|trazodone|clonidine|baclofen|carisoprodol|kava/, ["depressant"]],
    [/melatonin/, ["sleep"]],
  ];
  // js/classicons.js class keys -> tags.
  const CLASS_TAGS = {
    stimulant: ["stimulant"], depressant: ["depressant"], opioid: ["opioid"], psychedelic: ["psychedelic"],
    empathogen: ["empathogen", "serotonergic", "stimulant"], dissociative: ["dissociative"], cannabinoid: ["cannabinoid"],
    deliriant: ["deliriant", "depressant"], zdrug: ["depressant", "zdrug"], eugeroic: ["stimulant", "eugeroic"],
    antipsychotic: ["depressant", "antipsychotic"], oneirogen: [],
  };

  /** Tags for a substance: name (and ingredient) first, then its class key. */
  function tags(name, classKey, ingredient) {
    const text = low(name) + " " + low(ingredient);
    const out = new Set();
    for (const [re, t] of NAME_TAGS) {
      if (re.test(text)) { t.forEach((x) => out.add(x)); break; }
    }
    if (!out.size && classKey && CLASS_TAGS[classKey]) CLASS_TAGS[classKey].forEach((x) => out.add(x));
    return out;
  }

  // ---------- Tolerance ----------
  // build: how much tolerance one common dose adds (1 = full); half: days
  // until it halves; zero: days until it's gone. From PsychonautWiki's
  // tolerance sections (rounded), per kind of drug.
  const TOL = [
    ["dmt", { build: 0.05, half: 1, zero: 2, how: "DMT builds almost no tolerance." }],
    ["nitrous", { build: 0.3, half: 0.5, zero: 2, how: "Tolerance to nitrous fades within a day or two." }],
    ["psychedelic", { build: 1, half: 5, zero: 14, how: "One dose gives almost full tolerance; it halves in about 5 days and is gone after about 2 weeks." }],
    ["empathogen", { build: 0.45, half: 30, zero: 60, how: "MDMA-like drugs work less with frequent use; tolerance halves in about a month and is gone after about 2 months." }],
    ["dxm", { build: 0.5, half: 6, zero: 14, how: "Tolerance halves in about a week and is gone after about 2 weeks." }],
    ["dissociative", { build: 0.25, half: 5, zero: 14, how: "Tolerance builds with repeated use; it halves in 3-7 days and is gone after 1-2 weeks." }],
    ["cannabinoid", { build: 0.12, half: 7, zero: 21, how: "Tolerance builds with daily use; it halves in about a week and is mostly gone after 2-3 weeks." }],
    ["alcohol", { build: 0.06, half: 3, zero: 7, how: "Tolerance builds with regular drinking and fades over about a week." }],
    ["ghb", { build: 0.15, half: 3, zero: 7, how: "Tolerance builds with frequent use; it fades over about a week." }],
    ["gabapentinoid", { build: 0.2, half: 5, zero: 10, how: "Tolerance builds with repeated use; it halves in about 5 days." }],
    ["benzo", { build: 0.15, half: 5, zero: 14, how: "Tolerance builds with daily use; it halves in 3-7 days and is gone after 1-2 weeks." }],
    ["zdrug", { build: 0.15, half: 5, zero: 14, how: "Tolerance builds with nightly use; it halves in about 5 days." }],
    ["opioid", { build: 0.2, half: 5, zero: 14, how: "Tolerance builds fast and drops fast: after a break, a dose you were used to can be an overdose." }],
    ["caffeine", { build: 0.15, half: 2, zero: 7, how: "Tolerance builds with daily use and is gone after about a week." }],
    ["nicotine", { build: 0.1, half: 2, zero: 7, how: "Tolerance builds with daily use." }],
    ["cocaine", { build: 0.12, half: 3, zero: 7, how: "Tolerance builds within a session and fades over a few days." }],
    ["stimulant", { build: 0.2, half: 4, zero: 14, how: "Tolerance builds with repeated use; it halves in 3-7 days and is gone after 1-2 weeks." }],
    ["deliriant", { build: 0.3, half: 5, zero: 14, how: "Tolerance builds with repeated use." }],
    ["depressant", { build: 0.15, half: 5, zero: 14, how: "Tolerance builds with repeated use." }],
  ];
  const TOL_DEFAULT = { build: 0.2, half: 5, zero: 14, how: "Tolerance builds with repeated use (a general estimate)." };

  function toleranceProfile(tagSet) {
    for (const [tag, p] of TOL) if (tagSet.has(tag)) return p;
    return TOL_DEFAULT;
  }

  /** How much two substances share tolerance (0..1). */
  function crossFactor(a, b) {
    if (a.has("psychedelic") && b.has("psychedelic")) return a.has("dmt") || b.has("dmt") ? 0.2 : 1;
    if (a.has("empathogen") && b.has("empathogen")) return 0.8;
    if (a.has("opioid") && b.has("opioid")) return 0.7;
    const gaba = (t) => t.has("benzo") || t.has("zdrug") || t.has("barbiturate");
    if (gaba(a) && gaba(b)) return 0.8;
    if ((gaba(a) && b.has("alcohol")) || (gaba(b) && a.has("alcohol"))) return 0.4;
    if (a.has("gabapentinoid") && b.has("gabapentinoid")) return 0.8;
    if (a.has("cannabinoid") && b.has("cannabinoid")) return 0.9;
    const mild = (t) => t.has("caffeine") || t.has("nicotine");
    if (a.has("stimulant") && b.has("stimulant") && !mild(a) && !mild(b) && !a.has("empathogen") && !b.has("empathogen")) return 0.5;
    if (a.has("dissociative") && b.has("dissociative") && !a.has("nitrous") && !b.has("nitrous")) return 0.5;
    return 0;
  }

  const DAY = 86400000;

  /**
   * Tolerance for one substance from its doses ([{at, amount, common}], any
   * order) at time now: {level 0..1, clearAt (ms, when it is back to 0)}.
   */
  function toleranceFrom(doses, profile, now = Date.now()) {
    const list = doses.filter((d) => d.at <= now).sort((a, b) => a.at - b.at);
    let level = 0;
    let last = null;
    let sinceStart = 0; // days since tolerance started building again
    const decay = (lv, days) => {
      if (days <= 0) return lv;
      if (days >= profile.zero) return 0;
      return lv * Math.pow(0.5, days / profile.half);
    };
    for (const d of list) {
      if (last != null) {
        const days = (d.at - last) / DAY;
        level = decay(level, days);
        if (level === 0) sinceStart = 0;
      }
      const ratio = d.common > 0 && d.amount > 0 ? Math.min(2, Math.max(0.25, d.amount / d.common)) : 1;
      level = Math.min(1, level + profile.build * ratio * (1 - level * 0.5));
      last = d.at;
      sinceStart++;
    }
    if (last == null) return { level: 0, clearAt: 0, last: 0 };
    const days = (now - last) / DAY;
    const lv = decay(level, days);
    // Back to (nearly) normal: below 5 %, or the "zero" day, whichever is first.
    let clearDays = profile.zero;
    if (level > 0.05) clearDays = Math.min(profile.zero, profile.half * Math.log2(level / 0.05));
    else clearDays = 0;
    return { level: lv < 0.03 ? 0 : lv, clearAt: last + clearDays * DAY, last, peak: level };
  }

  /**
   * Tolerance for `name` from the whole history ([{name, at, amount, common,
   * classKey?}]): own tolerance plus cross-tolerance from related drugs.
   * Returns {level, own, clearAt, profile, from: [{name, level, factor, last}]}.
   */
  function tolerance(name, history, opts = {}) {
    const now = opts.now || Date.now();
    const cls = opts.classOf || (() => "");
    const mine = tags(name, cls(name), opts.ingredient);
    const profile = toleranceProfile(mine);
    const byName = new Map();
    for (const d of history || []) {
      const key = low(d.name);
      if (!byName.has(key)) byName.set(key, { name: d.name, doses: [] });
      byName.get(key).doses.push(d);
    }
    const own = byName.get(low(name));
    const ownT = own ? toleranceFrom(own.doses, profile, now) : { level: 0, clearAt: 0, last: 0 };
    const from = [];
    for (const [key, group] of byName) {
      if (key === low(name)) continue;
      const theirTags = tags(group.name, cls(group.name));
      const factor = crossFactor(mine, theirTags);
      if (!factor) continue;
      const t = toleranceFrom(group.doses, toleranceProfile(theirTags), now);
      if (t.level * factor >= 0.05) from.push({ name: group.name, level: t.level * factor, factor, last: t.last, clearAt: t.clearAt });
    }
    from.sort((a, b) => b.level - a.level);
    const level = Math.max(ownT.level, ...from.map((f) => f.level), 0);
    const clearAt = Math.max(ownT.level ? ownT.clearAt : 0, ...from.map((f) => f.clearAt), 0);
    return { level, own: ownT.level, last: ownT.last, clearAt, profile, from };
  }

  // ---------- Combinations ----------
  // [tags A, tags B, level, why]. Matched both ways; the first match wins.
  // Levels: "severe" (do not combine), "danger", "caution". From TripSit's
  // combination chart and the usual medical warnings.
  const DEP = ["benzo", "alcohol", "ghb", "zdrug", "barbiturate", "gabapentinoid"];
  const COMBOS = [
    [["opioid"], DEP, "severe", "Both slow your breathing. Opioids mixed with sedatives or alcohol cause most overdose deaths."],
    [["ghb"], ["alcohol", "benzo", "zdrug", "barbiturate", "gabapentinoid"], "severe", "Can cause sudden deep unconsciousness and stopped breathing, even at small doses."],
    [["maoi"], ["serotonergic", "stimulant", "dxm", "tramadol"], "severe", "Can cause serotonin syndrome or a dangerous rise in blood pressure."],
    [["lithium"], ["psychedelic"], "severe", "Lithium with psychedelics has caused seizures and heart problems."],
    [["dxm"], ["ssri", "empathogen", "tramadol"], "severe", "High risk of serotonin syndrome (fever, shaking, confusion)."],
    [["tramadol"], ["empathogen", "ssri", "stimulant"], "danger", "Raises the risk of seizures and serotonin syndrome."],
    [["alcohol"], ["benzo", "zdrug", "barbiturate", "gabapentinoid"], "danger", "Effects stack: blackouts, vomiting while passed out and slowed breathing."],
    [["benzo", "zdrug", "barbiturate", "gabapentinoid"], ["benzo", "zdrug", "barbiturate", "gabapentinoid"], "danger", "Sedation stacks up: heavy sleepiness, memory loss and slowed breathing."],
    [["dissociative"], ["alcohol", "benzo", "ghb", "zdrug", "barbiturate", "gabapentinoid", "opioid"], "danger", "Risk of passing out, vomiting while unconscious and slowed breathing."],
    [["cocaine"], ["alcohol"], "danger", "Together they make cocaethylene, which is harder on the heart and lasts longer."],
    [["deliriant"], ["alcohol", "benzo", "opioid", "zdrug"], "danger", "Heavy sedation and confusion; hard to tell how much you took."],
    [["stimulant"], ["stimulant"], "caution", "Stimulants stack: strain on the heart, high blood pressure and overheating."],
    [["empathogen"], ["alcohol"], "caution", "More dehydration and overheating; alcohol also dulls the effect, so people redose."],
    [["stimulant"], ["alcohol", "benzo", "opioid", "zdrug", "gabapentinoid", "ghb"], "caution", "The stimulant hides how drunk or sedated you are, so it's easy to take too much of either; when it wears off the downer hits harder."],
    [["psychedelic"], ["cannabinoid"], "caution", "Cannabis can make a psychedelic much stronger and more anxious, start very low."],
    [["psychedelic"], ["stimulant"], "caution", "More anxiety, a racing heart and harder come-downs."],
    [["dissociative"], ["psychedelic"], "caution", "Very strong, confusing effects; take much lower doses of both."],
    [["deliriant"], ["stimulant"], "caution", "Both raise heart rate and body heat."],
  ];

  // PsychonautWiki interaction names -> tags, so its own lists can be read.
  const PW_GROUPS = [
    [/opioid/, "opioid"], [/benzodiazepine/, "benzo"], [/alcohol/, "alcohol"], [/ghb|gbl/, "ghb"], [/maoi/, "maoi"],
    [/ssri|snri/, "ssri"], [/tramadol/, "tramadol"], [/lithium/, "lithium"], [/dxm|dextromethorphan/, "dxm"],
    [/cocaine/, "cocaine"], [/stimulant|amphetamine/, "stimulant"], [/cannabis|cannabinoid/, "cannabinoid"],
    [/psychedelic|lysergamide|tryptamine|2c-|mescaline|mushroom|lsd|psilocyb/, "psychedelic"], [/dissociative|ketamine|pcp|mxe/, "dissociative"],
    [/mdma|empathogen|entactogen/, "empathogen"], [/deliriant|diphenhydramine/, "deliriant"], [/nitrous/, "nitrous"],
    [/gabapentin|pregabalin/, "gabapentinoid"], [/depressant/, "depressant"], [/caffeine/, "caffeine"],
  ];
  const LEVEL_RANK = { caution: 1, danger: 2, severe: 3 };

  /**
   * Checks two substances. a/b: {name, classKey?, ingredient?, pw?: {caution:[],
   * danger:[], severe:[]} (PsychonautWiki's lists, if loaded)}.
   * Returns {level, why, source} or null.
   */
  function combo(a, b) {
    if (low(a.name) === low(b.name)) return null;
    const ta = tags(a.name, a.classKey, a.ingredient);
    const tb = tags(b.name, b.classKey, b.ingredient);
    let best = null;
    const consider = (level, why, source) => {
      if (!best || LEVEL_RANK[level] > LEVEL_RANK[best.level]) best = { level, why, source };
    };
    for (const [x, y, level, why] of COMBOS) {
      const hit = (s, list) => list.some((t) => s.has(t));
      if ((hit(ta, x) && hit(tb, y)) || (hit(tb, x) && hit(ta, y))) { consider(level, why, "guide"); break; }
    }
    // PsychonautWiki's own lists for either substance.
    const fromPw = (own, other, otherTags) => {
      if (!own.pw) return;
      for (const level of ["severe", "danger", "caution"]) {
        for (const entry of own.pw[level] || []) {
          const e = low(entry);
          const direct = e === low(other.name) || (other.ingredient && e === low(other.ingredient)) || low(other.name).includes(e);
          const group = !direct && PW_GROUPS.some(([re, tag]) => re.test(e) && otherTags.has(tag));
          if (direct || group) {
            consider(level, level === "severe" ? "PsychonautWiki lists this as a dangerous combination."
              : level === "danger" ? "PsychonautWiki lists this as an unsafe combination." : "PsychonautWiki says to take care with this combination.", "psychonautwiki");
            return;
          }
        }
      }
    };
    fromPw(a, b, tb);
    fromPw(b, a, ta);
    return best;
  }

  // ---------- Harm reduction ----------
  const TIPS = {
    any: [
      "Start with a low dose and wait for the full effect before taking more.",
      "Don't use alone, and tell someone what you took and how much.",
      "Test it: reagent kits or a drug checking service, where there is one.",
      "Check the combinations before mixing with anything else.",
    ],
    psychedelic: [
      "Pick a calm place and a sober friend to sit with you (set and setting).",
      "Skip it if you or close family have psychosis or bipolar disorder.",
      "Never with lithium or tramadol: both can cause seizures.",
      "Tolerance is almost full the next day, so space trips 1-2 weeks apart.",
      "Don't drive, swim or go near heights while it lasts.",
    ],
    dmt: ["Sit or lie down before you take it; the effect hits within seconds.", "Never with MAOIs unless you know exactly what you're doing (ayahuasca)."],
    empathogen: [
      "Test pills: some contain PMMA or much more MDMA than expected.",
      "Sip about 500 ml of water an hour when dancing, not more.",
      "Take breaks to cool down; overheating is the biggest danger.",
      "Space uses at least 1-3 months apart; frequent use works less and is harder on the brain.",
      "Never with SSRIs, MAOIs, tramadol or DXM.",
    ],
    stimulant: [
      "Eat, drink water and plan to sleep; stimulants hide how tired and thirsty you are.",
      "Set a limit before you start; redosing gets compulsive.",
      "Avoid if you have a heart condition or high blood pressure.",
      "Don't stack stimulants, and keep caffeine low.",
    ],
    cocaine: ["Use your own straw; shared straws spread hepatitis C.", "Fentanyl has been found in cocaine: use test strips where you can.", "Alcohol with cocaine makes cocaethylene, which is harder on the heart."],
    opioid: [
      "Keep naloxone (Narcan) nearby and tell friends where it is.",
      "Never with benzos, alcohol, GHB or pregabalin.",
      "After a break your tolerance is gone; start much lower.",
      "Use fentanyl test strips on anything not from a pharmacy.",
      "If someone can't be woken, call an ambulance and put them in the recovery position.",
    ],
    benzo: [
      "Never with alcohol, opioids or GHB.",
      "Memory goes before you feel it: decide your dose before you start.",
      "Daily use builds dependence; don't stop suddenly after weeks of use (risk of seizures), taper with a doctor.",
      "Street \"Xanax\" bars are often other, stronger benzos.",
    ],
    zdrug: ["Take it in bed: sleepwalking and memory loss are common.", "Never with alcohol or other sedatives.", "Daily use builds dependence."],
    alcohol: ["Eat first and drink water between drinks.", "Never with benzos, GHB, opioids or sleeping pills.", "Put someone who passed out in the recovery position."],
    ghb: ["Measure every dose with an oral syringe (ml), never by eye.", "Wait at least 2 hours before taking more and set a timer.", "Never with alcohol or other sedatives."],
    dissociative: ["Sit or lie down somewhere safe; you lose balance and feeling.", "Never near water, roads or heights.", "Never with alcohol, benzos, GHB or opioids.", "Frequent ketamine use damages the bladder."],
    nitrous: ["Never inhale straight from a tank or cracker: frostbite and lung damage.", "Sit down and breathe normal air between balloons.", "Heavy use drains vitamin B12 and can damage nerves."],
    cannabinoid: ["Edibles can take 2 hours to kick in: wait before eating more.", "Synthetic cannabinoids (spice) are far stronger and more dangerous.", "Don't drive while high."],
    gabapentinoid: ["Never with opioids: together they stop breathing.", "Raise doses slowly and expect dizziness.", "Daily use builds dependence; taper with a doctor."],
    deliriant: ["Deliriants are unpleasant and risky: hallucinations feel real and the heart races.", "Avoid with heart problems, glaucoma or other sedatives."],
    kratom: ["Daily use builds dependence and withdrawal.", "Don't mix with other depressants."],
    caffeine: ["Up to about 400 mg a day is considered safe for most adults.", "Avoid late in the day if you want to sleep."],
    maoi: ["MAOIs react with many drugs and foods; check every combination first."],
  };

  /** Harm reduction tips for a substance: the most specific first, then general ones. */
  function harmTips(name, classKey, ingredient) {
    const t = tags(name, classKey, ingredient);
    const order = ["dmt", "nitrous", "ghb", "cocaine", "kratom", "caffeine", "alcohol", "maoi", "empathogen", "psychedelic", "zdrug", "benzo", "gabapentinoid", "opioid", "dissociative", "cannabinoid", "deliriant", "stimulant"];
    const out = [];
    for (const key of order) if (t.has(key)) out.push(...TIPS[key]);
    out.push(...TIPS.any);
    return [...new Set(out)].slice(0, 9);
  }

  // ---------- Legal status ----------
  const COUNTRIES = [
    ["dk", "Denmark"], ["se", "Sweden"], ["no", "Norway"], ["de", "Germany"], ["nl", "Netherlands"], ["gb", "United Kingdom"],
    ["us", "United States"], ["ca", "Canada"], ["pt", "Portugal"], ["cz", "Czechia"], ["ch", "Switzerland"], ["au", "Australia"],
  ];
  const ALL = COUNTRIES.map((c) => c[0]);
  const PT_DECRIM = "grey:Decriminalised: having a personal amount is a fine, not a crime";
  const base = (state) => Object.fromEntries(ALL.map((c) => [c, state]));
  const illegal = (extra = {}) => ({ ...base("illegal"), pt: PT_DECRIM, ...extra });
  const rxControlled = (extra = {}) => ({ ...base("controlled"), ...extra });
  const rx = (extra = {}) => ({ ...base("prescription"), ...extra });
  const LEGAL = [
    [/alcohol|ethanol/, () => base("legal:Age limits apply")],
    [/caffeine|coffee/, () => base("legal")],
    [/nicotine|tobacco|snus/, () => base("legal:Age limits apply")],
    [/cannabis|marijuana|\bthc\b|\bweed\b/, () => illegal({
      dk: "illegal:Medical cannabis on prescription", de: "legal:Adults may carry 25 g and grow 3 plants (since 2024)",
      nl: "grey:Tolerated: sold in coffeeshops (5 g)", gb: "illegal:Class B; medical use on specialist prescription",
      us: "grey:Illegal federally, legal in many states", ca: "legal:Legal for adults since 2018", cz: "grey:Small amounts are a fine; medical use on prescription",
      ch: "illegal:Small amounts (10 g) are a fine", au: "illegal:Small amounts legal in the ACT; medical use on prescription",
    })],
    [/\bcbd\b/, () => base("legal:Products must stay under the local THC limit")],
    [/psilocyb|psilocin|mushroom|truffle/, () => illegal({
      nl: "grey:Truffles are sold legally; mushrooms are illegal", us: "grey:Illegal federally; legal programs in Oregon and Colorado",
      au: "controlled:Approved psychiatrists can prescribe it for depression (since 2023)", cz: "controlled:Medical use allowed from 2026",
    })],
    [/\b(mdma|ecstasy|molly)\b/, () => illegal({ au: "controlled:Approved psychiatrists can prescribe it for PTSD (since 2023)" })],
    [/\blsd\b|\bdmt\b|mescaline|\b2c-b\b|mephedrone|\bmda\b|nbome|ayahuasca/, () => illegal()],
    [/heroin|diamorphine/, () => illegal({ dk: "illegal:Prescribed in heroin-assisted treatment", de: "illegal:Prescribed in heroin-assisted treatment", nl: "illegal:Prescribed in heroin-assisted treatment", ch: "illegal:Prescribed in heroin-assisted treatment" })],
    [/cocaine|\bcrack\b/, () => illegal({ us: "illegal:Schedule II: hospital use only" })],
    [/methamphetamine/, () => illegal({ us: "controlled:Desoxyn on prescription" })],
    [/ketamine/, () => rxControlled({ pt: "controlled" })],
    [/\bghb\b|\bgbl\b|oxybate/, () => illegal({ us: "controlled:Sodium oxybate on prescription; otherwise illegal" })],
    [/nitrous|laughing gas/, () => ({
      ...base("grey:Legal as a gas; selling it for inhaling may be banned"), nl: "illegal:Banned for recreational use (since 2023)",
      gb: "illegal:Class C for inhaling (since November 2023)", dk: "grey:Selling it for inhaling is banned",
    })],
    [/kratom|mitragyn/, () => ({
      dk: "illegal", se: "illegal", au: "illegal", de: "grey:Not a controlled drug; not approved as food", nl: "grey:Not a controlled drug",
      gb: "illegal:Selling it is banned (Psychoactive Substances Act)", us: "grey:Legal federally, banned in some states", ca: "grey:Can't be sold as food or medicine",
    })],
    [/pregabalin|lyrica/, () => rx({ gb: "controlled:Class C (since 2019)", us: "controlled:Schedule V" })],
    [/gabapentin|neurontin/, () => rx({ gb: "controlled:Class C (since 2019)" })],
    [/modafinil|armodafinil/, () => rx({ us: "controlled:Schedule IV" })],
    [/az[eo]pam|azolam|clobazam|chlordiazepoxide|xanax|ksalol|valium|frisium|rivotril|zolpidem|zopiclone|eszopiclone|zaleplon/, () => rxControlled()],
    [/amphetamin|amfetamin|lisdex|elvanse|vyvanse|adderall|dexedrine|methylphenidate|ritalin|concerta|medikinet/, () => rxControlled()],
    [/codeine|kodimagnyl/, () => rxControlled({ gb: "controlled:Low-dose codeine is sold in pharmacies" })],
    [/oxycod|oxycontin|morphin|hydrocod|fentanyl|methadone|buprenorph|hydromorph|oxymorph|dihydrocod|tapentadol|tramadol|pethidine/, () => rxControlled()],
  ];
  const LEGAL_LABEL = { legal: "Legal", prescription: "Prescription", controlled: "Prescription only, controlled", illegal: "Illegal", grey: "Grey area" };

  /** {code: {state, note, label, country}} for a substance, or null when there's no data. */
  function legal(name, ingredient, custom) {
    const text = low(name) + " " + low(ingredient);
    let table = null;
    for (const [re, make] of LEGAL) if (re.test(text)) { table = make(); break; }
    if (custom && Object.keys(custom).length) table = { ...(table || {}), ...custom };
    if (!table) return null;
    const out = {};
    for (const [code, country] of COUNTRIES) {
      if (!table[code]) continue;
      const [state, ...note] = String(table[code]).split(":");
      out[code] = { state, note: note.join(":").trim(), label: LEGAL_LABEL[state] || state, country };
    }
    return out;
  }

  // ---------- Small DOM helpers for the drug page cards ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /** Fills the Drug Database's Harm reduction and Legal status sections. */
  function drugPage(substance, { harm, legalBox, mix }) {
    const name = substance.name;
    const ingredient = substance.ingredient || "";
    const classKey = window.xnClass?.keyFor(substance) || "";
    if (harm) {
      const custom = String(substance.harmReduction || "").split("\n").map((s) => s.trim()).filter(Boolean);
      const tips = [...custom, ...harmTips(name, classKey, ingredient)].slice(0, 10);
      const list = harm.querySelector("[data-tips]");
      list.replaceChildren(...tips.map((t, i) => {
        const li = el("li", "hr-tip" + (i < custom.length ? " is-site" : ""));
        li.append(el("span", "hr-num", String(i + 1)), el("span", "hr-text", t));
        return li;
      }));
      harm.hidden = !tips.length;
    }
    if (legalBox) {
      const data = legal(name, ingredient, substance.legal);
      const grid = legalBox.querySelector("[data-legal]");
      grid.replaceChildren();
      if (data) {
        for (const [code, row] of Object.entries(data)) {
          const card = el("div", "lg-row");
          card.dataset.state = row.state;
          const flag = el("span", "lg-code", code.toUpperCase());
          const text = el("div", "lg-text");
          text.append(el("strong", "", row.country), el("span", "lg-state", row.label));
          if (row.note) text.append(el("small", "lg-note", row.note));
          card.append(flag, text);
          grid.append(card);
        }
      }
      legalBox.hidden = !data;
    }
    if (mix) {
      const parts = substance.contents || [];
      const list = mix.querySelector("[data-mix]");
      list.replaceChildren(...parts.map((p) => mixRow(p)));
      mix.hidden = parts.length < 1;
    }
  }

  function mixRow(p) {
    const li = el("li", "mx-part" + (p.psychoactive ? " is-active" : ""));
    li.append(el("strong", "", p.name));
    if (p.amount) li.append(el("span", "mx-amt", `${Number(p.amount)} ${p.unit || "mg"}`));
    li.append(el("span", "mx-kind", p.psychoactive ? "Psychoactive" : "Not psychoactive"));
    if (p.note) li.append(el("small", "mx-note", p.note));
    return li;
  }

  // Class colors for charts (Stats page pie): fixed per class, never by rank.
  // The dataviz reference palette's dark steps, validated on the site's black.
  const CLASS_GROUPS = [
    ["stimulant", "Stimulants", "#3987e5"],
    ["depressant", "Depressants", "#d95926"],
    ["psychedelic", "Psychedelics", "#199e70"],
    ["opioid", "Opioids", "#c98500"],
    ["empathogen", "Empathogens", "#d55181"],
    ["cannabinoid", "Cannabinoids", "#0ca30c"],
    ["dissociative", "Dissociatives", "#9085e9"],
    ["other", "Other", "#8a8a91"],
  ];
  function classGroup(name, classKey, ingredient) {
    const t = tags(name, classKey, ingredient);
    for (const g of ["empathogen", "opioid", "psychedelic", "dissociative", "cannabinoid", "depressant", "stimulant"]) if (t.has(g)) return g;
    return "other";
  }

  window.xnFacts = {
    tags, tolerance, toleranceFrom, toleranceProfile, crossFactor, combo, harmTips, legal, COUNTRIES,
    drugPage, mixRow, CLASS_GROUPS, classGroup, LEVEL_RANK,
  };
})();
