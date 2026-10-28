// ============================================================
// ui.js
// DOM only: reads inputs, writes the DOM, wires event listeners.
// Every piece of business logic is delegated to logic.js; every
// chart draw is delegated to plot.js. This file owns none of
// the state itself, just element references + rendering.
// ============================================================

import * as logic from "./logic.js";
import * as plot from "./plot.js";

let suggestionTimer;
let els = {}; // populated in init()

document.addEventListener("DOMContentLoaded", init);

function init() {
  els = {
    input: document.getElementById("input"),
    suggestions: document.getElementById("sug"),
    suggestionList: document.getElementById("sugC"),
    status: document.getElementById("status"),
    searchButton: document.getElementById("searchButton"),

    dosePanel: document.getElementById("dosePanel"),
    doseInput: document.getElementById("doseInput"),
    doseUnit: document.getElementById("doseUnit"),
    doseStartHour: document.getElementById("doseStartHour"),
    releaseWindowField: document.getElementById("releaseWindowField"),
    releaseWindow: document.getElementById("releaseWindow"),
    addDoseButton: document.getElementById("addDoseButton"),
    resetButton: document.getElementById("resetButton"),
    saveButton: document.getElementById("saveButton"),

    doseList: document.getElementById("doses"),
    doseCount: document.getElementById("doseCount"),

    chartEmpty: document.getElementById("chartEmpty"),

    substanceInfo: document.getElementById("substanceInfo"),
    substanceImage: document.getElementById("substanceImage"),
    substanceName: document.getElementById("substanceName"),
    substanceSummary: document.getElementById("substanceSummary"),
    addictionPotential: document.getElementById("addictionPotential"),

    toast: document.getElementById("toast"),

    formulationInputs: Array.from(document.querySelectorAll('input[name="formulation"]')),
  };

  bindEvents();
  renderDoseList();
}

function bindEvents() {
  els.input.addEventListener("input", () => {
    clearTimeout(suggestionTimer);
    const value = els.input.value.trim();
    if (value.length < 2) {
      els.suggestions.hidden = true;
      return;
    }
    suggestionTimer = setTimeout(handleSuggestions, 350);
  });

  els.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSearch();
    }
  });

  els.searchButton.addEventListener("click", handleSearch);

  els.formulationInputs.forEach((checkbox) => {
    checkbox.addEventListener("change", () => selectFormulation(checkbox));
  });

  els.addDoseButton.addEventListener("click", handleAddDose);
  els.resetButton.addEventListener("click", handleReset);
  els.saveButton.addEventListener("click", handleSave);

  // event delegation for the per-dose remove buttons rendered dynamically
  els.doseList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-dose]");
    if (!button) return;
    const id = Number(button.dataset.removeDose);
    logic.removeDoseFromState(id);
    renderDoseList();
    refreshChart();
  });

  window.addEventListener("resize", () => plot.resizePlot("myPlot"));
  window.addEventListener("orientationchange", () => setTimeout(() => refreshChart(), 250));
}

// ------------------------------------------------------------
// Search / suggestions
// ------------------------------------------------------------

async function handleSuggestions() {
  const value = els.input.value.trim();
  if (value.length < 2) return;
  try {
    const substances = await logic.searchSuggestions(value);
    showSuggestions(substances);
  } catch (_) {
    els.suggestions.hidden = true;
  }
}

function showSuggestions(substances) {
  els.suggestionList.replaceChildren();
  substances.slice(0, 8).forEach((substance) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "suggestion";
    option.setAttribute("role", "option");
    option.textContent = substance.name;
    option.addEventListener("click", () => {
      els.input.value = substance.name;
      els.suggestions.hidden = true;
      handleSearch();
    });
    els.suggestionList.appendChild(option);
  });
  els.suggestions.hidden = substances.length === 0;
}

async function handleSearch() {
  const substanceName = els.input.value.trim();
  if (!substanceName) return;

  clearTimeout(suggestionTimer);
  els.suggestions.hidden = true;
  setLoading(true);
  els.status.textContent = "Loading substance data…";

  try {
    const { substance, commonDose, units } = await logic.fetchSubstanceData(substanceName);

    els.doseInput.value = commonDose;
    els.doseUnit.textContent = units;
    els.doseStartHour.value = logic.currentTimeValue();
    els.dosePanel.hidden = false;
    els.status.textContent = `${substance.name} loaded · common dose ${commonDose} ${units}`;
    renderSubstanceInfo(substance);
  } catch (error) {
    els.dosePanel.hidden = true;
    els.substanceInfo.hidden = true;
    els.status.textContent = error.message || "Unable to load substance data.";
  } finally {
    setLoading(false);
  }
}

function setLoading(loading) {
  els.searchButton.classList.toggle("loading", loading);
  els.searchButton.disabled = loading;
}

function renderSubstanceInfo(substance) {
  const imageUrl = substance?.images?.[0]?.thumb;
  els.substanceImage.hidden = !imageUrl;
  if (imageUrl) {
    els.substanceImage.src = imageUrl;
    els.substanceImage.alt = `${substance.name} reference`;
  }

  els.substanceName.textContent = substance.name;
  els.substanceSummary.textContent = substance.summary || "No summary available.";
  els.addictionPotential.textContent = substance.addictionPotential || "Unknown";
  setPills("caution", substance.uncertainInteractions);
  setPills("danger", substance.unsafeInteractions);
  setPills("severe", substance.dangerousInteractions);
  els.substanceInfo.hidden = false;
}

