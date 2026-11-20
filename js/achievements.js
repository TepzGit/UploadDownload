// achievements.js: the Achievements wall (mommy 2026-11-20). Profile, /u/
// and the Stats page draw it from GET /achievements (?user=<name>).
// window.xnAch.load(user) -> {items, got, total}; window.xnAch.render(box, data, {compact, got}).
(() => {
  // Line icons on a 24 grid, drawn with the tile's text color.
  const ICONS = {
    graph: '<path d="M4 4v15a1 1 0 0 0 1 1h15"/><path d="M7.5 15l3.8-5 3 3 4.7-6"/>',
    note: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 8h6M9 12h6M9 16h3.5"/>',
    coin: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><rect x="9" y="9.5" width="6" height="5" rx="1.5"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    chat: '<path d="M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 3.5v-3.5H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z"/>',
    badge: '<path d="M12 3l7 3v5.5c0 4.3-3 8-7 9.5-4-1.5-7-5.2-7-9.5V6z"/><path d="M9 12l2 2 4-4"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
    pill: '<rect x="2.8" y="8.5" width="18.4" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="M8.7 8.7l6.6 6.6"/>',
    book: '<path d="M5 4.5h12.5A1.5 1.5 0 0 1 19 6v14H6.5A1.5 1.5 0 0 1 5 18.5z"/><path d="M5 17h14M9 8.5h6"/>',
    flask: '<path d="M9.5 3.5h5M10.5 3.5v5.5l-5 8.6a1.6 1.6 0 0 0 1.4 2.4h10.2a1.6 1.6 0 0 0 1.4-2.4l-5-8.6V3.5"/><path d="M7.6 14.5h8.8"/>',
    check: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 12.3l2.8 2.7L16 9.5"/>',
    camera: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8.5 7l1.5-2.5h4L15.5 7"/><rect x="9" y="10.5" width="6" height="6" rx="2"/>',
    people: '<rect x="5.5" y="3.5" width="7" height="7" rx="2.5"/><path d="M3 20c.5-3.6 2.8-5.5 6-5.5s5.5 1.9 6 5.5"/><rect x="15" y="5.5" width="5" height="5" rx="2"/><path d="M16.5 14.6c2.4.3 3.9 2.1 4.3 5.4"/>',
    level: '<path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><path d="M8.5 13.5l3.5-3.5 3.5 3.5"/>',
    crown: '<path d="M3.5 8l4.5 4 4-6.5 4 6.5 4.5-4-1.5 10.5h-14z"/>',
  };
  const svg = (key) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[key] || ICONS.star) + "</svg>";
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  async function load(user) {
    const res = await fetch("/achievements" + (user ? "?user=" + encodeURIComponent(user) : ""), { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("achievements " + res.status);
    return res.json();
  }

  function tile(a) {
    const li = el("li", "xa-item");
    li.dataset.got = a.got ? "1" : "0";
    const ic = el("span", "xa-ic");
    ic.innerHTML = svg(a.icon);
    const txt = el("span", "xa-txt");
    txt.append(el("strong", "xa-name", a.name), el("span", "xa-desc", a.desc));
    if (!a.got && a.goal > 1) {
      const bar = el("span", "xa-bar");
      bar.style.setProperty("--p", Math.round((a.progress / a.goal) * 100) + "%");
      bar.append(el("i"));
      txt.append(bar, el("span", "xa-count", a.progress + " / " + a.goal));
    }
    li.append(ic, txt);
    li.setAttribute("aria-label", a.name + (a.got ? ", unlocked" : ", locked, " + a.progress + " of " + a.goal) + ". " + a.desc);
    return li;
  }

  /** Draws the wall. compact: the count and the three closest goals. */
  function render(box, data, opts = {}) {
    if (!box) return;
    box.textContent = "";
    const items = (data && data.items) || [];
    const head = el("div", "xa-head");
    head.append(el("strong", "xa-score", (data.got || 0) + " of " + (data.total || items.length)), el("span", "xa-score-sub", "unlocked"));
    const bar = el("span", "xa-bar xa-bar-big");
    bar.style.setProperty("--p", Math.round(((data.got || 0) / Math.max(1, data.total || items.length)) * 100) + "%");
    bar.append(el("i"));
    head.append(bar);
    box.append(head);
    let list = items;
    if (opts.got) {
      list = items.filter((a) => a.got);
      if (!list.length) { box.append(el("p", "xa-done", "No achievements unlocked yet.")); return; }
    }
    if (opts.compact) {
      list = items.filter((a) => !a.got).sort((a, b) => b.progress / b.goal - a.progress / a.goal).slice(0, 3);
      if (!list.length) { box.append(el("p", "xa-done", "Every achievement unlocked.")); return; }
      box.append(el("p", "xa-next", "Closest next"));
    }
    const ul = el("ul", "xa-list" + (opts.compact ? " is-compact" : ""));
    list.forEach((a) => ul.append(tile(a)));
    box.append(ul);
  }

  window.xnAch = { load, render, ICONS };
})();
