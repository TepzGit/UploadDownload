// reactions.js: Forum reactions and pill ratings (mommy 2026-11-20).
// Reactions: the site's own drawn emoji plus ones admins upload
// (GET /forum/emoji, POST /forum/react {post, emoji}). Rating: a row of 5
// pills where every half pill can be pressed (POST /forum/rate {post,
// score}); a post rated above 3.5 on average gets the Helpful badge.

// The site's own emoji, drawn on a 24 grid. Faces are rounded squares
// (mommy's rule: no circles).
export const EMOJI = {
  pill: { name: "Pill", svg: '<g transform="rotate(-40 12 12)"><rect x="2.5" y="8" width="19" height="8" rx="4" fill="#a67cff"/><path d="M12 8h5.5a4 4 0 0 1 0 8H12z" fill="#f5f3fa"/><rect x="5" y="9.4" width="5" height="1.6" rx=".8" fill="#fff" opacity=".45"/></g>' },
  heart: { name: "Love", svg: '<path d="M12 20.5S3 15 3 8.8A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 9 2.4C21 15 12 20.5 12 20.5z" fill="#ff4d6d"/><path d="M7 8.2a2 2 0 0 1 2-1.6" stroke="#fff" stroke-width="1.4" stroke-linecap="round" fill="none" opacity=".6"/>' },
  fire: { name: "Fire", svg: '<path d="M12 22c-4.4 0-7.5-3-7.5-7 0-3.4 2.3-5.4 3.6-7.6.4 1.6 1.2 2.6 2.2 3.1C10.4 6.6 12.6 3.8 15 2c-.4 3 1 5 2.6 7 1.3 1.6 2.4 3.4 2.4 6 0 4-3.6 7-8 7z" fill="#ff7a1a"/><path d="M12 22c-2.3 0-4-1.6-4-3.8 0-2.2 1.8-3.3 2.6-5 .5 1.2 1.3 1.8 2.1 2 .2-1.6.9-2.8 2-3.6.1 1.7.9 2.6 1.6 3.6.6.8.9 1.6.9 2.8 0 2.4-2.4 4-5.2 4z" fill="#ffd23f"/>' },
  lol: { name: "LOL", svg: '<rect x="2.5" y="2.5" width="19" height="19" rx="6.5" fill="#ffcc33"/><path d="M6.5 9.6l2.2-1.4 2.2 1.4M13.1 9.6l2.2-1.4 2.2 1.4" stroke="#5a3a00" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M6.5 13h11a5.5 5.5 0 0 1-11 0z" fill="#5a3a00"/><path d="M8.6 15.6h6.8a4.2 4.2 0 0 1-6.8 0z" fill="#ff6b81"/><path d="M3.2 10.5c-1 1.4-1 2.8-.2 3.6.9.8 2 .2 2-1 0-.9-1-1.6-1.8-2.6zM20.8 10.5c1 1.4 1 2.8.2 3.6-.9.8-2 .2-2-1 0-.9 1-1.6 1.8-2.6z" fill="#4fc3f7"/>' },
  mind: { name: "Mind blown", svg: '<rect x="3" y="7.5" width="18" height="14.5" rx="6" fill="#ffcc33"/><path d="M5 9c-1-3 1.5-5.5 3.6-4.5C9.5 2 14.5 2 15.4 4.5 17.5 3.5 20 6 19 9z" fill="#ff7a1a"/><path d="M8 3 6.6 1M12 2.4V.5M16 3l1.4-2M4 6 2 5M20 6l2-1" stroke="#ff7a1a" stroke-width="1.3" stroke-linecap="round"/><rect x="7.2" y="11.5" width="2.6" height="3" rx="1.2" fill="#5a3a00"/><rect x="14.2" y="11.5" width="2.6" height="3" rx="1.2" fill="#5a3a00"/><rect x="10" y="16.2" width="4" height="3.4" rx="1.6" fill="#5a3a00"/>' },
  hug: { name: "Hug", svg: '<rect x="4" y="2.5" width="16" height="16" rx="5.5" fill="#ffcc33"/><path d="M8 9.4c.6-.8 1.6-.8 2.2 0M13.8 9.4c.6-.8 1.6-.8 2.2 0" stroke="#5a3a00" stroke-width="1.4" stroke-linecap="round" fill="none"/><path d="M9.5 12.8c1.4 1.2 3.6 1.2 5 0" stroke="#5a3a00" stroke-width="1.4" stroke-linecap="round" fill="none"/><rect x="5.3" y="11" width="3" height="2" rx="1" fill="#ff8fa3" opacity=".7"/><rect x="15.7" y="11" width="3" height="2" rx="1" fill="#ff8fa3" opacity=".7"/><rect x="1.5" y="14" width="8" height="6.5" rx="3" fill="#f5b800" transform="rotate(-20 5.5 17)"/><rect x="14.5" y="14" width="8" height="6.5" rx="3" fill="#f5b800" transform="rotate(20 18.5 17)"/>' },
  brain: { name: "Big brain", svg: '<path d="M9 3.5a3.2 3.2 0 0 0-3.2 2.6A3.3 3.3 0 0 0 3.5 10a3.3 3.3 0 0 0 .6 4.5 3.4 3.4 0 0 0 3 4.6 3 3 0 0 0 4.9.9V4.4A3.1 3.1 0 0 0 9 3.5zM15 3.5a3.2 3.2 0 0 1 3.2 2.6 3.3 3.3 0 0 1 2.3 3.9 3.3 3.3 0 0 1-.6 4.5 3.4 3.4 0 0 1-3 4.6 3 3 0 0 1-4.9.9V4.4A3.1 3.1 0 0 1 15 3.5z" fill="#ff8fbf"/><path d="M12 4.5v15.4M8.5 8.5c1 .2 1.7 1 1.7 2M6.5 13c1.3-.4 2.6.2 3 1.4M15.5 8.5c-1 .2-1.7 1-1.7 2M17.5 13c-1.3-.4-2.6.2-3 1.4" stroke="#c2477f" stroke-width="1.2" stroke-linecap="round" fill="none"/>' },
  eyes: { name: "Eyes", svg: '<rect x="2" y="5" width="9" height="14" rx="4.5" fill="#f5f3fa"/><rect x="13" y="5" width="9" height="14" rx="4.5" fill="#f5f3fa"/><rect x="6.2" y="9.5" width="4" height="5.2" rx="1.8" fill="#16161b"/><rect x="17.2" y="9.5" width="4" height="5.2" rx="1.8" fill="#16161b"/>' },
  sparkle: { name: "Sparkle", svg: '<path d="M10 2.5c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7z" fill="#ffd23f"/><path d="M18 13.5c.3 2.2 1.3 3.2 3.5 3.5-2.2.3-3.2 1.3-3.5 3.5-.3-2.2-1.3-3.2-3.5-3.5 2.2-.3 3.2-1.3 3.5-3.5z" fill="#a67cff"/>' },
  melt: { name: "Melting", svg: '<path d="M4 9a6.5 6.5 0 0 1 6.5-6.5h3A6.5 6.5 0 0 1 20 9v6.5c0 1.2-1 1.6-1.7.9-.8-.8-1.8-.4-1.8.8v2.3c0 1.1-1.5 1.2-1.7 0l-.4-2c-.2-1-1.4-1-1.6 0l-.6 3.6c-.2 1.2-1.8 1.2-2 0l-.5-3.1c-.2-1-1.5-1-1.7 0l-.2 1c-.3 1.2-1.8 1-1.8-.2z" fill="#ffcc33"/><rect x="7.5" y="8" width="2.4" height="3" rx="1.1" fill="#5a3a00"/><rect x="14.1" y="8" width="2.4" height="3" rx="1.1" fill="#5a3a00"/><path d="M8.5 14c2 1.4 5 1.4 7 0" stroke="#5a3a00" stroke-width="1.4" stroke-linecap="round" fill="none"/>' },
  skull: { name: "Dead", svg: '<path d="M5 9.5A7 7 0 0 1 12 2.5a7 7 0 0 1 7 7v4.2c0 1-.6 1.8-1.5 2.1v3a1.7 1.7 0 0 1-1.7 1.7H8.2a1.7 1.7 0 0 1-1.7-1.7v-3A2.2 2.2 0 0 1 5 13.7z" fill="#eceaf2"/><rect x="7.4" y="9" width="3.6" height="3.6" rx="1.3" fill="#16161b"/><rect x="13" y="9" width="3.6" height="3.6" rx="1.3" fill="#16161b"/><path d="M11.2 14.6 12 13.4l.8 1.2zM10 17.2v2.4M12 17.2v2.4M14 17.2v2.4" stroke="#16161b" stroke-width="1.2" stroke-linecap="round" fill="#16161b"/>' },
  clap: { name: "Clap", svg: '<rect x="5" y="6" width="7" height="14" rx="3.4" fill="#f5b800" transform="rotate(-18 8.5 13)"/><rect x="11" y="6" width="7" height="14" rx="3.4" fill="#ffcc33" transform="rotate(14 14.5 13)"/><path d="M4.5 4.2 3 2.6M8 3V1M18.5 3.4 20 1.8M21 6.5l1.8-.6" stroke="#ffd23f" stroke-width="1.4" stroke-linecap="round"/>' },
};
const svgOf = (key) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (EMOJI[key] ? EMOJI[key].svg : "") + "</svg>";

