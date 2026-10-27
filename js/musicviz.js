// Music visualizer: a full-screen view that moves with the song playing in
// the Music player (#muAudio). Opened from the player bar, from Now playing,
// or with /Music#visualizer. The audio is only routed through Web Audio once
// the visualizer is first opened, so plain playback stays as it was.

const $ = (id) => document.getElementById(id);
const audio = $("muAudio");
const MODES = [
  { key: "bars", label: "Bars" },
  { key: "circle", label: "Circle" },
  { key: "wave", label: "Wave" },
];
const MODE_KEY = "xn_viz_mode";

let root = null;
let canvas = null;
let ctx2d = null;
let actx = null;
let analyser = null;
let freq = null;
let wave = null;
let frame = 0;
let mode = "bars";
let idleTimer = 0;
let smooth = [];
let bassLevel = 0;
let lastArt = "";
let artImg = null;

try { mode = localStorage.getItem(MODE_KEY) || "bars"; } catch {}
if (!MODES.some((m) => m.key === mode)) mode = "bars";

function accent() {
  const rgb = getComputedStyle(document.documentElement).getPropertyValue("--xn-accent-rgb").trim() || "166, 124, 255";
  return rgb.split(",").map((n) => parseFloat(n) || 0);
}

/** A second color: the accent turned around the color wheel. */
function partner([r, g, b]) {
  return [b, r, g].map((v, i) => Math.min(255, v * 0.85 + (i === 1 ? 40 : 20)));
}

const rgba = (c, a) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;

function ensureAudioGraph() {
  if (analyser) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  try {
    actx = new AC();
    const source = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.78;
    source.connect(analyser);
    analyser.connect(actx.destination);
    freq = new Uint8Array(analyser.frequencyBinCount);
    wave = new Uint8Array(analyser.fftSize);
    // Keep the context running whenever the song plays (phones suspend it).
    audio.addEventListener("play", () => actx.state !== "running" && actx.resume().catch(() => {}));
    return true;
  } catch (error) {
    console.warn("Visualizer: no Web Audio", error);
    analyser = null;
    return false;
  }
}

function icon(path) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
}

function build() {
  root = document.createElement("div");
  root.className = "mv";
  root.id = "muViz";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Visualizer");
  root.hidden = true;
  root.innerHTML = `
    <div class="mv-backdrop" id="mvBackdrop"></div>
    <canvas class="mv-canvas" id="mvCanvas"></canvas>
    <div class="mv-ui mv-top">
      <button type="button" class="mv-btn" id="mvClose" aria-label="Close visualizer">${icon('<path d="M6 6l12 12M18 6 6 18"/>')}</button>
      <div class="mv-modes" role="group" aria-label="Style">
        ${MODES.map((m) => `<button type="button" class="mv-mode" data-mode="${m.key}" aria-pressed="false">${m.label}</button>`).join("")}
      </div>
      <button type="button" class="mv-btn" id="mvFull" aria-label="Full screen">${icon('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}</button>
    </div>
    <p class="mv-empty" id="mvEmpty" hidden>Play a song and it moves here.</p>
    <div class="mv-ui mv-bottom">
      <div class="mv-text"><strong id="mvTitle"></strong><span id="mvArtist"></span></div>
      <div class="mv-controls">
        <button type="button" class="mv-btn" id="mvPrev" aria-label="Previous">${icon('<path class="mv-fill" d="M7 5v14M19 5.8v12.4c0 .8-.9 1.3-1.6.8L9 12.8a1 1 0 0 1 0-1.6l8.4-6.2c.7-.5 1.6 0 1.6.8z"/>')}</button>
        <button type="button" class="mv-btn mv-play" id="mvPlay" aria-label="Play or pause">${icon('<path class="mv-fill mv-i-play" d="M8 5.6v12.8c0 .8.9 1.3 1.6.8l9.6-6.4a1 1 0 0 0 0-1.6L9.6 4.8C8.9 4.3 8 4.8 8 5.6z"/><path class="mv-fill mv-i-pause" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>')}</button>
        <button type="button" class="mv-btn" id="mvNext" aria-label="Next">${icon('<path class="mv-fill" d="M17 5v14M5 5.8v12.4c0 .8.9 1.3 1.6.8l8.4-6.2a1 1 0 0 0 0-1.6L6.6 5c-.7-.5-1.6 0-1.6.8z"/>')}</button>
      </div>
    </div>`;
  document.body.append(root);
  canvas = $("mvCanvas");
  ctx2d = canvas.getContext("2d");

  $("mvClose").addEventListener("click", () => close());
  $("mvFull").addEventListener("click", toggleFullscreen);
  // The player's own buttons do the work, so queue, shuffle and repeat stay right.
  $("mvPrev").addEventListener("click", () => $("muPrev")?.click());
  $("mvNext").addEventListener("click", () => $("muNext")?.click());
  $("mvPlay").addEventListener("click", () => $("muPlay")?.click());
  root.querySelectorAll(".mv-mode").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  canvas.addEventListener("click", () => {
    // Tapping the picture switches style; on a phone it also shows the buttons.
    if (root.classList.contains("is-idle")) return wake();
    const i = MODES.findIndex((m) => m.key === mode);
    setMode(MODES[(i + 1) % MODES.length].key);
  });
  root.addEventListener("pointermove", wake);
  root.addEventListener("keydown", onKey);
  window.addEventListener("resize", sizeCanvas);
  audio.addEventListener("play", syncPlaying);
  audio.addEventListener("pause", syncPlaying);
  audio.addEventListener("loadedmetadata", syncSong);
  setMode(mode);
}

