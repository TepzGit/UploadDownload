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
      if (j.state === "running") {
        const bits = [];
        if (j.percent) bits.push(Math.round(j.percent) + "%");
        if (j.seconds) bits.push(fmtTime(j.seconds) + (j.duration ? " of " + fmtTime(j.duration) : "") + " saved");
        if (j.bytes) bits.push(fmtBytes(j.bytes));
        meta.textContent = (bits.length ? bits.join(" · ") : "Starting…") + " → " + j.folder;
      } else if (j.state === "done") {
        meta.textContent = "Saved in " + j.folder + (j.bytes ? " · " + fmtBytes(j.bytes) : "");
        const open = document.createElement("a");
        open.href = "/Files" + (j.folder === "/" ? "/" : j.folder.split("/").map(encodeURIComponent).join("/"));
        open.textContent = "Open folder";
        meta.append(" · ", open);
      } else if (j.state === "cancelled") meta.textContent = "Stopped.";
      else meta.textContent = j.error || "It didn't work.";
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
        else showNote("Works with video and audio links and sites like YouTube, SoundCloud and Pinterest (through yt-dlp). Spotify and other DRM-locked services can't be downloaded.");
      }
    } catch {
      clearTimeout(timer);
      timer = setTimeout(refresh, 5000);
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = urlBox.value.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      showNote("Paste a link that starts with http:// or https://.", true);
      urlBox.focus();
      return;
    }
    go.disabled = true;
    try {
      const data = await api({ url, name: nameBox.value.trim(), currentPath: document.getElementById("currentPathInput").value });
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
})();
