// ============================================================
// plot.js
// Plotly rendering ONLY. Takes plain data produced by
// logic.computeTimeline() — never touches app state directly.
// ============================================================

let hasPlot = false;
let plotlyLoadPromise = null;

/**
 * Bonus: lazy-load Plotly instead of a blocking <script> tag in <head>.
 * Safe to call multiple times — the network request only happens once.
 */
export function loadPlotly() {
  if (window.Plotly) return Promise.resolve(window.Plotly);
  if (plotlyLoadPromise) return plotlyLoadPromise;

  plotlyLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/plotly-2.32.0.min.js";
    script.async = true;
    script.onload = () => resolve(window.Plotly);
    script.onerror = () => {
      plotlyLoadPromise = null; // offline: try again next time
      script.remove();
      reject(new Error("Plotly failed to load."));
    };
    document.head.appendChild(script);
  });

  return plotlyLoadPromise;
}

// ------------------------------------------------------------
// Graph style: each account can restyle the plot (Profile > Preferences).
// Saved on the server with the appearance settings and kept in
// localStorage so the Graph draws in it at once.
// ------------------------------------------------------------

export const PLOT_DEFAULTS = Object.freeze({
  v: 2,            // style version, 2 since the thicker line (older saves are scaled up)
  width: 9,        // line width in px (phones draw 1 px thinner)
  shape: "smooth", // "smooth" or "sharp"
  fill: 30,        // area under the line, 0-60 %
  glow: false,     // soft glow around the line
  grid: true,      // grid lines
  yLabels: true,   // intensity % on the left
  topHours: true,  // hour labels along the top too
  dots: true,      // a dot at each dose
  now: true,       // the white "now" line
  height: "normal" // "compact", "normal" or "tall"
});
const STYLE_KEY = "xn_plot_style";

/** Cleans a style object: unknown keys dropped, values kept in range. */
export function cleanPlotStyle(raw) {
  const s = { ...PLOT_DEFAULTS };
  if (!raw || typeof raw !== "object") return s;
  const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
  // Before version 2 the default line was 6 px, so older saved widths are
  // scaled up by half and a saved line gets thicker along with the default.
  const legacy = raw.v !== PLOT_DEFAULTS.v && raw.width != null;
  s.width = num(legacy ? Number(raw.width) * 1.5 : raw.width, 2, 20, s.width);
  s.fill = num(raw.fill, 0, 60, s.fill);
  if (raw.shape === "sharp" || raw.shape === "smooth") s.shape = raw.shape;
  if (["compact", "normal", "tall"].includes(raw.height)) s.height = raw.height;
  ["glow", "grid", "yLabels", "topHours", "dots", "now"].forEach((k) => {
    if (typeof raw[k] === "boolean") s[k] = raw[k];
  });
  return s;
}

export function plotStyle() {
  try {
    return cleanPlotStyle(JSON.parse(localStorage.getItem(STYLE_KEY) || "null"));
  } catch {
    return { ...PLOT_DEFAULTS };
  }
}

/** Keeps a style on this device and redraws the Graph (saving to the server is the caller's job). */
export function usePlotStyle(style) {
  const clean = cleanPlotStyle(style);
  try { localStorage.setItem(STYLE_KEY, JSON.stringify(clean)); } catch {}
  window.dispatchEvent(new CustomEvent("xn:plot-style", { detail: clean }));
  return clean;
}

// The last Graph drawn per container, so a style change or the zoom
// buttons can redraw it.
const drawn = {};

/**
 * Old name: drawChart() (trace/layout half only).
 * `timeline` is exactly what logic.computeTimeline() returns:
 * { x, y, hoverTimes, tickValues, tickText }
 * Options: live (now line), starts (dose dots), tools (zoom buttons),
 * style (a plot style instead of the account's, for previews).
 */
