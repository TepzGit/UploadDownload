// Profile > Preferences > Graph style. Shows a small graph drawn by the same
// code as the Graph page (js/plot.js) and saves the choices with the
// account's appearance settings (/profile/appearance).

const $ = (id) => document.getElementById(id);
const form = $("psForm");
const preview = $("psPreview");

if (form && preview) {
  let plot = null;
  let style = null;
  let saveTimer = 0;
  let drawTimer = 0;
  let sample = null;

  const accent = () => {
    const rgb = getComputedStyle(document.documentElement).getPropertyValue("--xn-accent-rgb").trim();
    const parts = rgb.split(",").map((n) => Number(n.trim()));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return "#a67cff";
    return "#" + parts.map((n) => n.toString(16).padStart(2, "0")).join("");
  };

  // One made-up dose at 20:00, curved like a real one.
  async function sampleTimeline() {
    if (sample) return sample;
    const { effectCurve } = await import("/curve.js");
    const curve = effectCurve({ onset: 0.4, comeup: 0.8, peak: 2, comedown: 1.2, comedownLevel: 0.45, offset: 2.4 }, 20, 1, 0.05);
    const ticks = [];
    for (let h = 20; h <= Math.ceil(curve.x[curve.x.length - 1]); h += 1) ticks.push(h);
    const clock = (h) => {
      const mins = Math.round(h * 60);
      return String(Math.floor(mins / 60) % 24).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
    };
    sample = {
      x: curve.x,
      hoverTimes: curve.x.map(clock),
      tickValues: ticks,
      tickText: ticks.map((h) => clock(h) + " "),
      series: [{ name: "Example", color: accent(), y: curve.y }],
    };
    return sample;
  }

  async function draw() {
    if (!plot) return;
    const timeline = await sampleTimeline();
    preview.querySelector(".pf-note")?.remove();
    await plot.renderPlot(timeline, "psPreview", { live: false, starts: [{ x: 20, color: timeline.series[0].color }], tools: false, style });
  }

  function paint() {
    $("psWidth").value = style.width;
    $("psWidthOut").textContent = style.width + " px";
    $("psFill").value = style.fill;
    $("psFillOut").textContent = style.fill + "%";
    [$("psWidth"), $("psFill")].forEach((r) => r.style.setProperty("--fill", ((r.value - r.min) / (r.max - r.min)) * 100 + "%"));
    form.querySelectorAll(".ps-seg").forEach((seg) => {
      seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(style[seg.dataset.key] === b.dataset.value)));
    });
    form.querySelectorAll('input[type="checkbox"][data-key]').forEach((box) => (box.checked = !!style[box.dataset.key]));
  }

  function changed() {
    style = plot.cleanPlotStyle(style);
    paint();
    clearTimeout(drawTimer);
    drawTimer = setTimeout(draw, 60);
    plot.usePlotStyle(style);
    $("psStatus").textContent = "";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
  }

  async function save() {
    try {
      const res = await fetch("/profile/appearance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plotStyle: style }),
      });
      if (!res.ok) throw new Error((await res.text()).trim());
      $("psStatus").textContent = "Saved.";
    } catch (error) {
      $("psStatus").textContent = error.message || "Couldn't save the graph style.";
    }
  }

  async function start() {
    if (plot) return draw();
    try {
      plot = await import("/plot.js");
    } catch {
      preview.innerHTML = '<p class="pf-note">The preview couldn\'t load.</p>';
      return;
    }
    style = plot.plotStyle();
    paint();
    draw();
  }

  $("psWidth").addEventListener("input", (e) => { style.width = Number(e.target.value); changed(); });
  $("psFill").addEventListener("input", (e) => { style.fill = Number(e.target.value); changed(); });
  form.querySelectorAll(".ps-seg").forEach((seg) => {
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-value]");
      if (!b || !style) return;
      style[seg.dataset.key] = b.dataset.value;
      changed();
    });
  });
  form.querySelectorAll('input[type="checkbox"][data-key]').forEach((box) => {
    box.addEventListener("change", () => {
      if (!style) return;
      style[box.dataset.key] = box.checked;
      changed();
    });
  });
  $("psReset").addEventListener("click", () => {
    if (!plot) return;
    style = { ...plot.PLOT_DEFAULTS };
    changed();
  });

  // Drawn when Preferences opens (Plotly only loads then).
  $("PRB")?.addEventListener("click", () => setTimeout(start, 260));
  if ($("PR")?.classList.contains("open")) start();
}
