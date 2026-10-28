// ============================================================
// likes.js
// Liking substances: the heart buttons on Journal, Drug info and
// Profile. Likes are saved per account through /likes.
// ============================================================

(function () {
  const HEART =
    '<svg class="xn-heart" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 20.3c-.3 0-.6-.1-.8-.3C6.9 16.4 3 13.2 3 8.9 3 6.2 5.1 4 7.7 4c1.7 0 3.3.9 4.3 2.3C13 4.9 14.6 4 16.3 4 18.9 4 21 6.2 21 8.9c0 4.3-3.9 7.5-8.2 11.1-.2.2-.5.3-.8.3z"/></svg>';

  let cache = null;

  function key(name) {
    return String(name || "").trim().toLowerCase();
  }

  // Map of lowercased name -> {name, image, class} for the signed-in account.
  function load() {
    if (!cache) {
      cache = fetch("/likes", { headers: { Accept: "application/json" } })
        .then((res) => {
          const json = (res.headers.get("content-type") || "").includes("json");
          return res.ok && json ? res.json() : [];
        })
        .then((list) => new Map(list.map((item) => [key(item.name), item])))
        .catch(() => new Map());
    }
    return cache;
  }

  async function set(sub, liked) {
    const res = await fetch("/likes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: sub.name, image: sub.image || "", class: sub.class || "", liked }),
    });
    if (res.status === 401) throw new Error("Log in again to like substances.");
    if (!res.ok) throw new Error((await res.text()).trim() || "Couldn't save that. Try again.");
    const map = await load();
    if (liked) map.set(key(sub.name), sub);
    else map.delete(key(sub.name));
    return liked;
  }

  function paint(button, sub, liked) {
    button.setAttribute("aria-pressed", String(liked));
    button.setAttribute("aria-label", (liked ? "Unlike " : "Like ") + sub.name);
    button.title = liked ? "Liked. Tap to unlike" : "Like";
    const label = button.querySelector("[data-like-label]");
    if (label) label.textContent = liked ? "Liked" : "Like";
  }

  // Turns a button into a like toggle for sub ({name, image, class}).
  // onChange(liked) runs after the server has saved the change.
  function bind(button, sub, liked, onChange) {
    if (!button.querySelector(".xn-heart")) button.insertAdjacentHTML("afterbegin", HEART);
    paint(button, sub, !!liked);
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.busy) return;
      const next = button.getAttribute("aria-pressed") !== "true";
      button.dataset.busy = "1";
      paint(button, sub, next);
      if (next) {
        button.classList.remove("is-pop");
        void button.offsetWidth;
        button.classList.add("is-pop");
      }
      try {
        await set(sub, next);
        if (next && window.xnToast) window.xnToast(sub.name + " is on your profile now.");
        if (onChange) onChange(next);
      } catch (error) {
        paint(button, sub, !next);
        if (window.xnToast) window.xnToast(error.message, true);
      } finally {
        delete button.dataset.busy;
      }
    });
  }

  window.xnLikes = { load, set, bind, key, HEART };
})();
