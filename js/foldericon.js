// Files page, anyone who can edit: "Folder picture…" in a folder's ⋯ menu
// gives the folder an emoji or a picture (POST /files/folder-icon).
(function () {
  const PICKS = ["📁", "🎵", "🎬", "📷", "🖼️", "🎮", "📚", "📝", "💊", "🍄", "🌿", "🧪", "⭐", "❤️", "🔥", "💾", "🔒", "🗂️", "🎨", "🌈", "👽", "💀", "🐸", "🚀"];
  let dlg = null;
  let current = null;

  function build() {
    dlg = document.createElement("dialog");
    dlg.className = "fi-dlg";
    dlg.innerHTML =
      '<form method="dialog" class="fi-card xn-card">' +
      '<div class="fi-head"><h2 class="xn-h2">Folder picture</h2><button type="button" class="fi-x" value="close" aria-label="Close">×</button></div>' +
      '<p class="xn-sub fi-name"></p>' +
      '<div class="fi-preview" aria-hidden="true"></div>' +
      '<span class="xn-label">Pick an emoji</span>' +
      '<div class="fi-picks"></div>' +
      '<label class="xn-label" for="fiEmoji">Or type one</label>' +
      '<div class="fi-row"><input id="fiEmoji" class="xn-input" maxlength="16" autocomplete="off" placeholder="🙂"><button type="button" class="xn-btn" data-do="emoji">Use</button></div>' +
      '<span class="xn-label">Or use a picture</span>' +
      '<div class="fi-row"><button type="button" class="xn-btn" data-do="pick">Upload picture…</button><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden></div>' +
      '<p class="fi-msg" role="status"></p>' +
      '<div class="fi-foot"><button type="button" class="xn-btn xn-btn-danger" data-do="remove">Back to the normal icon</button><button type="button" class="xn-btn" value="close">Done</button></div>' +
      "</form>";
    document.body.append(dlg);
    const picks = dlg.querySelector(".fi-picks");
    PICKS.forEach((e) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fi-pick";
      b.textContent = e;
      b.setAttribute("aria-label", "Use " + e);
      b.addEventListener("click", () => send({ emoji: e }));
      picks.append(b);
    });
    const file = dlg.querySelector('input[type="file"]');
    dlg.querySelector('[data-do="pick"]').addEventListener("click", () => file.click());
    file.addEventListener("change", () => {
      if (file.files[0]) send({ image: file.files[0] });
      file.value = "";
    });
    dlg.querySelector('[data-do="emoji"]').addEventListener("click", () => {
      const v = dlg.querySelector("#fiEmoji").value.trim();
      if (v) send({ emoji: v });
    });
    dlg.querySelector("#fiEmoji").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        dlg.querySelector('[data-do="emoji"]').click();
      }
    });
    dlg.querySelector('[data-do="remove"]').addEventListener("click", () => send({ remove: true }));
    dlg.querySelectorAll('[value="close"]').forEach((b) => b.addEventListener("click", () => dlg.close()));
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
    });
  }

  function thumbHTML(icon) {
    const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    if (icon && icon.image) return '<img class="fx-ficon" src="' + esc(icon.image) + '" alt="">';
    if (icon && icon.emoji) return '<span class="fx-femoji" aria-hidden="true">' + esc(icon.emoji) + "</span>";
    return '<svg class="fx-ico" aria-hidden="true"><use href="#i-folder"/></svg>';
  }

  function show(icon) {
    dlg.querySelector(".fi-preview").innerHTML = thumbHTML(icon);
    if (current) {
      const thumb = current.querySelector(".fx-thumb");
      if (thumb) thumb.innerHTML = thumbHTML(icon);
    }
  }

  async function send(what) {
    if (!current) return;
    const msg = dlg.querySelector(".fi-msg");
    msg.textContent = "Saving…";
    msg.classList.remove("is-error");
    const form = new FormData();
    form.append("path", current.dataset.path);
    if (what.remove) form.append("remove", "1");
    if (what.emoji) form.append("emoji", what.emoji);
    if (what.image) form.append("image", what.image);
    try {
      const res = await fetch("/files/folder-icon", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.text()).trim() || "Couldn't save the icon.");
      show(await res.json());
      msg.textContent = what.remove ? "Back to the normal folder icon." : "Saved.";
    } catch (e) {
      msg.textContent = e.message;
      msg.classList.add("is-error");
    }
  }

  window.xnFolderIcon = function (item) {
    if (!dlg) build();
    current = item;
    dlg.querySelector(".fi-name").textContent = item.querySelector(".filename")?.textContent || "";
    dlg.querySelector(".fi-msg").textContent = "";
    dlg.querySelector("#fiEmoji").value = "";
    const thumb = item.querySelector(".fx-thumb");
    dlg.querySelector(".fi-preview").innerHTML = thumb ? thumb.innerHTML : "";
    dlg.showModal();
  };
})();
