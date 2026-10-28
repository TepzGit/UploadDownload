// Files page: "Move…" in a row's ⋯ menu opens a folder picker and moves the
// file or folder there (POST /files/move). Folders are listed with /getFolders.
(function () {
  let dlg = null;
  let item = null;
  let at = "";

  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const relOfPath = (p) => decodeURIComponent(new URL(p, location.href).pathname.replace(/^\/Files\/?/, "")).replace(/\/+$/, "");
  const parentOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

  function build() {
    dlg = document.createElement("dialog");
    dlg.className = "fi-dlg mv-dlg";
    dlg.innerHTML =
      '<form method="dialog" class="fi-card xn-card">' +
      '<div class="fi-head"><h2 class="xn-h2">Move</h2><button type="button" class="fi-x" value="close" aria-label="Close">×</button></div>' +
      '<p class="xn-sub fi-name"></p>' +
      '<div class="mv-bar"><button type="button" class="xn-btn mv-up" aria-label="Up one folder">↑</button><span class="mv-where"></span></div>' +
      '<div class="mv-list" role="list"></div>' +
      '<p class="fi-msg" role="status"></p>' +
      '<div class="fi-foot"><button type="button" class="xn-btn" value="close">Cancel</button><button type="button" class="xn-btn xn-btn-primary mv-go">Move here</button></div>' +
      "</form>";
    document.body.append(dlg);
    dlg.querySelectorAll('[value="close"]').forEach((b) => b.addEventListener("click", () => dlg.close()));
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
    });
    dlg.querySelector(".mv-up").addEventListener("click", () => load(parentOf(at)));
    dlg.querySelector(".mv-go").addEventListener("click", move);
    dlg.querySelector(".mv-list").addEventListener("click", (e) => {
      const b = e.target.closest("[data-rel]");
      if (b && !b.disabled) load(b.dataset.rel);
    });
  }

  function thumb(icon) {
    if (icon && icon.image) return '<img class="fx-ficon" src="' + esc(icon.image) + '" alt="">';
    if (icon && icon.emoji) return '<span class="fx-femoji" aria-hidden="true">' + esc(icon.emoji) + "</span>";
    return '<svg class="fx-ico" aria-hidden="true"><use href="#i-folder"/></svg>';
  }

  // The item itself and anything inside it can't be a target.
  function blocked(rel) {
    if (item.dataset.type !== "Dir") return false;
    const self = relOfPath(item.dataset.path);
    return rel === self || rel.startsWith(self + "/");
  }

  async function load(rel) {
    const list = dlg.querySelector(".mv-list");
    const msg = dlg.querySelector(".fi-msg");
    msg.textContent = "";
    msg.classList.remove("is-error");
    list.innerHTML = '<p class="xn-empty mv-empty">Loading…</p>';
    let data;
    try {
      const res = await fetch("/getFolders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPath: "/" + rel, FolderToGet: "" }) });
      if (!res.ok) throw new Error();
      data = await res.json();
    } catch (e) {
      list.innerHTML = "";
      msg.textContent = "Couldn't open that folder.";
      msg.classList.add("is-error");
      return;
    }
    at = data.CurrentPath === "." ? "" : data.CurrentPath || "";
    dlg.querySelector(".mv-where").textContent = "Files" + (at ? " / " + at.split("/").join(" / ") : "");
    dlg.querySelector(".mv-up").disabled = at === "";
    const icons = data.Icons || {};
    const folders = (data.Folders || []).slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    list.innerHTML = folders.length
      ? folders
          .map((name) => {
            const r = at ? at + "/" + name : name;
            return '<button type="button" role="listitem" class="mv-row" data-rel="' + esc(r) + '"' + (blocked(r) ? " disabled" : "") + '><span class="mv-thumb">' + thumb(icons[name]) + '</span><span class="mv-label">' + esc(name) + '</span><span class="mv-go-in" aria-hidden="true">›</span></button>';
          })
          .join("")
      : '<p class="xn-empty mv-empty">No folders in here.</p>';
    const here = parentOf(relOfPath(item.dataset.path));
    const go = dlg.querySelector(".mv-go");
    go.disabled = at === here || blocked(at);
    go.textContent = at === here ? "It's already here" : "Move here";
  }

  async function move() {
    const msg = dlg.querySelector(".fi-msg");
    const go = dlg.querySelector(".mv-go");
    go.disabled = true;
    msg.textContent = "Moving…";
    msg.classList.remove("is-error");
    try {
      const res = await fetch("/files/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: item.dataset.path, to: at }) });
      if (!res.ok) throw new Error((await res.text()).trim() || "Couldn't move it.");
      const out = await res.json();
      const name = item.querySelector(".filename")?.textContent || out.name;
      const list = item.parentElement;
      item.remove();
      dlg.close();
      if (list && !list.querySelector(".item") && !list.querySelector(".fx-empty")) {
        list.insertAdjacentHTML("beforeend", '<p class="xn-empty fx-empty">This folder is empty. Upload something or make a new folder.</p>');
      }
      const where = out.folder ? out.folder.split("/").pop() : "Files";
      const msgText = "Moved “" + name + "” to " + where + (out.name !== name ? " as “" + out.name + "”" : "") + ".";
      if (window.xnToast) window.xnToast(msgText);
    } catch (e) {
      msg.textContent = e.message;
      msg.classList.add("is-error");
      go.disabled = false;
    }
  }

  window.xnMoveItem = function (row) {
    if (!dlg) build();
    item = row;
    dlg.querySelector(".fi-name").textContent = row.querySelector(".filename")?.textContent || "";
    dlg.showModal();
    load(parentOf(relOfPath(row.dataset.path)));
  };
})();
