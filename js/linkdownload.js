// Upload page: "Download a video" card. The server fetches the link with
// FFmpeg (or yt-dlp for pages like YouTube) into the folder picked on the
// right (#currentPathInput), and this shows the downloads while they run.
(function () {
  const form = document.getElementById("linkBox");
  if (!form) return;
  const $ = (id) => document.getElementById(id);
  const urlBox = $("linkUrl");
  const nameBox = $("linkName");
  const go = $("linkGo");
  const note = $("linkNote");
  const list = $("linkJobs");
  let timer = 0;
  let known = {};

  const fmtBytes = (n) => (n >= 1 << 30 ? (n / (1 << 30)).toFixed(2) + " GB" : n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n + " B");
  const fmtTime = (s) => {
    s = Math.floor(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = String(s % 60).padStart(2, "0");
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + r : m + ":" + r;
  };

  function showNote(text, isError) {
    note.hidden = !text;
    note.textContent = text || "";
    note.classList.toggle("is-error", !!isError);
  }

  async function api(body) {
    const res = await fetch("/upload/link", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
    if (!res.ok) throw new Error((await res.text()).trim() || "Something went wrong.");
    return res.json();
  }

  function render(jobs) {
    $("linkJobsHead").hidden = !jobs.length;
    $("linkClear").hidden = !jobs.some((j) => j.state !== "running");
    list.replaceChildren();
    jobs.forEach((j) => {
      const li = document.createElement("li");
      li.className = "up-job is-" + j.state;
      const top = document.createElement("div");
      top.className = "up-job-top";
      const name = document.createElement("strong");
      name.className = "up-job-name";
      name.textContent = j.name || j.url.replace(/^https?:\/\//, "");
      name.title = j.url;
      top.append(name);
      if (j.state === "running") {
        const stop = document.createElement("button");
        stop.type = "button";
        stop.className = "up-job-x";
        stop.setAttribute("aria-label", "Stop this download");
        stop.textContent = "×";
        stop.addEventListener("click", async () => {
          stop.disabled = true;
          try { render((await api({ action: "cancel", id: j.id })).jobs || []); } catch (e) { showNote(e.message, true); }
        });
        top.append(stop);
      }
      li.append(top);
      if (j.state === "running") {
        const bar = document.createElement("div");
        bar.className = "up-bar";
        const fill = document.createElement("div");
        fill.className = "progress-bar" + (j.percent ? "" : " is-unknown");
        fill.style.width = (j.percent || 100) + "%";
        bar.append(fill);
        li.append(bar);
      }
      const meta = document.createElement("p");
      meta.className = "up-job-meta";
      const counts = () => {
        const c = [];
        if (j.total) c.push((j.done || 0).toLocaleString() + " of " + j.total.toLocaleString() + " tried");
        if (j.saved) c.push(j.saved.toLocaleString() + " saved");
        if (j.skipped) c.push(j.skipped.toLocaleString() + " already there");
        if (j.failed) c.push(j.failed.toLocaleString() + " not found");
        return c;
      };
      if (j.state === "running" && (j.tool === "list" || j.tool === "spotdl")) {
        const c = counts();
        meta.textContent = (c.length ? c.join(" · ") : "Starting…") + " → " + j.folder;
      } else if (j.state === "running") {
        const bits = [];
        if (j.percent) bits.push(Math.round(j.percent) + "%");
        if (j.seconds) bits.push(fmtTime(j.seconds) + (j.duration ? " of " + fmtTime(j.duration) : "") + " saved");
        if (j.bytes) bits.push(fmtBytes(j.bytes));
        meta.textContent = (bits.length ? bits.join(" · ") : "Starting…") + " → " + j.folder;
      } else if (j.state === "done") {
        const c = j.tool === "list" || j.tool === "spotdl" ? counts() : [];
        meta.textContent = "Saved in " + j.folder + (c.length ? " · " + c.join(" · ") : j.bytes ? " · " + fmtBytes(j.bytes) : "");
        const open = document.createElement("a");
        open.href = "/Files" + (j.folder === "/" ? "/" : j.folder.split("/").map(encodeURIComponent).join("/"));
        open.textContent = "Open folder";
        meta.append(" · ", open);
      } else if (j.state === "cancelled") meta.textContent = "Stopped.";
      else meta.textContent = (j.error || "It didn't work.") + (j.saved ? " (" + j.saved.toLocaleString() + " songs were saved before that.)" : "");
      li.append(meta);
      list.append(li);
      if (known[j.id] === "running" && j.state === "done" && window.xnToast) window.xnToast("Downloaded " + (j.name || "the video") + ".");
      known[j.id] = j.state;
    });
    clearTimeout(timer);
    if (jobs.some((j) => j.state === "running")) timer = setTimeout(refresh, 1200);
  }

  async function refresh() {
    try {
      const data = await api();
      render(data.jobs || []);
      if (!data.ffmpeg) {
        showNote("The server can't find FFmpeg yet, so link downloads won't work. Once it's installed (on Linux: sudo apt install ffmpeg) it's picked up within a minute; reload this page then.", true);
        go.disabled = true;
      } else if (note.dataset.intro !== "1") {
        note.dataset.intro = "1";
        const t = data.tools || {};
        if (!data.ytdlp && /^couldn't/.test(t.ytdlp || "")) showNote("Direct video links (.mp4, .webm, .m3u8) work. The server couldn't get yt-dlp for YouTube and other sites (" + t.ytdlp + "). It tries again every 12 hours and at every restart.", true);
        else if (!data.ytdlp) showNote("Direct video links (.mp4, .webm, .m3u8) work now. The server is getting yt-dlp for YouTube, SoundCloud and other sites; reload in a minute.");
        else showNote("Works with video and audio links and sites like YouTube, SoundCloud and Pinterest (through yt-dlp). Spotify songs, albums and playlists come as MP3s through spotDL, which finds each song on YouTube" + (t.spotdl && !/^couldn't/.test(t.spotdl) ? "." : (/^couldn't/.test(t.spotdl || "") ? " (the server couldn't get spotDL yet: " + t.spotdl + ")." : " (the server is still getting spotDL).")));
      }
    } catch {
      clearTimeout(timer);
      timer = setTimeout(refresh, 5000);
    }
  }

  // "A list": many songs ("Artist - Title"), Spotify links or other links, one per line.
  const listBox = $("linkList");
  const listLines = () => listBox.value.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const listMode = () => document.querySelector('input[name="linkMode"]:checked')?.value === "list";
  const countList = () => {
    const n = listLines().length;
    $("linkListCount").textContent = n.toLocaleString() + (n === 1 ? " song" : " songs");
  };
  const setMode = () => {
    const list = listMode();
    $("linkListBox").hidden = !list;
    $("linkOneBox").hidden = list;
    urlBox.required = !list;
    try { localStorage.setItem("xn_link_mode", list ? "list" : "one"); } catch (_) {}
  };
  document.querySelectorAll('input[name="linkMode"]').forEach((r) => r.addEventListener("change", setMode));
  try { if (localStorage.getItem("xn_link_mode") === "list") document.querySelector('input[name="linkMode"][value="list"]').checked = true; } catch (_) {}
  setMode();
  listBox.addEventListener("input", countList);

  // A CSV (for example from Exportify) becomes "Artist - Title" lines.
  function csvRows(text) {
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function fromCsv(text) {
    const rows = csvRows(text);
    if (rows.length < 2) return text;
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const find = (...names) => head.findIndex((h) => names.includes(h));
    const t = find("track name", "title", "name", "song", "track");
    const a = find("artist name(s)", "artist name", "artists", "artist");
    const u = find("track uri", "uri", "spotify uri", "url", "link");
    if (t < 0 && u < 0) return text;
    return rows.slice(1).map((r) => {
      const title = (r[t] || "").trim();
      const artist = (r[a] || "").split(/[,;]/)[0].trim();
      if (title) return artist ? artist + " - " + title : title;
      const uri = (r[u] || "").trim();
      const m = /^spotify:track:(\w+)$/.exec(uri);
      return m ? "https://open.spotify.com/track/" + m[1] : uri;
    }).filter(Boolean).join("\n");
  }
  $("linkListFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    let text = await file.text();
    if (/\.csv$/i.test(file.name) || file.type === "text/csv") text = fromCsv(text);
    listBox.value = (listBox.value.trim() ? listBox.value.trim() + "\n" : "") + text.trim();
    countList();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (listMode()) {
      const lines = listLines();
      if (!lines.length) {
        showNote("Paste one song or link per line.", true);
        listBox.focus();
        return;
      }
      go.disabled = true;
      try {
        const format = document.querySelector('input[name="linkFmt"]:checked')?.value || "mp3";
        const data = await api({ list: lines.join("\n"), currentPath: document.getElementById("currentPathInput").value, format });
        listBox.value = "";
        countList();
        showNote("Started. Songs show up in the folder as they finish, and songs already in the folder are skipped. You can close this page; the server keeps going (up to 3 days).");
        render(data.jobs || []);
      } catch (err) {
        showNote(err.message, true);
      } finally {
        go.disabled = false;
      }
      return;
    }
    const url = urlBox.value.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      showNote("Paste a link that starts with http:// or https://.", true);
      urlBox.focus();
      return;
    }
    go.disabled = true;
    try {
      const format = document.querySelector('input[name="linkFmt"]:checked')?.value || "mp3";
      try { localStorage.setItem("xn_link_fmt", format); } catch (_) {}
      const data = await api({ url, name: nameBox.value.trim(), currentPath: document.getElementById("currentPathInput").value, format });
      urlBox.value = "";
      nameBox.value = "";
      showNote("");
      render(data.jobs || []);
    } catch (err) {
      showNote(err.message, true);
    } finally {
      go.disabled = false;
    }
  });

  $("linkClear").addEventListener("click", async () => {
    try { render((await api({ action: "clear" })).jobs || []); } catch (e) { showNote(e.message, true); }
  });

  refresh();

  // MP3 (sound only) or MP4 (video); Spotify links are always MP3.
  (function formatChoice() {
    const mp4 = document.querySelector('input[name="linkFmt"][value="mp4"]');
    const mp3 = document.querySelector('input[name="linkFmt"][value="mp3"]');
    if (!mp4 || !mp3) return;
    try { if (localStorage.getItem("xn_link_fmt") === "mp4") mp4.checked = true; } catch (_) {}
    const urlBox = $("linkUrl");
    const check = () => {
      const spotify = /^\s*https?:\/\/(open\.)?spotify\.(com|link)\//i.test(urlBox.value);
      mp4.disabled = spotify;
      mp4.closest("label").title = spotify ? "Spotify links are always MP3" : "";
      if (spotify) mp3.checked = true;
    };
    urlBox.addEventListener("input", check);
    check();
  })();
})();
