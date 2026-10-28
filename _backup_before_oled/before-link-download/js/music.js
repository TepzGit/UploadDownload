// ============================================================
// music.js — the Music page (/Music).
// The library is the audio files in Files the account may open; playlists
// are made here or imported from Spotify (names only: each song is matched
// to one of those files on the server). The iOS app can keep playlists on
// the phone for offline listening ("Keep on this iPhone"), through the
// geek4uMusic message handler; it answers with window.xnMusicStatus.
// ============================================================

import { avatar } from "/forum.js";

const $ = (id) => document.getElementById(id);
const toast = (msg, bad) => window.xnToast && window.xnToast(msg, bad);
const bridge = window.webkit?.messageHandlers?.geek4uMusic || null;

const state = {
  library: [],
  libraryInfo: { access: true, ffmpeg: true, scanning: false },
  own: [],
  shared: [],
  view: { kind: "library", id: 0 },
  playlist: null, // the open playlist's answer from the server
  filter: "",
  // player
  queue: [],
  index: -1,
  order: [], // queue positions in play order (shuffled or not)
  shuffle: false,
  repeat: "off", // off | all | one
  from: "",
  // the iOS app's offline copies
  device: null, // { state, done, total, bytes, playlists:[ids], have:{id:v}, error }
};

// ---------------------------------------------------------------- helpers

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function icon(path, cls = "") {
  const span = el("span", "mu-ico " + cls);
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  return span;
}

const ICONS = {
  play: '<path class="mu-fill" d="M8 5.6v12.8c0 .8.9 1.3 1.6.8l9.6-6.4a1 1 0 0 0 0-1.6L9.6 4.8C8.9 4.3 8 4.8 8 5.6z"/>',
  shuffle: '<path d="M3 6h3.5c2.5 0 4 1.5 5.5 4l1 1.8c1.5 2.7 3 4.2 5.5 4.2H21M3 18h3.5c1.5 0 2.7-.6 3.7-1.7M13.8 7.7C15 6.6 16.3 6 18.5 6H21M18 3l3 3-3 3M18 13l3 3-3 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle class="mu-fill" cx="5" cy="12" r="1.8"/><circle class="mu-fill" cx="12" cy="12" r="1.8"/><circle class="mu-fill" cx="19" cy="12" r="1.8"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M12 8v6M9.5 11.5 12 14l2.5-2.5"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  trash: '<path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  library: '<path d="M4 4v16M8.5 4v16M13 4.5l5.5 15"/>',
  note: '<path class="mu-fill" d="M20 3.2v12.3a3.5 3.5 0 1 1-2-3.2V7.6l-8 2v8.9a3.5 3.5 0 1 1-2-3.2V6.4a1.5 1.5 0 0 1 1.1-1.5l9-2.3A1.5 1.5 0 0 1 20 3.2z"/>',
};

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60), m = Math.floor(sec / 60) % 60, h = Math.floor(sec / 3600);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function fmtBytes(n) {
  if (!(n > 0)) return "0 MB";
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0.1, n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;
}

async function api(url, body) {
  const opts = body === undefined ? { headers: { Accept: "application/json" } } : { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) };
  let res;
  try {
    res = await fetch(url, opts);
  } catch (error) {
    throw new Error(navigator.onLine === false ? "You're offline." : "Couldn't reach the server. Try again.");
  }
  const text = await res.text();
  if (res.status === 401) throw new Error("Log in again to use Music.");
  if (!res.ok) throw new Error(text.trim() || "Something went wrong. Try again.");
  return text ? JSON.parse(text) : {};
}

