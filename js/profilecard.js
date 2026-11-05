// ============================================================
// profilecard.js: the small profile card on the Forum (mommy 2026-11-05).
// Pointing at a name or picture (a link to /u/<name>) shows it after a short
// wait; on phones a tap shows it instead of leaving the page. The card has
// the picture, level badge, join date, bio, friend status and a few numbers.
// Cards are fetched once from GET /forum/card and kept for two minutes.
//   mountProfileCards(root)  starts it for the links inside root.
//   forgetProfileCard(name)  drops a kept card (after a friend change).
// ============================================================
import { avatar, paintName, rankBadge, profileLink } from "/forum.js";
import { friendButton } from "/friends.js";

const KEEP_MS = 120000;
const SHOW_DELAY = 380;
const HIDE_DELAY = 240;
const kept = new Map(); // lowercase name -> { at, promise }
const hoverable = window.matchMedia("(hover: hover) and (pointer: fine)");

let card = null;
let anchor = null;
let showTimer = 0;
let hideTimer = 0;
let shownFor = "";

export function forgetProfileCard(name) {
  if (name) kept.delete(String(name).toLowerCase());
  else kept.clear();
}

function fetchCard(name) {
  const key = name.toLowerCase();
  const have = kept.get(key);
  if (have && Date.now() - have.at < KEEP_MS) return have.promise;
  const promise = fetch("/forum/card?name=" + encodeURIComponent(name), { headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("gone"))));
  promise.catch(() => kept.delete(key));
  kept.set(key, { at: Date.now(), promise });
  return promise;
}

/** "Online", "Active 5 min ago", "Last online 3 days ago" */
export function onlineText(lastSeen) {
  if (!lastSeen) return { on: false, text: "Not online yet" };
  const ago = Date.now() - lastSeen;
  if (ago < 3 * 60000) return { on: true, text: "Online" };
  const min = Math.round(ago / 60000);
  if (min < 60) return { on: false, text: "Active " + min + " min ago" };
  const h = Math.round(min / 60);
  if (h < 24) return { on: false, text: "Active " + h + (h === 1 ? " hour ago" : " hours ago") };
  const d = Math.round(h / 24);
  if (d < 60) return { on: false, text: "Last online " + d + (d === 1 ? " day ago" : " days ago") };
  return { on: false, text: "Last online " + new Date(lastSeen).toLocaleDateString(undefined, { month: "short", year: "numeric" }) };
}

const FRIEND_TEXT = { friends: "Friends", incoming: "Wants to be your friend", outgoing: "Friend request sent" };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function build() {
  card = el("div", "pc-card");
  card.id = "pcCard";
  card.setAttribute("role", "dialog");
  card.hidden = true;
  card.addEventListener("pointerenter", () => clearTimeout(hideTimer));
  card.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hideSoon(); });
  card.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(true); });
  document.body.append(card);
  document.addEventListener("pointerdown", (e) => {
    if (card.hidden || card.contains(e.target) || (anchor && anchor.contains(e.target))) return;
    hide();
  }, true);
  window.addEventListener("scroll", () => { if (!card.hidden && hoverable.matches) hide(); }, { passive: true });
  window.addEventListener("resize", () => { if (!card.hidden) place(); });
}

function fill(d) {
  const who = d.author;
  const top = el("div", "pc-top");
  if (d.banner) top.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(10,10,12,.95)), url("${d.banner.replace(/"/g, "%22")}")`;
  const face = el("a", "pc-face");
  face.href = profileLink(who.name);
  face.setAttribute("aria-label", who.name + "'s profile");
  face.append(avatar(who, "pc-avatar"));
  const status = onlineText(d.lastSeen);
  const dot = el("span", "pc-dot" + (status.on ? " is-on" : ""));
  dot.setAttribute("aria-hidden", "true");
  face.append(dot);
  const badge = rankBadge(who);
  top.append(face);
  if (badge) top.append(badge);

  const body = el("div", "pc-body");
  const nameRow = el("div", "pc-name-row");
  const name = el("a", "pc-name", who.name);
  name.href = profileLink(who.name);
  name.id = "pcName";
  paintName(name, who);
  nameRow.append(name);
  if (who.admin) nameRow.append(el("span", "pc-admin", "Admin"));
  const sub = el("p", "pc-sub");
  sub.append(el("span", "pc-rank", (d.rankName || "Geek") + " · Level " + (who.level || 0)));
  const on = el("span", "pc-online" + (status.on ? " is-on" : ""), status.text);
  sub.append(on);
  body.append(nameRow, sub);
  if (d.bio) body.append(el("p", "pc-bio", d.bio));

  const stats = el("dl", "pc-stats");
  for (const [label, n] of [["Posts", d.stats.posts], ["Comments", d.stats.comments], ["Graphs", d.stats.graphs], ["Friends", d.stats.friends]]) {
    const box = el("div", "pc-stat");
    box.append(el("dt", "", label), el("dd", "", String(n || 0)));
    stats.append(box);
  }
  body.append(stats);

  const meta = el("p", "pc-meta");
  if (d.joined) meta.append(el("span", "", "Joined " + new Date(d.joined).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })));
  if (!d.self && d.friend) meta.append(el("span", "pc-friend", FRIEND_TEXT[d.friend] || ""));
  if (meta.childElementCount) body.append(meta);

  const acts = el("div", "pc-acts");
  const open = el("a", "xn-btn", d.self ? "Your profile" : "Profile");
  open.href = profileLink(who.name);
  acts.append(open);
  if (!d.self) {
    const msg = el("a", "xn-btn", "Message");
    msg.href = "/Chat?to=" + encodeURIComponent(who.name);
    const fb = el("div", "pc-friend-btns");
    friendButton(fb, who.name, d.friend || "", (state) => {
      forgetProfileCard(who.name);
      d.friend = state;
      window.dispatchEvent(new CustomEvent("xn:friends-changed", { detail: { name: who.name, state } }));
    });
    acts.append(msg, fb);
  }
  body.append(acts);
  card.replaceChildren(top, body);
  card.setAttribute("aria-labelledby", "pcName");
}

