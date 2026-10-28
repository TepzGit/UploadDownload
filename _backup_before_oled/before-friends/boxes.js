// boxes.js: the boxes people add with the + button on their Profile: up to
// 4 pictures, one saved Graph session, or a note. The Profile page mounts
// them editable; /u/<name> shows the same boxes read-only.
// Needs media.js (xnViewer, xnShrinkPicture) on the page.
import { previewTimeline, previewColors, setCustomColors, timeToHours, formatChartTime } from "/logic.js";

export const MAX_BOXES = 12;
const PER_BOX = 4;
const NOTE_MAX = 1000;
const SVG_NS = "http://www.w3.org/2000/svg";
const DAY = 86400000;

const PATHS = {
  plus: "M12 5v14M5 12h14",
  trash: "M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3",
  pencil: "M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4",
  open: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
};
export function icon(name) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + PATHS[name] + '"/></svg>';
}
const toast = (msg, bad) => window.xnToast && window.xnToast(msg, bad);

function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today", "Yesterday" or a short date, same wording as the Graph page. */
export function dayLabel(t) {
  const day = startOfDay(t);
  const today = startOfDay(Date.now());
  if (day === today) return "Today";
  if (day === startOfDay(today - DAY / 2)) return "Yesterday";
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

function hoursText(hours) {
  if (hours < 1) return Math.max(1, Math.round(hours * 60)) + " min";
  return Math.round(hours * 10) / 10 + " h";
}

function amountText(dose) {
  const unit = dose.unit === "ug" ? "µg" : dose.unit || "";
  return (Math.round(Number(dose.amount) * 100) / 100 + " " + unit).trim();
}

/**
 * A saved Graph session drawn as one filled curve per substance, plus what
 * the box needs around it. Returns null when the session can't be drawn.
 */
export function sessionChart(doses, className = "pf-exp-svg") {
  const preview = previewTimeline(doses, 96);
  if (!preview) return null;
  const colors = previewColors(preview.names);
  const colorOf = Object.fromEntries(preview.names.map((name, index) => [name, colors[index]]));
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", "0 0 100 40");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const base = document.createElementNS(SVG_NS, "line");
  base.setAttribute("x1", "0");
  base.setAttribute("x2", "100");
  base.setAttribute("y1", "39.5");
  base.setAttribute("y2", "39.5");
  svg.append(base);
  preview.series.forEach((item) => {
    const step = 100 / (item.y.length - 1);
    const points = item.y.map((value, i) => [(i * step).toFixed(2), (39 - (value / preview.peak) * 36).toFixed(2)]);
    const line = points.map(([x, y], i) => (i ? "L" : "M") + x + " " + y).join("");
    const area = document.createElementNS(SVG_NS, "path");
    area.setAttribute("class", "pf-exp-area");
    area.setAttribute("d", line + "L100 39L0 39Z");
    area.style.setProperty("--c", colorOf[item.name]);
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", "pf-exp-line");
    path.setAttribute("d", line);
    path.style.setProperty("--c", colorOf[item.name]);
    svg.append(area, path);
  });
  const start = Math.min(...doses.map((dose) => timeToHours(dose.time)));
  return { svg, colorOf, hours: preview.hours, start: formatChartTime(start), end: formatChartTime(start + preview.hours) };
}

/** The dose list under a session chart: color dot, time, substance, amount. */
function doseList(doses, colorOf) {
  const list = document.createElement("ol");
  list.className = "pf-exp-doses";
  [...doses]
    .sort((a, b) => timeToHours(a.time) - timeToHours(b.time))
    .forEach((dose) => {
      const row = document.createElement("li");
      const dot = document.createElement("i");
      dot.style.setProperty("--c", colorOf[dose.substance.trim()] || "var(--oled-muted)");
      const time = document.createElement("time");
      time.textContent = dose.time;
      const name = document.createElement("strong");
      name.textContent = dose.substance;
      const amount = document.createElement("span");
      amount.textContent = amountText(dose) + (dose.formulation ? " · " + dose.formulation : "");
      row.append(dot, time, name, amount);
      list.append(row);
    });
  return list;
}

/**
 * Loads and draws the boxes into grid. With editable, the owner can add
 * pictures, edit notes and remove boxes; user picks whose boxes to show.
 */
export async function mountBoxes({ grid, user = "", editable = false }) {
  let boxes = [];
  let changed = () => {};
  let uploadTarget = null;
  let fileInput = null;

  async function post(body) {
    const res = await fetch("/profile/boxes", body instanceof FormData
      ? { method: "POST", body }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 401) throw new Error("Log in again to change your profile.");
    if (!res.ok) throw new Error((await res.text()).trim() || "Couldn't save that. Try again.");
    return res.json();
  }

  function cardFor(box) {
    let card = grid.querySelector('[data-box="' + box.id + '"]');
    if (!card) {
      card = document.createElement("section");
      card.dataset.box = String(box.id);
      grid.append(card);
    }
    const kind = { pictures: "pf-pics", experience: "pf-exp", note: "pf-notebox" }[box.kind] || "pf-pics";
    card.className = "xn-card pf-box " + kind;
    return card;
  }

  /** Header: title, a short note and (for the owner) tool buttons. */
  function header(card, title, note) {
    const head = document.createElement("div");
    head.className = "pf-box-head";
    const h2 = document.createElement("h2");
    h2.className = "xn-h2";
    h2.textContent = title;
    const tools = document.createElement("div");
    tools.className = "pf-pics-tools";
    const small = document.createElement("span");
    small.className = "pf-note";
    small.textContent = note;
    tools.append(small);
    head.append(h2, tools);
    card.replaceChildren(head);
    card.setAttribute("aria-label", title);
    return tools;
  }

  function tool(name, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pf-tool";
    button.innerHTML = icon(name);
    button.setAttribute("aria-label", label);
    button.title = label;
    return button;
  }

  /** The remove button. With confirm, the first tap asks "Remove?". */
  function removeTool(box, confirm) {
    const del = tool("trash", "Remove this box");
    del.classList.add("pf-tool-del");
    let armed = null;
    const disarm = () => {
      clearTimeout(armed);
      armed = null;
      del.classList.remove("is-confirm");
      del.innerHTML = icon("trash");
      del.setAttribute("aria-label", "Remove this box");
    };
    del.addEventListener("blur", disarm);
    del.addEventListener("click", () => {
      if (!armed && confirm) {
        del.classList.add("is-confirm");
        del.textContent = "Remove?";
        del.setAttribute("aria-label", "Tap again to remove this box");
        armed = setTimeout(disarm, 4000);
        return;
      }
      disarm();
      removeBox(box);
    });
    return del;
  }

  function renderPictures(box) {
    const card = cardFor(box);
    const count = box.pictures.length;
    const tools = header(card, "Pictures", editable ? count + " of " + PER_BOX : count === 1 ? "1 picture" : count + " pictures");
    if (editable) {
      const add = tool("plus", "Add pictures");
      add.dataset.add = "";
      add.hidden = count >= PER_BOX;
      tools.append(add, removeTool(box, count > 0));
    }
    const area = document.createElement("div");
    area.className = "pf-pics-grid";
    area.dataset.count = String(count);
    if (!count && editable) {
      const drop = document.createElement("button");
      drop.type = "button";
      drop.className = "pf-pics-empty";
      drop.dataset.add = "";
      drop.innerHTML = icon("plus") + "<span>Add up to 4 pictures</span>";
      area.append(drop);
    }
    box.pictures.forEach((url, index) => {
      const cell = document.createElement("div");
      cell.className = "pf-pic";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "pf-pic-open";
      open.setAttribute("aria-label", "Open picture " + (index + 1) + " of " + count);
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", () => cell.classList.add("is-broken"));
      open.append(img);
      open.addEventListener("click", () => window.xnViewer.open(box.pictures, index));
      cell.append(open);
      if (editable) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "pf-pic-x";
        remove.textContent = "×";
        remove.setAttribute("aria-label", "Remove picture " + (index + 1));
        remove.addEventListener("click", () => removePicture(box, url));
        cell.append(remove);
      }
      area.append(cell);
    });
    card.append(area);
    card.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => pick(box)));
    return card;
  }

  function renderExperience(box) {
    const card = cardFor(box);
    const exp = box.experience;
    const chart = exp && sessionChart(exp.doses);
    const tools = header(card, "Experience", chart ? dayLabel(exp.startedAt) + " · " + hoursText(chart.hours) : "");
    if (editable) {
      if (chart) {
        const open = document.createElement("a");
        open.className = "pf-tool";
        open.href = "/?exp=" + encodeURIComponent(exp.id);
        open.innerHTML = icon("open");
        open.setAttribute("aria-label", "Open this session in the Graph");
        open.title = "Open in the Graph";
        tools.append(open);
      }
      tools.append(removeTool(box, false));
    }
    if (!chart) {
      const gone = document.createElement("p");
      gone.className = "xn-empty";
      gone.textContent = "This Graph session was deleted, so there's nothing to show. Remove the box or add another session.";
      card.append(gone);
      return card;
    }
    const figure = document.createElement("figure");
    figure.className = "pf-exp-chart";
    figure.append(chart.svg);
    const axis = document.createElement("div");
    axis.className = "pf-exp-axis";
    axis.innerHTML = "<span></span><span></span>";
    axis.children[0].textContent = chart.start;
    axis.children[1].textContent = chart.end;
    const names = Object.keys(chart.colorOf);
    figure.setAttribute("aria-label", "Graph of " + names.join(", ") + " from " + chart.start + " to " + chart.end);
    card.append(figure, axis, doseList(exp.doses, chart.colorOf));
    return card;
  }

  function renderNote(box, editing = false) {
    const card = cardFor(box);
    const tools = header(card, "Note", "");
    if (editable && !editing) {
      const edit = tool("pencil", "Edit note");
      edit.addEventListener("click", () => renderNote(box, true));
      tools.append(edit, removeTool(box, box.note !== ""));
    }
    if (editing) {
      const form = document.createElement("form");
      form.className = "pf-note-form";
      const area = document.createElement("textarea");
      area.className = "xn-input pf-note-input";
      area.maxLength = NOTE_MAX;
      area.value = box.note;
      area.placeholder = "Write something people see on your profile…";
      area.setAttribute("aria-label", "Note");
      const bar = document.createElement("div");
      bar.className = "pf-note-bar";
      const counter = document.createElement("span");
      counter.className = "pf-note";
      const sync = () => (counter.textContent = area.value.length + " / " + NOTE_MAX);
      sync();
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "xn-btn";
      cancel.textContent = "Cancel";
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "xn-btn xn-btn-primary";
      save.textContent = "Save";
      bar.append(counter, cancel, save);
      form.append(area, bar);
      card.append(form);
      area.addEventListener("input", sync);
      area.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.stopPropagation(); renderNote(box); }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.requestSubmit();
      });
      cancel.addEventListener("click", () => renderNote(box).querySelector("[data-write], .pf-tool")?.focus({ preventScroll: true }));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        save.disabled = true;
        try {
          Object.assign(box, await post({ action: "note", id: box.id, note: area.value }));
          renderNote(box).querySelector(".pf-tool")?.focus({ preventScroll: true });
          toast("Note saved.");
        } catch (error) {
          save.disabled = false;
          toast(error.message, true);
        }
      });
      requestAnimationFrame(() => area.focus({ preventScroll: true }));
      return card;
    }
    if (box.note) {
      const text = document.createElement("div");
      text.className = "pf-note-text";
      text.textContent = box.note;
      card.append(text);
    } else if (editable) {
      const write = document.createElement("button");
      write.type = "button";
      write.className = "pf-pics-empty";
      write.dataset.write = "";
      write.innerHTML = icon("pencil") + "<span>Write a note</span>";
      write.addEventListener("click", () => renderNote(box, true));
      card.append(write);
    }
    return card;
  }

  function render(box) {
    if (box.kind === "experience") return renderExperience(box);
    if (box.kind === "note") return renderNote(box);
    return renderPictures(box);
  }

  function pick(box) {
    uploadTarget = box;
    fileInput.click();
  }

  async function removeBox(box) {
    try {
      await post({ action: "delete", id: box.id });
      boxes = boxes.filter((b) => b.id !== box.id);
      grid.querySelector('[data-box="' + box.id + '"]')?.remove();
      changed();
      toast("Box removed.");
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function removePicture(box, url) {
    try {
      Object.assign(box, await post({ action: "remove", id: box.id, url }));
      render(box).querySelector("[data-add]")?.focus({ preventScroll: true });
    } catch (error) {
      toast(error.message, true);
    }
  }

  if (editable) {
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.className = "pf-file";
    fileInput.accept = "image/jpeg,image/png,image/gif,image/webp,image/*";
    fileInput.multiple = true;
    fileInput.tabIndex = -1;
    fileInput.setAttribute("aria-hidden", "true");
    grid.after(fileInput);
    fileInput.addEventListener("change", async () => {
      const box = uploadTarget;
      const picked = [...(fileInput.files || [])];
      fileInput.value = "";
      if (!box || !picked.length) return;
      const room = PER_BOX - box.pictures.length;
      const files = picked.slice(0, room);
      if (picked.length > room) toast("A box holds 4 pictures, so only the first " + room + " were added.");
      grid.querySelector('[data-box="' + box.id + '"]')?.classList.add("is-busy");
      try {
        for (const file of files) {
          const picture = await window.xnShrinkPicture(file, [1600, 1600]);
          const form = new FormData();
          form.append("id", String(box.id));
          form.append("image", picture, picture === file ? file.name : "picture.jpg");
          Object.assign(box, await post(form));
          render(box);
        }
      } catch (error) {
        toast(error.message, true);
      } finally {
        grid.querySelector('[data-box="' + box.id + '"]')?.classList.remove("is-busy");
      }
    });

    // The owner's own Graph colors, so sessions look the same as on the Graph page.
    try {
      const res = await fetch("/graphColors", { headers: { Accept: "application/json" } });
      if (res.ok && (res.headers.get("content-type") || "").includes("json")) setCustomColors(await res.json());
    } catch (_) {}
  }

  try {
    const res = await fetch("/profile/boxes" + (user ? "?user=" + encodeURIComponent(user) : ""), { headers: { Accept: "application/json" } });
    const list = res.ok && (res.headers.get("content-type") || "").includes("json") ? await res.json() : [];
    boxes = Array.isArray(list) ? list : [];
  } catch (_) {
    boxes = [];
  }
  boxes.forEach(render);

  return {
    get count() {
      return boxes.length;
    },
    onChange(fn) {
      changed = fn;
      fn();
    },
    /** Adds a box of kind ("pictures", "experience" with { experience: id }, "note"). */
    async add(kind, extra = {}) {
      const box = await post({ action: "create", kind, ...extra });
      boxes.push(box);
      changed();
      const card = kind === "note" ? renderNote(box, true) : render(box);
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      if (kind === "pictures") card.querySelector(".pf-pics-empty")?.focus({ preventScroll: true });
      return box;
    },
  };
}