/** The picture for a song: its own cover, the album cover from the playlist, or a note. */
function artBox(cls, track, fallback) {
  const box = el("span", "mu-art " + cls);
  const src = track?.art ? `/music/art/${track.id}?v=${track.v}` : fallback || "";
  if (src) {
    const img = el("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.src = src;
    img.addEventListener("error", () => {
      img.remove();
      box.append(icon(ICONS.note));
    });
    box.append(img);
  } else {
    box.append(icon(ICONS.note));
  }
  return box;
}

function songItem(track, extra = {}) {
  return {
    id: track.id,
    v: track.v,
    title: extra.title || track.title || "Unknown song",
    artist: extra.artist || track.artist || "",
    album: extra.album || track.album || "",
    art: track.art ? `/music/art/${track.id}?v=${track.v}` : extra.image || "",
    duration: track.duration || 0,
  };
}

const onPhone = (item) => state.device?.have?.[item.id] === item.v;
const isOffline = () => navigator.onLine === false;

// ---------------------------------------------------------------- loading

async function loadLists() {
  try {
    const data = await api("/music/playlists");
    state.own = data.own || [];
    state.shared = data.shared || [];
  } catch (error) {
    toast(error.message, true);
  }
  renderSide();
}

let scanTimer = 0;
async function loadLibrary() {
  try {
    const data = await api("/music/library");
    state.library = data.tracks || [];
    state.libraryInfo = { access: data.access, ffmpeg: data.ffmpeg, scanning: data.scanning };
    clearTimeout(scanTimer);
    // A scan of new files is running: look again in a bit.
    if (data.scanning) scanTimer = setTimeout(loadLibrary, 4000);
  } catch (error) {
    state.libraryInfo.error = error.message;
  }
  renderSide();
  if (state.view.kind === "library") renderLibrary();
}

async function openPlaylist(id, { quiet } = {}) {
  state.view = { kind: "playlist", id };
  history.replaceState(null, "", `/Music?playlist=${id}`);
  renderSide();
  if (!quiet) $("muView").replaceChildren(el("p", "mu-status", "Loading…"));
  try {
    state.playlist = await api(`/music/playlists?id=${id}`);
  } catch (error) {
    state.playlist = null;
    $("muView").replaceChildren(el("p", "mu-status", error.message));
    return;
  }
  if (state.view.kind === "playlist" && state.view.id === id) renderPlaylist();
}

function openLibrary() {
  state.view = { kind: "library", id: 0 };
  state.playlist = null;
  history.replaceState(null, "", "/Music");
  renderSide();
  renderLibrary();
  document.getElementById("mu").classList.add("is-open");
}

// ---------------------------------------------------------------- the side list

function renderSide() {
  const box = $("muLists");
  box.replaceChildren();
  const item = (label, sub, active, onClick, art) => {
    const b = el("button", "mu-list-item" + (active ? " is-active" : ""));
    b.type = "button";
    if (active) b.setAttribute("aria-current", "true");
    b.append(art || el("span", "mu-art mu-art-xs"));
    const text = el("span", "mu-list-text");
    text.append(el("strong", "", label), el("span", "", sub));
    b.append(text);
    b.addEventListener("click", onClick);
    box.append(b);
    return b;
  };
  const libArt = el("span", "mu-art mu-art-xs mu-art-lib");
  libArt.append(icon(ICONS.library));
  item("Library", `${state.library.length} ${state.library.length === 1 ? "song" : "songs"}`, state.view.kind === "library", openLibrary, libArt);

  const coverOf = (p) => {
    const a = el("span", "mu-art mu-art-xs");
    if (p.image) {
      const img = el("img");
      img.alt = "";
      img.src = p.image;
      img.loading = "lazy";
      img.addEventListener("error", () => img.replaceWith(icon(ICONS.note)));
      a.append(img);
    } else a.append(icon(ICONS.note));
    return a;
  };
  const kept = new Set(state.device?.playlists || []);
  const listSub = (p) => `${p.count} ${p.count === 1 ? "song" : "songs"}${kept.has(p.id) ? " · on this iPhone" : ""}`;
  box.append(el("h2", "mu-list-head", "Playlists"));
  if (!state.own.length) box.append(el("p", "mu-list-empty", "None yet. Make one, or import one from Spotify."));
  state.own.forEach((p) => item(p.name, listSub(p), state.view.kind === "playlist" && state.view.id === p.id, () => openPlaylist(p.id), coverOf(p)));
  if (state.shared.length) {
    box.append(el("h2", "mu-list-head", "Shared with you"));
    state.shared.forEach((p) => item(p.name, `${p.owner?.name || ""} · ${listSub(p)}`, state.view.kind === "playlist" && state.view.id === p.id, () => openPlaylist(p.id), coverOf(p)));
  }
  renderDevice();
}

function renderDevice() {
  const box = $("muDevice");
  const d = state.device;
  if (!bridge || !d) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const count = Object.keys(d.have || {}).length;
  if (d.state === "running") box.textContent = `Saving songs to this iPhone… ${d.done || 0} of ${d.total || 0}`;
  else if (d.state === "error") box.textContent = d.error || "Saving songs stopped. It will try again.";
  else box.textContent = count ? `${count} ${count === 1 ? "song" : "songs"} on this iPhone · ${fmtBytes(d.bytes)}` : "Turn on Keep on this iPhone in a playlist to listen offline.";
}

// ---------------------------------------------------------------- the library

function renderLibrary() {
  const view = $("muView");
  view.replaceChildren();
  view.append(backButton());
  const head = el("div", "mu-head");
  const art = el("span", "mu-art mu-art-lg mu-art-lib");
  art.append(icon(ICONS.library));
  const text = el("div", "mu-head-text");
  text.append(el("p", "xn-eyebrow", "Library"), el("h2", "xn-h1 mu-title", "All songs"));
  const info = state.libraryInfo;
  const total = state.library.reduce((s, t) => s + (t.duration || 0), 0);
  text.append(el("p", "xn-sub", `${state.library.length} ${state.library.length === 1 ? "song" : "songs"}${total ? " · " + fmtTime(total) : ""} · the audio files in Files you can open`));
  head.append(art, text);
  view.append(head);

  const actions = el("div", "mu-actions");
  const playable = state.library.filter((t) => t.playable);
  actions.append(button("Play", ICONS.play, () => playList(playable.map((t) => songItem(t)), 0, "Library"), "xn-btn-primary", !playable.length));
  actions.append(button("Shuffle", ICONS.shuffle, () => playList(playable.map((t) => songItem(t)), -1, "Library", true), "", !playable.length));
  const find = el("input", "xn-input mu-find");
  find.type = "search";
  find.placeholder = "Find a song, artist or album";
  find.setAttribute("aria-label", "Find in your library");
  find.value = state.filter;
  find.addEventListener("input", () => {
    state.filter = find.value;
    fillLibraryRows(rows);
  });
  actions.append(find);
  view.append(actions);

  if (info.error) view.append(el("p", "mu-note is-bad", info.error));
  if (!info.access) view.append(el("p", "mu-note", "Your account can't open Files, so there's no library here. Songs in playlists friends share with you still play. An admin can give you Files access."));
  if (info.scanning) view.append(el("p", "mu-note", "Looking for new songs in Files…"));
  if (!info.ffmpeg && state.library.some((t) => !t.playable)) view.append(el("p", "mu-note", "Some songs (like .ogg, .opus or .wma) need FFmpeg on the server to play. Ask an admin to install it."));
  if (info.access && !state.library.length && !info.scanning) view.append(el("p", "mu-note", "No songs yet. Upload .mp3, .m4a, .flac or other audio files in Files and they show up here."));

  const rows = el("ol", "mu-songs");
  view.append(rows);
  fillLibraryRows(rows);
}

function fillLibraryRows(rows) {
  const q = state.filter.trim().toLowerCase();
  rows.replaceChildren();
  const list = state.library.filter((t) => !q || `${t.title} ${t.artist} ${t.album} ${t.folder}`.toLowerCase().includes(q));
  const items = list.map((t) => songItem(t));
  const playable = items.filter((_, i) => list[i].playable);
  list.slice(0, 1500).forEach((t, i) => {
    const row = songRow(items[i], { num: i + 1, album: t.album, playable: t.playable, track: t });
    row.querySelector(".mu-song-main").addEventListener("click", () => {
      if (!t.playable) return toast("This song needs FFmpeg on the server to play.", true);
      playList(playable, playable.indexOf(items[i]), "Library");
    });
    const add = iconButton("Add to a playlist", ICONS.plus, () => addToPlaylist([t.id]));
    row.append(add);
    rows.append(row);
  });
  if (!list.length && state.library.length) rows.append(el("li", "mu-status", "Nothing matches."));
  markPlaying();
}

// ---------------------------------------------------------------- one playlist

function renderPlaylist() {
  const data = state.playlist;
  const p = data.playlist;
  const view = $("muView");
  view.replaceChildren();

  view.append(backButton());

  const head = el("div", "mu-head");
  const cover = el("span", "mu-art mu-art-lg");
  const firstArt = data.songs.find((s) => s.track?.art)?.track;
  if (p.image || firstArt) {
    const img = el("img");
    img.alt = "";
    img.src = p.image || `/music/art/${firstArt.id}?v=${firstArt.v}`;
    img.addEventListener("error", () => img.replaceWith(icon(ICONS.note)));
    cover.append(img);
  } else cover.append(icon(ICONS.note));
  if (data.mine) {
    // The owner taps the cover to change the picture.
    const pick = el("button", "mu-art-edit");
    pick.type = "button";
    pick.title = "Change picture";
    pick.setAttribute("aria-label", "Change the playlist's picture");
    pick.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.image}</svg>`;
    pick.addEventListener("click", () => editPlaylist(p, firstArt));
    cover.classList.add("is-editable");
    cover.append(pick);
  }
  const text = el("div", "mu-head-text");
  text.append(el("p", "xn-eyebrow", p.source === "spotify" ? "Playlist from Spotify" : "Playlist"), el("h2", "xn-h1 mu-title", p.name));
  const total = data.songs.reduce((s, x) => s + (x.track?.duration || x.durationMs / 1000 || 0), 0);
  const meta = el("p", "xn-sub");
  meta.textContent = `${p.count} ${p.count === 1 ? "song" : "songs"} · ${p.matched} with a file${total ? " · " + fmtTime(total) : ""}`;
  text.append(meta);
  if (!data.mine && p.owner) {
    const by = el("p", "mu-by");
    by.append(avatar(p.owner, "mu-avatar"), `Shared by ${p.owner.name}`);
    text.append(by);
  }
  if (data.mine && data.shares.length) {
    const by = el("p", "mu-by");
    data.shares.slice(0, 5).forEach((f) => by.append(avatar(f, "mu-avatar")));
    by.append(`Shared with ${data.shares.map((f) => f.name).join(", ")}`);
    text.append(by);
  }
  head.append(cover, text);
  view.append(head);

  const items = [];
  const rowsData = data.songs.map((s) => {
    const item = s.track ? songItem(s.track, { title: s.title, artist: s.artist, album: s.album, image: p.image || s.image }) : null;
    if (item) items.push(item);
    return { s, item };
  });

  const actions = el("div", "mu-actions");
  actions.append(button("Play", ICONS.play, () => playList(items, 0, p.name), "xn-btn-primary", !items.length));
  actions.append(button("Shuffle", ICONS.shuffle, () => playList(items, -1, p.name, true), "", !items.length));
  if (bridge) actions.append(keepToggle(p, items));
  if (data.mine) {
    actions.append(button("Share", ICONS.share, () => sharePlaylist(data)));
    if (data.spotify) actions.append(button("Update from Spotify", ICONS.sync, () => resync(p), "mu-btn-icon-only"));
    actions.append(button("Edit", ICONS.edit, () => editPlaylist(p, firstArt)));
    actions.append(button("Delete", ICONS.trash, () => deletePlaylist(p), "mu-btn-icon-only xn-btn-danger"));
  }
  view.append(actions);

  const missing = data.songs.length - p.matched;
  if (missing > 0) view.append(el("p", "mu-note", data.mine
    ? `${missing} ${missing === 1 ? "song has" : "songs have"} no file in your music yet. Upload them to Files and they're matched on their own, or tap one to pick its file.`
    : `${missing} ${missing === 1 ? "song isn't" : "songs aren't"} in ${p.owner?.name || "the owner"}'s music, so ${missing === 1 ? "it" : "they"} can't play.`));
  if (!data.songs.length) view.append(el("p", "mu-note", data.mine ? "This playlist is empty. Add songs from your Library with the + button." : "This playlist is empty."));

  const rows = el("ol", "mu-songs");
  rowsData.forEach(({ s, item }, i) => {
    const row = songRow(item || { title: s.title, artist: s.artist, art: s.image }, { num: i + 1, album: s.album, playable: !!item, track: s.track, missing: !item, durationMs: s.durationMs });
    row.querySelector(".mu-song-main").addEventListener("click", () => {
      if (item) return playList(items, items.indexOf(item), p.name);
      if (data.mine) return pickFile(data, s);
      toast("This song isn't in the owner's music, so it can't play.", true);
    });
    if (data.mine) row.append(iconButton("Song options", ICONS.more, () => songOptions(data, s, i)));
    rows.append(row);
  });
  view.append(rows);
  markPlaying();
  document.getElementById("mu").classList.add("is-open");
}

