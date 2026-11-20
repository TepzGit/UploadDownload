// pillrate.js: ratings drawn as pills (mommy 2026-11-20).
// window.xnPillRate.show(value, max): a row of pills, full or half filled.
// window.xnPillRate.picker({max, value, label, onChange}): the same row as a
// slider; pressing the left half of a pill gives .5, the right half a whole.
// window.xnTried.mount(box, {user}): the "I've tried" card (GET/POST /tried).
(() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const fmt = (v) => (v % 1 ? v.toFixed(1) : String(v));

  function paint(row, value, max) {
    row.querySelectorAll(".xp-pill").forEach((p, i) => {
      p.dataset.fill = value >= i + 1 ? "full" : value >= i + 0.5 ? "half" : "empty";
    });
  }
  function pills(max) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < max; i++) frag.append(el("i", "xp-pill"));
    return frag;
  }

  function show(value, max = 10, small) {
    const row = el("span", "xp-row" + (small ? " is-small" : ""));
    row.setAttribute("role", "img");
    row.setAttribute("aria-label", fmt(value) + " of " + max + " pills");
    row.append(pills(max));
    paint(row, value, max);
    return row;
  }

  function picker({ max = 10, value = 0, label = "Rating", onChange } = {}) {
    const wrap = el("span", "xp-pick");
    const row = el("span", "xp-row is-pick");
    row.tabIndex = 0;
    row.setAttribute("role", "slider");
    row.setAttribute("aria-label", label);
    row.setAttribute("aria-valuemin", "0");
    row.setAttribute("aria-valuemax", String(max));
    row.append(pills(max));
    const out = el("span", "xp-out");
    wrap.append(row, out);
    let cur = value;
    let hoverV = null;
    const set = (v, fire) => {
      cur = Math.max(0, Math.min(max, Math.round(v * 2) / 2));
      row.setAttribute("aria-valuenow", String(cur));
      row.setAttribute("aria-valuetext", fmt(cur) + " of " + max + " pills");
      paint(row, hoverV ?? cur, max);
      out.textContent = fmt(hoverV ?? cur) + " / " + max;
      if (fire && onChange) onChange(cur);
    };
    const at = (e) => {
      const list = [...row.querySelectorAll(".xp-pill")];
      for (let i = 0; i < list.length; i++) {
        const r = list[i].getBoundingClientRect();
        if (e.clientX <= r.right + 2) return i + (e.clientX < r.left + r.width / 2 ? 0.5 : 1);
      }
      return max;
    };
    row.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") { hoverV = at(e); set(cur); } });
    row.addEventListener("pointerleave", () => { hoverV = null; set(cur); });
    row.addEventListener("click", (e) => {
      const v = at(e);
      hoverV = null;
      // Pressing the rating you already have clears it.
      set(v === cur ? 0 : v, true);
    });
    row.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 }[e.key];
      if (step) { e.preventDefault(); set(cur + step, true); }
      else if (e.key === "Home") { e.preventDefault(); set(0, true); }
      else if (e.key === "End") { e.preventDefault(); set(max, true); }
    });
    set(value);
    wrap.get = () => cur;
    wrap.set = (v) => set(v);
    return wrap;
  }

  window.xnPillRate = { show, picker, fmt };

  // ---------- I've tried ----------
  const NOTE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8.5L19 8v11.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M14 3.5V8h5M8.5 12.5h7M8.5 16h5"/></svg>';
  let names = null;
  async function substanceNames() {
    if (names) return names;
    const set = new Map();
    const add = (n) => { n = String(n || "").trim(); if (n && !set.has(n.toLowerCase())) set.set(n.toLowerCase(), n); };
    try {
      const r = await fetch("/substances/custom", { headers: { Accept: "application/json" } });
      if (r.ok) (await r.json()).forEach((s) => add(s.name));
    } catch (_) {}
    try {
      const r = await fetch("/stats/api", { headers: { Accept: "application/json" } });
      if (r.ok) ((await r.json()).doses || []).forEach((d) => add(d.name));
    } catch (_) {}
    names = [...set.values()].sort((a, b) => a.localeCompare(b));
    return names;
  }

  function mount(box, opts = {}) {
    if (!box) return;
    const user = opts.user || "";
    box.classList.add("tr-box");
    box.innerHTML = "";
    const head = el("div", "pf-box-head tr-head");
    const h = el("h2", "xn-h2", "I've tried");
    h.id = "triedTitle";
    box.setAttribute("aria-labelledby", "triedTitle");
    const count = el("span", "pf-note tr-count");
    const tools = el("span", "tr-tools");
    const sortBtn = el("button", "tr-sort", "Best first");
    sortBtn.type = "button";
    const addBtn = el("button", "xn-btn tr-add");
    addBtn.type = "button";
    addBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Add</span>';
    addBtn.hidden = true;
    tools.append(count, sortBtn, addBtn);
    head.append(h, tools);

    const form = el("form", "tr-form");
    form.hidden = true;
    form.noValidate = true;
    const listId = "trNames" + Math.random().toString(36).slice(2, 7);
    form.innerHTML =
      '<label class="tr-field"><span class="xn-label">Substance</span><input class="xn-input" name="name" maxlength="80" autocomplete="off" required list="' + listId + '"><datalist id="' + listId + '"></datalist></label>' +
      '<div class="tr-field"><span class="xn-label" id="' + listId + 'r">Rating</span><div class="tr-rate"></div></div>' +
      '<label class="tr-field"><span class="xn-label">Note <em>optional</em></span><textarea class="xn-input tr-note-in" name="note" rows="2" maxlength="600"></textarea></label>' +
      '<div class="tr-actions"><button type="submit" class="xn-btn xn-btn-primary">Save</button><button type="button" class="xn-btn" data-cancel>Cancel</button><button type="button" class="xn-btn xn-btn-danger" data-delete hidden>Remove</button><span class="pf-note tr-msg" aria-live="polite"></span></div>';
    const nameIn = form.querySelector('input[name="name"]');
    const noteIn = form.querySelector('textarea[name="note"]');
    const rate = picker({ max: 10, value: 0, label: "Rating, 0 to 10 pills" });
    form.querySelector(".tr-rate").append(rate);
    const list = el("ul", "tr-list");
    const empty = el("p", "xn-empty");
    box.append(head, form, list, empty);

    let items = [];
    let mine = false;
    let editing = "";
    let byRating = true;
    const msg = form.querySelector(".tr-msg");

    function render() {
      list.textContent = "";
      count.textContent = items.length ? items.length + (items.length === 1 ? " substance" : " substances") : "";
      sortBtn.hidden = items.length < 2;
      sortBtn.textContent = byRating ? "Best first" : "A to Z";
      empty.hidden = !!items.length;
      empty.textContent = mine ? "Add the substances you've tried and rate them from 0 to 10 pills." : "Nothing here yet.";
      const sorted = [...items].sort((a, b) => (byRating ? b.rating - a.rating : 0) || a.name.localeCompare(b.name));
      sorted.forEach((it) => {
        const li = el("li", "tr-row");
        const name = el(mine ? "button" : "span", "tr-name", it.name);
        if (mine) {
          name.type = "button";
          name.title = "Change " + it.name;
          name.addEventListener("click", () => open(it));
        }
        const score = el("span", "tr-score");
        score.append(show(it.rating, 10, true), el("b", "tr-num", window.xnPillRate.fmt(it.rating)));
        li.append(name, score);
        if (it.note) {
          const nb = el("button", "tr-note-btn");
          nb.type = "button";
          nb.innerHTML = NOTE_ICON;
          nb.setAttribute("aria-label", "Note about " + it.name);
          nb.setAttribute("aria-expanded", "false");
          const note = el("p", "tr-note", it.note);
          note.hidden = true;
          nb.addEventListener("click", () => {
            note.hidden = !note.hidden;
            nb.setAttribute("aria-expanded", String(!note.hidden));
          });
          li.append(nb, note);
        }
        list.append(li);
      });
    }

    async function open(it) {
      editing = it ? it.name : "";
      form.hidden = false;
      nameIn.value = it ? it.name : "";
      noteIn.value = it ? it.note || "" : "";
      rate.set(it ? it.rating : 0);
      form.querySelector("[data-delete]").hidden = !it;
      msg.textContent = "";
      (it ? form.querySelector(".xp-row") : nameIn).focus();
      const dl = form.querySelector("datalist");
      if (!dl.childElementCount) {
        (await substanceNames()).forEach((n) => { const o = document.createElement("option"); o.value = n; dl.append(o); });
      }
    }
    const close = () => { form.hidden = true; editing = ""; };

    async function post(body) {
      msg.textContent = "Saving…";
      try {
        const r = await fetch("/tried", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!r.ok) { msg.textContent = (await r.text()).trim() || "Couldn't save."; return false; }
        items = (await r.json()).items || [];
        render();
        return true;
      } catch (_) {
        msg.textContent = "Couldn't save. Check your connection.";
        return false;
      }
    }
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = nameIn.value.trim();
      if (!name) { msg.textContent = "Pick a substance."; nameIn.focus(); return; }
      // Renamed while editing: the old name goes.
      if (editing && editing.toLowerCase() !== name.toLowerCase()) await post({ action: "delete", name: editing });
      if (await post({ action: "save", name, rating: rate.get(), note: noteIn.value.trim() })) close();
    });
    form.querySelector("[data-cancel]").addEventListener("click", close);
    form.querySelector("[data-delete]").addEventListener("click", async () => {
      if (editing && (await post({ action: "delete", name: editing }))) close();
    });
    addBtn.addEventListener("click", () => open(null));
    sortBtn.addEventListener("click", () => { byRating = !byRating; render(); });

    fetch("/tried" + (user ? "?user=" + encodeURIComponent(user) : ""), { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        items = d.items || [];
        mine = !!d.mine;
        addBtn.hidden = !mine;
        render();
        if (!items.length && !mine && opts.hideEmpty) box.hidden = true;
      })
      .catch(() => { empty.hidden = false; empty.textContent = "Couldn't load this list."; });
  }

  window.xnTried = { mount };
})();
