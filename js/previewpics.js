// ============================================================
// previewpics.js: Journal preview pictures in the admin Substances Editor
// (mommy 2026-11-05). Preview pictures come first in the Journal gallery
// (big picture + 5 small ones); Wikimedia Commons pictures fill the rest.
// Changes save at once through /journal/api/previews (admins only).
//   mountPreviewPics(fieldset) -> { show(name) }  ("" hides it)
// ============================================================
const toast = (msg, bad) => window.xnToast && window.xnToast(msg, bad);

export function mountPreviewPics(box) {
  let name = "";
  let items = [];
  const grid = box.querySelector(".se-prev-grid");
  const file = box.querySelector(".se-prev-file");
  const add = box.querySelector(".se-prev-add");
  const status = box.querySelector(".se-prev-status");
  const link = box.querySelector(".se-prev-link");

  function say(text) {
    status.textContent = text;
  }

  async function call(options) {
    const res = await fetch("/journal/api/previews" + (options ? "" : "?q=" + encodeURIComponent(name)), options || { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error((await res.text()).trim() || "Couldn't change the pictures.");
    return (await res.json()).items || [];
  }

  function draw() {
    grid.replaceChildren(...items.map((p, i) => {
      const cell = document.createElement("figure");
      cell.className = "se-prev-cell";
      const img = document.createElement("img");
      img.src = p.url;
      img.alt = "";
      img.loading = "lazy";
      const tag = document.createElement("span");
      tag.className = "se-prev-pos";
      tag.textContent = i === 0 ? "Big picture" : String(i + 1);
      const tools = document.createElement("div");
      tools.className = "se-prev-tools";
      const btn = (text, label, fn, off) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.setAttribute("aria-label", label);
        b.title = label;
        b.disabled = !!off;
        b.addEventListener("click", fn);
        return b;
      };
      tools.append(
        btn("←", "Move earlier", () => change({ action: "move", id: p.id, dir: -1 }), i === 0),
        btn("→", "Move later", () => change({ action: "move", id: p.id, dir: 1 }), i === items.length - 1),
        btn("×", "Remove this picture", (e) => {
          const b = e.currentTarget;
          if (b.dataset.sure !== "1") {
            b.dataset.sure = "1";
            b.classList.add("is-confirm");
            b.textContent = "Sure?";
            setTimeout(() => { b.dataset.sure = ""; b.classList.remove("is-confirm"); b.textContent = "×"; }, 3500);
            return;
          }
          change({ action: "delete", id: p.id });
        }),
      );
      cell.append(img, tag, tools);
      return cell;
    }));
    say(items.length ? (items.length === 1 ? "1 preview picture." : items.length + " preview pictures.") + (items.length < 6 ? " Commons pictures fill the other " + (6 - items.length) + " places." : " Only these show in the gallery; Commons pictures are under View all.") : "No preview pictures yet. The Drug Database shows Wikimedia Commons pictures.");
  }

  async function change(body) {
    try {
      items = await call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      draw();
    } catch (e) {
      toast(e.message, true);
    }
  }

  add.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const files = [...(file.files || [])].filter((f) => f.type.startsWith("image/"));
    file.value = "";
    if (!files.length || !name) return;
    add.disabled = true;
    say("Uploading…");
    try {
      const form = new FormData();
      form.append("name", name);
      for (const f of files.slice(0, 12)) {
        const small = window.xnShrinkPicture && f.type !== "image/png" ? await window.xnShrinkPicture(f, [2000, 2000]) : f;
        form.append("image", small, small === f ? f.name : "picture.jpg");
      }
      items = await call({ method: "POST", body: form });
      draw();
      toast(files.length === 1 ? "Preview picture added." : files.length + " preview pictures added.");
    } catch (e) {
      say(e.message);
    } finally {
      add.disabled = false;
    }
  });

  return {
    async show(next) {
      name = next || "";
      box.hidden = !name;
      if (!name) return;
      link.href = "/journal/Drug?drug=" + encodeURIComponent(name);
      grid.replaceChildren();
      say("Loading…");
      try {
        items = await call();
        if (name === next) draw();
      } catch (e) {
        say(e.message);
      }
    },
  };
}
