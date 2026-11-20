// stats.js: the Stats page (/Stats, mommy 2026-11-20). Drug totals, the
// days you take things, your use by class (pie), spending, tolerance and
// what you added to the Forum, trip reports and the Pill Database.
// Data: GET /stats/api (every dose + activity numbers) and /achievements.
(() => {
  const $ = (id) => document.getElementById(id);
  const DAY = 86400000;
  const facts = window.xnFacts;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  // Monday first.
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const RANGE_KEY = "xn_stats_range";

  let data = null;
  let ach = null;
  let days = 0;
  let sortBy = "doses";
  let showAll = false;
  let currency = "kr";

  // ---------- Helpers ----------
  const low = (s) => String(s || "").toLowerCase().trim();
  const num = (v, max = 2) => Number(v).toLocaleString(undefined, { maximumFractionDigits: max });
  const pct = (v) => (v >= 0.1 || v === 0 ? Math.round(v * 100) : Math.round(v * 1000) / 10) + "%";
  function money(v) {
    const n = (Math.round(Number(v) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 });
    return /^[a-z]/i.test(currency) ? `${n} ${currency}` : `${currency}${n}`;
  }
  // Bigger units once the numbers get long: 1500 mg -> 1.5 g.
  function amount(sum, unit) {
    const u = String(unit || "").trim();
    if (u === "mg" && sum >= 1000) return num(sum / 1000) + " g";
    if ((u === "µg" || u === "ug" || u === "mcg") && sum >= 1000) return num(sum / 1000) + " mg";
    if (u === "ml" && sum >= 1000) return num(sum / 1000) + " l";
    return num(sum) + (u ? " " + u : "");
  }
  let classCache = null;
  function classOf(name) {
    if (!classCache) { try { classCache = JSON.parse(localStorage.getItem("gp-classes-3")) || {}; } catch (_) { classCache = {}; } }
    return classCache[low(name)] || (window.xnClass ? window.xnClass.keyFor({ name }) : "") || "";
  }
  const groupOf = (name) => (facts ? facts.classGroup(name, classOf(name)) : "other");
  const GROUPS = facts ? facts.CLASS_GROUPS : [["other", "Other", "#8a8a91"]];
  const groupInfo = (key) => GROUPS.find((g) => g[0] === key) || GROUPS[GROUPS.length - 1];
  const dayIndex = (d) => (d.day + 6) % 7;

  function inRange() {
    if (!data) return [];
    if (!days) return data.doses;
    const from = Date.now() - days * DAY;
    return data.doses.filter((d) => d.at >= from);
  }

  // ---------- Tooltip ----------
  const tip = $("stTip");
  function showTip(e, html) {
    if (!tip) return;
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14;
    let y = e.clientY - r.height - 12;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 14;
    if (x < 8) x = 8;
    if (y < 8) y = e.clientY + 18;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  const hideTip = () => { if (tip) tip.hidden = true; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function hover(node, html, onEnter, onLeave) {
    node.addEventListener("pointerenter", (e) => { showTip(e, html()); onEnter && onEnter(); });
    node.addEventListener("pointermove", (e) => showTip(e, html()));
    node.addEventListener("pointerleave", () => { hideTip(); onLeave && onLeave(); });
    node.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") showTip(e, html()); });
  }
  window.addEventListener("scroll", hideTip, { passive: true });

  // ---------- Table views ----------
  function table(key, head, rows) {
    const box = document.querySelector(`.st-table[data-for="${key}"]`);
    if (!box) return;
    box.textContent = "";
    const t = el("table");
    const tr = el("tr");
    head.forEach((h, i) => { const th = el("th", i ? "is-num" : "", h); th.scope = "col"; tr.append(th); });
    const thead = el("thead");
    thead.append(tr);
    const tb = el("tbody");
    rows.forEach((r) => {
      const row = el("tr");
      r.forEach((c, i) => row.append(el(i ? "td" : "th", i ? "is-num" : "", c)));
      tb.append(row);
    });
    t.append(thead, tb);
    box.append(t);
  }
  document.querySelectorAll(".st-tbtn").forEach((b) => {
    b.addEventListener("click", () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", String(on));
      const card = b.closest(".st-card");
      card.querySelector(`.st-table[data-for="${b.dataset.table}"]`).hidden = !on;
      card.querySelectorAll(".st-chart, .st-pie-wrap").forEach((c) => { if (!c.closest(".st-pie-wrap") || c.classList.contains("st-pie-wrap")) c.hidden = on; });
    });
  });

  // ---------- KPIs ----------
  function renderKpis(list, byName) {
    $("kDoses").textContent = num(list.length, 0);
    const spanDays = days || Math.max(1, (Date.now() - Math.min(...list.map((d) => d.at))) / DAY);
    $("kDosesSub").textContent = list.length ? "about " + num((list.length / spanDays) * 7, 1) + " a week" : "";
    $("kSubs").textContent = num(byName.length, 0);
    const top = [...byName].sort((a, b) => b.count - a.count)[0];
    $("kSubsSub").textContent = top ? "most: " + top.name : "";
    const spent = list.reduce((s, d) => s + (d.price || 0), 0);
    const priced = list.filter((d) => d.price > 0).length;
    $("kSpent").textContent = money(spent);
    if (!priced) $("kSpentSub").textContent = "no prices added yet";
    else {
      const m = new Date();
      const start = new Date(m.getFullYear(), m.getMonth(), 1).getTime();
      const month = list.filter((d) => d.at >= start).reduce((s, d) => s + (d.price || 0), 0);
      $("kSpentSub").textContent = money(month) + " this month";
    }
    const counts = new Array(7).fill(0);
    list.forEach((d) => counts[dayIndex(d)]++);
    const best = counts.indexOf(Math.max(...counts));
    $("kDay").textContent = list.length ? DAYS[best] + "s" : "None";
    $("kDaySub").textContent = list.length ? pct(counts[best] / list.length) + " of doses" : "";
  }

  // ---------- Drug totals ----------
  function groupByName(list) {
    const map = new Map();
    for (const d of list) {
      const k = low(d.name);
      let g = map.get(k);
      if (!g) { g = { name: d.name, count: 0, spent: 0, last: 0, units: new Map() }; map.set(k, g); }
      g.count++;
      g.spent += d.price || 0;
      if (d.at > g.last) { g.last = d.at; g.name = d.name; }
      const u = d.unit || "";
      g.units.set(u, (g.units.get(u) || 0) + (Number(d.amount) || 0));
    }
    return [...map.values()];
  }
  const amounts = (g) => [...g.units.entries()].filter(([, s]) => s > 0).map(([u, s]) => amount(s, u)).join(" + ");
  const dateText = (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });

  function renderTotals(byName) {
    const box = $("stTotals");
    box.textContent = "";
    const rows = [...byName].sort((a, b) =>
      sortBy === "spent" ? b.spent - a.spent || b.count - a.count : sortBy === "last" ? b.last - a.last : b.count - a.count || b.last - a.last);
    const max = Math.max(1, ...rows.map((g) => (sortBy === "spent" ? g.spent : g.count)));
    const shown = showAll ? rows : rows.slice(0, 10);
    for (const g of shown) {
      const li = el("li", "st-row");
      const key = classOf(g.name);
      const head = el("span", "st-row-name");
      if (window.xnClass) head.append(window.xnClass.icon(key, "st-ic", g.name));
      head.append(el("strong", "", g.name));
      const bar = el("span", "st-row-bar");
      const fill = el("i");
      const v = sortBy === "spent" ? g.spent : g.count;
      fill.style.width = Math.max(2, (v / max) * 100) + "%";
      fill.style.background = groupInfo(groupOf(g.name))[2];
      bar.append(fill);
      const meta = el("span", "st-row-meta");
      meta.append(el("b", "", g.count + (g.count === 1 ? " dose" : " doses")));
      const amt = amounts(g);
      if (amt) meta.append(el("span", "", amt));
      if (g.spent > 0) meta.append(el("span", "st-money", money(g.spent)));
      meta.append(el("span", "st-last", "last " + dateText(g.last)));
      li.append(head, bar, meta);
      box.append(li);
    }
    const more = $("stMore");
    more.hidden = rows.length <= 10;
    more.textContent = showAll ? "Show fewer" : "Show all " + rows.length;
  }
  document.querySelectorAll(".st-sort button").forEach((b) => {
    b.addEventListener("click", () => {
      sortBy = b.dataset.sort;
      document.querySelectorAll(".st-sort button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      render();
    });
  });
  $("stMore").addEventListener("click", () => { showAll = !showAll; render(); });

  // ---------- Days (bars) ----------
  function renderDays(list) {
    const box = $("stDays");
    box.textContent = "";
    const counts = new Array(7).fill(0);
    list.forEach((d) => counts[dayIndex(d)]++);
    const total = list.length || 1;
    const max = Math.max(1, ...counts);
    const best = counts.indexOf(max);
    $("stDaysSub").textContent = list.length ? `Most of your doses are on ${DAYS[best]}s (${pct(counts[best] / total)}).` : "No doses in this range.";
    const W = Math.max(260, box.clientWidth || 320);
    const H = 200;
    const padL = 30, padB = 26, padT = 18;
    const plotW = W - padL - 4;
    const plotH = H - padB - padT;
    const step = niceStep(max);
    const top = Math.ceil(max / step) * step;
    const s = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "st-svg" });
    for (let v = 0; v <= top; v += step) {
      const y = padT + plotH - (v / top) * plotH;
      s.append(svgEl("line", { x1: padL, x2: W - 4, y1: y, y2: y, class: v ? "st-grid-line" : "st-axis" }));
      const t = svgEl("text", { x: padL - 6, y: y + 3.5, class: "st-tick", "text-anchor": "end" });
      t.textContent = v;
      s.append(t);
    }
    const slot = plotW / 7;
    const bw = Math.min(44, slot * 0.62);
    counts.forEach((c, i) => {
      const x = padL + slot * i + (slot - bw) / 2;
      const h = (c / top) * plotH;
      const y = padT + plotH - h;
      if (c) {
        const r = Math.min(4, h / 2, bw / 2);
        // Rounded top, flat on the baseline.
        s.append(svgEl("path", { d: `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y + h}Z`, class: "st-bar" + (i === best ? " is-top" : "") }));
      }
      const lab = svgEl("text", { x: x + bw / 2, y: H - 8, class: "st-tick", "text-anchor": "middle" });
      lab.textContent = W < 380 ? DAYS[i][0] : DAYS[i].slice(0, 3);
      s.append(lab);
      if (i === best && c) {
        const v = svgEl("text", { x: x + bw / 2, y: y - 5, class: "st-val", "text-anchor": "middle" });
        v.textContent = c;
        s.append(v);
      }
      const hit = svgEl("rect", { x: padL + slot * i, y: padT, width: slot, height: plotH, class: "st-hit" });
      hover(hit, () => `<strong>${DAYS[i]}</strong><span>${c} ${c === 1 ? "dose" : "doses"} · ${pct(c / total)}</span>`);
      s.append(hit);
    });
    box.append(s);
    table("days", ["Day", "Doses", "Share"], counts.map((c, i) => [DAYS[i], String(c), pct(c / total)]));
  }
  function niceStep(max) {
    const raw = max / 4;
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
    const n = raw / p;
    return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p);
  }

  // ---------- Classes (pie) ----------
  function renderPie(list) {
    const box = $("stPie");
    const legend = $("stLegend");
    box.textContent = "";
    legend.textContent = "";
    const counts = new Map();
    list.forEach((d) => { const g = groupOf(d.name); counts.set(g, (counts.get(g) || 0) + 1); });
    const total = list.length;
    // Fixed order (each class keeps its color), "Other" last.
    const parts = GROUPS.map(([key, label, color]) => ({ key, label, color, n: counts.get(key) || 0 })).filter((p) => p.n);
    if (!total) { legend.append(el("li", "st-none", "No doses in this range.")); return; }
    const S = 200, R = 96, C = S / 2;
    const s = svgEl("svg", { viewBox: `0 0 ${S} ${S}`, class: "st-svg st-pie-svg" });
    let a0 = -Math.PI / 2;
    const slices = [];
    parts.forEach((p) => {
      const frac = p.n / total;
      let node;
      if (frac >= 0.9999) node = svgEl("circle", { cx: C, cy: C, r: R, fill: p.color, class: "st-slice" });
      else {
        const a1 = a0 + frac * Math.PI * 2;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const [x0, y0] = [C + R * Math.cos(a0), C + R * Math.sin(a0)];
        const [x1, y1] = [C + R * Math.cos(a1), C + R * Math.sin(a1)];
        node = svgEl("path", { d: `M${C},${C}L${x0},${y0}A${R},${R} 0 ${large} 1 ${x1},${y1}Z`, fill: p.color, class: "st-slice" });
        // Direct label on slices big enough to hold one.
        if (frac >= 0.1) {
          const mid = (a0 + a1) / 2;
          const t = svgEl("text", { x: C + R * 0.62 * Math.cos(mid), y: C + R * 0.62 * Math.sin(mid) + 4, class: "st-pie-label", "text-anchor": "middle" });
          t.textContent = pct(frac);
          slices.push(t);
        }
        a0 = a1;
      }
      const li = el("li", "st-leg");
      const sw = el("i", "st-sw");
      sw.style.background = p.color;
      li.append(sw, el("span", "st-leg-name", p.label), el("b", "st-leg-pct", pct(frac)), el("span", "st-leg-n", p.n + (p.n === 1 ? " dose" : " doses")));
      legend.append(li);
      const html = () => `<strong>${esc(p.label)}</strong><span>${pct(frac)} · ${p.n} ${p.n === 1 ? "dose" : "doses"}</span>`;
      const focus = () => { s.classList.add("is-focus"); node.classList.add("is-on"); li.classList.add("is-on"); };
      const blur = () => { s.classList.remove("is-focus"); node.classList.remove("is-on"); li.classList.remove("is-on"); };
      hover(node, html, focus, blur);
      li.addEventListener("pointerenter", focus);
      li.addEventListener("pointerleave", blur);
      s.append(node);
    });
    slices.forEach((t) => s.append(t));
    box.append(s);
    box.setAttribute("aria-label", "Pie chart: " + parts.map((p) => `${p.label} ${pct(p.n / total)}`).join(", "));
    table("classes", ["Class", "Doses", "Share"], parts.map((p) => [p.label, String(p.n), pct(p.n / total)]));
  }

  // ---------- Spending (bars) ----------
  function renderSpend(list, byName) {
    const box = $("stSpend");
    box.textContent = "";
    const priced = list.filter((d) => d.price > 0);
    const total = priced.reduce((s, d) => s + d.price, 0);
    const sub = $("stSpendSub");
    if (!priced.length) {
      sub.textContent = "";
      const p = el("p", "st-none");
      p.append("Add a price when you add a dose on the ", Object.assign(el("a", "", "Graph"), { href: "/" }), " and your spending shows up here.");
      box.append(p);
      table("spend", ["Substance", "Spent"], []);
      return;
    }
    sub.textContent = `${money(total)} in total. ${priced.length} of ${list.length} doses have a price.`;
    let rows = byName.filter((g) => g.spent > 0).sort((a, b) => b.spent - a.spent);
    if (rows.length > 8) {
      const rest = rows.slice(7);
      rows = rows.slice(0, 7).concat([{ name: `Other (${rest.length})`, spent: rest.reduce((s, g) => s + g.spent, 0), other: true }]);
    }
    const max = Math.max(...rows.map((g) => g.spent));
    const ul = el("ul", "st-hbars");
    rows.forEach((g) => {
      const li = el("li", "st-hbar");
      const bar = el("span", "st-hbar-track");
      const fill = el("i");
      fill.style.width = Math.max(2, (g.spent / max) * 100) + "%";
      bar.append(fill);
      li.append(el("span", "st-hbar-name", g.name), bar, el("b", "st-hbar-val", money(g.spent)));
      hover(li, () => `<strong>${esc(g.name)}</strong><span>${money(g.spent)} · ${pct(g.spent / total)} of spending</span>`);
      ul.append(li);
    });
    box.append(ul);
    table("spend", ["Substance", "Spent", "Share"], rows.map((g) => [g.name, money(g.spent), pct(g.spent / total)]));
  }

  // ---------- Tolerance ----------
  function renderTolerance() {
    const box = $("stTol");
    box.textContent = "";
    if (!facts || !data) return;
    const history = data.doses.map((d) => ({ name: d.name, at: d.at, amount: d.amount, common: d.common }));
    const recent = new Map();
    const since = Date.now() - 70 * DAY;
    data.doses.forEach((d) => { if (d.at >= since) recent.set(low(d.name), d.name); });
    const rows = [];
    for (const name of recent.values()) {
      const t = facts.tolerance(name, history, { classOf });
      if (t.own >= 0.05) rows.push({ name, t });
    }
    rows.sort((a, b) => b.t.own - a.t.own);
    if (!rows.length) { box.append(el("li", "st-none", "No tolerance right now. Everything is back to normal.")); return; }
    rows.slice(0, 8).forEach(({ name, t }) => {
      const li = el("li", "st-tol-row");
      const lv = t.own;
      const head = el("span", "st-tol-head");
      head.append(el("strong", "", name), el("b", "", Math.round(lv * 100) + "%"));
      const meter = el("span", "st-meter");
      meter.dataset.band = lv >= 0.66 ? "high" : lv >= 0.33 ? "mid" : "low";
      meter.style.setProperty("--lv", Math.round(lv * 100) + "%");
      meter.setAttribute("role", "meter");
      meter.setAttribute("aria-valuemin", "0");
      meter.setAttribute("aria-valuemax", "100");
      meter.setAttribute("aria-valuenow", String(Math.round(lv * 100)));
      meter.setAttribute("aria-label", name + " tolerance");
      meter.append(el("i"));
      const daysLeft = Math.max(0, Math.ceil((t.clearAt - Date.now()) / DAY));
      const note = el("span", "st-tol-note", daysLeft ? `Back to normal in about ${daysLeft} ${daysLeft === 1 ? "day" : "days"}.` : "Almost back to normal.");
      li.append(head, meter, note);
      box.append(li);
    });
  }

  // ---------- Community numbers ----------
  function nums(id, list) {
    const box = $(id);
    box.textContent = "";
    list.forEach(([label, value, sub]) => {
      const d = el("div", "st-num");
      d.append(el("dt", "", label), el("dd", "", value));
      if (sub) d.append(el("dd", "st-num-sub", sub));
      box.append(d);
    });
  }
  function renderCommunity() {
    const c = (data && data.counts) || {};
    const n = (v) => num(v || 0, 0);
    nums("stForum", [
      ["Posts", n(c.forumPosts)],
      ["Likes", n(c.reactionsReceived), "reactions on your posts"],
      ["Comments", n(c.commentsReceived), "on your posts"],
      ["Comments written", n(c.commentsWritten)],
      ["Helpful posts", n(c.helpfulPosts), "rated above 3.5"],
      ["Average rating", c.ratingsReceived ? num(c.ratingAverage, 1) + " / 5" : "None yet", c.ratingsReceived ? c.ratingsReceived + " ratings" : ""],
    ]);
    nums("stReports", [
      ["Reports", n(c.reports)],
      ["Likes", n(c.reportLikes)],
      ["Comments", n(c.reportComments), "on your reports"],
      ["Comments written", n(c.reportCommentsWritten)],
    ]);
    nums("stPills", [
      ["Contributions", n(c.pills), "pills you added"],
      ["Verified", n(c.pillsVerified), "checked by an admin"],
      ["Drug pictures", n(c.photos), "in the Drug Database"],
      ["Rated substances", n(c.tried), "in I've tried"],
    ]);
  }

  // ---------- Everything ----------
  function render() {
    if (!data) return;
    hideTip();
    const list = inRange();
    const byName = groupByName(list);
    const any = data.doses.length > 0;
    $("stKpis").hidden = !any;
    $("stEmpty").hidden = any;
    $("stGrid").hidden = false;
    document.querySelectorAll("#stGrid > .st-card").forEach((card) => {
      if (card.querySelector("#stForum, #stReports, #stPills, #stAch")) return;
      card.hidden = !any;
    });
    const first = data.doses.length ? Math.min(...data.doses.map((d) => d.at)) : 0;
    $("stRangeNote").textContent = !any ? "" : days ? `${list.length} ${list.length === 1 ? "dose" : "doses"} in the last ${days} days` : `Since ${new Date(first).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
    if (any) {
      renderKpis(list, byName);
      renderTotals(byName);
      renderDays(list);
      renderPie(list);
      renderSpend(list, byName);
      renderTolerance();
    }
    renderCommunity();
    if (ach && window.xnAch) window.xnAch.render($("stAch"), ach, { compact: true });
  }

  const ranges = [...document.querySelectorAll(".st-range button")];
  function setRange(d, save) {
    days = d;
    ranges.forEach((b) => b.setAttribute("aria-checked", String(Number(b.dataset.days) === d)));
    if (save) { try { localStorage.setItem(RANGE_KEY, String(d)); } catch (_) {} }
    render();
  }
  ranges.forEach((b, i) => {
    b.addEventListener("click", () => setRange(Number(b.dataset.days), true));
    b.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = ranges[(i + step + ranges.length) % ranges.length];
      next.focus();
      next.click();
    });
  });
  try { const saved = Number(localStorage.getItem(RANGE_KEY)); if ([30, 90, 365, 0].includes(saved)) days = saved; } catch (_) {}
  ranges.forEach((b) => b.setAttribute("aria-checked", String(Number(b.dataset.days) === days)));

  let resizeTimer = 0;
  let lastW = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (data) renderDays(inRange()); }, 150);
  });

  async function load() {
    const zone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (_) { return ""; } })();
    try {
      const res = await fetch("/stats/api?zone=" + encodeURIComponent(zone) + "&tz=" + new Date().getTimezoneOffset(), { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(String(res.status));
      data = await res.json();
      data.doses = (data.doses || []).filter((d) => d && d.name && d.at);
      currency = (window.xnLook && window.xnLook.get().currency) || data.currency || "kr";
      $("stLoading").hidden = true;
      render();
    } catch (err) {
      $("stLoading").hidden = true;
      $("stError").hidden = false;
      $("stError").textContent = "Couldn't load your stats. Check your connection and reload the page.";
      return;
    }
    if (window.xnAch) {
      try { ach = await window.xnAch.load(); render(); } catch (_) {}
    }
  }
  window.addEventListener("xn:look", () => {
    const c = window.xnLook && window.xnLook.get().currency;
    if (c !== undefined) { currency = c || "kr"; render(); }
  });
  load();
})();