// Phones show the list of playlists or one of them; this goes back to the list.
function backButton() {
  const back = el("button", "mu-back");
  back.type = "button";
  back.append(icon(ICONS.back), "Playlists");
  back.addEventListener("click", () => {
    document.getElementById("mu").classList.remove("is-open");
    window.scrollTo(0, 0);
  });
  return back;
}

function songRow(item, { num, album, playable, track, missing, durationMs }) {
  const li = el("li", "mu-song" + (missing || !playable ? " is-missing" : ""));
  li.dataset.track = track?.id || "";
  const main = el("button", "mu-song-main");
  main.type = "button";
  const n = el("span", "mu-num", String(num));
  const art = artBox("mu-art-sm", track, item.art && !track?.art ? item.art : "");
  const text = el("span", "mu-song-text");
  const title = el("strong", "", item.title);
  const sub = el("span", "", [item.artist, album].filter(Boolean).join(" · "));
  text.append(title, sub);
  main.append(n, art, text);
  if (missing) main.append(el("span", "mu-tag", "No file"));
  else if (!playable) main.append(el("span", "mu-tag", "Needs FFmpeg"));
  else if (bridge && track && state.device?.have?.[track.id] === track.v) main.append(el("span", "mu-tag mu-tag-on", "On iPhone"));
  const len = track?.duration || (durationMs ? durationMs / 1000 : 0);
  main.append(el("span", "mu-len", len ? fmtTime(len) : ""));
  main.setAttribute("aria-label", `${missing ? "" : "Play "}${item.title}${item.artist ? " by " + item.artist : ""}`);
  li.append(main);
  return li;
}

