// ============================================================
// curve.js
// The shape of one dose's effect over time, shared by the Graph
// (logic.js) and the admin Substances Importer preview, so the
// preview is exactly what the Graph will draw.
//
// base (all in hours):
//   onset, comeup, peak, offset   - every substance (PsychonautWiki's four)
//   comedown, comedownLevel       - optional: after the peak the effect first
//                                   eases to comedownLevel (0-1, share of the
//                                   peak) over `comedown`, then offset takes it to 0
//   peak2 { gap, dip, duration, level }
//                                 - optional second peak: `gap` hours after the
//                                   first peak ends (falling to `dip`, then rising
//                                   again), it holds at `level` for `duration`
//   shape                         - optional: "smooth" draws one soft curve that
//                                   rises and falls through the same times
//                                   (top in the middle of the peak) instead of
//                                   straight lines with a flat peak
// ============================================================

/** Phases in order: { name, hours, from, to } with levels 0-1. */
export function effectPhases(base) {
  const b = base || {};
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  const share = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
  };
  const phases = [
    { name: "onset", hours: num(b.onset), from: 0, to: 0 },
    { name: "comeup", hours: num(b.comeup), from: 0, to: 1 },
    { name: "peak", hours: num(b.peak), from: 1, to: 1 },
  ];
  let level = 1;
  const p2 = b.peak2;
  if (p2 && num(p2.duration) > 0) {
    const second = share(p2.level, 1) || 1;
    const dip = Math.min(share(p2.dip, 0.5), 1, second);
    const gap = num(p2.gap);
    phases.push({ name: "dip", hours: gap / 2, from: 1, to: dip });
    phases.push({ name: "rise2", hours: gap / 2, from: dip, to: second });
    phases.push({ name: "peak2", hours: num(p2.duration), from: second, to: second });
    level = second;
  }
  if (num(b.comedown) > 0) {
    const down = Math.min(level, share(b.comedownLevel, 0.35) * level);
    phases.push({ name: "comedown", hours: num(b.comedown), from: level, to: down });
    level = down;
  }
  phases.push({ name: "offset", hours: num(b.offset), from: level, to: 0 });
  return phases;
}

/** Total length of the effect in hours. */
export function effectHours(base) {
  return effectPhases(base).reduce((sum, p) => sum + p.hours, 0);
}

/**
 * Points of the curve from startHour, scaled so a level of 1 is 100 * intensity.
 * step = hours between points.
 */
export function effectCurve(base, startHour, intensity, step) {
  if (base?.shape === "smooth") return smoothCurve(base, startHour, intensity, step);
  const x = [startHour];
  const y = [0];
  let cursor = startHour;
  effectPhases(base).forEach((phase) => {
    if (phase.hours <= 0) return;
    const count = Math.max(1, Math.ceil(phase.hours / step));
    for (let index = 1; index <= count; index += 1) {
      const progress = index / count;
      x.push(cursor + phase.hours * progress);
      y.push(Math.max(0, (phase.from + (phase.to - phase.from) * progress) * 100 * intensity));
    }
    cursor += phase.hours;
  });
  return { x, y };
}

/**
 * The key points of a smooth curve, [hours, level]: flat until the onset ends,
 * the top in the middle of each peak, the dip between two peaks, where the
 * come-down ends, and 0 at the very end. Flat stretches become single points.
 */
function smoothPoints(base) {
  const pts = [[0, 0]];
  let at = 0;
  let pendingTop = null;
  effectPhases(base).forEach((p) => {
    const start = at;
    at += p.hours;
    if (p.hours <= 0) return;
    if (p.name === "onset") pts.push([at, 0]);
    else if (p.name === "peak" || p.name === "peak2") pts.push([start + p.hours / 2, p.from]);
    else if (p.name === "dip") pendingTop = [at, p.to];
    else if (p.name === "rise2" && pendingTop) {
      pts.push([pendingTop[0], pendingTop[1]]);
      pendingTop = null;
    } else if (p.name === "comedown") pts.push([at, p.to]);
  });
  if (pendingTop) pts.push(pendingTop);
  // Nothing marks the top when the peak has no length: it's where the come-up ends.
  if (!pts.some(([, y]) => y > 0)) {
    const ph = effectPhases(base);
    const top = ph.slice(0, 2).reduce((s, p) => s + p.hours, 0);
    pts.push([top, 1]);
  }
  pts.push([at, 0]);
  return pts.filter((p, i) => i === 0 || p[0] > pts[i - 1][0] + 1e-9);
}

/** effectCurve for shape "smooth": a monotone cubic through smoothPoints (no overshoot). */
function smoothCurve(base, startHour, intensity, step) {
  const pts = smoothPoints(base);
  const n = pts.length;
  const x = [startHour];
  const y = [0];
  if (n < 2) return { x, y };
  const h = [], d = [];
  for (let i = 0; i < n - 1; i += 1) {
    h.push(pts[i + 1][0] - pts[i][0]);
    d.push((pts[i + 1][1] - pts[i][1]) / h[i]);
  }
  // Slopes (Fritsch-Carlson): flat at the ends, tops and bottoms.
  const m = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i += 1) {
    if (d[i - 1] * d[i] <= 0) continue;
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  for (let i = 0; i < n - 1; i += 1) {
    const count = Math.max(1, Math.ceil(h[i] / step));
    const [x0, y0] = pts[i], y1 = pts[i + 1][1];
    for (let k = 1; k <= count; k += 1) {
      const t = k / count, t2 = t * t, t3 = t2 * t;
      const level = (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h[i] * m[i + 1];
      x.push(startHour + x0 + h[i] * t);
      y.push(Math.max(0, level * 100 * intensity));
    }
  }
  return { x, y };
}
