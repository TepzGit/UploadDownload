// ============================================================
// chat.js — the Chat page (/Chat): private messages and groups.
//  - The list and the open chat come from GET /chat/updates, which
//    waits (long poll) until something changes for this account.
//  - Send: POST /chat/send (JSON, or multipart with a picture).
//  - Everything else: POST /chat/action {action, ...}.
//  - /Chat#<id> opens a chat, /Chat?to=<name> starts one with a member.
// ============================================================

const $ = (id) => document.getElementById(id);
const toast = (msg, bad) => (window.xnToast ? window.xnToast(msg, bad) : console.log(msg));
const root = document.documentElement;
const page = $("chat");

const state = {
  me: 0,
  v: null,
  chats: [],
  open: 0,
  msgs: new Map(), // id -> message, for the open chat
  firstId: 0,
  lastId: 0,
  seenAt: 0, // server time of the last answer, for edits since then
  readSent: 0,
  reply: null,
  editing: null,
  picture: null,
  hasOlder: false,
};

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.text()).trim() || "Something went wrong.");
  return res.json();
}

// ---------------------------------------------------------------- helpers

const ICONS = {
  reply: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>',
  tick: '<svg class="ch-ticks" viewBox="0 0 18 12" aria-hidden="true"><path d="m1.5 6.5 3.5 3.5 7-8"/></svg>',
  ticks: '<svg class="ch-ticks" viewBox="0 0 18 12" aria-hidden="true"><path d="m1.5 6.5 3.5 3.5 7-8"/><path d="m8 9.5.5.5 7-8"/></svg>',
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function face(p) {
  const s = el("span");
  if (p && p.avatar) {
    const img = el("img");
    img.src = p.avatar;
    img.alt = "";
    img.loading = "lazy";
    s.append(img);
  } else s.textContent = (p && p.initial) || "?";
  return s;
}

function avatarFor(chat) {
  const others = chat.members.filter((m) => m.id !== state.me);
  if (chat.kind === "group") {
    const a = el("span", "ch-av is-group");
    const two = others.slice(0, 2);
    if (!two.length) two.push({ initial: (chat.name || "?")[0] });
    if (two.length === 1) two.push({ initial: (chat.name || "?")[0].toUpperCase() });
    two.forEach((p) => a.append(face(p)));
    return a;
  }
  const a = el("span", "ch-av");
  const p = others[0] || chat.members[0];
  a.append(...face(p).childNodes);
  return a;
}

function chatName(chat) {
  if (chat.kind === "group") return chat.name || "Group";
  const other = chat.members.find((m) => m.id !== state.me);
  return other ? other.name : "Just you";
}

function personOf(chat, id) {
  return (chat && chat.members.find((m) => m.id === id)) || { name: "Someone who left", initial: "?" };
}

function paintName(node, p) {
  if (!p || !p.color) return node;
  if (p.color === "rainbow") node.classList.add("xn-named", "xn-rainbow");
  else {
    node.style.color = (window.xnSiteColor && window.xnSiteColor.preview(p.color)) || p.color;
    node.classList.add("xn-named");
  }
  return node;
}

const timeOf = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
function shortWhen(t) {
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeOf(t);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  if (now - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}
function dayLabel(t) {
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

// Text with links made clickable (built from text nodes, never HTML).
function richText(node, text) {
  const re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
  let at = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > at) node.append(text.slice(at, m.index));
    const a = el("a", "", m[0]);
    a.href = m[0];
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    node.append(a);
    at = m.index + m[0].length;
  }
  if (at < text.length) node.append(text.slice(at));
}

const snippet = (m) => (m.deleted ? "Message deleted" : m.body ? m.body.replace(/\s+/g, " ") : m.image ? "📷 Picture" : "");

// ---------------------------------------------------------------- page height

// The page fills the space between the menu and the tab bar, and shrinks
// with the phone keyboard so the box to type in stays visible.
function fit() {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  const top = page.getBoundingClientRect().top + (vv ? vv.offsetTop : 0);
  const tabs = parseFloat(getComputedStyle(root).getPropertyValue("--xn-tabs-h")) || 0;
  const keyboard = vv && window.innerHeight - vv.height > 120;
  page.style.setProperty("--ch-h", Math.max(320, h - Math.max(0, top) - (keyboard ? 0 : tabs)) + "px");
}
root.style.overflow = "hidden";
window.addEventListener("resize", fit);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => { fit(); if (nearBottom(160)) scrollDown(); });
  window.visualViewport.addEventListener("scroll", fit);
}
window.scrollTo(0, 0);
fit();
setTimeout(fit, 300);

