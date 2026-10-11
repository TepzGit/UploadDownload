// arrange.js: putting the Profile cards in your own order. Tap "Arrange",
// then drag a card by its handle (mouse or finger) or use its arrow buttons.
// Every change is saved straight away; "Done" leaves arrange mode.

const toast = (msg, bad) => window.xnToast && window.xnToast(msg, bad);

/** The key the server stores for a card: "intake", "totals" or "b<box id>". */
const keyOf = (card) => card.dataset.card || (card.dataset.box ? "b" + card.dataset.box : "");
const cardsIn = (grid) => [...grid.children].filter((el) => keyOf(el));

/** Puts the cards in grid into the saved order; cards it doesn't know stay at the end. */
export function applyOrder(grid, order) {
  const place = new Map(order.map((key, i) => [key, i]));
  const cards = cardsIn(grid);
  const sorted = [...cards].sort((a, b) => {
    const pa = place.has(keyOf(a)) ? place.get(keyOf(a)) : order.length + cards.indexOf(a);
    const pb = place.has(keyOf(b)) ? place.get(keyOf(b)) : order.length + cards.indexOf(b);
    return pa - pb;
  });
  sorted.forEach((card) => grid.append(card));
}

const ICON = {
  grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
};

// FLIP: remember where every card is, let change() move them in the DOM,
// then slide each card from its old spot to its new one.
function slide(grid, change, skip) {
  const cards = cardsIn(grid);
  const before = new Map(cards.map((card) => [card, card.getBoundingClientRect()]));
  change();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  cards.forEach((card) => {
    if (card === skip) return;
    const a = before.get(card);
    const b = card.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (!dx && !dy) return;
    card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
  });
}

export function mountArrange({ grid, toggle }) {
  let on = false;
  let saveTimer = null;

  async function save() {
    try {
      const res = await fetch("/profile/boxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "order", order: cardsIn(grid).map(keyOf) }),
      });
      if (res.status === 401) throw new Error("Log in again to move your cards.");
      if (!res.ok) throw new Error((await res.text()).trim() || "Couldn't save the order. Try again.");
    } catch (error) {
      toast(error.message, true);
    }
  }
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  };

  function title(card) {
    return card.querySelector(".pf-box-head h2")?.textContent.trim() || "card";
  }

  function move(card, by) {
    const cards = cardsIn(grid);
    const to = cards.indexOf(card) + by;
    if (to < 0 || to >= cards.length) return;
    slide(grid, () => {
      if (by < 0) grid.insertBefore(card, cards[to]);
      else grid.insertBefore(card, cards[to].nextSibling);
    });
    refreshButtons();
    saveSoon();
  }

  function refreshButtons() {
    const cards = cardsIn(grid);
    cards.forEach((card, i) => {
      const bar = card.querySelector(":scope > .pf-move");
      if (!bar) return;
      bar.querySelector("[data-up]").disabled = i === 0;
      bar.querySelector("[data-down]").disabled = i === cards.length - 1;
      bar.querySelector(".pf-move-pos").textContent = i + 1 + " of " + cards.length;
    });
  }

  function addBar(card) {
    if (card.querySelector(":scope > .pf-move")) return;
    const bar = document.createElement("div");
    bar.className = "pf-move";
    bar.innerHTML =
      '<button type="button" class="pf-move-grip">' + ICON.grip + '<span>Drag</span></button>' +
      '<span class="pf-move-pos"></span>' +
      '<button type="button" class="pf-move-btn" data-up>' + ICON.up + "</button>" +
      '<button type="button" class="pf-move-btn" data-down>' + ICON.down + "</button>";
    const name = title(card);
    const grip = bar.querySelector(".pf-move-grip");
    grip.setAttribute("aria-label", "Drag " + name + " to move it");
    bar.querySelector("[data-up]").setAttribute("aria-label", "Move " + name + " earlier");
    bar.querySelector("[data-down]").setAttribute("aria-label", "Move " + name + " later");
    bar.querySelector("[data-up]").addEventListener("click", (e) => {
      move(card, -1);
      e.currentTarget.focus();
    });
    bar.querySelector("[data-down]").addEventListener("click", (e) => {
      move(card, 1);
      e.currentTarget.focus();
    });
    grip.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); move(card, -1); grip.focus(); }
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); move(card, 1); grip.focus(); }
    });
    grip.addEventListener("pointerdown", (e) => startDrag(e, card, grip));
    card.prepend(bar);
  }

  // Dragging: the card follows the pointer's place in the grid, so the
  // others slide around it. Near the top or bottom of the screen the page scrolls.
  function startDrag(e, card, grip) {
    if (e.button > 0) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    card.classList.add("is-dragging");
    grid.classList.add("is-dragging-any");
    const before = cardsIn(grid).map(keyOf).join();
    let lastY = e.clientY;
    let scroller = null;
    const edgeScroll = () => {
      const zone = 70;
      const speed = lastY < zone ? -(zone - lastY) / 4 : lastY > innerHeight - zone ? (lastY - (innerHeight - zone)) / 4 : 0;
      if (speed) window.scrollBy(0, speed);
      scroller = requestAnimationFrame(edgeScroll);
    };
    scroller = requestAnimationFrame(edgeScroll);

    const onMove = (ev) => {
      lastY = ev.clientY;
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".pf-box");
      if (!under || under === card || under.parentElement !== grid || !keyOf(under)) return;
      if (under.getAnimations && under.getAnimations().length) return; // still sliding; wait so cards don't flip back and forth
      const cards = cardsIn(grid);
      slide(grid, () => {
        if (cards.indexOf(card) < cards.indexOf(under)) grid.insertBefore(card, under.nextSibling);
        else grid.insertBefore(card, under);
      }, card);
    };
    const onEnd = () => {
      cancelAnimationFrame(scroller);
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onEnd);
      grip.removeEventListener("pointercancel", onEnd);
      card.classList.remove("is-dragging");
      grid.classList.remove("is-dragging-any");
      refreshButtons();
      if (cardsIn(grid).map(keyOf).join() !== before) saveSoon();
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onEnd);
    grip.addEventListener("pointercancel", onEnd);
  }

  function set(next) {
    on = next;
    grid.classList.toggle("is-arranging", on);
    toggle.setAttribute("aria-pressed", String(on));
    toggle.querySelector("span").textContent = on ? "Done" : "Arrange";
    if (on) {
      cardsIn(grid).forEach(addBar);
      refreshButtons();
      toast("Drag the cards, or use the arrows. Changes save by themselves.");
    } else {
      grid.querySelectorAll(":scope > .pf-box > .pf-move").forEach((bar) => bar.remove());
      clearTimeout(saveTimer);
      if (saveTimer) save();
      saveTimer = null;
    }
  }
  toggle.addEventListener("click", () => set(!on));

  // Boxes added or removed while arranging get (or lose) their bar.
  new MutationObserver(() => {
    if (!on) return;
    cardsIn(grid).forEach(addBar);
    refreshButtons();
  }).observe(grid, { childList: true });

  return { get arranging() { return on; } };
}
