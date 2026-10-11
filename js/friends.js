// friends.js: friend requests. The friend button on /u/<name>, the Friends
// box on Profile and the requests on the Forum all use these.
import { avatar, profileLink, paintName } from "/forum.js";

const toast = (msg, bad) => window.xnToast && window.xnToast(msg, bad);

/** POST /friends; answers the new state: "friends", "outgoing", "incoming" or "". */
export async function friendAction(action, user) {
  const res = await fetch("/friends", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, user }),
  });
  if (res.status === 401) throw new Error("Log in again to change your friends.");
  if (!res.ok) throw new Error((await res.text()).trim() || "Couldn't change that. Try again.");
  return (await res.json()).state;
}

export async function loadFriends() {
  const res = await fetch("/friends", { headers: { Accept: "application/json" } });
  if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) throw new Error("Couldn't load your friends.");
  return res.json();
}

function button(text, primary) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "xn-btn" + (primary ? " xn-btn-primary" : "");
  b.textContent = text;
  return b;
}

/**
 * Draws the friend controls for one account into container and keeps them
 * up to date. onChange(state) runs after every change.
 */
export function friendButton(container, name, state, onChange = () => {}) {
  async function act(action, buttonEl, done) {
    container.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      state = await friendAction(action, name);
      render();
      toast(done);
      onChange(state);
      container.querySelector("button")?.focus({ preventScroll: true });
    } catch (error) {
      toast(error.message, true);
      render();
    }
  }

  function render() {
    container.replaceChildren();
    container.dataset.state = state;
    if (state === "friends") {
      const b = button("Friends ✓");
      b.classList.add("fr-on");
      let armed = null;
      const disarm = () => {
        clearTimeout(armed);
        armed = null;
        b.classList.remove("is-confirm");
        b.textContent = "Friends ✓";
      };
      b.addEventListener("blur", disarm);
      b.addEventListener("click", () => {
        if (!armed) {
          b.classList.add("is-confirm");
          b.textContent = "Remove friend?";
          armed = setTimeout(disarm, 4000);
          return;
        }
        disarm();
        act("remove", b, name + " is no longer on your friends list.");
      });
      container.append(b);
    } else if (state === "outgoing") {
      const note = document.createElement("span");
      note.className = "fr-note";
      note.textContent = "Request sent";
      const cancel = button("Cancel request");
      cancel.addEventListener("click", () => act("cancel", cancel, "Friend request cancelled."));
      container.append(note, cancel);
    } else if (state === "incoming") {
      const accept = button("Accept friend request", true);
      accept.addEventListener("click", () => act("accept", accept, "You and " + name + " are friends now."));
      const decline = button("Decline");
      decline.addEventListener("click", () => act("decline", decline, "Request declined."));
      container.append(accept, decline);
    } else {
      const add = button("Add friend", true);
      add.addEventListener("click", () => act("request", add, "Friend request sent to " + name + "."));
      container.append(add);
    }
  }
  render();
}

/** One person in a friends list: picture and name linking to their profile, a short note, and buttons. */
export function personRow(who, note = "", actions = []) {
  const row = document.createElement("div");
  row.className = "fr-row";
  row.dataset.name = who.name.toLowerCase();
  const link = document.createElement("a");
  link.className = "fr-link";
  link.href = profileLink(who.name);
  const text = document.createElement("span");
  text.className = "fr-text";
  const strong = document.createElement("strong");
  strong.textContent = who.name;
  paintName(strong, who);
  text.append(strong);
  if (note) {
    const small = document.createElement("small");
    small.textContent = note;
    text.append(small);
  }
  link.append(avatar(who), text);
  row.append(link);
  if (actions.length) {
    const box = document.createElement("div");
    box.className = "fr-actions";
    box.append(...actions);
    row.append(box);
  }
  return row;
}

function smallButton(text, primary, onClick) {
  const b = button(text, primary);
  b.classList.add("fr-small");
  b.addEventListener("click", onClick);
  return b;
}

/**
 * Incoming requests with Accept / Decline. Calls onChange() after each
 * answer. Returns how many requests are waiting.
 */
export function renderRequests(target, incoming, onChange) {
  target.replaceChildren(...incoming.map((who) => {
    const answer = (action, done) => async (event) => {
      const row = event.currentTarget.closest(".fr-row");
      row.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        await friendAction(action, who.name);
        toast(done);
        onChange();
      } catch (error) {
        toast(error.message, true);
        row.querySelectorAll("button").forEach((b) => (b.disabled = false));
      }
    };
    return personRow(who, "Wants to be friends", [
      smallButton("Accept", true, answer("accept", "You and " + who.name + " are friends now.")),
      smallButton("Decline", false, answer("decline", "Request declined.")),
    ]);
  }));
  return incoming.length;
}

/** The Friends box on Profile: requests, friends and requests you sent. */
export async function mountFriendsBox(list, count) {
  async function refresh() {
    let data;
    try {
      data = await loadFriends();
    } catch (error) {
      list.innerHTML = '<p class="xn-empty"></p>';
      list.firstChild.textContent = error.message + " Reload the page to try again.";
      return;
    }
    list.replaceChildren();
    count.textContent = data.friends.length === 1 ? "1 friend" : data.friends.length + " friends";
    if (data.incoming.length) {
      const group = document.createElement("div");
      group.className = "fr-group";
      renderRequests(group, data.incoming, refresh);
      list.append(group);
    }
    data.friends.forEach((who) => list.append(personRow(who, who.admin ? "Admin" : "Friend")));
    data.outgoing.forEach((who) => {
      list.append(personRow(who, "Request sent", [
        smallButton("Cancel", false, async (event) => {
          event.currentTarget.disabled = true;
          try {
            await friendAction("cancel", who.name);
            toast("Friend request cancelled.");
          } catch (error) {
            toast(error.message, true);
          }
          refresh();
        }),
      ]));
    });
    if (!list.children.length) {
      const empty = document.createElement("p");
      empty.className = "xn-empty";
      empty.innerHTML = 'No friends yet. Open someone\'s profile from the <a href="/Forum">Forum</a> and tap Add friend.';
      list.append(empty);
    }
  }
  await refresh();
}