// ---------------------------------------------------------------- chat list

function renderList() {
  const q = $("chFind").value.trim().toLowerCase();
  const list = $("chList");
  const shown = state.chats.filter((c) => !q || chatName(c).toLowerCase().includes(q) || c.members.some((m) => m.name.toLowerCase().includes(q)));
  const old = new Map([...list.children].map((li) => [li.dataset.id, li]));
  list.replaceChildren();
  shown.forEach((c, i) => {
    const li = el("li");
    li.dataset.id = c.id;
    const b = el("button", "ch-item");
    b.type = "button";
    if (old.has(String(c.id))) b.style.animation = "none";
    else b.style.animationDelay = Math.min(i, 8) * 25 + "ms";
    b.setAttribute("aria-current", String(c.id === state.open));
    const text = el("span", "ch-item-text");
    const top = el("span", "ch-item-top");
    const name = el("span", "ch-item-name", chatName(c));
    if (c.kind !== "group") paintName(name, c.members.find((m) => m.id !== state.me));
    top.append(name, el("span", "ch-item-time", c.last ? shortWhen(c.last.at) : ""));
    const bottom = el("span", "ch-item-bottom");
    let lastText = "No messages yet";
    let typing = false;
    if (c.typing && c.typing.length) {
      lastText = c.kind === "group" ? c.typing.join(", ") + " typing…" : "typing…";
      typing = true;
    } else if (c.last) {
      const who = c.last.user === state.me ? "You: " : c.kind === "group" ? personOf(c, c.last.user).name + ": " : "";
      lastText = who + snippet(c.last);
    }
    bottom.append(el("span", "ch-item-last" + (typing ? " is-typing" : ""), lastText));
    if (c.unread && c.id !== state.open) bottom.append(el("span", "ch-badge", c.unread > 99 ? "99+" : String(c.unread)));
    text.append(top, bottom);
    b.append(avatarFor(c), text);
    b.addEventListener("click", () => openChat(c.id));
    li.append(b);
    list.append(li);
  });
  $("chListEmpty").hidden = state.chats.length > 0;
  const total = state.chats.reduce((n, c) => n + (c.id === state.open ? 0 : c.unread || 0), 0);
  document.title = (total ? "(" + total + ") " : "") + "Chat · Geek⁴u";
}
$("chFind").addEventListener("input", renderList);

// ---------------------------------------------------------------- open chat

const current = () => state.chats.find((c) => c.id === state.open);