function button(label, path, onClick, cls = "", disabled = false) {
  const b = el("button", "xn-btn " + cls);
  b.type = "button";
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  if (cls.includes("mu-btn-icon-only")) {
    b.title = label;
    b.setAttribute("aria-label", label);
  } else b.append(label);
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

function iconButton(label, path, onClick) {
  const b = el("button", "mu-icon-btn");
  b.type = "button";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

// ---------------------------------------------------------------- the iOS app's offline copies

function keepToggle(p, items) {
  const kept = new Set(state.device?.playlists || []);
  const on = kept.has(p.id);
  const label = el("label", "mu-keep");
  const box = el("input");
  box.type = "checkbox";
  box.checked = on;
  const have = items.filter(onPhone).length;
  const text = el("span", "", "Keep on this iPhone");
  const small = el("small", "", on ? `${have} of ${items.length} saved` : "Listen offline");
  text.append(small);
  label.append(box, text);
  box.addEventListener("change", () => {
    const next = new Set(state.device?.playlists || []);
    if (box.checked) next.add(p.id);
    else next.delete(p.id);
    bridge.postMessage({ action: "keep", playlists: [...next] });
    toast(box.checked ? `Saving ${p.name} to this iPhone.` : `${p.name} won't be kept on this iPhone.`);
  });
  return label;
}

// The app calls this with what it has saved and how the saving goes.
window.xnMusicStatus = function (status) {
  const before = JSON.stringify([state.device?.playlists, state.device?.have]);
  state.device = status || null;
  renderDevice();
  if (before !== JSON.stringify([status?.playlists, status?.have])) {
    renderSide();
    if (state.view.kind === "playlist" && state.playlist) renderPlaylist();
  } else if (state.view.kind === "playlist" && state.playlist && status?.state === "running") {
    const small = document.querySelector(".mu-keep small");
    if (small) small.textContent = `Saving ${status.done || 0} of ${status.total || 0}…`;
  }
};

// ---------------------------------------------------------------- dialogs

let modalSubmit = null;
function openModal(title, body, actions, onSubmit) {
  $("muModalTitle").textContent = title;
  $("muModalBody").replaceChildren(...[].concat(body));
  $("muModalActions").replaceChildren(...actions);
  $("muModalError").hidden = true;
  modalSubmit = onSubmit || null;
  $("muModal").hidden = false;
  document.documentElement.classList.add("xn-modal-open");
  const first = $("muModalBody").querySelector("input, textarea, button");
  (first || $("muModal").querySelector("[data-close]")).focus();
}

function closeModal() {
  $("muModal").hidden = true;
  document.documentElement.classList.remove("xn-modal-open");
  modalSubmit = null;
}

function modalError(message) {
  $("muModalError").textContent = message;
  $("muModalError").hidden = !message;
}

function submitButton(label, cls = "xn-btn-primary") {
  const b = el("button", "xn-btn " + cls, label);
  b.type = "submit";
  return b;
}

function cancelButton(label = "Cancel") {
  const b = el("button", "xn-btn", label);
  b.type = "button";
  b.addEventListener("click", closeModal);
  return b;
}

function field(label, input) {
  const wrap = el("label", "mu-field");
  wrap.append(el("span", "xn-label", label), input);
  return wrap;
}

async function busy(btn, work) {
  btn.disabled = true;
  try {
    await work();
  } catch (error) {
    modalError(error.message);
  } finally {
    btn.disabled = false;
  }
}

function newPlaylist(trackIds = []) {
  const name = el("input", "xn-input");
  name.maxLength = 100;
  name.placeholder = "Late night";
  const save = submitButton("Make playlist");
  openModal("New playlist", [field("Name", name)], [save, cancelButton()], () => busy(save, async () => {
    if (!name.value.trim()) throw new Error("Give the playlist a name.");
    const out = await api("/music/playlists", { action: "create", name: name.value, tracks: trackIds });
    closeModal();
    toast(trackIds.length ? `Added to ${name.value.trim()}.` : `${name.value.trim()} is ready. Add songs from your Library.`);
    await loadLists();
    openPlaylist(out.id);
  }));
}

function addToPlaylist(trackIds) {
  if (!state.own.length) return newPlaylist(trackIds);
  const list = el("div", "mu-pick-list");
  state.own.forEach((p) => {
    const b = el("button", "mu-pick");
    b.type = "button";
    b.append(el("strong", "", p.name), el("span", "", `${p.count} ${p.count === 1 ? "song" : "songs"}`));
    b.addEventListener("click", async () => {
      try {
        await api("/music/playlists", { action: "add", id: p.id, tracks: trackIds });
        closeModal();
        toast(`Added to ${p.name}.`);
        loadLists();
      } catch (error) {
        modalError(error.message);
      }
    });
    list.append(b);
  });
  const fresh = el("button", "xn-btn", "New playlist…");
  fresh.type = "button";
  fresh.addEventListener("click", () => newPlaylist(trackIds));
  openModal("Add to a playlist", [list], [fresh, cancelButton()]);
}

function importPlaylist() {
  const tabs = el("div", "mu-tabs");
  const spot = el("button", "mu-tab", "Spotify link");
  const paste = el("button", "mu-tab", "Paste a list");
  [spot, paste].forEach((b) => (b.type = "button"));
  tabs.append(spot, paste);
  const link = el("input", "xn-input");
  link.placeholder = "https://open.spotify.com/playlist/…";
  link.inputMode = "url";
  link.autocomplete = "off";
  const spotBox = el("div", "mu-tab-panel");
  spotBox.append(field("Playlist link", link), el("p", "mu-hint", "In Spotify: the playlist's ··· › Share › Copy link. It has to be public. Spotify only gives the song names: each one is matched to an audio file in your music, and nothing is downloaded from Spotify."));
  const name = el("input", "xn-input");
  name.maxLength = 100;
  name.placeholder = "Imported playlist";
  const text = el("textarea", "xn-input mu-text");
  text.rows = 8;
  text.placeholder = "Artist - Title\nArtist - Title";
  const pasteBox = el("div", "mu-tab-panel");
  pasteBox.append(field("Name", name), field("Songs", text), el("p", "mu-hint", "One song per line as Artist - Title, or a CSV export (like Exportify's) with Track Name and Artist Name(s) columns."));
  let mode = "spotify";
  const setMode = (m) => {
    mode = m;
    spot.setAttribute("aria-pressed", String(m === "spotify"));
    paste.setAttribute("aria-pressed", String(m === "text"));
    spotBox.hidden = m !== "spotify";
    pasteBox.hidden = m !== "text";
    modalError("");
  };
  spot.addEventListener("click", () => setMode("spotify"));
  paste.addEventListener("click", () => setMode("text"));
  const file = el("input");
  file.type = "file";
  file.accept = ".csv,.txt,text/csv,text/plain";
  file.hidden = true;
  const fileBtn = el("button", "xn-btn", "Open a CSV file…");
  fileBtn.type = "button";
  fileBtn.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    if (f.size > 2e6) return modalError("That file is over 2 MB.");
    text.value = await f.text();
    if (!name.value) name.value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  });
  pasteBox.append(fileBtn, file);
  setMode("spotify");
  const go = submitButton("Import");
  openModal("Import a playlist", [tabs, spotBox, pasteBox], [go, cancelButton()], () => busy(go, async () => {
    const body = mode === "spotify" ? { link: link.value } : { text: text.value, name: name.value };
    if (mode === "spotify" && !link.value.trim()) throw new Error("Paste the playlist's link.");
    if (mode === "text" && !text.value.trim()) throw new Error("Paste the songs, one per line.");
    go.textContent = "Importing…";
    try {
      const out = await api("/music/import", body);
      closeModal();
      toast(`Imported ${out.count} ${out.count === 1 ? "song" : "songs"}. ${out.matched} matched a file in your music.`);
      await loadLists();
      openPlaylist(out.id);
    } finally {
      go.textContent = "Import";
    }
  }));
}