let catalog = null; // {builtin, custom: [{key, name, url}], admin}
export function loadEmoji(force) {
  if (catalog && !force) return catalog;
  catalog = fetch("/forum/emoji", { headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : { builtin: Object.keys(EMOJI), custom: [] }))
    .catch(() => ({ builtin: Object.keys(EMOJI), custom: [] }));
  return catalog;
}

function emojiNode(key, custom) {
  const span = document.createElement("span");
  span.className = "fx-emoji";
  if (EMOJI[key]) span.innerHTML = svgOf(key);
  else {
    const c = custom && custom.find((e) => e.key === key);
    if (c) {
      const img = document.createElement("img");
      img.src = c.url;
      img.alt = "";
      img.loading = "lazy";
      span.append(img);
    } else span.textContent = "?";
  }
  return span;
}
const emojiName = (key, custom) => (EMOJI[key] ? EMOJI[key].name : (custom && custom.find((e) => e.key === key) || {}).name || key);

async function post(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.status === 401) throw new Error("Log in again first.");
  if (!res.ok) throw new Error((await res.text()).trim() || "Something went wrong. Try again.");
  return res.json();
}
const toast = (m, bad) => window.xnToast && window.xnToast(m, bad);

// ---------- Reaction bar ----------
let openPicker = null;
document.addEventListener("pointerdown", (e) => {
  if (openPicker && !openPicker.contains(e.target) && !e.target.closest(".fx-add")) closePicker();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openPicker) closePicker(true); });