function nearBottom(px = 80) {
  const box = $("chMsgs");
  return box.scrollHeight - box.scrollTop - box.clientHeight < px;
}
function scrollDown(smooth) {
  const box = $("chMsgs");
  box.scrollTo({ top: box.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

function openChat(id, { push = true } = {}) {
  id = Number(id) || 0;
  if (id === state.open && id) {
    root.classList.add("ch-open");
    return;
  }
  state.open = id;
  state.msgs = new Map();
  state.firstId = state.lastId = state.readSent = 0;
  state.reply = state.editing = null;
  setPicture(null);
  $("chReply").hidden = true;
  root.classList.toggle("ch-open", !!id);
  if (push) history.replaceState(null, "", id ? "/Chat#" + id : "/Chat");
  $("chNone").hidden = !!id;
  $("chHead").hidden = $("chMsgs").hidden = $("chForm").hidden = !id;
  $("chMsgList").replaceChildren();
  renderHead();
  renderList();
  if (id) {
    $("chText").value = sessionStorage.getItem("ch_draft_" + id) || "";
    grow();
    if (matchMedia("(hover: hover)").matches) $("chText").focus();
    refresh(true);
  }
}

function renderHead() {
  const c = current();
  page.classList.toggle("is-dm", !!c && c.kind !== "group");
  if (!c) return;
  const av = $("chHeadAv");
  av.replaceWith(Object.assign(avatarFor(c), { id: "chHeadAv" }));
  const name = $("chHeadName");
  name.textContent = chatName(c);
  name.className = "";
  name.style.color = "";
  if (c.kind !== "group") paintName(name, c.members.find((m) => m.id !== state.me));
  const sub = $("chHeadSub");
  const typing = c.typing && c.typing.length;
  sub.classList.toggle("is-typing", !!typing);
  if (typing) sub.textContent = c.kind === "group" ? c.typing.join(", ") + (c.typing.length === 1 ? " is" : " are") + " typing…" : "typing…";
  else if (c.kind === "group") sub.textContent = c.members.length + " members · " + c.members.map((m) => (m.id === state.me ? "you" : m.name)).join(", ");
  else sub.textContent = "Private chat";
  const other = c.members.find((m) => m.id !== state.me);
  const who = $("chWho");
  if (c.kind !== "group" && other) who.href = "/u/" + encodeURIComponent(other.name);
  else who.removeAttribute("href");
  $("chMore").hidden = c.kind !== "group";
}

function bubbleFor(m, c, prev, next) {
  const mine = m.user === state.me;
  const row = el("div", "ch-msg" + (mine ? " is-mine" : "") + (m.deleted ? " is-deleted" : ""));
  row.dataset.id = m.id;
  const sameAsPrev = prev && prev.user === m.user && m.at - prev.at < 5 * 60e3 && new Date(prev.at).toDateString() === new Date(m.at).toDateString();
  const sameAsNext = next && next.user === m.user && next.at - m.at < 5 * 60e3 && new Date(next.at).toDateString() === new Date(m.at).toDateString();
  if (!sameAsPrev) row.classList.add("is-first");
  if (!sameAsNext) row.classList.add("is-last");
  const who = personOf(c, m.user);
  const av = el("span", "ch-av ch-msg-av");
  av.append(...face(who).childNodes);
  row.append(av);

  const b = el("div", "ch-bubble");
  if (!mine && c.kind === "group" && !sameAsPrev) b.append(paintName(el("span", "ch-from", who.name), who));
  if (m.deleted) b.append("Message deleted");
  else {
    if (m.replyTo) {
      const q = state.msgs.get(m.replyTo);
      const quote = el("span", "ch-quote");
      quote.append(el("b", "", q ? personOf(c, q.user).name : "Reply"), q ? snippet(q) : "An older message");
      quote.addEventListener("click", () => jumpTo(m.replyTo));
      b.append(quote);
    }
    if (m.image) {
      const img = el("img", "ch-pic");
      img.src = m.image;
      img.alt = "Picture";
      img.loading = "lazy";
      img.addEventListener("load", () => { if (state.stick) scrollDown(); });
      img.addEventListener("click", () => {
        $("chViewerImg").src = m.image;
        $("chViewer").showModal();
      });
      b.append(img);
    }
    if (m.body) {
      const t = el("span");
      richText(t, m.body);
      b.append(t);
    }
  }
  const meta = el("span", "ch-meta");
  meta.append((m.edited && !m.deleted ? "edited · " : "") + timeOf(m.at));
  if (mine && !m.deleted) {
    const others = c.members.filter((p) => p.id !== state.me);
    const read = others.length > 0 && others.every((p) => (c.reads[p.id] || 0) >= m.id);
    meta.insertAdjacentHTML("beforeend", read ? ICONS.ticks.replace("ch-ticks", "ch-ticks is-read") : others.some((p) => (c.reads[p.id] || 0) >= m.id) ? ICONS.ticks : ICONS.tick);
    meta.title = read ? "Read" : "Sent";
  }
  b.append(meta);
  row.append(b);

  if (!m.deleted) {
    const tools = el("span", "ch-msg-tools");
    const r = el("button", "ch-icon-btn");
    r.type = "button";
    r.title = "Reply";
    r.innerHTML = ICONS.reply;
    r.addEventListener("click", () => startReply(m));
    const more = el("button", "ch-icon-btn");
    more.type = "button";
    more.title = "More";
    more.innerHTML = ICONS.more;
    more.addEventListener("click", (e) => msgMenu(m, e.currentTarget.getBoundingClientRect()));
    tools.append(r, more);
    row.append(tools);
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      msgMenu(m, { left: e.clientX, top: e.clientY, bottom: e.clientY, right: e.clientX });
    });
    // Long press on phones.
    let timer = 0;
    b.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      timer = setTimeout(() => {
        if (navigator.vibrate) navigator.vibrate(10);
        msgMenu(m, { left: t.clientX, top: t.clientY, bottom: t.clientY, right: t.clientX });
      }, 450);
    }, { passive: true });
    ["touchend", "touchmove", "touchcancel"].forEach((ev) => b.addEventListener(ev, () => clearTimeout(timer), { passive: true }));
  }
  return row;
}

