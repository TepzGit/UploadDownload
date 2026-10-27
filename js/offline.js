// ============================================================
// offline.js
// Lets the Graph, Journal and Drug info work without internet:
//  - substance data from PsychonautWiki is kept on the phone (IndexedDB),
//    and the whole catalog is downloaded once a week while online;
//  - small JSON answers from our server are kept in localStorage;
//  - saves made offline wait in an outbox and go up when the phone is
//    back online (ui.js decides what to send).
// ============================================================

const DB_NAME = "geek4u-offline";
const STORE = "substances";
const CATALOG_KEY = "xn_catalog_at_2"; // _2: the catalog now has the Drug info details too
const CATALOG_EVERY = 7 * 24 * 3600 * 1000;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("no IndexedDB"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

function tx(mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const keyOf = (name) => String(name || "").trim().toLowerCase();

// The desktop app's server runs on this computer (it sets this cookie), so
// our own pages and saves always work there, with or without internet.
const LOCAL_SERVER = typeof document !== "undefined" && /(?:^|;\s*)xn_local=1(?:;|$)/.test(document.cookie);

/** True when the browser is sure our server can't be reached. */
export const isOffline = () => !LOCAL_SERVER && typeof navigator !== "undefined" && navigator.onLine === false;

/** A fetch() failure that means "no connection" rather than an error answer. */
export const isNetworkError = (error) => error instanceof TypeError || isOffline();

/**
 * Keeps substances (by name and by their other names). A substance already
 * saved keeps the fields the new copy doesn't have, so the Graph's smaller
 * answers never wipe the Drug info details from the weekly catalog.
 */
export async function putSubstances(list) {
  const items = list.filter((s) => s?.name);
  if (!items.length) return;
  try {
    await tx("readwrite", (store) => {
      items.forEach((s) => {
        const k = keyOf(s.name);
        const get = store.get(k);
        get.onsuccess = () => {
          const old = get.result;
          store.put(old && !old.alias ? { ...old, ...s } : s, k);
        };
        [].concat(s.commonNames || []).forEach((alias) => {
          const a = keyOf(alias);
          if (a && a !== k) store.put({ alias: s.name }, "@" + a);
        });
      });
    });
  } catch (_) {
    // No storage (private mode, full disk): the pages still work online.
  }
}

/** Every saved substance (for the Journal list offline). */
export async function allSubstances() {
  try {
    const keys = await tx("readonly", (store) => store.getAllKeys());
    const all = await tx("readonly", (store) => store.getAll());
    return all.filter((v, i) => !String(keys[i]).startsWith("@") && v?.name);
  } catch (_) {
    return [];
  }
}

/** A saved substance by its name or another name, or null. */
export async function getSubstance(name) {
  try {
    const k = keyOf(name);
    let hit = await tx("readonly", (store) => store.get(k));
    if (!hit) {
      const alias = await tx("readonly", (store) => store.get("@" + k));
      if (alias?.alias) hit = await tx("readonly", (store) => store.get(keyOf(alias.alias)));
    }
    return hit || null;
  } catch (_) {
    return null;
  }
}

/** Saved substance names containing the text, for the search box offline. */
export async function searchNames(text, limit = 8) {
  const q = keyOf(text);
  if (!q) return [];
  try {
    const keys = await tx("readonly", (store) => store.getAllKeys());
    const names = keys.filter((k) => !k.startsWith("@") && k.includes(q))
      .sort((a, b) => (a.startsWith(q) ? 0 : 1) - (b.startsWith(q) ? 0 : 1) || a.localeCompare(b))
      .slice(0, limit);
    const items = await Promise.all(names.map((k) => tx("readonly", (store) => store.get(k))));
    return items.filter(Boolean);
  } catch (_) {
    return [];
  }
}

/**
 * Downloads every substance once a week (in pages of 250) so the Graph can
 * draw any of them offline. fetchPage(offset) returns one page.
 */
export async function refreshCatalog(fetchPage, { force = false } = {}) {
  if (isOffline()) return false;
  let last = 0;
  try { last = Number(localStorage.getItem(CATALOG_KEY)) || 0; } catch {}
  if (!force && Date.now() - last < CATALOG_EVERY) return false;
  try {
    for (let offset = 0; offset < 4000; offset += 250) {
      const page = await fetchPage(offset);
      if (!Array.isArray(page)) throw new Error("catalog page failed");
      await putSubstances(page);
      if (page.length < 250) break;
    }
    try { localStorage.setItem(CATALOG_KEY, String(Date.now())); } catch {}
    return true;
  } catch (_) {
    return false; // try again next time the Graph opens
  }
}

// ---- small JSON answers from our server ----

/** GETs JSON; keeps the last good answer and returns it when offline. */
export async function cachedJson(url, key) {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) return { res, data: null, offline: false };
    const data = await res.json();
    try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
    return { res, data, offline: false };
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    let data = null;
    try { data = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
    return { res: null, data, offline: true };
  }
}

export function saveJson(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

export function readJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