function setMode(next) {
  mode = next;
  try { localStorage.setItem(MODE_KEY, mode); } catch {}
  root.querySelectorAll(".mv-mode").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  smooth = [];
}

function wake() {
  root.classList.remove("is-idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => root && !root.hidden && root.classList.add("is-idle"), 3500);
}

function onKey(e) {
  if (e.key === "Escape" && !document.fullscreenElement) return close();
  if (e.target.closest("button") && (e.key === " " || e.key === "Enter")) return;
  if (e.key === " ") { e.preventDefault(); $("muPlay")?.click(); }
  else if (e.key === "ArrowRight") $("muNext")?.click();
  else if (e.key === "ArrowLeft") $("muPrev")?.click();
  else if (e.key.toLowerCase() === "m") {
    const i = MODES.findIndex((m) => m.key === mode);
    setMode(MODES[(i + 1) % MODES.length].key);
  }
  wake();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else root.requestFullscreen?.().catch(() => {});
}

function syncPlaying() {
  if (!root) return;
  root.classList.toggle("is-playing", !audio.paused);
}

function syncSong() {
  if (!root) return;
  const title = $("muTitle")?.textContent || "";
  $("mvTitle").textContent = title;
  $("mvArtist").textContent = $("muArtist")?.textContent || "";
  $("mvEmpty").hidden = Boolean(audio.src);
  const src = $("muArt")?.querySelector("img")?.src || "";
  if (src !== lastArt) {
    lastArt = src;
    $("mvBackdrop").style.backgroundImage = src ? `url("${src.replace(/"/g, "%22")}")` : "";
    artImg = null;
    if (src) {
      const img = new Image();
      img.onload = () => (artImg = img);
      img.src = src;
    }
  }
}

function sizeCanvas() {
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}

/** Spectrum squeezed into n bands on a log scale (more room for bass and mids). */
function bands(n) {
  const out = new Array(n).fill(0);
  if (!analyser) return out;
  analyser.getByteFrequencyData(freq);
  const max = freq.length * 0.72; // the top end is mostly empty
  for (let i = 0; i < n; i++) {
    const a = Math.floor(Math.pow(max, i / n));
    const b = Math.max(a + 1, Math.floor(Math.pow(max, (i + 1) / n)));
    let sum = 0;
    for (let j = a; j < b; j++) sum += freq[j];
    out[i] = sum / (b - a) / 255;
  }
  for (let i = 0; i < n; i++) {
    const v = out[i];
    smooth[i] = smooth[i] == null ? v : v > smooth[i] ? smooth[i] * 0.45 + v * 0.55 : smooth[i] * 0.86 + v * 0.14;
  }
  return smooth.slice(0, n);
}

function roundedBar(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, Math.abs(h) / 2);
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r);
  else c.rect(x, y, w, h);
  c.fill();
}

