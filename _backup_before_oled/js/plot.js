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
export async function renderPlot(timeline, containerId = "myPlot") {
  const Plotly = await loadPlotly();

  const trace = {
    x: timeline.x,
    y: timeline.y,
    mode: "lines",
    type: "scatter",
    hovertext: timeline.hoverTimes,
    hovertemplate: "Time: %{hovertext}<br>Relative intensity: %{y:.0f}%<extra></extra>",
    line: { color: "#a67cff", width: 3, shape: "spline", smoothing: 0.65 },
    fill: "tozeroy",
    fillcolor: "rgba(139, 92, 246, 0.18)",
  };

  const layout = {
    margin: { t: 16, r: 18, b: 48, l: 52 },
    autosize: true,
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "nerd, monospace", size: 12, color: "#9894a4" },
    hoverlabel: { bgcolor: "#1a1720", bordercolor: "#3a3345", font: { color: "#f6f2ff" } },
    xaxis: {
      tickmode: "array",
      tickvals: timeline.tickValues,
      ticktext: timeline.tickText,
      gridcolor: "rgba(255,255,255,0.055)",
      zeroline: false,
      fixedrange: true,
    },
    yaxis: {
      title: { text: "Relative intensity", font: { size: 11 } },
      rangemode: "tozero",
      gridcolor: "rgba(255,255,255,0.055)",
      zeroline: false,
      fixedrange: true,
    },
    showlegend: false,
  };

  await Plotly.react(containerId, [trace], layout, { displayModeBar: false, responsive: true });
  hasPlot = true;
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
