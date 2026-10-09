// ============================================================
// nav.js
// Shared nav bar: highlights the current page and drives the
// phone menu (tap to open, tap outside / Esc / pick a link to close).
// ============================================================

(function () {
  document.documentElement.classList.add("xn-js");

  function init() {
    const nav = document.querySelector(".xn");
    if (!nav) return;
    const toggle = nav.querySelector(".xn-toggle");
    const links = nav.querySelectorAll(".xn-links a");

    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    links.forEach((link) => {
      const target = (link.getAttribute("href") || "").replace(/\/+$/, "") || "/";
      const match = target === "/" ? path === "/" : path === target || path.startsWith(target + "/");
      if (match) link.setAttribute("aria-current", "page");
    });

    if (!toggle) return;

    function setOpen(open) {
      nav.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    }

    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(!nav.classList.contains("open"));
    });
    links.forEach((link) => link.addEventListener("click", () => setOpen(false)));
    document.addEventListener("click", (event) => {
      if (!nav.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setOpen(false);
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth >= 768) setOpen(false);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
