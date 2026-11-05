// ============================================================
// forumpeople.js: the Members card and the Friends tab on the Forum
// (mommy 2026-11-05). Both read GET /forum/members (everyone, with friend
// state, level and last online) and use the friend buttons from friends.js.
//   mountPeople({ myName }) -> { reload, showFriends, bumpPosts }
// ============================================================
import { avatar, paintName, profileLink, rankBadge } from "/forum.js";
import { friendAction, friendButton, renderRequests } from "/friends.js";
import { onlineText, forgetProfileCard } from "/profilecard.js";

const $ = (id) => document.getElementById(id);
const toast = (msg, bad) => window.xnToast && window.xnToast(msg, bad);
const FRIEND_TAGS = { friends: "Friend", incoming: "Asks you", outgoing: "Sent" };
const FRIEND_TITLES = { friends: "Your friend", incoming: "Wants to be your friend", outgoing: "You sent a friend request" };
const SORT_KEY = "xn_forum_member_sort";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Picture with a green dot while the person is online. */
function face(member, cls) {
  const box = el("span", "fm-face" + (cls ? " " + cls : ""));
  box.append(avatar(member));
  const st = onlineText(member.lastSeen);
  if (st.on) {
    const dot = el("span", "fm-dot");
    dot.setAttribute("aria-hidden", "true");
    box.append(dot);
  }
  return box;
}

function postsText(n) {
  return n === 1 ? "1 post" : n + " posts";
}

