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

  // Page-leave fade for browsers without cross-document view transitions.
  // Browsers that have them (they fire "pagereveal") animate on their own.
  function initLeaveFade() {
    if ("onpagereveal" in window) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    document.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest("a[href]");
      if (!link || link.hasAttribute("download") || link.dataset.noTransition !== undefined) return;
      if (link.target && link.target !== "_self") return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (/\.[a-z0-9]{2,5}$/i.test(url.pathname) && !/\.html?$/i.test(url.pathname)) return; // file downloads

      event.preventDefault();
      document.body.classList.add("xn-leaving");
      setTimeout(() => { window.location.href = url.href; }, 150);
      // If the browser stays on this page (download, blocked nav), undo the fade.
      setTimeout(() => document.body.classList.remove("xn-leaving"), 1500);
    });

    // Back/forward cache restores the faded page; bring it back.
    window.addEventListener("pageshow", () => document.body.classList.remove("xn-leaving"));
  }

  initLeaveFade();

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
