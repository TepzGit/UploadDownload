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