function drawBars(c, W, H, col1, col2) {
  const n = W < 700 ? 48 : 72;
  const v = bands(n);
  const gap = Math.max(2, W / n * 0.28);
  const bw = (W * 0.9 - gap * (n - 1)) / n;
  const x0 = W * 0.05;
  const mid = H * 0.56;
  const grad = c.createLinearGradient(0, mid - H * 0.4, 0, mid);
  grad.addColorStop(0, rgba(col2, 0.95));
  grad.addColorStop(1, rgba(col1, 0.95));
  for (let i = 0; i < n; i++) {
    const h = Math.max(bw * 0.6, v[i] * H * 0.42);
    const x = x0 + i * (bw + gap);
    c.fillStyle = grad;
    c.shadowColor = rgba(col1, 0.6);
    c.shadowBlur = 18;
    roundedBar(c, x, mid - h, bw, h, bw / 2);
    // the reflection below
    c.shadowBlur = 0;
    c.fillStyle = rgba(col1, 0.16);
    roundedBar(c, x, mid + 6, bw, h * 0.45, bw / 2);
  }
  c.shadowBlur = 0;
}

function drawCircle(c, W, H, col1, col2) {
  const n = 96;
  const v = bands(n);
  const bass = (v[0] + v[1] + v[2] + v[3]) / 4;
  bassLevel = bassLevel * 0.7 + bass * 0.3;
  const cx = W / 2;
  const cy = H * 0.46;
  const base = Math.min(W, H) * 0.17 * (1 + bassLevel * 0.12);
  const len = Math.min(W, H) * 0.2;
  c.lineCap = "round";
  c.lineWidth = Math.max(3, (Math.PI * 2 * base) / n * 0.55);
  for (let i = 0; i < n; i++) {
    // mirrored, so the circle is even on both sides
    const k = i < n / 2 ? i : n - 1 - i;
    const val = v[Math.floor(k * 1.6) % n];
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r2 = base + 8 + val * len;
    const t = i / n;
    c.strokeStyle = rgba([col1[0] + (col2[0] - col1[0]) * Math.sin(t * Math.PI), col1[1] + (col2[1] - col1[1]) * Math.sin(t * Math.PI), col1[2] + (col2[2] - col1[2]) * Math.sin(t * Math.PI)], 0.9);
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * (base + 8), cy + Math.sin(a) * (base + 8));
    c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    c.stroke();
  }
  // the cover in the middle, beating with the bass
  c.save();
  c.shadowColor = rgba(col1, 0.7);
  c.shadowBlur = 30 + bassLevel * 40;
  c.beginPath();
  c.arc(cx, cy, base, 0, Math.PI * 2);
  c.fillStyle = "#111";
  c.fill();
  c.restore();
  c.save();
  c.beginPath();
  c.arc(cx, cy, base - 2, 0, Math.PI * 2);
  c.clip();
  if (artImg) {
    const s = Math.max((base * 2) / artImg.width, (base * 2) / artImg.height);
    c.drawImage(artImg, cx - (artImg.width * s) / 2, cy - (artImg.height * s) / 2, artImg.width * s, artImg.height * s);
  } else {
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, base);
    g.addColorStop(0, rgba(col2, 0.9));
    g.addColorStop(1, rgba(col1, 0.6));
    c.fillStyle = g;
    c.fillRect(cx - base, cy - base, base * 2, base * 2);
  }
  c.restore();
}