export async function renderPlot(timeline, containerId = "myPlot", { live = false, starts = [], tools = containerId === "myPlot", style = null } = {}) {
  const Plotly = await loadPlotly();
  const container = document.getElementById(containerId);
  if (!container) return;
  const look = style ? cleanPlotStyle(style) : plotStyle();
  drawn[containerId] = { timeline, opts: { live, starts, tools, style } };
  container.dataset.plotH = look.height;
  const narrow = (container.clientWidth || window.innerWidth) < 560;

  const tickValues = timeline.tickValues;
  const first = timeline.x[0];
  const last = timeline.x[timeline.x.length - 1];
  // A little room on both sides so the whole curve, its rounded ends and
  // the dose dots are always in view.
  const pad = Math.max(0.5, (last - first) * 0.1);
  const full = [first - pad, last + pad];
  // Room above the highest point and below 0% so the curve never fills the box edge to edge.
  const top = Math.max(100, ...timeline.series.flatMap((series) => series.y.filter(Number.isFinite)));
  const yTop = top * 1.3;
  const yBottom = -top * 0.07; // the line at 0% sits a bit above the bottom edge
  const yStep = top > 300 ? 100 : top > 150 ? 50 : 25;
  const width = Math.max(1, look.width - (narrow ? 1 : 0));

  const traces = timeline.series.map((series) => ({
    x: timeline.x,
    y: series.y,
    name: series.name,
    mode: "lines",
    type: "scatter",
    hovertext: timeline.hoverTimes,
    hovertemplate: `${series.name}<br>Time: %{hovertext}<br>Relative intensity: %{y:.0f}%<extra></extra>`,
    line: look.shape === "sharp" ? { color: series.color, width, shape: "linear" } : { color: series.color, width, shape: "spline", smoothing: 0.35 },
    fill: look.fill > 0 ? "tozeroy" : "none",
    fillcolor: hexToRgba(series.color, (look.fill / 100) * (timeline.series.length > 1 ? 0.55 : 1)),
  }));
  const multi = traces.length > 1;
  // Glow: a wide, faint copy of each line underneath it.
  if (look.glow) {
    const glows = timeline.series.map((series, i) => ({
      x: timeline.x,
      y: series.y,
      mode: "lines",
      type: "scatter",
      line: { ...traces[i].line, width: width * 2.6, color: hexToRgba(series.color, 0.25) },
      hoverinfo: "skip",
      showlegend: false,
    }));
    traces.unshift(...glows);
  }
  // A dot on the baseline at each dose: { x: hour on the timeline, color }.
  if (look.dots) {
    starts.forEach((start) => {
      traces.push({
        x: [start.x],
        y: [0],
        mode: "markers",
        type: "scatter",
        marker: { color: start.color, size: Math.max(narrow ? 13 : 14, width + 6) },
        cliponaxis: false,
        hoverinfo: "skip",
        showlegend: false,
      });
    });
  }
  // Hour labels along the top as well as the bottom.
  if (look.topHours) traces.push({ x: [first, last], y: [0, 0], xaxis: "x2", mode: "lines", line: { width: 0 }, hoverinfo: "skip", showlegend: false });
  const plotWidth = Math.max(200, (container.clientWidth || window.innerWidth) - (narrow ? 72 : 100));
  const hourAxis = {
    tickmode: "array",
    tickvals: tickValues,
    ticktext: hourLabels(timeline, full, plotWidth, narrow),
    ticks: "",
    showgrid: false,
    zeroline: false,
    showline: false,
    tickfont: { color: "#f5f3fa", size: narrow ? 12 : 13 },
  };

  const layout = {
    margin: narrow ? { t: look.topHours ? 30 : 12, r: 12, b: 30, l: look.yLabels ? 40 : 12 } : { t: look.topHours ? 34 : 14, r: 18, b: 34, l: look.yLabels ? 48 : 14 },
    autosize: true,
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "Roboto Mono, monospace", size: narrow ? 10 : 12, color: "#9c96aa" },
    dragmode: container.dataset.plotMove === "1" ? "pan" : false,
    // Zoom and pan survive redraws (the now line moves every minute) until
    // the doses on the graph change.
    uirevision: `${first}|${last}|${timeline.series.length}`,
    hoverlabel: { bgcolor: "#000000", bordercolor: "#2f2a3a", font: { color: "#f5f3fa" } },
    xaxis: { ...hourAxis, range: full, showgrid: look.grid, gridcolor: "rgba(255,255,255,0.05)", fixedrange: !tools },
    xaxis2: { ...hourAxis, overlaying: "x", side: "top", anchor: "y", matches: "x" },
    // Intensity in percent of one common dose, labelled on the left.
    yaxis: {
      range: [yBottom, yTop],
      tickmode: "linear",
      tick0: 0,
      dtick: yStep,
      ticksuffix: "%",
      showticklabels: look.yLabels,
      tickfont: { color: "#9c96aa", size: narrow ? 10 : 11 },
      showgrid: look.grid,
      gridcolor: "rgba(255,255,255,0.05)",
      zeroline: false,
      fixedrange: true,
      automargin: true,
    },
    showlegend: multi,
    legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", font: { color: "#f5f3fa" }, bgcolor: "rgba(0,0,0,0)" },
    hovermode: multi ? "x unified" : "closest",
  };
  if (multi) {
    layout.margin.t = (look.topHours ? 0 : -20) + (narrow ? 58 : 62);
    layout.legend.y = narrow ? 1.12 : 1.06;
  }
  if (live && look.now) addNowLine(layout, timeline, narrow);

  await Plotly.react(containerId, traces, layout, {
    displayModeBar: false,
    responsive: true,
    scrollZoom: tools && container.dataset.plotMove === "1",
    doubleClick: tools ? "reset" : false,
  });
  hasPlot = true;
  if (tools) setupTools(container, full, timeline, plotWidth, narrow, [yBottom, yTop], yStep);
}