function closePicker(focusBack) {
  if (!openPicker) return;
  const btn = openPicker._btn;
  openPicker.remove();
  openPicker = null;
  if (btn) { btn.setAttribute("aria-expanded", "false"); if (focusBack) btn.focus(); }
}

export function reactionBar(p) {
  const bar = document.createElement("div");
  bar.className = "fx-bar";
  let reactions = (p.reactions || []).slice();
  let custom = [];
  const list = document.createElement("div");
  list.className = "fx-list";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "fx-add";
  add.setAttribute("aria-label", "Add a reaction");
  add.setAttribute("aria-haspopup", "true");
  add.setAttribute("aria-expanded", "false");
  add.title = "Add a reaction";
  add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="15" height="15" rx="5"/><path d="M7.5 12c1.4 1.4 4.6 1.4 6 0M8 8.2v.1M13 8.2v.1M19.5 15v6M16.5 18h6"/></svg>';

  async function toggle(key) {
    const before = reactions.slice();
    // Show it at once, then use what the server says.
    const hit = reactions.find((r) => r.emoji === key);
    if (hit) { hit.mine = !hit.mine; hit.count += hit.mine ? 1 : -1; reactions = reactions.filter((r) => r.count > 0); }
    else reactions.push({ emoji: key, count: 1, mine: true });
    draw();
    try {
      const d = await post("/forum/react", { post: p.id, emoji: key });
      reactions = d.reactions || [];
    } catch (e) {
      reactions = before;
      toast(e.message, true);
    }
    draw();
  }
  function draw() {
    list.replaceChildren(...reactions.map((r) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fx-chip" + (r.mine ? " is-mine" : "");
      b.setAttribute("aria-pressed", String(!!r.mine));
      const nm = emojiName(r.emoji, custom);
      b.setAttribute("aria-label", nm + ", " + r.count + (r.mine ? ", you reacted" : ""));
      b.title = nm;
      const n = document.createElement("span");
      n.className = "fx-n";
      n.textContent = String(r.count);
      b.append(emojiNode(r.emoji, custom), n);
      b.addEventListener("click", () => toggle(r.emoji));
      return b;
    }));
  }
  add.addEventListener("click", async () => {
    if (openPicker && openPicker._btn === add) return closePicker();
    closePicker();
    const cat = await loadEmoji();
    custom = cat.custom || [];
    const pick = document.createElement("div");
    pick.className = "fx-pick";
    pick.setAttribute("role", "menu");
    pick.setAttribute("aria-label", "Reactions");
    pick._btn = add;
    const keys = [...(cat.builtin || Object.keys(EMOJI)), ...custom.map((c) => c.key)];
    keys.forEach((key) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fx-opt";
      b.setAttribute("role", "menuitem");
      const nm = emojiName(key, custom);
      b.title = nm;
      b.setAttribute("aria-label", nm);
      b.append(emojiNode(key, custom));
      b.addEventListener("click", () => { closePicker(true); toggle(key); });
      pick.append(b);
    });
    if (cat.admin) {
      const m = document.createElement("a");
      m.className = "fx-manage";
      m.href = "#";
      m.textContent = "Add emoji";
      m.addEventListener("click", (e) => { e.preventDefault(); closePicker(); openManager(); });
      pick.append(m);
    }
    bar.append(pick);
    openPicker = pick;
    add.setAttribute("aria-expanded", "true");
    pick.querySelector(".fx-opt")?.focus({ preventScroll: true });
  });
  bar.append(list, add);
  // Custom emoji need their pictures before the chips can draw them.
  if (reactions.some((r) => !EMOJI[r.emoji])) loadEmoji().then((c) => { custom = c.custom || []; draw(); });
  draw();
  return bar;
}