export function mountPeople({ myName }) {
  let members = [];
  const list = $("members");
  const find = $("memberFind");
  const sort = $("memberSort");
  try { sort.value = localStorage.getItem(SORT_KEY) || "online"; } catch {}
  if (!sort.value) sort.value = "online";

  async function reload() {
    try {
      const res = await fetch("/forum/members", { headers: { Accept: "application/json" } });
      members = res.ok && (res.headers.get("content-type") || "").includes("json") ? await res.json() : [];
    } catch {
      members = members || [];
    }
    drawMembers();
    if (!$("friendsPage").hidden) drawFriends();
    const asking = members.filter((m) => m.friend === "incoming").length;
    $("friendsBadge").hidden = !asking;
    $("friendsBadge").textContent = asking ? String(asking) : "";
  }

  function sorted(listIn) {
    const by = sort.value;
    const name = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    const seen = (m) => m.lastSeen || 0;
    return [...listIn].sort((a, b) => {
      if (a.self !== b.self) return a.self ? -1 : 1; // you first
      if (by === "level") return (b.level || 0) - (a.level || 0) || name(a, b);
      if (by === "posts") return b.posts - a.posts || name(a, b);
      if (by === "name") return name(a, b);
      const ao = onlineText(seen(a)).on, bo = onlineText(seen(b)).on;
      if (ao !== bo) return ao ? -1 : 1;
      const af = a.friend === "friends", bf = b.friend === "friends";
      if (af !== bf) return af ? -1 : 1;
      return seen(b) - seen(a) || name(a, b);
    });
  }

  function memberRow(m) {
    const li = el("li");
    li.dataset.name = m.name.toLowerCase();
    const a = el("a", "fm-member");
    a.href = profileLink(m.name);
    const text = el("span", "fm-member-text");
    const top = el("span", "fm-member-top");
    const name = el("strong", "", m.name);
    paintName(name, m);
    top.append(name);
    const badge = rankBadge(m);
    if (badge) top.append(badge);
    const st = onlineText(m.lastSeen);
    const meta = el("small", "fm-member-meta");
    const posts = el("span", "fm-member-posts", postsText(m.posts));
    posts.dataset.posts = String(m.posts);
    meta.append(el("span", "fm-member-on" + (st.on ? " is-on" : ""), st.on ? "Online" : (m.rankName || "Geek")), posts);
    text.append(top, meta);
    a.append(face(m), text);
    const tag = m.self ? "You" : FRIEND_TAGS[m.friend];
    if (tag) {
      const chip = el("span", "fm-member-tag", tag);
      chip.dataset.state = m.self ? "self" : m.friend;
      if (!m.self) chip.title = FRIEND_TITLES[m.friend];
      a.append(chip);
    }
    li.append(a);
    return li;
  }

  function drawMembers() {
    list.removeAttribute("aria-busy");
    $("membersCount").textContent = members.length ? String(members.length) : "";
    const online = members.filter((m) => onlineText(m.lastSeen).on).length;
    $("membersOnline").hidden = !online;
    $("membersOnline").textContent = online + " online";
    const asking = members.filter((m) => m.friend === "incoming");
    $("requests").hidden = !renderRequests($("requestList"), asking, changed);
    const q = find.value.trim().toLowerCase();
    const shown = sorted(q ? members.filter((m) => m.name.toLowerCase().includes(q)) : members);
    list.replaceChildren(...shown.map(memberRow));
    $("membersNone").hidden = shown.length > 0 || !q;
  }

  // ---------------- Friends tab ----------------
  function personRow(m, actions) {
    const row = el("div", "fm-prow");
    row.dataset.name = m.name.toLowerCase();
    const link = el("a", "fm-prow-link");
    link.href = profileLink(m.name);
    const text = el("span", "fm-prow-text");
    const top = el("span", "fm-member-top");
    const name = el("strong", "", m.name);
    paintName(name, m);
    top.append(name);
    const badge = rankBadge(m);
    if (badge) top.append(badge);
    const st = onlineText(m.lastSeen);
    const meta = el("small", "fm-prow-meta");
    meta.append(el("span", "", (m.rankName || "Geek") + " · Level " + (m.level || 0)), el("span", "fm-member-on" + (st.on ? " is-on" : ""), st.text));
    text.append(top, meta);
    link.append(face(m, "fm-face-lg"), text);
    row.append(link);
    const box = el("div", "fm-prow-acts");
    actions(box);
    row.append(box);
    return row;
  }

  function small(text, primary, onClick, extra = "") {
    const b = el("button", "xn-btn fr-small" + (primary ? " xn-btn-primary" : "") + extra, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  async function act(action, m, done, button) {
    button.closest(".fm-prow")?.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      await friendAction(action, m.name);
      toast(done);
      changed(m.name);
    } catch (e) {
      toast(e.message, true);
      button.closest(".fm-prow")?.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  }

  function message(m) {
    const a = el("a", "xn-btn fr-small", "Message");
    a.href = "/Chat?to=" + encodeURIComponent(m.name);
    return a;
  }

  function fill(listEl, countEl, people, empty, actions) {
    countEl.textContent = people.length ? String(people.length) : "";
    if (!people.length) {
      listEl.replaceChildren(el("p", "xn-empty", empty));
      return;
    }
    listEl.replaceChildren(...people.map((m) => personRow(m, (box) => actions(box, m))));
  }

  function drawFriends() {
    const others = members.filter((m) => !m.self);
    const by = (state) => sorted(others.filter((m) => m.friend === state));
    fill($("fsIncomingList"), $("fsIncomingCount"), by("incoming"), "No one is asking right now.", (box, m) => {
      box.append(
        small("Accept", true, (e) => act("accept", m, "You and " + m.name + " are friends now.", e.currentTarget)),
        small("Decline", false, (e) => act("decline", m, "Request declined.", e.currentTarget)),
      );
    });
    $("fsIncoming").classList.toggle("has-items", by("incoming").length > 0);
    fill($("fsFriendsList"), $("fsFriendsCount"), by("friends"), "No friends yet. Find people below and tap Add friend.", (box, m) => {
      box.append(message(m));
      const fb = el("div", "fm-fb");
      friendButton(fb, m.name, "friends", () => changed(m.name));
      fb.querySelectorAll(".xn-btn").forEach((b) => b.classList.add("fr-small"));
      box.append(fb);
    });
    fill($("fsOutgoingList"), $("fsOutgoingCount"), by("outgoing"), "You have no requests waiting.", (box, m) => {
      box.append(small("Cancel request", false, (e) => act("cancel", m, "Friend request cancelled.", e.currentTarget)));
    });
    drawFind();
  }

  function drawFind() {
    const q = $("fsFindInput").value.trim().toLowerCase();
    const listEl = $("fsFindList");
    if (!q) {
      listEl.replaceChildren(el("p", "xn-empty", "Type a name to find someone."));
      return;
    }
    const hits = sorted(members.filter((m) => !m.self && m.name.toLowerCase().includes(q))).slice(0, 30);
    if (!hits.length) {
      listEl.replaceChildren(el("p", "xn-empty", "No one has that name."));
      return;
    }
    listEl.replaceChildren(...hits.map((m) => personRow(m, (box) => {
      const fb = el("div", "fm-fb");
      friendButton(fb, m.name, m.friend || "", () => changed(m.name));
      fb.querySelectorAll(".xn-btn").forEach((b) => b.classList.add("fr-small"));
      box.append(fb);
    })));
  }

  function changed(name) {
    if (name) forgetProfileCard(name);
    reload();
  }

  find.addEventListener("input", drawMembers);
  sort.addEventListener("change", () => {
    try { localStorage.setItem(SORT_KEY, sort.value); } catch {}
    drawMembers();
  });
  let typing = 0;
  $("fsFindInput").addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(drawFind, 120); });
  window.addEventListener("xn:friends-changed", () => reload());
  // Online dots go stale; refresh the list now and then while the page is open.
  setInterval(() => { if (!document.hidden) reload(); }, 90000);
  reload();

  return {
    reload,
    showFriends() { drawFriends(); },
    bumpPosts() {
      const me = members.find((m) => m.self || m.name.toLowerCase() === String(myName).toLowerCase());
      if (me) { me.posts += 1; drawMembers(); }
    },
  };
}