/** Change a playlist's name and picture. */
function editPlaylist(p, firstArt) {
  const name = el("input", "xn-input");
  name.maxLength = 100;
  name.value = p.name;

  let file = null;
  let remove = false;
  const preview = el("span", "mu-art mu-edit-art");
  const showPreview = () => {
    preview.replaceChildren();
    let src = "";
    if (file) src = URL.createObjectURL(file);
    else if (p.image && !remove) src = p.image;
    else if (firstArt) src = `/music/art/${firstArt.id}?v=${firstArt.v}`;
    if (src) {
      const img = el("img");
      img.alt = "";
      img.src = src;
      img.addEventListener("error", () => img.replaceWith(icon(ICONS.note)));
      preview.append(img);
    } else preview.append(icon(ICONS.note));
    clear.hidden = !(file || (p.image && !remove));
  };
  const input = el("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/gif,image/webp";
  input.hidden = true;
  input.addEventListener("change", () => {
    const chosen = input.files[0];
    input.value = "";
    if (!chosen) return;
    if (chosen.size > 10 * 1024 * 1024) return modalError("That picture is too big. Use one under 10 MB.");
    file = chosen;
    remove = false;
    $("muModalError").hidden = true;
    showPreview();
  });
  const choose = button("Choose picture", ICONS.image, () => input.click());
  const clear = button("Remove picture", ICONS.trash, () => {
    file = null;
    remove = true;
    showPreview();
  }, "mu-btn-quiet");
  const picBox = el("div", "mu-edit-pic");
  const picButtons = el("div", "mu-edit-pic-btns");
  picButtons.append(choose, clear, el("span", "mu-hint", "JPG, PNG, GIF or WebP, up to 10 MB. Square looks best."));
  picBox.append(preview, picButtons, input);
  showPreview();

  const save = submitButton("Save");
  openModal("Edit playlist", [field("Name", name), picBox], [save, cancelButton()], () => busy(save, async () => {
    if (!name.value.trim()) throw new Error("Give the playlist a name.");
    if (name.value.trim() !== p.name) await api("/music/playlists", { action: "rename", id: p.id, name: name.value });
    if (file || remove) {
      const form = new FormData();
      if (file) form.append("image", file);
      else form.append("remove", "1");
      let res;
      try {
        res = await fetch(`/music/cover/${p.id}`, { method: "POST", body: form });
      } catch {
        throw new Error(navigator.onLine === false ? "You're offline." : "Couldn't reach the server. Try again.");
      }
      if (!res.ok) throw new Error((await res.text()).trim() || "Couldn't save the picture. Try again.");
    }
    closeModal();
    await loadLists();
    openPlaylist(p.id, { quiet: true });
  }));
}

function deletePlaylist(p) {
  const del = submitButton("Delete playlist", "xn-btn-danger");
  openModal(`Delete ${p.name}?`, [el("p", "mu-hint", "The songs stay in your Library and in Files. Friends you shared it with lose it.")], [del, cancelButton()], () => busy(del, async () => {
    await api("/music/playlists", { action: "delete", id: p.id });
    if (state.device?.playlists?.includes(p.id) && bridge) bridge.postMessage({ action: "keep", playlists: state.device.playlists.filter((x) => x !== p.id) });
    closeModal();
    toast(`${p.name} deleted.`);
    await loadLists();
    openLibrary();
  }));
}

async function resync(p) {
  toast("Checking Spotify for changes…");
  try {
    await api("/music/playlists", { action: "resync", id: p.id });
    await loadLists();
    await openPlaylist(p.id, { quiet: true });
    toast(`${p.name} is up to date with Spotify.`);
  } catch (error) {
    toast(error.message, true);
  }
}

async function sharePlaylist(data) {
  let friends = [];
  try {
    friends = (await api("/friends")).friends || [];
  } catch (error) {
    return toast(error.message, true);
  }
  const chosen = new Set(data.shares.map((f) => f.name.toLowerCase()));
  const list = el("div", "mu-pick-list");
  if (!friends.length) list.append(el("p", "mu-hint", "You have no friends on Geek⁴u yet. Add some from their profiles, then share."));
  friends.forEach((f) => {
    const row = el("label", "mu-friend");
    const box = el("input");
    box.type = "checkbox";
    box.value = f.name;
    box.checked = chosen.has(f.name.toLowerCase());
    row.append(box, avatar(f, "mu-avatar"), el("span", "", f.name));
    list.append(row);
  });
  const save = submitButton("Save");
  openModal(`Share ${data.playlist.name}`, [el("p", "mu-hint", "Friends you pick can play this playlist (and keep it on their phone) but can't change it."), list], friends.length ? [save, cancelButton()] : [cancelButton("Close")], () => busy(save, async () => {
    const people = [...list.querySelectorAll("input:checked")].map((b) => b.value);
    await api("/music/playlists", { action: "share", id: data.playlist.id, people });
    closeModal();
    toast(people.length ? `Shared with ${people.join(", ")}.` : "Not shared with anyone now.");
    openPlaylist(data.playlist.id, { quiet: true });
  }));
}

function songOptions(data, song, index) {
  const list = el("div", "mu-pick-list");
  const opt = (label, run, cls = "") => {
    const b = el("button", "mu-pick " + cls, label);
    b.type = "button";
    b.addEventListener("click", async () => {
      try {
        await run();
      } catch (error) {
        modalError(error.message);
      }
    });
    list.append(b);
  };
  const change = async (body) => {
    await api("/music/playlists", { id: data.playlist.id, ...body });
    closeModal();
    await openPlaylist(data.playlist.id, { quiet: true });
    loadLists();
  };
  opt(song.track ? "Pick a different file" : "Pick its file", () => pickFile(data, song));
  if (song.manual) opt("Let Geek⁴u find the file", () => change({ action: "unmatch", song: song.id }));
  const order = data.songs.map((s) => s.id);
  if (index > 0) opt("Move up", () => {
    [order[index - 1], order[index]] = [order[index], order[index - 1]];
    return change({ action: "move", order });
  });
  if (index < order.length - 1) opt("Move down", () => {
    [order[index + 1], order[index]] = [order[index], order[index + 1]];
    return change({ action: "move", order });
  });
  opt("Remove from playlist", () => change({ action: "remove", song: song.id }), "is-danger");
  const sub = el("p", "mu-hint", [song.artist, song.album].filter(Boolean).join(" · "));
  openModal(song.title, [sub, list], [cancelButton("Close")]);
}

function pickFile(data, song) {
  const find = el("input", "xn-input");
  find.type = "search";
  find.placeholder = "Find a file in your music";
  find.value = song.title;
  const list = el("div", "mu-pick-list mu-pick-scroll");
  const fill = () => {
    const q = find.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    list.replaceChildren();
    const hits = state.library.filter((t) => t.playable && q.every((w) => `${t.title} ${t.artist} ${t.album} ${t.folder}`.toLowerCase().includes(w))).slice(0, 60);
    if (!hits.length) list.append(el("p", "mu-hint", state.library.length ? "No file matches. Try fewer words." : "Your Library is empty. Upload the song to Files first."));
    hits.forEach((t) => {
      const b = el("button", "mu-pick mu-pick-song");
      b.type = "button";
      const text = el("span", "mu-song-text");
      text.append(el("strong", "", t.title), el("span", "", [t.artist, t.album, fmtTime(t.duration)].filter(Boolean).join(" · ")));
      b.append(artBox("mu-art-xs", t), text);
      b.addEventListener("click", async () => {
        try {
          await api("/music/playlists", { action: "match", id: data.playlist.id, song: song.id, track: t.id });
          closeModal();
          toast(`${song.title} now plays ${t.title}.`);
          await openPlaylist(data.playlist.id, { quiet: true });
          loadLists();
        } catch (error) {
          modalError(error.message);
        }
      });
      list.append(b);
    });
  };
  find.addEventListener("input", fill);
  const none = el("button", "xn-btn", "No file for this song");
  none.type = "button";
  none.addEventListener("click", async () => {
    try {
      await api("/music/playlists", { action: "match", id: data.playlist.id, song: song.id, track: 0 });
      closeModal();
      openPlaylist(data.playlist.id, { quiet: true });
    } catch (error) {
      modalError(error.message);
    }
  });
  openModal(`File for ${song.title}`, [el("p", "mu-hint", [song.artist, song.album].filter(Boolean).join(" · ")), find, list], [none, cancelButton()]);
  fill();
  if (!state.library.length) loadLibrary().then(fill);
}

// ---------------------------------------------------------------- the player

const audio = $("muAudio");

function playList(items, start, from, shuffle = false) {
  if (!items.length) return;
  state.queue = items.slice();
  state.from = from;
  state.shuffle = shuffle || state.shuffle;
  buildOrder(start < 0 ? Math.floor(Math.random() * items.length) : start);
  playAt(state.order[0] ?? 0);
}

function buildOrder(first) {
  const n = state.queue.length;
  const order = [...Array(n).keys()];
  if (state.shuffle) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const at = order.indexOf(first);
    if (at > 0) [order[0], order[at]] = [order[at], order[0]];
    state.order = order;
  } else {
    state.order = order.slice(first).concat(order.slice(0, first));
  }
}

