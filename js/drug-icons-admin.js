(() => {
  const form = document.getElementById("diaForm");
  const nameInput = document.getElementById("diaName");
  const imageInput = document.getElementById("diaImage");
  const preview = document.getElementById("diaPreview");
  const defaultLabel = document.getElementById("diaDefault");
  const search = document.getElementById("diaSearch");
  const list = document.getElementById("diaList");
  const status = document.getElementById("diaStatus");
  let entries = [];
  let previewUrl = "";

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.dataset.error = String(isError);
  }

  async function request(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
      const message = (await response.text()).trim();
      throw new Error(message || `Request failed (${response.status}).`);
    }
    return response.json();
  }

  function currentEntry(name) {
    const key = name.trim().toLocaleLowerCase();
    return entries.find((entry) => entry.name.toLocaleLowerCase() === key);
  }

  function renderPreview() {
    const chosen = imageInput.files[0];
    const entry = currentEntry(nameInput.value);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = chosen ? URL.createObjectURL(chosen) : (entry?.image || "");
    preview.hidden = !previewUrl;
    defaultLabel.hidden = !!previewUrl;
    if (previewUrl) preview.src = previewUrl;
  }

  function renderList() {
    const query = search.value.trim().toLocaleLowerCase();
    const shown = entries.filter((entry) => entry.name.toLocaleLowerCase().includes(query));
    list.replaceChildren();
    if (!shown.length) {
      const empty = document.createElement("li");
      empty.className = "dia-empty";
      empty.textContent = entries.length ? "No custom pictures match this search." : "No custom drug pictures yet.";
      list.append(empty);
      return;
    }
    shown.forEach((entry) => {
      const row = document.createElement("li");
      row.className = "dia-item";
      const image = document.createElement("img");
      image.src = entry.image;
      image.alt = "";
      const title = document.createElement("strong");
      title.className = "dia-item-name";
      title.textContent = entry.name;
      const actions = document.createElement("div");
      actions.className = "dia-item-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "xn-btn";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => {
        nameInput.value = entry.name;
        imageInput.value = "";
        renderPreview();
        nameInput.focus();
        setStatus(`Editing ${entry.name}.`);
      });
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "xn-btn";
      reset.textContent = "Use default";
      reset.addEventListener("click", () => restoreDefault(entry.name));
      actions.append(edit, reset);
      row.append(image, title, actions);
      list.append(row);
    });
  }

  async function loadEntries() {
    entries = await request("/admin/drug-icons/api");
    renderList();
    renderPreview();
  }

  async function restoreDefault(name) {
    const body = new FormData();
    body.set("name", name);
    body.set("remove", "1");
    try {
      await request("/admin/drug-icons/api", { method: "POST", body });
      entries = entries.filter((entry) => entry.name.toLocaleLowerCase() !== name.toLocaleLowerCase());
      if (nameInput.value.trim().toLocaleLowerCase() === name.toLocaleLowerCase()) {
        imageInput.value = "";
        renderPreview();
      }
      renderList();
      setStatus(`Restored the default icon for ${name}.`);
    } catch (error) {
      setStatus(error.message || "Couldn't restore the default icon.", true);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return setStatus("Enter a drug name.", true);
    if (!imageInput.files.length) return setStatus("Choose a picture to upload.", true);
    const body = new FormData();
    body.set("name", name);
    body.set("image", imageInput.files[0]);
    try {
      await request("/admin/drug-icons/api", { method: "POST", body });
      await loadEntries();
      imageInput.value = "";
      renderPreview();
      setStatus(`Saved a custom picture for ${name}.`);
    } catch (error) {
      setStatus(error.message || "Couldn't save the custom picture.", true);
    }
  });

  document.getElementById("diaReset").addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) return setStatus("Enter a drug name to restore its default icon.", true);
    restoreDefault(name);
  });
  nameInput.addEventListener("input", renderPreview);
  imageInput.addEventListener("change", renderPreview);
  search.addEventListener("input", renderList);
  loadEntries().catch((error) => {
    list.replaceChildren();
    const empty = document.createElement("li");
    empty.className = "dia-empty";
    empty.textContent = error.message || "Couldn't load drug icons.";
    list.append(empty);
    setStatus(error.message || "Couldn't load drug icons.", true);
  });
})();