function renderMsgs(newIds = new Set()) {
  const c = current();
  if (!c) return;
  const stick = nearBottom();
  const box = $("chMsgs");
  const oldHeight = box.scrollHeight;
  const oldTop = box.scrollTop;
  const list = [...state.msgs.values()].sort((a, b) => a.id - b.id);
  const out = document.createDocumentFragment();
  let day = "";
  list.forEach((m, i) => {
    const d = new Date(m.at).toDateString();
    if (d !== day) {
      day = d;
      const sep = el("div", "ch-day");
      sep.append(el("span", "", dayLabel(m.at)));
      out.append(sep);
    }
    const row = bubbleFor(m, c, list[i - 1], list[i + 1]);
    if (newIds.has(m.id)) row.classList.add("is-new");
    out.append(row);
  });
  if (c.typing && c.typing.length) {
    const t = el("div", "ch-typing");
    t.append(el("i"), el("i"), el("i"));
    out.append(t);
  }
  if (!list.length) out.append(el("p", "ch-sys", c.kind === "group" ? "Say hi to the group." : "No messages yet. Say hi!"));
  $("chMsgList").replaceChildren(out);
  $("chOlder").hidden = !state.hasOlder;
  state.stick = stick;
  if (state.prepend) {
    box.scrollTop = oldTop + (box.scrollHeight - oldHeight);
    state.prepend = false;
  } else if (stick || state.forceDown) {
    scrollDown(!state.forceDown && newIds.size > 0);
    state.forceDown = false;
  } else if ([...newIds].some((id) => state.msgs.get(id).user !== state.me)) {
    state.missed = (state.missed || 0) + [...newIds].filter((id) => state.msgs.get(id).user !== state.me).length;
  }
  showDown();
}

function showDown() {
  const far = !nearBottom(240);
  $("chDown").hidden = !far;
  if (!far) state.missed = 0;
  $("chDownN").textContent = state.missed ? String(state.missed) : "";
}
$("chMsgs").addEventListener("scroll", () => {
  showDown();
  markRead();
}, { passive: true });
$("chDown").addEventListener("click", () => scrollDown(true));

function jumpTo(id) {
  const row = $("chMsgList").querySelector(`.ch-msg[data-id="${id}"]`);
  if (!row) return toast("That message is further back. Show older messages first.");
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  row.classList.remove("is-hl");
  void row.offsetWidth;
  row.classList.add("is-hl");
}

