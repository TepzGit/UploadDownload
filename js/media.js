// media.js: picture helpers shared by Profile, public profiles and the Forum.
//   xnShrinkPicture(file, [maxW, maxH]) re-saves a photo as a smaller JPEG
//   (phone photos are big and carry location data). GIFs go up as they are.
//   xnViewer.open(urls, index) shows pictures full size, with arrows for more.
(function () {
  async function shrinkPicture(file, [maxW, maxH]) {
    if (file.type === "image/gif") return file;
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((done) => canvas.toBlob(done, "image/jpeg", 0.88));
      return blob || file;
    } catch (_) {
      return file;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  window.xnShrinkPicture = shrinkPicture;

  let dialog = null;
  let list = [];
  let at = 0;

  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "xn-viewer";
    dialog.setAttribute("aria-label", "Picture");
    dialog.innerHTML = `
      <div class="xn-viewer-case">
        <img alt="">
        <div class="xn-viewer-bar">
          <span class="xn-viewer-count" aria-live="polite"></span>
          <div class="xn-viewer-nav">
            <button type="button" class="xn-btn" data-step="-1" aria-label="Previous picture">‹</button>
            <button type="button" class="xn-btn" data-step="1" aria-label="Next picture">›</button>
            <button type="button" class="xn-btn xn-btn-primary" data-close>Close</button>
          </div>
        </div>
      </div>`;
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.closest("[data-close]")) dialog.close();
      const step = event.target.closest("[data-step]");
      if (step) show(at + Number(step.dataset.step));
    });
    dialog.addEventListener("keydown", (event) => {
      if (list.length < 2) return;
      if (event.key === "ArrowLeft") show(at - 1);
      if (event.key === "ArrowRight") show(at + 1);
    });
    dialog.addEventListener("close", () => document.documentElement.classList.remove("xn-modal-open"));
    document.body.append(dialog);
  }

  function show(index) {
    at = (index + list.length) % list.length;
    dialog.querySelector("img").src = list[at];
    dialog.querySelector(".xn-viewer-count").textContent = list.length > 1 ? at + 1 + " of " + list.length : "";
    dialog.querySelectorAll("[data-step]").forEach((button) => (button.hidden = list.length < 2));
  }

  window.xnViewer = {
    open(urls, index = 0) {
      if (!urls || !urls.length) return;
      if (!dialog) build();
      list = urls.slice();
      show(index);
      dialog.showModal();
      document.documentElement.classList.add("xn-modal-open");
      dialog.querySelector("[data-close]").focus({ preventScroll: true });
    },
  };
})();
