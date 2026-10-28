// forum.js: Forum posts (text and up to 4 pictures) and their comments. The
// Forum page lists everyone's posts; /u/<name> lists one member's. Needs
// media.js on the page.
const toast = (msg, bad) => window.xnToast && window.xnToast(msg, bad);
const DAY = 86400000;
const COMMENT_MAX = 1000;
const touch = window.matchMedia("(pointer: coarse)");

function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "just now", "5 min ago", "3 h ago", "Yesterday, 21:30" or "9 Oct, 21:30". */
export function postTime(t) {
  const minutes = Math.floor((Date.now() - t) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + " min ago";
  if (minutes < 12 * 60) return Math.floor(minutes / 60) + " h ago";
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (startOfDay(t) === startOfDay(Date.now())) return "Today, " + time;
  if (startOfDay(t) === startOfDay(startOfDay(Date.now()) - DAY / 2)) return "Yesterday, " + time;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString([], { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }) + ", " + time;
}

export function profileLink(name) {
  return "/u/" + encodeURIComponent(name);
}

/** A round avatar: the member's picture, or their first letter. */
export function avatar(person, className = "fm-avatar") {
  const span = document.createElement("span");
  span.className = className;
  span.setAttribute("aria-hidden", "true");
  if (person.avatar) {
    const img = document.createElement("img");
    img.src = person.avatar;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => img.replaceWith(person.initial || "?"));
    span.append(img);
  } else {
    span.textContent = person.initial || "?";
  }
  return span;
}

async function send(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Error("Log in again to do that.");
  if (!res.ok) throw new Error((await res.text()).trim() || "Couldn't save that. Try again.");
  return res.json();
}

