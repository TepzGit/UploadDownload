// Journal thumbnails: a full-color picture of the form a substance is most
// often taken in (blotter tab, pill, powder in a baggie, bud...), tinted with
// its usual real color. The form comes from xnClass.keyFor (classicons.js);
// substances that only have a class key get the class's most common form.
(() => {
  // Class keys that aren't a form themselves -> the usual form for that class.
  const CLASS_FORM = {
    depressant: "tablet",
    opioid: "tablet",
    antipsychotic: "tablet",
    zdrug: "oblong",
    deliriant: "tablet",
    eugeroic: "tablet",
    stimulant: "baggie",
    dissociative: "baggie",
    empathogen: "xtc",
    psychedelic: "powder",
    cannabinoid: "cannabinoid",
    oneirogen: "herb",
  };
  const LABELS = {
    blotter: "Blotter tab", mushroom: "Dried mushrooms", xtc: "Pressed pill", lines: "Lines of powder",
    crystal: "Crystals", baggie: "Powder in a baggie", powder: "Powder", bar: "Bar", tablet: "Tablet",
    oblong: "Tablet", capsule: "Capsule", cannabinoid: "Bud", bottle: "Drink", coffee: "Coffee",
    cigarette: "Cigarette", charger: "Charger", dropper: "Dropper bottle", syrup: "Syrup",
    cactus: "Cactus", herb: "Dried leaves",
  };

  function formOf(substance) {
    const key = window.xnClass ? window.xnClass.keyFor(substance) : "";
    if (LABELS[key]) return key;
    return CLASS_FORM[key] || "powder";
  }

  // #rrggbb lighter (amount > 0) or darker (amount < 0).
  function shade(hex, amount) {
    const n = parseInt(String(hex).replace("#", ""), 16);
    const mix = (c) => Math.round(amount > 0 ? c + (255 - c) * amount : c * (1 + amount));
    const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
    return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  let uid = 0;
  // Each picture gets its own gradient ids, so many on one page don't clash.
  function draw(form, color) {
    const id = "ft" + ++uid;
    const c = color, hi = shade(color, 0.45), lo = shade(color, -0.35), dk = shade(color, -0.6);
    const shine = '<ellipse cx="22" cy="20" rx="8" ry="3.5" transform="rotate(-35 22 20)" fill="#fff" fill-opacity=".45"/>';
    const shadow = (cy, rx) => `<ellipse cx="32" cy="${cy}" rx="${rx}" ry="3.2" fill="#000" fill-opacity=".45"/>`;
    const radial = `<radialGradient id="${id}" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="${hi}"/><stop offset=".6" stop-color="${c}"/><stop offset="1" stop-color="${lo}"/></radialGradient>`;
    const linear = `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset=".5" stop-color="${c}"/><stop offset="1" stop-color="${lo}"/></linearGradient>`;
    const art = {
      blotter: `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7ad9"/><stop offset=".5" stop-color="#8b7bff"/><stop offset="1" stop-color="#3fd6c6"/></linearGradient></defs>
        ${shadow(53, 20)}
        <g transform="rotate(-8 32 32)"><rect x="12" y="12" width="40" height="40" rx="1.5" fill="${c}" stroke="${lo}" stroke-width="1"/>
        <rect x="15" y="15" width="34" height="34" fill="url(#${id})"/>
        <circle cx="32" cy="32" r="9" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="2"/><circle cx="32" cy="32" r="3.2" fill="#fff" fill-opacity=".9"/>
        <path d="M32 18v5M32 41v5M18 32h5M41 32h5" stroke="#fff" stroke-opacity=".7" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M12 32h40M32 12v40" stroke="${c}" stroke-dasharray="1.2 1.6" stroke-width=".9" stroke-opacity=".8"/></g>`,
      mushroom: `<defs>${radial}</defs>${shadow(55, 18)}
        <path d="M27 34c-1 8-2 14-4 19 4 1.5 11 1.5 15 0-2-5-3-11-3.5-19z" fill="#efe3cf" stroke="#b9a385" stroke-width="1"/>
        <path d="M9 35c0-13 10.5-22 23-22s23 9 23 22c-6 2.5-40 2.5-46 0z" fill="url(#${id})" stroke="${dk}" stroke-width="1"/>
        <path d="M14 34.5c5 1.2 31 1.2 36 0" stroke="${dk}" stroke-opacity=".5" stroke-width="1.2"/>
        <ellipse cx="24" cy="21" rx="7" ry="3" transform="rotate(-25 24 21)" fill="#fff" fill-opacity=".3"/>`,
      xtc: `<defs>${radial}</defs>${shadow(52, 20)}
        <circle cx="32" cy="31" r="21" fill="url(#${id})" stroke="${lo}" stroke-width="1"/>
        <circle cx="32" cy="31" r="17" fill="none" stroke="${lo}" stroke-opacity=".35" stroke-width="1"/>
        <path d="M32 21l3 6.3 6.8.7-5.1 4.6 1.5 6.7L32 35.8l-6.2 3.5 1.5-6.7-5.1-4.6 6.8-.7z" fill="${lo}" fill-opacity=".75"/>${shine}`,
      lines: `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3d46"/><stop offset="1" stop-color="#15161a"/></linearGradient></defs>
        <rect x="6" y="14" width="52" height="38" rx="3" fill="url(#${id})" stroke="#555a66" stroke-width="1"/>
        <path d="M14 26h30M14 34h30M14 42h22" stroke="${c}" stroke-width="3.4" stroke-linecap="round"/>
        <rect x="40" y="38" width="16" height="10" rx="1.5" transform="rotate(-20 48 43)" fill="#6c7cff" stroke="#3b47b8" stroke-width=".8"/>
        <path d="M10 18l14 0" stroke="#fff" stroke-opacity=".15" stroke-width="2"/>`,
      crystal: `<defs>${linear}</defs>${shadow(54, 20)}
        <path d="M14 52l5-22 7 22z" fill="${hi}" stroke="${lo}" stroke-width=".8"/>
        <path d="M22 53l9-38 9 38z" fill="url(#${id})" stroke="${lo}" stroke-width=".9"/>
        <path d="M37 53l7-27 8 27z" fill="${c}" stroke="${lo}" stroke-width=".8"/>
        <path d="M31 15v38" stroke="#fff" stroke-opacity=".6" stroke-width="1"/><path d="M44 26v27M19 30v22" stroke="#fff" stroke-opacity=".45" stroke-width=".8"/>`,
      baggie: `<defs>${linear}</defs>${shadow(56, 19)}
        <path d="M15 16h34v36a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3z" fill="#fff" fill-opacity=".14" stroke="#e8edf5" stroke-opacity=".7" stroke-width="1.2"/>
        <path d="M15 16h34v5H15z" fill="#e14b5a" fill-opacity=".85"/><path d="M15 23.5h34" stroke="#e8edf5" stroke-opacity=".5" stroke-width="1"/>
        <path d="M17 52c2-10 6-15 15-16 9 1 13 6 15 16z" fill="url(#${id})"/>
        <path d="M20 47c4-1 8-1 12 0" stroke="#fff" stroke-opacity=".5" stroke-width="1"/>
        <path d="M44 26v20" stroke="#fff" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/>`,
      powder: `<defs>${linear}</defs>${shadow(52, 24)}
        <path d="M8 51c4-12 13-23 24-23s20 11 24 23c-12 3-36 3-48 0z" fill="url(#${id})" stroke="${lo}" stroke-width=".8"/>
        <path d="M22 37c4-3 8-4 12-3" stroke="#fff" stroke-opacity=".55" stroke-width="1.4" stroke-linecap="round"/>
        <g fill="${c}"><circle cx="10" cy="53" r="1"/><circle cx="55" cy="52" r="1.1"/><circle cx="50" cy="55" r=".8"/><circle cx="15" cy="56" r=".7"/></g>`,
      bar: `<defs>${linear}</defs>${shadow(46, 26)}
        <g transform="rotate(-18 32 32)"><rect x="5" y="25" width="54" height="14" rx="7" fill="url(#${id})" stroke="${lo}" stroke-width="1"/>
        <path d="M18.5 26v12M32 26v12M45.5 26v12" stroke="${lo}" stroke-width="1.6"/>
        <rect x="10" y="27" width="40" height="3" rx="1.5" fill="#fff" fill-opacity=".5"/></g>`,
      tablet: `<defs>${radial}</defs>${shadow(52, 20)}
        <circle cx="32" cy="31" r="20" fill="url(#${id})" stroke="${lo}" stroke-width="1"/>
        <path d="M14 31h36" stroke="${lo}" stroke-width="2"/><path d="M14 32.4h36" stroke="#fff" stroke-opacity=".6" stroke-width=".8"/>${shine}`,
      oblong: `<defs>${radial}</defs>${shadow(48, 24)}
        <g transform="rotate(-25 32 32)"><rect x="8" y="21" width="48" height="22" rx="11" fill="url(#${id})" stroke="${lo}" stroke-width="1"/>
        <path d="M32 22v20" stroke="${lo}" stroke-width="1.8"/><rect x="14" y="24" width="30" height="3.4" rx="1.7" fill="#fff" fill-opacity=".5"/></g>`,
      capsule: `<defs>${linear}<linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#eceef1"/><stop offset="1" stop-color="#b8bec6"/></linearGradient></defs>${shadow(50, 24)}
        <g transform="rotate(-35 32 32)"><path d="M32 21H17a11 11 0 0 0 0 22h15z" fill="url(#${id})" stroke="${lo}" stroke-width="1"/>
        <path d="M30 21.5h17a10.5 10.5 0 0 1 0 21H30z" fill="url(#${id}b)" stroke="#a3aab3" stroke-width="1"/>
        <path d="M30 22v20" stroke="#000" stroke-opacity=".22" stroke-width="1"/><rect x="11" y="24" width="40" height="3.4" rx="1.7" fill="#fff" fill-opacity=".5"/></g>`,
      cannabinoid: `<defs>${radial}</defs>${shadow(56, 16)}
        <path d="M32 9c7 5 11 12 11 20 0 10-5 19-11 25-6-6-11-15-11-25 0-8 4-15 11-20z" fill="url(#${id})" stroke="${dk}" stroke-width="1"/>
        <path d="M22 26c-6 1-10 5-11 10 6 1 11-1 13-5M42 26c6 1 10 5 11 10-6 1-11-1-13-5" fill="${c}" stroke="${dk}" stroke-width="1"/>
        <g stroke="#e8893a" stroke-width="1.3" stroke-linecap="round"><path d="M28 20l-3-3M36 24l3-3M29 33l-4 1M36 38l4-1M31 45l-3 3M34 29l2 0"/></g>
        <g fill="#f3f0dc" fill-opacity=".7"><circle cx="30" cy="27" r=".9"/><circle cx="35" cy="33" r=".9"/><circle cx="31" cy="40" r=".9"/><circle cx="34" cy="18" r=".8"/></g>`,
      bottle: `<defs>${linear}</defs>${shadow(58, 12)}
        <path d="M27 6h10v12c0 3 6 6 6 13v22a4 4 0 0 1-4 4H25a4 4 0 0 1-4-4V31c0-7 6-10 6-13z" fill="url(#${id})" stroke="${dk}" stroke-width="1"/>
        <rect x="26.5" y="4" width="11" height="4" rx="1" fill="#d9b44a"/><rect x="21" y="33" width="22" height="13" fill="#f5ecd2" fill-opacity=".9"/>
        <path d="M25.5 23v28" stroke="#fff" stroke-opacity=".4" stroke-width="2" stroke-linecap="round"/>`,
      coffee: `<defs>${linear}</defs>${shadow(55, 20)}
        <path d="M14 26h32v16a12 12 0 0 1-12 12h-8a12 12 0 0 1-12-12z" fill="#f3f1ec" stroke="#b9b5ab" stroke-width="1"/>
        <path d="M46 30h3a6 6 0 0 1 0 12h-4" fill="none" stroke="#f3f1ec" stroke-width="3.4"/>
        <ellipse cx="30" cy="26.5" rx="15.5" ry="3.6" fill="url(#${id})"/>
        <path d="M24 20c-2-3 2-5 0-8M31 20c-2-3 2-5 0-8M38 20c-2-3 2-5 0-8" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.6" stroke-linecap="round"/>`,
      cigarette: `${shadow(48, 24)}<g transform="rotate(-25 32 32)">
        <rect x="6" y="27" width="40" height="9" rx="1.5" fill="#f7f5f0" stroke="#c9c4b8" stroke-width=".8"/>
        <rect x="42" y="27" width="14" height="9" rx="1.5" fill="${c === "#f2dfc0" ? "#d9934a" : c}" stroke="#a96a2c" stroke-width=".8"/>
        <rect x="4" y="27" width="4" height="9" rx="1" fill="#ff7b3a"/><path d="M4 27h4" stroke="#555" stroke-width="1.5"/></g>
        <path d="M10 22c-3-3 1-5-1-9" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.6" stroke-linecap="round"/>`,
      charger: `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${lo}"/><stop offset=".4" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></linearGradient></defs>${shadow(50, 22)}
        <g transform="rotate(-30 32 32)"><path d="M10 23h26c8 0 14 4 14 9s-6 9-14 9H10a4 4 0 0 1-4-4V27a4 4 0 0 1 4-4z" fill="url(#${id})" stroke="${dk}" stroke-width="1"/>
        <rect x="49" y="29" width="8" height="6" rx="1" fill="${lo}" stroke="${dk}" stroke-width=".8"/><path d="M10 26h24" stroke="#fff" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/></g>`,
      dropper: `<defs>${linear}</defs>${shadow(58, 13)}
        <rect x="27" y="4" width="10" height="10" rx="4" fill="#1d1d22" stroke="#444" stroke-width="1"/>
        <rect x="24" y="13" width="16" height="7" rx="1.5" fill="#2a2a30"/>
        <path d="M20 26c0-4 3-6 6-6h12c3 0 6 2 6 6v26a5 5 0 0 1-5 5H25a5 5 0 0 1-5-5z" fill="#6b3f1d" fill-opacity=".85" stroke="#3d220d" stroke-width="1"/>
        <path d="M21 34h22v18a4 4 0 0 1-4 4H25a4 4 0 0 1-4-4z" fill="url(#${id})" fill-opacity=".8"/>
        <path d="M24 26v26" stroke="#fff" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/>`,
      syrup: `<defs>${linear}</defs>${shadow(58, 14)}
        <rect x="25" y="5" width="14" height="7" rx="1.5" fill="#f1f1f1" stroke="#bbb" stroke-width=".8"/>
        <path d="M26 12h12v5c5 2 7 6 7 11v24a5 5 0 0 1-5 5H24a5 5 0 0 1-5-5V28c0-5 2-9 7-11z" fill="url(#${id})" stroke="${dk}" stroke-width="1"/>
        <rect x="19" y="32" width="26" height="12" fill="#fff" fill-opacity=".85"/><path d="M22 36h14M22 40h9" stroke="${lo}" stroke-width="1.6"/>
        <path d="M23 24v26" stroke="#fff" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/>`,
      cactus: `<defs>${linear}</defs>
        <path d="M18 52h28l-3 8H21z" fill="#c4683f" stroke="#8a4526" stroke-width="1"/>
        <path d="M27 52V18a5 5 0 0 1 10 0v34z" fill="url(#${id})" stroke="${dk}" stroke-width="1"/>
        <path d="M27 38h-6a4 4 0 0 1-4-4v-8a3 3 0 0 1 6 0v6h4M37 32h5v-8a3 3 0 0 1 6 0v8a4 4 0 0 1-4 4h-7" fill="${c}" stroke="${dk}" stroke-width="1"/>
        <path d="M32 16v34" stroke="${dk}" stroke-opacity=".5" stroke-width="1"/><g fill="#fff" fill-opacity=".7"><circle cx="29.5" cy="24" r=".8"/><circle cx="34.5" cy="30" r=".8"/><circle cx="29.5" cy="40" r=".8"/><circle cx="34.5" cy="46" r=".8"/></g>
        <circle cx="32" cy="13" r="3" fill="#ff7fb0"/>`,
      herb: `<defs>${linear}</defs>${shadow(55, 20)}
        <path d="M32 54C22 46 18 34 24 16c10 8 13 22 8 38z" fill="url(#${id})" stroke="${dk}" stroke-width="1"/>
        <path d="M32 54c4-12 12-18 24-18-4 12-12 18-24 18z" fill="${c}" stroke="${dk}" stroke-width="1"/>
        <path d="M32 54c-6-8-15-11-24-9 5 8 14 11 24 9z" fill="${lo}" stroke="${dk}" stroke-width="1"/>
        <path d="M32 54C29 42 27 30 24 16M32 54c6-7 13-12 24-18M32 54c-8-4-16-8-24-9" fill="none" stroke="${hi}" stroke-opacity=".6" stroke-width=".9"/>`,
    };
    return `<svg class="ft-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${art[form] || art.powder}</svg>`;
  }

  /** Thumbnail markup for a substance object (name, class, ingredient, icon). */
  function thumb(substance) {
    const form = formOf(substance);
    const og = window.xnClass ? window.xnClass.ogColor(substance?.name || substance?.ingredient || "", form) : "#f1efe8";
    return { form, label: LABELS[form] || "", svg: draw(form, og) };
  }

  window.xnForm = { thumb, formOf, LABELS };
})();
