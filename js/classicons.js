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
  };

  /** One class name, e.g. "Opioids" -> "opioid", or "" when none fits. */
  function keyForClass(text) {
    const lower = String(text || "").toLowerCase();
    const rule = RULES.find(([, re]) => re.test(lower));
    return rule ? rule[0] : "";
  }

  /** A whole PsychonautWiki substance -> one icon key. */
  function keyFor(substance) {
    const name = String(substance?.name || "").toLowerCase();
    if (Z_DRUGS.includes(name)) return "zdrug";
    if (name === "cannabis" || name === "thc") return "cannabinoid";
    return keyForClass([...(substance?.class?.psychoactive || []), ...(substance?.class?.chemical || [])].join(" "));
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