/** A delete button that asks once ("Delete?") before it calls onConfirm. */
function deleteButton(className, label, ask, onConfirm) {
  const del = document.createElement("button");
  del.type = "button";
  del.className = className;
  del.textContent = label;
  let armed = null;
  const disarm = () => {
    clearTimeout(armed);
    armed = null;
    del.classList.remove("is-confirm");
    del.textContent = label;
  };
  del.addEventListener("blur", disarm);
  del.addEventListener("click", async () => {
    if (!armed) {
      del.classList.add("is-confirm");
      del.textContent = ask;
      armed = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    del.disabled = true;
    try {
      await onConfirm();
    } catch (error) {
      del.disabled = false;
      toast(error.message, true);
    }
  });
  return del;
}

function commentLabel(count) {
  if (!count) return "Comment";
  return count === 1 ? "1 comment" : count + " comments";
}

function commentItem(comment, onRemoved) {
  const item = document.createElement("li");
  item.className = "fm-comment";
  const author = document.createElement("a");
  author.className = "fm-comment-face";
  author.href = profileLink(comment.author.name);
  author.setAttribute("aria-label", comment.author.name + "'s profile");
  author.append(avatar(comment.author, "fm-avatar fm-avatar-sm"));
  const main = document.createElement("div");
  main.className = "fm-comment-main";
  const head = document.createElement("div");
  head.className = "fm-comment-head";
  const name = document.createElement("a");
  name.className = "fm-comment-name";
  name.href = profileLink(comment.author.name);
  name.textContent = comment.author.name;
  const when = document.createElement("time");
  when.className = "fm-time";
  when.dateTime = new Date(comment.createdAt).toISOString();
  when.title = new Date(comment.createdAt).toLocaleString();
  when.textContent = postTime(comment.createdAt);
  head.append(name, when);
  if (comment.canDelete) {
    head.append(deleteButton("fm-delete fm-delete-sm", "Delete", "Delete?", async () => {
      await send("/forum/comments", { action: "delete", id: comment.id });
      item.remove();
      onRemoved();
    }));
  }
  const body = document.createElement("p");
  body.className = "fm-comment-body";
  body.textContent = comment.body;
  main.append(head, body);
  item.append(author, main);
  return item;
}

/** The comment button under a post and the list + box it opens. */
function commentsArea(post) {
  let count = post.comments || 0;
  let loaded = false;
  const foot = document.createElement("div");
  foot.className = "fm-post-foot";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "fm-comment-toggle";
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v10H9l-5 4v-14z"/></svg><span></span>';
  const label = toggle.querySelector("span");
  label.textContent = commentLabel(count);
  foot.append(toggle);

  const area = document.createElement("div");
  area.className = "fm-comments";
  area.hidden = true;
  const list = document.createElement("ol");
  list.className = "fm-comment-list";
  const form = document.createElement("form");
  form.className = "fm-comment-form";
  const text = document.createElement("textarea");
  text.className = "xn-input fm-comment-text";
  text.rows = 1;
  text.maxLength = COMMENT_MAX;
  text.placeholder = "Write a comment…";
  text.setAttribute("aria-label", "Write a comment");
  const sendBtn = document.createElement("button");
  sendBtn.type = "submit";
  sendBtn.className = "xn-btn xn-btn-primary";
  sendBtn.textContent = "Send";
  sendBtn.disabled = true;
  form.append(text, sendBtn);
  area.append(list, form);

  const changed = (by) => {
    count = Math.max(0, count + by);
    label.textContent = commentLabel(count);
  };
  const grow = () => {
    text.style.height = "auto";
    text.style.height = Math.min(text.scrollHeight + 2, 160) + "px";
    sendBtn.disabled = !text.value.trim();
  };

  async function load() {
    list.innerHTML = '<li class="fm-comment-note">Loading comments…</li>';
    try {
      const res = await fetch("/forum/comments?post=" + encodeURIComponent(post.id), { headers: { Accept: "application/json" } });
      if (res.status === 404) throw new Error("This post was deleted.");
      if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) throw new Error("Couldn't load the comments. Try again.");
      const comments = await res.json();
      list.replaceChildren(...comments.map((c) => commentItem(c, () => changed(-1))));
      if (!comments.length) list.innerHTML = '<li class="fm-comment-note">No comments yet.</li>';
      count = comments.length;
      label.textContent = commentLabel(count);
      loaded = true;
    } catch (error) {
      list.innerHTML = "";
      const note = document.createElement("li");
      note.className = "fm-comment-note";
      note.textContent = error.message;
      list.append(note);
    }
  }

  toggle.addEventListener("click", () => {
    const open = area.hidden;
    area.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (!open) return;
    if (!loaded) load();
    // On phones the keyboard would cover the comments, so wait for a tap.
    if (!touch.matches) text.focus({ preventScroll: true });
  });
  text.addEventListener("input", grow);
  text.addEventListener("keydown", (e) => {
    // Enter sends on computers; phones keep Enter for new lines.
    if (e.key === "Enter" && !e.shiftKey && (!touch.matches || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!text.value.trim()) return;
    sendBtn.disabled = true;
    text.disabled = true;
    try {
      const comment = await send("/forum/comments", { action: "add", post: post.id, body: text.value });
      list.querySelector(".fm-comment-note")?.remove();
      list.append(commentItem(comment, () => changed(-1)));
      changed(1);
      text.value = "";
    } catch (error) {
      toast(error.message, true);
    } finally {
      text.disabled = false;
      grow();
      text.focus({ preventScroll: true });
    }
  });
  return [foot, area];
}

async function deletePost(id) {
  const res = await fetch("/forum/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", id }),
  });
  if (res.status === 401) throw new Error("Log in again to delete posts.");
  if (!res.ok) throw new Error((await res.text()).trim() || "Couldn't delete that post. Try again.");
}