// ---------- Pill rating ----------
function pillRow(value, max, cls) {
  const row = document.createElement("span");
  row.className = "xp-row " + (cls || "");
  for (let i = 0; i < max; i++) {
    const pill = document.createElement("i");
    pill.className = "xp-pill";
    pill.dataset.fill = value >= i + 1 ? "full" : value >= i + 0.5 ? "half" : "empty";
    row.append(pill);
  }
  return row;
}
const one = (v) => (Math.round(v * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });

export function ratingRow(p) {
  const box = document.createElement("div");
  box.className = "fx-rate";
  let rating = p.rating || { average: 0, count: 0, mine: 0, helpful: false };
  const mineCanRate = !p.mine;

  const label = document.createElement("span");
  label.className = "fx-rate-label";
  const pills = document.createElement("span");
  pills.className = "fx-rate-pills";
  const info = document.createElement("span");
  info.className = "fx-rate-info";
  const badge = document.createElement("span");
  badge.className = "fx-helpful";
  badge.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8 19.5 6v5.6c0 4.6-3.1 8.4-7.5 9.8-4.4-1.4-7.5-5.2-7.5-9.8V6z"/><path d="m8.6 12 2.4 2.4 4.6-4.8" fill="none" stroke="#0b0b0d" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>Helpful';
  badge.title = "Rated above 3.5 pills on average";

  let hoverV = null;
  function draw() {
    const show = hoverV ?? (mineCanRate && rating.mine ? rating.mine : rating.average);
    const row = pillRow(show, 5, mineCanRate ? "is-pick" : "");
    if (mineCanRate) {
      row.tabIndex = 0;
      row.setAttribute("role", "slider");
      row.setAttribute("aria-label", "Rate this post from half a pill to 5 pills");
      row.setAttribute("aria-valuemin", "0");
      row.setAttribute("aria-valuemax", "5");
      row.setAttribute("aria-valuenow", String(rating.mine || 0));
      row.setAttribute("aria-valuetext", rating.mine ? one(rating.mine) + " pills" : "Not rated");
    } else {
      row.setAttribute("role", "img");
      row.setAttribute("aria-label", rating.count ? "Rated " + one(rating.average) + " of 5 pills" : "No ratings yet");
    }
    pills.replaceChildren(row);
    label.textContent = mineCanRate ? (rating.mine ? "Your rating" : "Rate it") : "Rating";
    info.textContent = rating.count ? one(rating.average) + " / 5 · " + rating.count + (rating.count === 1 ? " rating" : " ratings") : "No ratings yet";
    badge.hidden = !rating.helpful;
    if (mineCanRate) bind(row);
  }
  const at = (row, e) => {
    const list = [...row.querySelectorAll(".xp-pill")];
    for (let i = 0; i < list.length; i++) {
      const r = list[i].getBoundingClientRect();
      if (e.clientX <= r.right + 1) return i + (e.clientX < r.left + r.width / 2 ? 0.5 : 1);
    }
    return 5;
  };
  async function rate(v) {
    v = Math.max(0, Math.min(5, Math.round(v * 2) / 2));
    if (v === rating.mine) v = 0; // pressing your rating again takes it back
    const before = rating;
    rating = { ...rating, mine: v };
    hoverV = null;
    draw();
    try {
      rating = (await post("/forum/rate", { post: p.id, score: v })).rating || rating;
    } catch (e) {
      rating = before;
      toast(e.message, true);
    }
    draw();
    box.querySelector(".xp-row")?.focus({ preventScroll: true });
  }
  function bind(row) {
    row.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") { const v = at(row, e); if (v !== hoverV) { hoverV = v; paint(row, v); } } });
    row.addEventListener("pointerleave", () => { hoverV = null; paint(row, rating.mine || rating.average); });
    row.addEventListener("click", (e) => rate(at(row, e)));
    row.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 }[e.key];
      if (step) { e.preventDefault(); const next = Math.max(0.5, Math.min(5, (rating.mine || 0) + step)); if (next !== rating.mine) rate(next); }
      else if (e.key === "Delete" || e.key === "Backspace" || e.key === "Home") { e.preventDefault(); if (rating.mine) rate(rating.mine); }
    });
  }
  function paint(row, v) {
    row.querySelectorAll(".xp-pill").forEach((pill, i) => { pill.dataset.fill = v >= i + 1 ? "full" : v >= i + 0.5 ? "half" : "empty"; });
  }
  box.append(label, pills, info, badge);
  draw();
  return box;
}