function setPills(type, items) {
  const container = document.querySelector(`[data-interaction="${type}"]`);
  container.replaceChildren();
  if (!items?.length) {
    const empty = document.createElement("span");
    empty.className = "pill empty";
    empty.textContent = "None listed";
    container.appendChild(empty);
    return;
  }
  items.forEach((item) => {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = item.name || item;
    container.appendChild(pill);
  });
}

// ------------------------------------------------------------
// Formulation toggle group
// ------------------------------------------------------------

function selectFormulation(selected) {
  if (!selected.checked) selected.checked = true;
  els.formulationInputs.forEach((checkbox) => {
    if (checkbox !== selected) checkbox.checked = false;
    checkbox.closest(".check-card").classList.toggle("selected", checkbox.checked);
  });

  const summary = document.getElementById("releaseSummary");
  if (summary) summary.textContent = selected.closest(".check-card").querySelector("strong").textContent;

  const isImmediate = selected.value === "immediate";
  els.releaseWindowField.hidden = isImmediate;
  if (!isImmediate) els.releaseWindow.value = selected.dataset.hours;
}

function selectedFormulation() {
  const selected = els.formulationInputs.find((checkbox) => checkbox.checked) || els.formulationInputs[0];
  return {
    key: selected.value,
    label: selected.dataset.label,
    releaseHours: selected.value === "immediate" ? 0 : Number(els.releaseWindow.value),
  };
}

// ------------------------------------------------------------
// Doses: add / remove / reset
// ------------------------------------------------------------

function handleAddDose() {
  try {
    const dose = logic.addDoseToState({
      amount: els.doseInput.value,
      time: els.doseStartHour.value,
      formulation: selectedFormulation(),
    });
    renderDoseList();
    refreshChart();
    showToast(`${dose.formulation} dose added.`);
    // On phones the chart sits below the form, so bring it into view.
    if (window.matchMedia("(max-width: 1279px)").matches) {
      document.getElementById("chartCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (error) {
    showToast(error.message, true);
  }
}

function handleReset() {
  logic.resetState();
  renderDoseList();
  plot.clearPlot("myPlot");
  els.chartEmpty.hidden = false;
  showToast("Timeline reset.");
}

function renderDoseList() {
  const { addedDoses } = logic.getState();

  els.doseList.replaceChildren();
  els.doseCount.textContent = addedDoses.length;
  els.saveButton.disabled = addedDoses.length === 0;

  if (!addedDoses.length) {
    const empty = document.createElement("p");
    empty.className = "dose-list-empty";
    empty.textContent = "No doses added yet.";
    els.doseList.appendChild(empty);
    return;
  }

  addedDoses.forEach((dose) => {
    const card = document.createElement("article");
    card.className = "dose-card";

    const time = document.createElement("time");
    time.textContent = dose.time;
    time.style.color = dose.color;
    card.style.borderLeft = `3px solid ${dose.color}`;

    const details = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = dose.substance;
    const meta = document.createElement("span");
    meta.textContent = `${dose.amount} ${dose.unit} · ${dose.formulation}`;
    details.append(name, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-dose";
    remove.dataset.removeDose = String(dose.id);
    remove.setAttribute("aria-label", `Remove ${dose.substance} dose at ${dose.time}`);
    remove.textContent = "×";

    card.append(time, details, remove);
    els.doseList.appendChild(card);
  });
}

// ------------------------------------------------------------
// Chart refresh — bridges logic.computeTimeline() -> plot.renderPlot()
// ------------------------------------------------------------

function refreshChart() {
  const timeline = logic.computeTimeline();
  if (!timeline) {
    plot.clearPlot("myPlot");
    els.chartEmpty.hidden = false;
    return;
  }
  els.chartEmpty.hidden = true;
  plot.renderPlot(timeline, "myPlot");
}

// ------------------------------------------------------------
// Save
// ------------------------------------------------------------

async function handleSave() {
  const { addedDoses } = logic.getState();
  if (!addedDoses.length) return;

  // The journal stores one entry per substance, so send one request each.
  const now = new Date();
  const bySubstance = new Map();
  addedDoses.forEach((dose) => {
    if (!bySubstance.has(dose.substance)) bySubstance.set(dose.substance, []);
    bySubstance.get(dose.substance).push(dose);
  });
  const payloads = [...bySubstance].map(([name, doses]) => ({
    DrugName: name,
    Unit: doses[0].unit,
    Doses: doses.map((dose) => {
      const [hours, minutes] = dose.time.split(":").map(Number);
      const takenAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
      return {
        Time: takenAt.toISOString(),
        DoseAmount: String(dose.amount),
        Unit: dose.unit,
        Method: dose.formulation,
      };
    }),
  }));

  els.saveButton.disabled = true;
  els.saveButton.textContent = "Saving…";
  try {
    for (const data of payloads) {
      const response = await fetch("/sub/saveData", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Save failed");
    }
    showToast("Timeline saved to your journal.");
  } catch (_) {
    showToast("The timeline could not be saved. Please try again.", true);
  } finally {
    els.saveButton.disabled = false;
    els.saveButton.textContent = "Save data";
  }
}

// ------------------------------------------------------------
// Toast
// ------------------------------------------------------------

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle("error", isError);
  els.toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("visible"), 2800);
}
