// The shelf in the Profile header: pictures (PNG stickers look best) standing
// on wooden planks. The owner adds them with +, takes one off with x and
// drags them to move them. Server: POST /profile/shelf.
const shelf = document.getElementById("pfShelf");
if (shelf && shelf.dataset.own) {
  const list = document.getElementById("shelfItems");
  const empty = document.getElementById("shelfEmpty");
  const add = document.getElementById("shelfAdd");
  const file = document.getElementById("shelfFile");
  const max = Number(shelf.dataset.max) || 12;
  const say = (text, bad) => (window.xnToast ? window.xnToast(text, bad) : bad && alert(text));

  async function post(body) {
    const res = await fetch("/profile/shelf", body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(res.status === 401 ? "Log in again to change your shelf." : (await res.text()).trim() || "Couldn't change the shelf.");
    return (await res.json()).items || [];
  }

  function item(url) {
    const li = document.createElement("li");
    li.className = "pf-shelf-item";
    li.dataset.url = url;
    li.draggable = true;
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.draggable = false;
    const off = document.createElement("button");
    off.type = "button";
    off.className = "pf-shelf-off";
    off.setAttribute("aria-label", "Take this off the shelf");
    off.title = "Take off the shelf";
    off.textContent = "×";
    li.append(img, off);
    return li;
  }

  function show(items) {
    list.replaceChildren(...items.map(item));
    empty.hidden = items.length > 0;
    add.hidden = items.length >= max;
  }
  show([...list.querySelectorAll("[data-url]")].map((li) => li.dataset.url));

  add.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const picked = [...file.files];
    file.value = "";
    add.disabled = true;
    try {
      for (const f of picked) {
        if (list.children.length >= max) { say("The shelf is full. Take something off first.", true); break; }
        const form = new FormData();
        form.append("image", f);
        show(await post(form));
      }
    } catch (error) {
      say(error.message, true);
    } finally {
      add.disabled = false;
    }
  });

  list.addEventListener("click", async (e) => {
    const off = e.target.closest(".pf-shelf-off");
    if (!off) return;
    const li = off.closest(".pf-shelf-item");
    li.classList.add("is-going");
    try { show(await post({ action: "remove", url: li.dataset.url })); }
    catch (error) { li.classList.remove("is-going"); say(error.message, true); }
  });

  // Shelf color: the wood (frame, planks, back) is mixed from --wood.
  const paint = document.getElementById("shelfPaint");
  const colors = document.getElementById("shelfColors");
  const custom = document.getElementById("shelfCustom");
  const woods = [...colors.querySelectorAll("[data-wood]")];
  function setWood(color) {
    if (color) shelf.style.setProperty("--wood", color);
    else shelf.style.removeProperty("--wood");
    let hit = false;
    woods.forEach((b) => {
      const on = b.dataset.wood === color;
      hit = hit || on;
      b.setAttribute("aria-checked", String(on));
    });
    custom.parentElement.classList.toggle("is-on", !hit);
    if (!hit) { custom.parentElement.style.setProperty("--sw", color); custom.value = color; }
  }
  async function saveWood(color) {
    setWood(color);
    try { await post({ action: "color", color }); say("Shelf color saved."); }
    catch (error) { say(error.message, true); }
  }
  const openColors = (open) => { colors.hidden = !open; paint.setAttribute("aria-expanded", String(open)); };
  paint.addEventListener("click", () => openColors(colors.hidden));
  woods.forEach((b) => b.addEventListener("click", () => saveWood(b.dataset.wood)));
  custom.addEventListener("input", () => setWood(custom.value.toLowerCase()));
  custom.addEventListener("change", () => saveWood(custom.value.toLowerCase()));
  document.addEventListener("pointerdown", (e) => { if (!colors.hidden && !colors.contains(e.target) && !paint.contains(e.target)) openColors(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !colors.hidden) { openColors(false); paint.focus(); } });
  setWood(shelf.dataset.wood || "");

  // Drag a picture onto another spot to move it there.
  let dragged = null;
  list.addEventListener("dragstart", (e) => {
    dragged = e.target.closest(".pf-shelf-item");
    if (!dragged) return;
    dragged.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragged.dataset.url);
  });
  list.addEventListener("dragover", (e) => {
    const over = e.target.closest(".pf-shelf-item");
    if (!dragged || !over || over === dragged) return;
    e.preventDefault();
    const box = over.getBoundingClientRect();
    list.insertBefore(dragged, e.clientX < box.left + box.width / 2 ? over : over.nextSibling);
  });
  list.addEventListener("dragend", async () => {
    if (!dragged) return;
    dragged.classList.remove("is-dragging");
    dragged = null;
    try { await post({ action: "order", order: [...list.children].map((li) => li.dataset.url) }); }
    catch (error) { say(error.message, true); }
  });
}