$("chOlder").addEventListener("click", async () => {
  try {
    const res = await fetch(`/chat/updates?chat=${state.open}&before=${state.firstId}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const msgs = data.messages || [];
    msgs.forEach((m) => state.msgs.set(m.id, m));
    if (msgs.length) state.firstId = msgs[0].id;
    state.hasOlder = msgs.length >= 60;
    state.prepend = true;
    renderMsgs();
  } catch {
    toast("Couldn't load older messages.", true);
  }
});

// Mark what's on screen as read.
function markRead() {
  const c = current();
  if (!c || document.hidden || !state.lastId || state.readSent >= state.lastId || !nearBottom(120)) return;
  state.readSent = state.lastId;
  c.unread = 0;
  post("/chat/action", { action: "read", chat: c.id, upto: state.lastId }).catch(() => {});
  renderList();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) { markRead(); refresh(); } });

// ---------------------------------------------------------------- updates

let polling = false;
let pollCtl = null;

function apply(data, first) {
  state.me = data.me;
  state.v = data.v;
  state.chats = data.chats || [];
  const c = current();
  if (state.open && !c && !first) {
    toast("You're no longer in that chat.");
    openChat(0);
    return;
  }
  const newIds = new Set();
  if (data.messages) {
    const fresh = !state.lastId;
    data.messages.forEach((m) => {
      if (!state.msgs.has(m.id) && !fresh) newIds.add(m.id);
      state.msgs.set(m.id, m);
      if (m.id > state.lastId) state.lastId = m.id;
      if (!state.firstId || m.id < state.firstId) state.firstId = m.id;
    });
    if (fresh) {
      state.hasOlder = data.messages.length >= 60;
      state.forceDown = true;
    }
  }
  (data.changed || []).forEach((m) => state.msgs.set(m.id, m));
  state.seenAt = data.now || Date.now();
  renderList();
  if (c) {
    renderHead();
    renderMsgs(newIds);
    markRead();
  }
}

async function refresh(first) {
  if (pollCtl) pollCtl.abort();
  try {
    const q = `/chat/updates?chat=${state.open}&after=${state.lastId}&changed=${state.seenAt}`;
    const res = await fetch(q, { cache: "no-store" });
    if (res.status === 401) return (location.href = "/Main?next=/Chat");
    if (!res.ok) throw new Error();
    apply(await res.json(), first);
  } catch {}
  poll();
}

async function poll() {
  if (polling) return;
  polling = true;
  while (true) {
    pollCtl = new AbortController();
    try {
      const q = `/chat/updates?v=${state.v ?? 0}&chat=${state.open}&after=${state.lastId}&changed=${state.seenAt}`;
      const res = await fetch(q, { cache: "no-store", signal: pollCtl.signal });
      if (!res.ok) throw new Error();
      apply(await res.json());
    } catch (e) {
      if (e && e.name === "AbortError") break;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  polling = false;
}

// ---------------------------------------------------------------- compose

function grow() {
  const t = $("chText");
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight + 2, 180) + "px";
  $("chSend").disabled = !t.value.trim() && !state.picture;
}

let typingAt = 0;
$("chText").addEventListener("input", () => {
  grow();
  if (state.open) sessionStorage.setItem("ch_draft_" + state.open, $("chText").value);
  if ($("chText").value.trim() && Date.now() - typingAt > 3000 && !state.editing) {
    typingAt = Date.now();
    post("/chat/action", { action: "typing", chat: state.open }).catch(() => {});
  }
});
$("chText").addEventListener("keydown", (e) => {
  const desktop = matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (e.key === "Enter" && !e.shiftKey && desktop && !e.isComposing) {
    e.preventDefault();
    $("chForm").requestSubmit();
  } else if (e.key === "Escape") {
    cancelReply();
    if (state.editing) stopEdit();
  } else if (e.key === "ArrowUp" && !$("chText").value) {
    const mine = [...state.msgs.values()].filter((m) => m.user === state.me && !m.deleted && m.body).pop();
    if (mine) { e.preventDefault(); startEdit(mine); }
  }
});

function startReply(m) {
  stopEdit();
  state.reply = m;
  $("chReplyWho").textContent = "Reply to " + personOf(current(), m.user).name;
  $("chReplyBody").textContent = snippet(m);
  $("chReply").hidden = false;
  $("chText").focus();
}
function cancelReply() {
  state.reply = null;
  $("chReply").hidden = true;
}
$("chReplyX").addEventListener("click", cancelReply);

function startEdit(m) {
  cancelReply();
  state.editing = m;
  $("chReplyWho").textContent = "Edit message";
  $("chReplyBody").textContent = snippet(m);
  $("chReply").hidden = false;
  $("chText").value = m.body;
  grow();
  $("chText").focus();
}
function stopEdit() {
  if (!state.editing) return;
  state.editing = null;
  $("chReply").hidden = true;
  $("chText").value = sessionStorage.getItem("ch_draft_" + state.open) || "";
  grow();
}
$("chReplyX").addEventListener("click", stopEdit);

// Pictures: big photos are shrunk to 2000 px before sending (GIFs stay as they are).
async function shrink(file) {
  if (file.type === "image/gif" || file.size < 600e3) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.86));
    return blob && blob.size < file.size ? new File([blob], "picture.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}
function setPicture(file) {
  state.picture = file;
  const prev = $("chPicPrev");
  prev.hidden = !file;
  if (file) $("chPicImg").src = URL.createObjectURL(file);
  grow();
}
$("chPic").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (f) setPicture(await shrink(f));
});
$("chPicX").addEventListener("click", () => setPicture(null));
// Paste a picture straight into the message box.
$("chText").addEventListener("paste", async (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) {
    e.preventDefault();
    setPicture(await shrink(item.getAsFile()));
  }
});

$("chForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("chText").value.trim();
  if (!state.open || (!text && !state.picture)) return;
  const send = $("chSend");
  send.disabled = true;
  try {
    if (state.editing) {
      if (!text) throw new Error("A message can't be empty. Use Delete instead.");
      await post("/chat/action", { action: "edit", id: state.editing.id, body: text });
      state.msgs.set(state.editing.id, { ...state.editing, body: text, edited: Date.now() });
      stopEdit();
      renderMsgs();
      return;
    }
    let msg;
    if (state.picture) {
      const fd = new FormData();
      fd.append("chat", state.open);
      fd.append("body", text);
      if (state.reply) fd.append("replyTo", state.reply.id);
      fd.append("picture", state.picture);
      const res = await fetch("/chat/send", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.text()).trim() || "Couldn't send it.");
      msg = await res.json();
    } else {
      msg = await post("/chat/send", { chat: state.open, body: text, replyTo: state.reply ? state.reply.id : 0 });
    }
    $("chText").value = "";
    sessionStorage.removeItem("ch_draft_" + state.open);
    cancelReply();
    setPicture(null);
    grow();
    if (!state.msgs.has(msg.id)) {
      state.msgs.set(msg.id, msg);
      state.lastId = Math.max(state.lastId, msg.id);
      state.readSent = state.lastId;
      state.forceDown = true;
      renderMsgs(new Set([msg.id]));
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    grow();
    if (matchMedia("(hover: hover)").matches) $("chText").focus();
  }
});

// ---------------------------------------------------------------- message menu

let pop = null;
function closePop() {
  if (pop) pop.remove();
  pop = null;
}
function msgMenu(m, at) {
  closePop();
  pop = el("div", "ch-pop");
  pop.setAttribute("role", "menu");
  const add = (label, fn, bad) => {
    const b = el("button", bad ? "is-bad" : "", label);
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.addEventListener("click", () => { closePop(); fn(); });
    pop.append(b);
  };
  add("Reply", () => startReply(m));
  if (m.body) add("Copy text", () => navigator.clipboard?.writeText(m.body).then(() => toast("Copied."), () => toast("Couldn't copy.", true)));
  if (m.user === state.me && m.body) add("Edit", () => startEdit(m));
  if (m.user === state.me) add("Delete", async () => {
    if (!confirm("Delete this message for everyone?")) return;
    try {
      await post("/chat/action", { action: "delete", id: m.id });
      state.msgs.set(m.id, { ...m, deleted: true, body: "", image: "" });
      renderMsgs();
    } catch (err) { toast(err.message, true); }
  }, true);
  document.body.append(pop);
  const r = pop.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(at.left, innerWidth - r.width - 8)) + "px";
  pop.style.top = (at.bottom + r.height + 8 > innerHeight ? Math.max(8, at.top - r.height - 4) : at.bottom + 4) + "px";
  pop.querySelector("button").focus();
}
document.addEventListener("pointerdown", (e) => { if (pop && !pop.contains(e.target)) closePop(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });

// ---------------------------------------------------------------- header menu (groups)

const menu = $("chMenu");
$("chMore").addEventListener("click", () => {
  const open = menu.hidden;
  menu.hidden = !open;
  $("chMore").setAttribute("aria-expanded", String(open));
});
document.addEventListener("pointerdown", (e) => {
  if (!menu.hidden && !e.target.closest(".ch-menu-wrap")) {
    menu.hidden = true;
    $("chMore").setAttribute("aria-expanded", "false");
  }
});
menu.addEventListener("click", async (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!act) return;
  menu.hidden = true;
  const c = current();
  if (!c) return;
  try {
    if (act === "rename") {
      const name = prompt("Group name", c.name);
      if (name && name.trim()) await post("/chat/action", { action: "rename", chat: c.id, name: name.trim() });
    } else if (act === "add") openNew("add");
    else if (act === "members") alert(c.members.map((m) => (m.id === state.me ? m.name + " (you)" : m.name)).join("\n"));
    else if (act === "leave") {
      if (!confirm("Leave “" + chatName(c) + "”? You won't see its messages anymore.")) return;
      await post("/chat/action", { action: "leave", chat: c.id });
      openChat(0);
      refresh();
    }
  } catch (err) {
    toast(err.message, true);
  }
});

$("chBack").addEventListener("click", () => openChat(0));

// ---------------------------------------------------------------- new chat dialog

const dlg = $("chNewDlg");
let mode = "dm";
let picked = new Map();
let peopleTimer = 0;

function setMode(m) {
  mode = m;
  dlg.querySelectorAll(".ch-seg-btn").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === m || (m === "add" && b.dataset.mode === "group"))));
  $("chGroupName").hidden = m !== "group";
  $("chGroupFoot").hidden = m === "dm";
  $("chPicked").hidden = m === "dm" || !picked.size;
  $("chMakeGroup").textContent = m === "add" ? "Add to group" : "Start group";
  dlg.querySelector(".ch-seg").hidden = m === "add";
  $("chNewTitle").textContent = m === "add" ? "Add people" : "New chat";
  findPeople();
}
dlg.querySelectorAll(".ch-seg-btn").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

function renderPicked() {
  const box = $("chPicked");
  box.replaceChildren();
  picked.forEach((p) => {
    const chip = el("span", "ch-chip", p.name);
    const x = el("button");
    x.type = "button";
    x.setAttribute("aria-label", "Remove " + p.name);
    x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    x.addEventListener("click", () => { picked.delete(p.name); renderPicked(); findPeople(); });
    chip.append(x);
    box.append(chip);
  });
  box.hidden = mode === "dm" || !picked.size;
}

async function findPeople() {
  clearTimeout(peopleTimer);
  peopleTimer = setTimeout(async () => {
    const list = $("chPeople");
    try {
      const res = await fetch("/chat/people?q=" + encodeURIComponent($("chPeopleFind").value.trim()));
      if (!res.ok) throw new Error();
      let people = await res.json();
      if (mode === "add") {
        const inChat = new Set((current()?.members || []).map((m) => m.id));
        people = people.filter((p) => !inChat.has(p.id));
      }
      list.replaceChildren();
      if (!people.length) list.append(el("li", "ch-empty", "Nobody found."));
      people.forEach((p) => {
        const li = el("li");
        const b = el("button", "ch-person");
        b.type = "button";
        const av = el("span", "ch-av");
        av.append(...face(p).childNodes);
        b.append(av, paintName(el("span", "ch-person-name", p.name), p));
        if (mode !== "dm") {
          b.setAttribute("aria-pressed", String(picked.has(p.name)));
          b.append(el("span", "ch-check"));
        }
        b.addEventListener("click", async () => {
          if (mode === "dm") {
            try {
              const out = await post("/chat/action", { action: "open", user: p.name });
              dlg.close();
              await refresh();
              openChat(out.chat);
            } catch (err) { msg(err.message, true); }
            return;
          }
          if (picked.has(p.name)) picked.delete(p.name);
          else picked.set(p.name, p);
          b.setAttribute("aria-pressed", String(picked.has(p.name)));
          renderPicked();
        });
        li.append(b);
        list.append(li);
      });
    } catch {
      msg("Couldn't load members.", true);
    }
  }, 150);
}
function msg(text, bad) {
  $("chNewMsg").textContent = text || "";
  $("chNewMsg").classList.toggle("is-error", !!bad);
}
$("chPeopleFind").addEventListener("input", findPeople);

function openNew(m = "dm") {
  picked = new Map();
  renderPicked();
  $("chGroupName").value = "";
  $("chPeopleFind").value = "";
  msg("");
  setMode(m);
  dlg.showModal();
  setTimeout(() => (m === "group" ? $("chGroupName") : $("chPeopleFind")).focus(), 50);
}
$("chNew").addEventListener("click", () => openNew());
$("chNone2").addEventListener("click", () => openNew());
dlg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dlg.close()));
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
$("chMakeGroup").addEventListener("click", async () => {
  const members = [...picked.keys()];
  if (!members.length) return msg("Pick at least one person.", true);
  try {
    if (mode === "add") {
      await post("/chat/action", { action: "add", chat: state.open, members });
      dlg.close();
      toast("Added " + members.join(", ") + ".");
      return refresh();
    }
    const name = $("chGroupName").value.trim();
    if (!name) return msg("Give the group a name.", true), $("chGroupName").focus();
    const out = await post("/chat/action", { action: "group", name, members });
    dlg.close();
    await refresh();
    openChat(out.chat);
  } catch (err) {
    msg(err.message, true);
  }
});

const viewer = $("chViewer");
viewer.addEventListener("click", () => viewer.close());

// ---------------------------------------------------------------- start

(async function start() {
  const to = new URLSearchParams(location.search).get("to");
  if (to) {
    try {
      const out = await post("/chat/action", { action: "open", user: to });
      history.replaceState(null, "", "/Chat#" + out.chat);
    } catch (err) {
      toast(err.message, true);
      history.replaceState(null, "", "/Chat");
    }
  }
  const id = Number(location.hash.slice(1)) || 0;
  if (id) openChat(id, { push: false });
  else refresh(true);
})();
window.addEventListener("hashchange", () => openChat(Number(location.hash.slice(1)) || 0, { push: false }));