/** Hour labels (like a clock: 12 13 14 ... 00), thinned out to fit the visible range. */
function hourLabels(timeline, range, plotWidth, narrow) {
  const visible = timeline.tickValues.filter((v) => v >= range[0] && v <= range[1]).length || 1;
  const maxLabels = Math.max(2, Math.floor(plotWidth / (narrow ? 27 : 36)));
  const every = Math.max(1, Math.ceil(visible / maxLabels));
  return timeline.tickText.map((text, index) => (index % every !== 0 ? "" : text.split(" ")[0].slice(0, 2)));
}

// ------------------------------------------------------------
// Plot controls: zoom in/out, fit, move (drag to pan), full screen, save.
// ------------------------------------------------------------

const TOOL_ICONS = {
  in: '<path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v6M8 11h6"/>',
  out: '<path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  expand: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>',
  shrink: '<path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/>',
  save: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
};

function setupTools(container, full, timeline, plotWidth, narrow, yFull, yStep) {
  const state = container._xnTools || (container._xnTools = {});
  state.full = full;
  state.yFull = yFull;
  state.yStep = yStep;
  state.timeline = timeline;
  state.plotWidth = plotWidth;
  state.narrow = narrow;
  if (!state.bar) {
    const bar = document.createElement("div");
    bar.className = "plot-tools";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Graph controls");
    const button = (key, label, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "plot-tool";
      b.dataset.tool = key;
      b.title = label;
      b.setAttribute("aria-label", label);
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${TOOL_ICONS[key]}</svg>`;
      b.addEventListener("click", onClick);
      bar.append(b);
      return b;
    };
    button("out", "Zoom out", () => zoomBy(container, 1 / 0.6));
    button("in", "Zoom in", () => zoomBy(container, 0.6));
    button("fit", "Show the whole graph", () => setRange(container, state.full));
    state.move = button("move", "Drag to move", () => {
      const on = container.dataset.plotMove !== "1";
      container.dataset.plotMove = on ? "1" : "";
      state.move.setAttribute("aria-pressed", String(on));
      redraw(container.id);
    });
    state.move.setAttribute("aria-pressed", "false");
    state.expand = button("expand", "Full screen", () => toggleExpand(container));
    button("save", "Save as picture", () => savePicture(container));
    container.after(bar);
    state.bar = bar;
    // Labels follow the zoom.
    container.on?.("plotly_relayout", (ev) => {
      if (!ev || !Object.keys(ev).some((k) => k.startsWith("xaxis.range") || k === "xaxis.autorange")) return;
      const range = container._fullLayout?.xaxis?.range || state.full;
      const text = hourLabels(state.timeline, range, state.plotWidth, state.narrow);
      window.Plotly.relayout(container, { "xaxis.ticktext": text, "xaxis2.ticktext": text });
    });
  }
  state.bar.hidden = false;
}

// Past the whole graph the curve shrinks in height too, so zooming out
// leaves room around it on every side.
function setRange(container, range) {
  const state = container._xnTools;
  const update = { "xaxis.range": range };
  if (state?.yFull) {
    const z = Math.max(1, (range[1] - range[0]) / (state.full[1] - state.full[0]));
    update["yaxis.range"] = [state.yFull[0] * z, state.yFull[1] * z];
    update["yaxis.dtick"] = state.yStep * Math.ceil(z);
  }
  window.Plotly.relayout(container, update);
}

function zoomBy(container, factor) {
  const state = container._xnTools;
  const [a, b] = container._fullLayout?.xaxis?.range || state.full;
  const center = (a + b) / 2;
  const fullSpan = state.full[1] - state.full[0];
  // Up to 4x the whole graph when zooming out.
  const half = Math.min(fullSpan * 2, Math.max(0.25, ((b - a) / 2) * factor));
  if (half >= fullSpan / 2) {
    // Wider than the graph: keep it in the middle.
    const mid = (state.full[0] + state.full[1]) / 2;
    return setRange(container, [mid - half, mid + half]);
  }
  let lo = center - half, hi = center + half;
  if (lo < state.full[0]) { hi += state.full[0] - lo; lo = state.full[0]; }
  if (hi > state.full[1]) { lo -= hi - state.full[1]; hi = state.full[1]; }
  setRange(container, [Math.max(state.full[0], lo), Math.min(state.full[1], hi)]);
}

// The graph as it looks on screen (same shape, 2x sharp) on the page's dark
// background; Plotly alone would save it on white.
async function savePicture(container) {
  const w = container.clientWidth || 800;
  const h = container.clientHeight || 400;
  try {
    const url = await window.Plotly.toImage(container, { format: "png", width: w, height: h, scale: 2 });
    const img = new Image();
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0a0a0c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const a = document.createElement("a");
    a.download = "geek4u-graph.png";
    a.href = canvas.toDataURL("image/png");
    document.body.append(a);
    a.click();
    a.remove();
  } catch {
    window.Plotly.downloadImage(container, { format: "png", filename: "geek4u-graph", width: w, height: h, scale: 2 });
  }
}

function toggleExpand(container) {
  const card = container.closest("section") || container.parentElement;
  const on = !card.classList.contains("plot-expanded");
  card.classList.toggle("plot-expanded", on);
  document.documentElement.classList.toggle("plot-expanded-open", on);
  const state = container._xnTools;
  state.expand.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${TOOL_ICONS[on ? "shrink" : "expand"]}</svg>`;
  state.expand.title = on ? "Leave full screen" : "Full screen";
  state.expand.setAttribute("aria-label", state.expand.title);
  const onKey = (e) => {
    if (e.key === "Escape") toggleExpand(container);
  };
  if (on) {
    state.onKey = onKey;
    document.addEventListener("keydown", onKey);
  } else if (state.onKey) {
    document.removeEventListener("keydown", state.onKey);
  }
  requestAnimationFrame(() => redraw(container.id));
}

function redraw(containerId) {
  const last = drawn[containerId];
  if (last && document.getElementById(containerId)) renderPlot(last.timeline, containerId, last.opts);
}

window.addEventListener("xn:plot-style", () => {
  Object.keys(drawn).forEach((id) => {
    if (!drawn[id].opts.style) redraw(id);
  });
});

/**
 * The white "now" line: where the clock is on the timeline, with the
 * stretch since the first dose softly lit and the time passed as a label.
 * The x axis is clock hours (past midnight it runs on as 24, 25, ...), so the
 * clock is tried as is and a day later. Nothing is drawn when now is before
 * the first dose or after everything wore off.
 */
function addNowLine(layout, timeline, narrow) {
  if (!timeline.x.length) return;
  const clock = new Date();
  const hours = clock.getHours() + clock.getMinutes() / 60 + clock.getSeconds() / 3600;
  const first = timeline.x[0];
  const last = timeline.x[timeline.x.length - 1];
  const now = [hours, hours + 24].find((h) => h >= first && h <= last);
  if (now === undefined) return;
  const passed = Math.round((now - first) * 60);
  const h = Math.floor(passed / 60);
  const m = passed % 60;
  const label = h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
  layout.shapes = [
    { type: "rect", xref: "x", yref: "paper", x0: first, x1: now, y0: 0, y1: 1, fillcolor: "rgba(255,255,255,0.045)", line: { width: 0 }, layer: "below" },
    { type: "line", xref: "x", yref: "paper", x0: now, x1: now, y0: 0, y1: 1, line: { color: "#ffffff", width: 2 } },
  ];
  layout.annotations = [{
    x: now,
    xref: "x",
    y: 1,
    yref: "paper",
    yanchor: "top",
    xanchor: now - first > (last - first) * 0.75 ? "right" : "left",
    xshift: now - first > (last - first) * 0.75 ? -4 : 4,
    text: `<b>Now</b> · ${label} since dose`,
    showarrow: false,
    font: { color: "#ffffff", size: narrow ? 10 : 11 },
    bgcolor: "rgba(0,0,0,0.75)",
    borderpad: 3,
  }];
}

function hexToRgba(hex, alpha) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** Old name: clearChart(). */
export function clearPlot(containerId = "myPlot") {
  if (hasPlot && window.Plotly) {
    window.Plotly.purge(containerId);
  }
  hasPlot = false;
  delete drawn[containerId];
  const tools = document.getElementById(containerId)?._xnTools;
  if (tools?.bar) tools.bar.hidden = true;
  if (tools && document.getElementById(containerId).closest(".plot-expanded")) toggleExpand(document.getElementById(containerId));
}

/** Old name: the resize handler's Plotly.Plots.resize call. */
export function resizePlot(containerId = "myPlot") {
  if (hasPlot && window.Plotly) {
    window.Plotly.Plots.resize(containerId);
  }
}

export function isPlotVisible() {
  return hasPlot;
}