function current() {
  return state.queue[state.index] || null;
}

function playAt(index) {
  const item = state.queue[index];
  if (!item) return;
  // Offline, only songs saved on the phone can play.
  if (isOffline() && bridge && !onPhone(item)) {
    const next = nextIndex(index, 1, true);
    if (next != null && next !== index) return playAt(next);
    return toast("You're offline and none of these songs are on this iPhone.", true);
  }
  state.index = index;
  audio.src = `/music/stream/${item.id}?v=${encodeURIComponent(item.v)}`;
  const tried = audio.play();
  if (tried) tried.catch((error) => {
    if (error.name !== "AbortError") toast("Tap play to start.", false);
  });
  showNow();
}

/** The queue position step songs away in play order; null at the end (unless repeating). */
function nextIndex(from, step, wrap = state.repeat === "all") {
  const n = state.order.length;
  if (!n) return null;
  let at = state.order.indexOf(from);
  for (let tries = 0; tries < n; tries++) {
    at += step;
    if (at >= n || at < 0) {
      if (!wrap) return null;
      at = (at + n) % n;
    }
    const idx = state.order[at];
    if (!(isOffline() && bridge) || onPhone(state.queue[idx])) return idx;
  }
  return null;
}

function next(auto = false) {
  if (auto && state.repeat === "one") {
    audio.currentTime = 0;
    audio.play();
    return;
  }
  const idx = nextIndex(state.index, 1, auto ? state.repeat === "all" : true);
  if (idx == null) {
    audio.pause();
    audio.currentTime = 0;
    updateButtons();
    return;
  }
  playAt(idx);
}