// ---------- Admin: custom emoji ----------
async function openManager() {
  let dlg = document.getElementById("fxManager");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "fxManager";
    dlg.className = "fx-dialog";
    dlg.setAttribute("aria-labelledby", "fxManTitle");
    dlg.innerHTML = '<form class="fx-man" method="dialog"><div class="fx-man-head"><h2 class="xn-h2" id="fxManTitle">Forum emoji</h2><button type="button" class="fx-x" data-close aria-label="Close">×</button></div>' +
      '<p class="xn-sub">Emoji you add here can be used as reactions on every post. Use a square PNG, GIF or WebP under 512 KB.</p>' +
      '<div class="fx-man-add"><label><span class="xn-label">Name</span><input class="xn-input" name="name" maxlength="24" placeholder="e.g. party" autocomplete="off"></label>' +
      '<label class="fx-man-file"><span class="xn-label">Picture</span><input type="file" name="image" accept="image/png,image/gif,image/webp,image/jpeg"></label>' +
      '<button type="button" class="xn-btn xn-btn-primary" data-add>Add</button></div><p class="fx-man-msg" aria-live="polite"></p><ul class="fx-man-list"></ul></form>';
    document.body.append(dlg);
    dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); });
    const msg = dlg.querySelector(".fx-man-msg");
    dlg.querySelector("[data-add]").addEventListener("click", async () => {
      const name = dlg.querySelector('input[name="name"]').value.trim();
      const file = dlg.querySelector('input[name="image"]').files[0];
      if (!name) { msg.textContent = "Give the emoji a short name."; return; }
      if (!file) { msg.textContent = "Pick a picture."; return; }
      const body = new FormData();
      body.append("name", name);
      body.append("image", file);
      msg.textContent = "Adding…";
      try {
        const res = await fetch("/forum/emoji", { method: "POST", body });
        if (!res.ok) throw new Error((await res.text()).trim() || "Couldn't add it.");
        msg.textContent = "Added.";
        dlg.querySelector('input[name="name"]').value = "";
        dlg.querySelector('input[name="image"]').value = "";
        fill(true);
      } catch (e) { msg.textContent = e.message; }
    });
  }
  async function fill(force) {
    const cat = await loadEmoji(force);
    const ul = dlg.querySelector(".fx-man-list");
    const custom = cat.custom || [];
    ul.replaceChildren(...custom.map((c) => {
      const li = document.createElement("li");
      li.className = "fx-man-row";
      const nm = document.createElement("span");
      nm.textContent = c.name;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "xn-btn xn-btn-danger";
      del.textContent = "Delete";
      del.addEventListener("click", async () => {
        try {
          await post("/forum/emoji", { delete: Number(c.key.slice(1)) });
          fill(true);
        } catch (e) { toast(e.message, true); }
      });
      li.append(emojiNode(c.key, custom), nm, del);
      return li;
    }));
    if (!custom.length) ul.innerHTML = '<li class="fx-man-none">No custom emoji yet.</li>';
  }
  fill(false);
  dlg.showModal();
}
