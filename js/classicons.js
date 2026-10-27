// Drug class icons. Turns PsychonautWiki classes into one icon key that
// css/classicons.css draws (<i class="sc-icon" data-class="...">).
(() => {
  const Z_DRUGS = ["zolpidem", "zopiclone", "eszopiclone", "zaleplon"];
  // First match wins, so the narrow classes come before depressant/stimulant.
  const RULES = [
    ["zdrug", /hypnotic|imidazopyridine|cyclopyrrolone|pyrazolopyrimidine/],
    ["antipsychotic", /antipsychotic/],
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
  };

  /** One class name, e.g. "Opioids" -> "opioid", or "" when none fits. */
  function keyForClass(text) {
    const lower = String(text || "").toLowerCase();
    const rule = RULES.find(([, re]) => re.test(lower));
    return rule ? rule[0] : "";
  }

  /** A whole PsychonautWiki substance -> one icon key. */
  function keyFor(substance) {
    const name = String(substance?.name || "").toLowerCase().trim();
    const drug = DRUGS.find(([, re]) => re.test(name));
    if (drug) return drug[0];
    if (Z_DRUGS.includes(name)) return "zdrug";
    const classes = [...(substance?.class?.psychoactive || []), ...(substance?.class?.chemical || [])].join(" ");
    // Benzodiazepines usually come as small round scored tablets.
    if (/benzodiazepine/i.test(classes)) return "tablet";
    return keyForClass(classes);
  }

  /** An <i> icon element for a key; hidden when the key is empty. */
  function icon(key, extraClass) {
    const node = document.createElement("i");
    node.className = "sc-icon" + (extraClass ? " " + extraClass : "");
    node.setAttribute("aria-hidden", "true");
    node.dataset.class = key || "";
    node.title = LABELS[key] || "";
    node.hidden = !key;
    return node;
  }

  window.xnClass = { keyFor, keyForClass, icon, LABELS };
})();