function prev() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  const idx = nextIndex(state.index, -1, true);
  if (idx != null) playAt(idx);
}

function toggle() {
  if (!current()) {
    const items = state.view.kind === "library" ? state.library.filter((t) => t.playable).map((t) => songItem(t)) : [];
    if (items.length) playList(items, 0, "Library");
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function showNow() {
  const item = current();
  $("muPlayer").hidden = !item;
  document.documentElement.classList.toggle("mu-has-player", !!item);
  if (!item) return;
  $("muTitle").textContent = item.title;
  $("muArtist").textContent = item.artist;
  $("muNowTitle").textContent = item.title;
  $("muNowArtist").textContent = [item.artist, item.album].filter(Boolean).join(" · ");
  $("muNowFrom").textContent = state.from ? `Playing from ${state.from}` : "";
  const art = (box, cls) => {
    box.className = "mu-art " + cls;
    box.replaceChildren();
    if (item.art) {
      const img = el("img");
      img.alt = "";
      img.src = item.art;
      img.addEventListener("error", () => img.replaceWith(icon(ICONS.note)));
      box.append(img);
    } else box.append(icon(ICONS.note));
  };
  art($("muArt"), "mu-art-sm");
  art($("muNowArt"), "mu-art-xl");
  document.title = `${item.title} · Music · Geek⁴u`;
  if ("mediaSession" in navigator) {
    const artwork = item.art ? [{ src: new URL(item.art, location.href).href, sizes: "600x600", type: "image/jpeg" }] : [];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.artist, album: item.album || state.from, artwork });
    } catch (_) {}
  }
  markPlaying();
  updateButtons();
}

function markPlaying() {
  const item = current();
  document.querySelectorAll(".mu-song").forEach((li) => li.classList.toggle("is-playing", !!item && li.dataset.track === String(item.id)));
}

function updateButtons() {
  const playing = !audio.paused && !!current();
  $("muPlayer").classList.toggle("is-playing", playing);
  $("muNow").classList.toggle("is-playing", playing);
  $("muPlay").setAttribute("aria-label", playing ? "Pause" : "Play");
  $("muShuffle").setAttribute("aria-pressed", String(state.shuffle));
  $("muRepeat").dataset.mode = state.repeat;
  $("muRepeat").setAttribute("aria-label", { off: "Repeat", all: "Repeat all", one: "Repeat one" }[state.repeat]);
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = current() ? (playing ? "playing" : "paused") : "none";
}