function place() {
  if (!anchor || !card) return;
  const r = anchor.getBoundingClientRect();
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const gap = 8;
  let left = Math.min(Math.max(12, r.left), vw - w - 12);
  let top = r.bottom + gap;
  let below = true;
  if (top + h > vh - 12 && r.top - gap - h > 12) {
    top = r.top - gap - h;
    below = false;
  }
  top = Math.max(12, Math.min(top, vh - h - 12));
  card.style.left = Math.round(left + window.scrollX) + "px";
  card.style.top = Math.round(top + window.scrollY) + "px";
  card.dataset.side = below ? "below" : "above";
}

async function show(link, name) {
  if (!card) build();
  clearTimeout(hideTimer);
  if (!card.hidden && shownFor === name.toLowerCase() && anchor === link) return;
  anchor = link;
  shownFor = name.toLowerCase();
  card.classList.add("is-loading");
  let data;
  try {
    data = await fetchCard(name);
  } catch {
    if (anchor === link) hide();
    return;
  }
  if (anchor !== link) return; // moved on to someone else meanwhile
  fill(data);
  card.classList.remove("is-loading");
  const wasHidden = card.hidden;
  card.hidden = false;
  place();
  if (wasHidden) {
    card.classList.remove("is-in");
    void card.offsetWidth;
    card.classList.add("is-in");
  }
  link.setAttribute("aria-expanded", "true");
}

function hide(focusBack) {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (!card || card.hidden) { anchor = null; return; }
  card.hidden = true;
  if (anchor) {
    anchor.removeAttribute("aria-expanded");
    if (focusBack) anchor.focus({ preventScroll: true });
  }
  anchor = null;
  shownFor = "";
}

function hideSoon() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => hide(), HIDE_DELAY);
}

function nameOf(link) {
  const m = (link.getAttribute("href") || "").match(/^\/u\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

function linkFrom(target, root) {
  const a = target.closest && target.closest('a[href^="/u/"]');
  if (!a || !root.contains(a) || (card && card.contains(a))) return null;
  return a;
}

export function mountProfileCards(root = document.body) {
  root.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse" || !hoverable.matches) return;
    const a = linkFrom(e.target, root);
    if (!a) return;
    clearTimeout(hideTimer);
    if (anchor === a && card && !card.hidden) return;
    clearTimeout(showTimer);
    const name = nameOf(a);
    if (!name) return;
    fetchCard(name).catch(() => {}); // start loading while the pointer rests
    showTimer = setTimeout(() => show(a, name), card && !card.hidden ? 120 : SHOW_DELAY);
  });
  root.addEventListener("pointerout", (e) => {
    if (e.pointerType !== "mouse") return;
    const a = linkFrom(e.target, root);
    if (!a || (e.relatedTarget && a.contains(e.relatedTarget))) return;
    clearTimeout(showTimer);
    if (card && !card.hidden) hideSoon();
  });
  // Phones and tablets: a tap shows the card; the card's Profile button opens the page.
  root.addEventListener("click", (e) => {
    if (hoverable.matches || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const a = linkFrom(e.target, root);
    if (!a) return;
    const name = nameOf(a);
    if (!name) return;
    e.preventDefault();
    if (card && !card.hidden && anchor === a) return hide();
    show(a, name);
  });
}