function drawWave(c, W, H, col1, col2) {
  let level = 0;
  if (analyser) {
    analyser.getByteTimeDomainData(wave);
    for (let i = 0; i < wave.length; i += 8) level += Math.abs(wave[i] - 128);
    level /= wave.length / 8 * 128;
  }
  const mid = H * 0.48;
  const amp = H * 0.32;
  const grad = c.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, rgba(col1, 0.95));
  grad.addColorStop(0.5, rgba(col2, 0.95));
  grad.addColorStop(1, rgba(col1, 0.95));
  const pass = (width, alpha, blur, offset) => {
    c.lineWidth = width;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = grad;
    c.globalAlpha = alpha;
    c.shadowColor = rgba(col1, 0.8);
    c.shadowBlur = blur;
    c.beginPath();
    const step = Math.max(1, Math.floor((wave?.length || 1024) / (W / 3)));
    const len = wave ? wave.length : 1024;
    for (let i = 0, k = 0; i < len; i += step, k++) {
      const x = (i / (len - 1)) * W;
      const v = wave ? (wave[i] - 128) / 128 : Math.sin(i / 60 + performance.now() / 600) * 0.05;
      const y = mid + v * amp * (1 + offset) + offset * 30;
      if (k === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  };
  pass(10, 0.18, 40, 0.35);
  pass(4, 0.95, 22, 0);
  c.globalAlpha = 1;
  c.shadowBlur = 0;
  return level;
}

function draw() {
  frame = requestAnimationFrame(draw);
  if (!canvas.width) sizeCanvas();
  const W = canvas.width;
  const H = canvas.height;
  const c = ctx2d;
  const col1 = accent();
  const col2 = partner(col1);
  // a slow fade instead of a clear leaves soft trails
  c.globalCompositeOperation = "source-over";
  c.fillStyle = mode === "wave" ? "rgba(0, 0, 0, 0.32)" : "rgba(0, 0, 0, 0.55)";
  c.fillRect(0, 0, W, H);
  if (mode === "bars") drawBars(c, W, H, col1, col2);
  else if (mode === "circle") drawCircle(c, W, H, col1, col2);
  else drawWave(c, W, H, col1, col2);
}

export function open({ push = true } = {}) {
  if (!root) build();
  ensureAudioGraph();
  if (actx && actx.state !== "running") actx.resume().catch(() => {});
  root.hidden = false;
  document.documentElement.classList.add("xn-modal-open", "mv-open");
  sizeCanvas();
  syncSong();
  syncPlaying();
  cancelAnimationFrame(frame);
  ctx2d.fillStyle = "#000";
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);
  draw();
  wake();
  $("mvClose").focus();
  if (push && location.hash !== "#visualizer") history.pushState({ mv: 1 }, "", "#visualizer");
}

export function close({ fromHistory = false } = {}) {
  if (!root || root.hidden) return;
  cancelAnimationFrame(frame);
  if (document.fullscreenElement) document.exitFullscreen?.();
  root.hidden = true;
  document.documentElement.classList.remove("xn-modal-open", "mv-open");
  if (!fromHistory && location.hash === "#visualizer") {
    if (history.state?.mv) history.back();
    else history.replaceState(history.state, "", location.pathname + location.search);
  }
  $("muVizBtn")?.focus();
}

// Song changes update the title and the cover in the middle.
new MutationObserver(() => root && !root.hidden && syncSong()).observe($("muTitle"), { childList: true, characterData: true, subtree: true });

window.addEventListener("popstate", () => {
  if (location.hash === "#visualizer") open({ push: false });
  else close({ fromHistory: true });
});

$("muVizBtn")?.addEventListener("click", () => open());
$("muNowViz")?.addEventListener("click", () => open());
if (location.hash === "#visualizer") {
  // Web Audio needs a tap first, so show it and start on the first touch.
  addEventListener("pointerdown", () => ensureAudioGraph() && actx.resume().catch(() => {}), { once: true });
  open({ push: false });
}

window.xnVisualizer = { open, close };
