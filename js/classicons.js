// Drug class icons. Turns PsychonautWiki classes into one icon key that
// css/classicons.css draws (<i class="sc-icon" data-class="...">).
(() => {
  const Z_DRUGS = ["zolpidem", "zopiclone", "eszopiclone", "zaleplon"];
  // First match wins, so the narrow classes come before depressant/stimulant.
  const RULES = [
    ["zdrug", /hypnotic|imidazopyridine|cyclopyrrolone|pyrazolopyrimidine/],
    ["antipsychotic", /antipsychotic/],
    ["deliriant", /deliriant|anticholinergic/],
    ["oneirogen", /oneirogen/],
    ["eugeroic", /eugeroic|wakefulness/],
    ["cannabinoid", /cannabinoid/],
    ["dissociative", /dissociative/],
    ["empathogen", /entactogen|empathogen/],
    ["psychedelic", /psychedelic|hallucinogen/],
    ["opioid", /opioid/],
    ["depressant", /depressant|sedative|anxiolytic|benzodiazepine|gabapentinoid|barbiturate/],
    ["stimulant", /stimulant|nootropic/],
  ];
  // What the drug usually looks like, by name. First match wins; anything
  // not listed keeps its class icon.
  const DRUGS = [
    ["blotter", /lsd|lad$|^lsz$|nbome|nboh|^do[bci]$/],
    ["mushroom", /mushroom|psilocybin|psilocin|amanita/],
    ["xtc", /^(mdma|mda|mdea|mbdb|methylone|2c-[a-z0-9]+)$/],
    ["lines", /^(cocaine|crack)/],
    ["crystal", /methamphetamine|^(5-meo-)?dmt$/],
    ["baggie", /^(amphetamine|ketamine|heroin|mephedrone|[34]-mmc|a-pvp|α-pvp|2-fdck|o-pce|3-meo-pcp|pcp|methoxetamine|deschloroketamine)$/],
    ["bar", /alprazolam|xanax/],
    ["capsule", /gabapentin|pregabalin|lisdexamfetamine|dextroamphetamine|adderall|tramadol|phenibut|fluoxetine/],
    ["oblong", /^(zolpidem|zopiclone|eszopiclone|zaleplon|hydrocodone)$/],
    ["cannabinoid", /^(cannabis|thc|cbd|hhc|delta-8-thc|marijuana)$/],
    ["bottle", /^(alcohol|ethanol)$/],
    ["coffee", /^caffeine$/],
    ["cigarette", /^(nicotine|tobacco)$/],
    ["charger", /nitrous/],
    ["dropper", /^(ghb|gbl|1,4-butanediol|poppers|amyl nitrite|alkyl nitrites?)$/],
    ["syrup", /^(dxm|dextromethorphan|promethazine)$/],
    ["cactus", /mescaline|peyote|san pedro/],
    ["herb", /salvia|kratom/],
    ["tablet", /^(oxycodone|morphine|codeine|methadone|hydromorphone|buprenorphine|tapentadol|dihydrocodeine|methylphenidate|modafinil|armodafinil)$/],
  ];
  const LABELS = {
    depressant: "Depressant",
    opioid: "Opioid",
    stimulant: "Stimulant",
    empathogen: "Empathogen",
    psychedelic: "Psychedelic",
    dissociative: "Dissociative",
    cannabinoid: "Cannabinoid",
    antipsychotic: "Antipsychotic",
    zdrug: "Z-drug",
    deliriant: "Deliriant",
    eugeroic: "Eugeroic",
    oneirogen: "Oneirogen",
    blotter: "Blotter tab",
    mushroom: "Mushroom",
    xtc: "Pressed pill",
    lines: "Powder lines",
    crystal: "Crystals",
    baggie: "Baggie",
    bar: "Bar",
    tablet: "Tablet",
    oblong: "Tablet",
    capsule: "Capsule",
    bottle: "Bottle",
    coffee: "Coffee",
    cigarette: "Cigarette",
    charger: "Charger",
    dropper: "Dropper bottle",
    syrup: "Syrup",
    cactus: "Cactus",
    herb: "Leaf",
    // Pictures of real pills, set per medicine (js/medicines.json "icon").
    "pill-oc80": "OxyContin 80 mg",
    "pill-ksalol": "Ksalol 1 mg",
    "pill-ritalin": "Ritalin 10 mg",
    "pill-concerta": "Concerta",
    "pill-medikinet": "Medikinet Retard",
    "pill-elvanse": "Elvanse",
  };
  let customIcons = new Map();

  // "OG medication icons" (Profile > Preferences, html.xn-og-icons): what the
  // drug really looks like, by name first, then by the icon's shape.
  const OG_COLORS = [
    [/heroin|diacetylmorphine/, "#8b5a2b"],
    [/^(5-meo-)?dmt$|dimethyltryptamine/, "#e8b04f"],
    [/^crack/, "#ece0bf"],
    [/methamphetamine/, "#dff1ff"],
    [/mdma|ecstasy|molly|mda$|2c-b|2c-/, "#ff8fcf"],
    [/promethazine|lean/, "#9b5de5"],
    [/dxm|dextromethorphan/, "#e0414f"],
    [/kratom/, "#8aa35a"],
    [/salvia|cannabis|marijuana|thc|cbd|hhc|weed/, "#6fb04a"],
    [/mescaline|peyote|san pedro/, "#5f9e4a"],
    [/psilocybin|psilocin|mushroom/, "#c49a6c"],
    [/amanita/, "#e2483d"],
    [/alcohol|ethanol|beer|wine/, "#d39a35"],
    [/caffeine|coffee/, "#8a5a3b"],
    [/poppers|nitrite/, "#a0632e"],
    [/ghb|gbl|butanediol/, "#c8e8ff"],
    [/nitrous/, "#c9ced6"],
    [/nicotine|tobacco/, "#f2dfc0"],
    [/gabapentin/, "#f2d04b"],
    [/pregabalin|lyrica/, "#f0883e"],
    [/tramadol/, "#e9d55a"],
    [/adderall|dextroamphetamine/, "#f28c28"],
    [/fluoxetine|prozac/, "#5aa36b"],
  ];
  const OG_SHAPES = {
    blotter: "#f2e8cc", mushroom: "#c49a6c", xtc: "#ff8fcf", lines: "#f7f7f3", crystal: "#e2f2ff",
    baggie: "#f4f3ee", bar: "#f5f5ef", tablet: "#f5f5ef", oblong: "#f5f5ef", capsule: "#f2d04b",
    cannabinoid: "#6fb04a", bottle: "#d39a35", coffee: "#8a5a3b", cigarette: "#f2dfc0",
    charger: "#c9ced6", dropper: "#c8e8ff", syrup: "#e0414f", cactus: "#5f9e4a", herb: "#6fb04a",
  };
  // Anything else (most research chemicals) is a white powder.
  const OG_POWDER = "#f1efe8";

  function ogColor(name, key) {
    const n = String(name || "").toLowerCase();
    const hit = n && OG_COLORS.find(([re]) => re.test(n));
    return hit ? hit[1] : OG_SHAPES[key] || OG_POWDER;
  }

  function applyCustomIcon(node) {
    const name = String(node.dataset.drugName || "").trim().toLowerCase();
    node.style.setProperty("--sc-og", ogColor(name, node.dataset.class));
    const image = customIcons.get(name);
    if (image) {
      node.classList.add("has-custom-image");
      node.style.setProperty("--sc-icon-image", `url(${JSON.stringify(image)})`);
      node.hidden = false;
    } else {
      node.classList.remove("has-custom-image");
      node.style.removeProperty("--sc-icon-image");
      node.hidden = !node.dataset.class && !node.classList.contains("si-noicon");
    }
  }

  /** One class name, e.g. "Opioids" -> "opioid", or "" when none fits. */
  function keyForClass(text) {
    const lower = String(text || "").toLowerCase();
    const rule = RULES.find(([, re]) => re.test(lower));
    return rule ? rule[0] : "";
  }

  /** A whole PsychonautWiki substance -> one icon key. */
  function keyFor(substance) {
    if (substance?.icon && LABELS[substance.icon]) return substance.icon;
    const name = String(substance?.name || "").toLowerCase().trim();
    // Medicines are named by brand ("Xanax (alprazolam)"), so their active ingredient counts too.
    const ingredient = String(substance?.ingredient || "").toLowerCase().split("+")[0].trim();
    const drug = DRUGS.find(([, re]) => re.test(name)) || (ingredient && DRUGS.find(([, re]) => re.test(ingredient)));
    if (drug) return drug[0];
    if (Z_DRUGS.includes(name) || Z_DRUGS.includes(ingredient)) return "zdrug";
    const classes = [...(substance?.class?.psychoactive || []), ...(substance?.class?.chemical || [])].join(" ");
    // Benzodiazepines usually come as small round scored tablets.
    if (/benzodiazepine/i.test(classes)) return "tablet";
    return keyForClass(classes);
  }

  /** An <i> icon element for a key; hidden when the key is empty. */
  function icon(key, extraClass, drugName) {
    const node = document.createElement("i");
    node.className = "sc-icon" + (extraClass ? " " + extraClass : "");
    node.setAttribute("aria-hidden", "true");
    node.dataset.class = key || "";
    if (drugName) node.dataset.drugName = drugName;
    node.title = LABELS[key] || "";
    node.hidden = !key;
    applyCustomIcon(node);
    return node;
  }

  function setDrugName(node, name) {
    if (!node) return;
    node.dataset.drugName = name || "";
    applyCustomIcon(node);
  }

  window.xnClass = { keyFor, keyForClass, icon, setDrugName, ogColor, LABELS };

  fetch("/drug-icons", { cache: "no-cache" })
    .then((response) => {
      if (!response.ok) throw new Error("Couldn't load custom drug icons.");
      return response.json();
    })
    .then((icons) => {
      customIcons = new Map(Object.entries(icons).map(([name, image]) => [name.toLowerCase(), image]));
      document.querySelectorAll(".sc-icon[data-drug-name]").forEach(applyCustomIcon);
    })
    .catch(() => {});
})();