let seeking = false;
function updateTime() {
  const d = audio.duration;
  $("muTime").textContent = fmtTime(audio.currentTime);
  $("muLength").textContent = Number.isFinite(d) ? fmtTime(d) : fmtTime(current()?.duration || 0);
  if (!seeking && Number.isFinite(d) && d > 0) $("muSeekBar").value = String(Math.round((audio.currentTime / d) * 1000));
  if ("mediaSession" in navigator && Number.isFinite(d) && d > 0 && navigator.mediaSession.setPositionState) {
    try {
      navigator.mediaSession.setPositionState({ duration: d, position: Math.min(d, audio.currentTime), playbackRate: audio.playbackRate || 1 });
    } catch (_) {}
  }
}

function initPlayer() {
  audio.addEventListener("play", updateButtons);
  audio.addEventListener("pause", updateButtons);
  audio.addEventListener("ended", () => next(true));
  audio.addEventListener("timeupdate", updateTime);
  audio.addEventListener("loadedmetadata", updateTime);
  audio.addEventListener("error", () => {
    const item = current();
    if (!item || !audio.src) return;
    toast(isOffline() ? `${item.title} isn't on this iPhone.` : `${item.title} couldn't play.`, true);
    // Skip it, but don't spin through a whole list of broken songs.
    if (state.queue.length > 1 && (audio._skips = (audio._skips || 0) + 1) < 5) next(true);
  });
  audio.addEventListener("playing", () => (audio._skips = 0));

  $("muPlay").addEventListener("click", toggle);
  $("muNext").addEventListener("click", () => next());
  $("muPrev").addEventListener("click", prev);
  $("muShuffle").addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    if (state.queue.length) buildOrder(state.index);
    updateButtons();
  });
  $("muRepeat").addEventListener("click", () => {
    state.repeat = { off: "all", all: "one", one: "off" }[state.repeat];
    updateButtons();
  });
  const bar = $("muSeekBar");
  bar.addEventListener("input", () => {
    seeking = true;
    const d = audio.duration;
    if (Number.isFinite(d)) $("muTime").textContent = fmtTime((bar.value / 1000) * d);
  });
  bar.addEventListener("change", () => {
    const d = audio.duration;
    if (Number.isFinite(d)) audio.currentTime = (bar.value / 1000) * d;
    seeking = false;
  });
  const vol = $("muVolume");
  try {
    const saved = Number(localStorage.getItem("xn_music_volume"));
    if (saved >= 0 && saved <= 100 && localStorage.getItem("xn_music_volume") !== null) vol.value = String(saved);
  } catch (_) {}
  audio.volume = vol.value / 100;
  vol.addEventListener("input", () => {
    audio.volume = vol.value / 100;
    try { localStorage.setItem("xn_music_volume", vol.value); } catch (_) {}
  });

  if ("mediaSession" in navigator) {
    const on = (action, fn) => {
      try { navigator.mediaSession.setActionHandler(action, fn); } catch (_) {}
    };
    on("play", () => audio.play());
    on("pause", () => audio.pause());
    on("previoustrack", prev);
    on("nexttrack", () => next());
    on("seekto", (d) => {
      if (d.fastSeek && audio.fastSeek) audio.fastSeek(d.seekTime);
      else audio.currentTime = d.seekTime;
    });
    on("seekbackward", (d) => (audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10))));
    on("seekforward", (d) => (audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d.seekOffset || 10))));
  }

  // Now playing, full screen on phones: the controls move into it while it's open.
  const nowBox = $("muNow");
  const home = { controls: document.querySelector(".mu-controls"), seek: document.querySelector(".mu-seek") };
  const openNow = () => {
    if (window.matchMedia("(min-width: 900px)").matches) return;
    $("muNowSlot").append(home.seek, home.controls);
    nowBox.hidden = false;
    document.documentElement.classList.add("xn-modal-open");
    $("muCloseNow").focus();
  };
  const closeNow = () => {
    const player = $("muPlayer");
    player.insertBefore(home.controls, player.querySelector(".mu-vol"));
    player.insertBefore(home.seek, player.querySelector(".mu-vol"));
    nowBox.hidden = true;
    document.documentElement.classList.remove("xn-modal-open");
  };
  $("muOpenNow").addEventListener("click", openNow);
  $("muCloseNow").addEventListener("click", closeNow);
  // Swipe Now playing down to close it.
  let startY = null;
  nowBox.addEventListener("touchstart", (e) => (startY = e.target.closest("input") ? null : e.touches[0].clientY), { passive: true });
  nowBox.addEventListener("touchend", (e) => {
    if (startY != null && e.changedTouches[0].clientY - startY > 90) closeNow();
    startY = null;
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("muModal").hidden) closeModal();
      else if (!nowBox.hidden) closeNow();
      return;
    }
    if (e.target.closest("input, textarea, select, button") || !$("muModal").hidden) return;
    if (e.code === "Space") {
      e.preventDefault();
      toggle();
    }
  });
}

// ---------------------------------------------------------------- start

function init() {
  $("muNew").addEventListener("click", () => newPlaylist());
  $("muImport").addEventListener("click", importPlaylist);
  $("muModalForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (modalSubmit) modalSubmit();
  });
  $("muModal").addEventListener("click", (e) => {
    if (e.target === $("muModal") || e.target.closest("[data-close]")) closeModal();
  });
  initPlayer();
  updateButtons();
  window.addEventListener("online", () => state.view.kind === "playlist" ? openPlaylist(state.view.id, { quiet: true }) : loadLibrary());
  if (bridge) bridge.postMessage({ action: "status" });

  const wanted = Number(new URLSearchParams(location.search).get("playlist"));
  loadLists();
  loadLibrary();
  if (wanted > 0) openPlaylist(wanted);
}

init();
