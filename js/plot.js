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
    script.src = "https://cdn.plot.ly/plotly-2.32.0.min.js";
    script.async = true;
    script.onload = () => resolve(window.Plotly);
    script.onerror = () => reject(new Error("Plotly failed to load."));
    document.head.appendChild(script);
  });

  return plotlyLoadPromise;
}

/**
 * Old name: drawChart() (trace/layout half only).
 * `timeline` is exactly what logic.computeTimeline() returns:
 * { x, y, hoverTimes, tickValues, tickText }
 */
export async function renderPlot(timeline, containerId = "myPlot", { live = false } = {}) {
  const Plotly = await loadPlotly();
  const container = document.getElementById(containerId);
  const narrow = (container?.clientWidth || window.innerWidth) < 560;

  // Keep a grid line on every tick (one per hour). Labels drop the "+1d"
  // day suffix except at midnight, and some are blanked out when there
  // isn't room for all of them.
  const tickValues = timeline.tickValues;
  const plotWidth = Math.max(200, (container?.clientWidth || window.innerWidth) - (narrow ? 44 : 70));
  const maxLabels = Math.max(2, Math.floor(plotWidth / (narrow ? 38 : 46)));
  const labelEvery = Math.max(1, Math.ceil(tickValues.length / maxLabels));
  const tickText = timeline.tickText.map((text, index) => {
    if (index % labelEvery !== 0) return "";
    const [time, day] = text.split(" ");
    return day && time === "00:00" ? `${time}<br>${day}` : time;
  });

  const traces = timeline.series.map((series) => ({
    x: timeline.x,
    y: series.y,
    name: series.name,
    mode: "lines",
    type: "scatter",
    hovertext: timeline.hoverTimes,
    hovertemplate: `${series.name}<br>Time: %{hovertext}<br>Relative intensity: %{y:.0f}%<extra></extra>`,
    line: { color: series.color, width: 3, shape: "spline", smoothing: 0.65 },
    fill: "tozeroy",
    fillcolor: hexToRgba(series.color, timeline.series.length > 1 ? 0.12 : 0.18),
  }));
  const multi = traces.length > 1;

  const layout = {
    margin: narrow ? { t: 8, r: 10, b: 44, l: 34 } : { t: 16, r: 18, b: 52, l: 52 },
    autosize: true,
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "Roboto Mono, monospace", size: narrow ? 10 : 12, color: "#9c96aa" },
    dragmode: false,
    hoverlabel: { bgcolor: "#000000", bordercolor: "#2f2a3a", font: { color: "#f5f3fa" } },
    xaxis: {
      tickmode: "array",
      tickvals: tickValues,
      ticktext: tickText,
      gridcolor: "rgba(255,255,255,0.07)",
      zeroline: false,
      fixedrange: true,
    },
    yaxis: {
      title: narrow ? undefined : { text: "Relative intensity", font: { size: 11 } },
      rangemode: "tozero",
      gridcolor: "rgba(255,255,255,0.07)",
      zeroline: false,
      fixedrange: true,
    },
    showlegend: multi,
    legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", font: { color: "#f5f3fa" }, bgcolor: "rgba(0,0,0,0)" },
    hovermode: multi ? "x unified" : "closest",
  };
  if (multi) layout.margin.t = narrow ? 36 : 40;
  if (live) addNowLine(layout, timeline, narrow);

  await Plotly.react(containerId, traces, layout, { displayModeBar: false, responsive: true, scrollZoom: false });
  hasPlot = true;
}

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