export function postCard(post, { onRemoved } = {}) {
  const card = document.createElement("article");
  card.className = "xn-card fm-post";
  card.dataset.post = String(post.id);

  const head = document.createElement("header");
  head.className = "fm-post-head";
  const author = document.createElement("a");
  author.className = "fm-author";
  author.href = profileLink(post.author.name);
  const name = document.createElement("strong");
  name.textContent = post.author.name;
  author.append(avatar(post.author), name);
  head.append(author);
  if (post.author.admin) {
    const badge = document.createElement("span");
    badge.className = "fm-badge";
    badge.textContent = "Admin";
    head.append(badge);
  }
  const when = document.createElement("time");
  when.className = "fm-time";
  when.dateTime = new Date(post.createdAt).toISOString();
  when.title = new Date(post.createdAt).toLocaleString();
  when.textContent = postTime(post.createdAt);
  head.append(when);

  if (post.canDelete) {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "fm-delete";
    del.textContent = "Delete";
    let armed = null;
    const disarm = () => {
      clearTimeout(armed);
      armed = null;
      del.classList.remove("is-confirm");
      del.textContent = "Delete";
    };
    del.addEventListener("blur", disarm);
    del.addEventListener("click", async () => {
      if (!armed) {
        del.classList.add("is-confirm");
        del.textContent = "Delete post?";
        armed = setTimeout(disarm, 4000);
        return;
      }
      disarm();
      del.disabled = true;
      try {
        await deletePost(post.id);
        card.remove();
        toast("Post deleted.");
        onRemoved && onRemoved(post);
      } catch (error) {
        del.disabled = false;
        toast(error.message, true);
      }
    });
    head.append(del);
  }
  card.append(head);

  if (post.body) {
    const body = document.createElement("p");
    body.className = "fm-body";
    body.textContent = post.body;
    card.append(body);
  }

  if (post.pictures.length) {
    const pics = document.createElement("div");
    pics.className = "fm-pics";
    pics.dataset.count = String(post.pictures.length);
    post.pictures.forEach((url, index) => {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "fm-pic";
      open.setAttribute("aria-label", "Open picture " + (index + 1) + " of " + post.pictures.length);
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", () => open.classList.add("is-broken"));
      open.append(img);
      open.addEventListener("click", () => window.xnViewer.open(post.pictures, index));
      pics.append(open);
    });
    card.append(pics);
  }
  card.append(...commentsArea(post));
  return card;
}

/**
 * Loads posts into list, 20 at a time, newest first. more is the "Show older
 * posts" button and empty the note shown when there are none.
 */
export function mountFeed({ list, more, empty, user = "", emptyText = "No posts yet." }) {
  let oldest = 0;
  let loaded = false;

  function checkEmpty() {
    empty.hidden = !loaded || list.children.length > 0;
    empty.textContent = emptyText;
  }

  async function load() {
    more.disabled = true;
    const query = new URLSearchParams();
    if (oldest) query.set("before", String(oldest));
    if (user) query.set("user", user);
    try {
      const res = await fetch("/forum/posts?" + query, { headers: { Accept: "application/json" } });
      if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) throw new Error();
      const data = await res.json();
      (data.posts || []).forEach((post) => list.append(postCard(post, { onRemoved: checkEmpty })));
      if (data.posts && data.posts.length) oldest = data.posts[data.posts.length - 1].id;
      more.hidden = !data.more;
      loaded = true;
    } catch (_) {
      toast("Couldn't load the posts. Reload the page to try again.", true);
      if (!loaded) empty.textContent = "Couldn't load the posts. Reload the page to try again.";
      return;
    } finally {
      more.disabled = false;
      list.setAttribute("aria-busy", "false");
    }
    checkEmpty();
  }

  more.addEventListener("click", load);
  load();

  // Refresh the "5 min ago" labels now and then.
  setInterval(() => {
    list.querySelectorAll(".fm-time").forEach((el) => (el.textContent = postTime(Date.parse(el.dateTime))));
  }, 60000);

  return {
    prepend(post) {
      list.prepend(postCard(post, { onRemoved: checkEmpty }));
      checkEmpty();
    },
  };
}
