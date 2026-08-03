function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function showToast(message) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("is-visible"), 2000);
}

function copyLink(url, btn) {
  navigator.clipboard.writeText(url).then(() => {
    if (btn) {
      const original = btn.textContent;
      btn.textContent = "Copied!";
      btn.classList.add("is-copied");
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove("is-copied");
      }, 1500);
    } else {
      showToast("Link copied!");
    }
  }).catch(() => {
    showToast("Could not copy link");
  });
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  } catch { return ""; }
}

/** Human-readable age for recent dates; falls back to formatDate for older. */
function formatRelativeDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diffMs = now - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return min === 1 ? "1 minute ago" : `${min} minutes ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr === 1 ? "1 hour ago" : `${hr} hours ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return day === 1 ? "1 day ago" : `${day} days ago`;
  const week = Math.floor(day / 7);
  if (day < 35) return week === 1 ? "1 week ago" : `${week} weeks ago`;
  return formatDate(iso);
}

function escapeHtml(str) {
  if (str == null || str === "") return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Optional override: full URL to deployed site root (trailing slash optional), e.g. https://org.github.io/repo/ */
let _publicSiteBaseFromConfig = null;

function normalizePublicBase(url) {
  if (url == null) return null;
  const s = String(url).trim();
  if (!s) return null;
  try {
    const raw = /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`;
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    let path = u.pathname || "/";
    if (!path.endsWith("/")) path += "/";
    return `${u.origin}${path}`;
  } catch {
    return null;
  }
}

function githubIoPagesBase() {
  const u = new URL(window.location.href);
  let path = u.pathname.replace(/[^/]*$/, "");
  if (!path.endsWith("/")) path += "/";
  return `${u.origin}${path}`;
}

function currentOriginToolBase() {
  try {
    return new URL(".", document.baseURI).href;
  } catch {
    return `${window.location.origin}/`;
  }
}

/**
 * Root URL for built-in pages (prototype.html, etc.) when copying share links.
 * Order: site.json publicBaseUrl → window.__DESIGN_CORE_PUBLIC_BASE__ → meta design-core-public-url → *.github.io path → current page origin.
 */
function shareBaseUrl() {
  if (_publicSiteBaseFromConfig) return _publicSiteBaseFromConfig;
  const w = typeof window !== "undefined" && window.__DESIGN_CORE_PUBLIC_BASE__;
  const fromWin = normalizePublicBase(w);
  if (fromWin) return fromWin;
  const meta = typeof document !== "undefined" && document.querySelector('meta[name="design-core-public-url"]');
  if (meta) {
    const fromMeta = normalizePublicBase(meta.getAttribute("content"));
    if (fromMeta) return fromMeta;
  }
  if (typeof location !== "undefined" && /\.github\.io$/i.test(location.hostname)) {
    return githubIoPagesBase();
  }
  return currentOriginToolBase();
}

/** Load optional public/data/site.json so share links work on localhost (set publicBaseUrl to your GitHub Pages URL). */
function loadSiteConfig() {
  return fetchJSON("data/site.json")
    .then((cfg) => {
      const n = normalizePublicBase(cfg && cfg.publicBaseUrl);
      if (n) _publicSiteBaseFromConfig = n;
    })
    .catch(() => {});
}

function projectHubUrl(projectId) {
  const base = shareBaseUrl();
  try {
    const u = new URL("project.html", base);
    u.searchParams.set("id", projectId);
    return u.href;
  } catch {
    return `${base.replace(/\/?$/, "/")}project.html?id=${encodeURIComponent(projectId)}`;
  }
}

function initials(name) {
  if (!name) return "?";
  return name.split(/\s+/).map(w => w[0]).join("").slice(0, 2);
}

function fetchJSON(url) {
  return fetch(url).then(r => {
    if (!r.ok) throw new Error(r.status + " " + r.statusText);
    return r.json();
  });
}

/** Trimmed raw value from meta (for forms). May be invalid or incomplete. */
function prototypeExternalTestRaw(meta) {
  if (!meta || meta.externalTestUrl == null) return "";
  const raw = meta.externalTestUrl;
  return (typeof raw === "string" ? raw : String(raw)).trim();
}

/**
 * Normalized http(s) href if the string is a plausible external test URL.
 * Rejects junk (e.g. "true"), non-http schemes, and hostnames without a dot
 * (except localhost). Used for "Tested" UI, counts, and navigation.
 */
function prototypeExternalTestHref(raw) {
  const t = (raw && String(raw).trim()) || "";
  if (!t) return "";
  let u;
  try {
    u = new URL(t);
  } catch {
    try {
      u = new URL("https://" + t.replace(/^\/+/, ""));
    } catch {
      return "";
    }
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  const host = (u.hostname || "").toLowerCase();
  if (!host || host.length < 2) return "";
  if (host !== "localhost" && !host.includes(".")) return "";
  return u.href;
}

/** Valid usability-test URL for badge, links, and home counts. */
function prototypeExternalTestUrl(meta) {
  return prototypeExternalTestHref(prototypeExternalTestRaw(meta));
}

/** For home list cards: screen/proto counts and dates from project files. Counts are null if the file failed to load. */
function fetchProjectListDetails(projectId) {
  const b = "data/projects/" + encodeURIComponent(projectId) + "/";
  return Promise.all([
    fetchJSON(b + "project.json").catch(() => ({})),
    fetchJSON(b + "canvas.json")
      .then((c) => ({ ok: true, count: (c.screens || []).length }))
      .catch(() => ({ ok: false, count: 0 })),
    fetchJSON(b + "prototypes/index.json")
      .then((d) => {
        const list = d.prototypes || [];
        return {
          ok: true,
          count: list.length,
          ids: list.map((p) => p.id).filter(Boolean),
        };
      })
      .catch(() => ({ ok: false, count: 0, ids: [] })),
  ]).then(([proj, canvas, protoIndex]) => {
    const base = {
      updatedAt: proj.updatedAt || null,
      createdAt: proj.createdAt || null,
      screenCount: canvas.ok ? canvas.count : null,
      protoCount: protoIndex.ok ? protoIndex.count : null,
      testedProtoCount: null,
    };
    if (!protoIndex.ok) return base;
    const ids = protoIndex.ids;
    if (!ids.length) return { ...base, testedProtoCount: 0 };
    return Promise.all(
      ids.map((id) =>
        fetchJSON(
          b + "prototypes/" + encodeURIComponent(id) + "/meta.json",
        ).catch(() => ({})),
      ),
    ).then((metas) => {
      let n = 0;
      for (const m of metas) {
        if (prototypeExternalTestUrl(m)) n++;
      }
      return { ...base, testedProtoCount: n };
    });
  });
}

function parseDateMs(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Share URL for a prototype (embed view). Optional hashFragment mirrors the
 * prototype document hash (e.g. "#transfer-review") for deep links / Maze.
 */
function prototypeUrl(projectId, protoId, hashFragment) {
  const base = shareBaseUrl();
  const q = `prototype.html?project=${encodeURIComponent(projectId)}&proto=${encodeURIComponent(protoId)}&view=embed`;
  let fragment = "";
  if (hashFragment != null && hashFragment !== "") {
    const raw = String(hashFragment).trim();
    if (raw !== "" && raw !== "#") {
      const inner = raw.startsWith("#") ? raw.slice(1) : raw;
      if (inner !== "") fragment = "#" + inner;
    }
  }
  const full = q + fragment;
  try {
    return new URL(full, base).href;
  } catch {
    return `${base.replace(/\/?$/, "/")}${full}`;
  }
}

/** Cached: true when Vite dev server exposes /api/tool-env (local editing enabled). */
let _localToolServerCache = null;

function isLocalToolServer() {
  if (_localToolServerCache !== null) return Promise.resolve(_localToolServerCache);
  return fetch("/api/tool-env")
    .then((r) => {
      if (!r.ok) {
        _localToolServerCache = false;
        return false;
      }
      return r.json().then((j) => {
        _localToolServerCache = !!j.local;
        return _localToolServerCache;
      });
    })
    .catch(() => {
      _localToolServerCache = false;
      return false;
    });
}

function putDataJson(relPath, obj) {
  const url = relPath.startsWith("/") ? relPath : `/${relPath.replace(/^\/+/, "")}`;
  return fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj, null, 2),
  }).then((r) => {
    if (!r.ok) throw new Error("Could not save");
  });
}

function postProjectAdmin(payload) {
  return fetch("/api/project-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Request failed");
    return j;
  });
}

/** Lowercase slug for project/prototype folder names (a-z, 0-9, hyphens). */
function slugifyDataId(str, fallback) {
  const fb = fallback == null ? "item" : fallback;
  const s = String(str || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    // slice() can cut mid-group and leave a trailing hyphen; the server's
    // SLUG_RE then rejects it with a confusing "must be lowercase letters…"
    .replace(/-+$/g, "");
  return s || fb;
}

/**
 * Calls postProjectAdmin(payloadFn(id)). If the server reports an id collision, retries with -2, -3, …
 */
function postProjectAdminAutoId(baseId, payloadFn) {
  let n = 0;
  function attempt() {
    const id = n === 0 ? baseId : baseId + "-" + (n + 1);
    return postProjectAdmin(payloadFn(id)).catch((err) => {
      const msg = String(err && err.message ? err.message : "");
      if (/already exists/i.test(msg) && n < 24) {
        n++;
        return attempt();
      }
      throw err;
    });
  }
  return attempt();
}

/** Unique display names from `.designer` (you + `team`) for attribution pickers. */
function designerAttributionNames(profile) {
  const prof = profile || {};
  const out = [];
  const seen = new Set();
  function add(n) {
    const t = String(n || "").trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  }
  add(prof.name);
  if (Array.isArray(prof.team)) {
    prof.team.forEach((m) => add(m && m.name));
  }
  return out;
}

function fetchDesignerProfile() {
  return fetch("/api/designer")
    .then((r) => {
      if (!r.ok) throw new Error("unavailable");
      return r.json();
    })
    .catch(() => ({ name: "", company: "", team: [] }));
}

function saveDesignerProfile(data) {
  return fetch("/api/designer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(async (r) => {
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || "Could not save profile");
    }
  });
}

/**
 * Wire a "Created by" dropdown that only lets you pick a real user from
 * `.designer`. No free-typed attribution — choosing "Add a user…" reveals an
 * input that persists the new name to `.designer` and re-selects it.
 * opts: { select, addRow, addInput, addBtn, defaultToOwner }.
 * Returns { refresh(preferredName) -> Promise, getValue() -> Promise<string> }.
 */
function setupAttributionPicker(opts) {
  const select = opts.select;
  const addRow = opts.addRow;
  const addInput = opts.addInput;
  const addBtn = opts.addBtn;
  const ADD = "__add_user__";
  let profile = { name: "", company: "", team: [] };

  function names() {
    return designerAttributionNames(profile);
  }

  // Toggle the add-user row via inline display so it works regardless of the
  // `hidden` attribute, which an inline display style would otherwise override.
  function showAddRow(on) {
    addRow.style.display = on ? "flex" : "none";
  }

  function rebuild(selected) {
    const list = names();
    const want = String(selected == null ? "" : selected).trim();
    const known = list.some((n) => n.toLowerCase() === want.toLowerCase());
    select.innerHTML = "";
    select.appendChild(new Option(opts.emptyLabel || "Unassigned", ""));
    if (want && !known) select.appendChild(new Option(want, want));
    list.forEach((n) => select.appendChild(new Option(n, n)));
    select.appendChild(new Option("+ Add a user…", ADD));
    select.value = want;
    syncAddRow();
  }

  function syncAddRow() {
    const adding = select.value === ADD;
    showAddRow(adding);
    if (adding) {
      addInput.value = "";
      addInput.focus();
    }
  }

  // Persist a new team member to `.designer`, then re-select them. Resolves to
  // the added name, or null if nothing was added (blank input or save failed).
  function commitAdd() {
    const name = addInput.value.trim();
    if (!name) {
      addInput.focus();
      return Promise.resolve(null);
    }
    const existing = names().find((n) => n.toLowerCase() === name.toLowerCase());
    if (existing) {
      rebuild(existing);
      return Promise.resolve(existing);
    }
    const team = Array.isArray(profile.team) ? profile.team.slice() : [];
    team.push({ name });
    const next = { name: profile.name || "", company: profile.company || "", team };
    return saveDesignerProfile(next)
      .then(() => {
        profile = next;
        rebuild(name);
        return name;
      })
      .catch((err) => {
        if (typeof showToast === "function") showToast(err.message || "Could not add user");
        return null;
      });
  }

  showAddRow(false);
  select.addEventListener("change", syncAddRow);
  addBtn.addEventListener("click", function () {
    commitAdd();
  });
  addInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitAdd();
    }
  });

  return {
    refresh: function (preferredName) {
      return fetchDesignerProfile()
        .then((prof) => {
          profile = prof || { name: "", company: "", team: [] };
          let want = preferredName != null ? String(preferredName).trim() : "";
          if (!want && opts.defaultToOwner) want = String(profile.name || "").trim();
          rebuild(want);
          return profile;
        })
        .catch(() => {
          profile = { name: "", company: "", team: [] };
          rebuild(preferredName || "");
        });
    },
    // Resolves to the chosen name ("" = Unassigned). If "Add a user…" is active,
    // commit the typed name first; rejects if nothing valid was added so the
    // caller can abort instead of wiping attribution.
    getValue: function () {
      if (select.value === ADD) {
        return commitAdd().then((added) => {
          if (!added) return Promise.reject(new Error("add-user-incomplete"));
          return added;
        });
      }
      return Promise.resolve(select.value.trim());
    },
  };
}

function syncProjectIndexEntry(projectId, patch) {
  return fetchJSON("data/projects/index.json").then((idx) => {
    const projects = Array.isArray(idx.projects) ? idx.projects.slice() : [];
    const i = projects.findIndex((p) => p.id === projectId);
    if (i < 0) return Promise.resolve();
    const next = { ...projects[i], ...patch };
    Object.keys(patch).forEach((k) => {
      if (patch[k] === null) delete next[k];
    });
    projects[i] = next;
    return putDataJson("data/projects/index.json", { projects });
  });
}

/* ── Project status & tags (optional metadata) ── */
const PROJECT_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "in-progress", label: "In progress" },
  { value: "shipped", label: "Shipped" },
  { value: "archived", label: "Archived" },
];

function normalizeProjectStatus(value) {
  const v = String(value || "").trim().toLowerCase();
  return PROJECT_STATUSES.some((s) => s.value === v) ? v : "";
}

function projectStatusLabel(value) {
  const s = PROJECT_STATUSES.find((x) => x.value === normalizeProjectStatus(value));
  return s ? s.label : "";
}

/** Accepts an array or comma-separated string; returns a de-duped, trimmed list. */
function normalizeProjectTags(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const t = String(item || "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Stable hue (0–359) derived from a project id, for per-project color accents. */
function projectHue(id) {
  const s = String(id || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/* ── Current user & per-user prefs ──
   Favorites, recents, theme, and filters are saved per user. Which user you are
   is remembered per browser (localStorage); their prefs live in a committed
   file (public/data/users/<slug>.json) when the dev server is running, with a
   localStorage mirror for instant, offline reads. */
const CURRENT_USER_KEY = "design-core:current-user";
const PREFS_MIRROR_PREFIX = "design-core:prefs:v2:";
const LEGACY_FAVORITES_KEY = "design-core:favorites";
const LEGACY_RECENTS_KEY = "design-core:recents";
const GUEST_SLUG = "__guest__";
const RECENTS_MAX = 12;

let _userState = null;
let _userStateSlug = null;
let _prefsSaveTimer = null;
let _pendingSave = null;
let _prefsStorageReady = false;

function readLsArray(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeLs(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** Display name of the selected user ("" = nobody picked yet). */
function getCurrentUserName() {
  try {
    return (localStorage.getItem(CURRENT_USER_KEY) || "").trim();
  } catch {
    return "";
  }
}

/** Folder/file-safe id for a user name. */
function userSlug(name) {
  const t = String(name || "").trim();
  if (!t) return "";
  const s = slugifyDataId(t, "");
  if (s) return s;
  // Non-latin names slugify to empty; derive a stable id so each gets its own bucket.
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return "u-" + h.toString(16);
}

function currentUserSlug() {
  return userSlug(getCurrentUserName());
}

function defaultPrefs() {
  return { name: "", favorites: [], recents: [], theme: null, filters: { sort: "", status: "" }, navCollapsed: null, updatedAt: 0 };
}

function normalizePrefs(p) {
  const d = defaultPrefs();
  if (!p || typeof p !== "object") return d;
  return {
    name: typeof p.name === "string" ? p.name : "",
    favorites: Array.isArray(p.favorites) ? p.favorites.filter((x) => typeof x === "string") : [],
    recents: Array.isArray(p.recents) ? p.recents.filter((e) => e && typeof e.id === "string") : [],
    theme: p.theme === "light" || p.theme === "dark" ? p.theme : null,
    filters: {
      sort: p.filters && typeof p.filters.sort === "string" ? p.filters.sort : "",
      status: p.filters && typeof p.filters.status === "string" ? p.filters.status : "",
    },
    navCollapsed: typeof p.navCollapsed === "boolean" ? p.navCollapsed : null,
    updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : 0,
  };
}

function prefsMirrorKey(slug) {
  // Browser storage is shared by every app served from the same origin. Local
  // Design Core repos normally all run at localhost:3000, so user name alone
  // is not enough to isolate favorites and recents. site.json supplies the
  // deployed repo URL, which gives every company checkout a stable scope.
  const base = _publicSiteBaseFromConfig || shareBaseUrl();
  const scope = encodeURIComponent(String(base || "").replace(/\/+$/, "").toLowerCase());
  return PREFS_MIRROR_PREFIX + scope + ":" + (slug || GUEST_SLUG);
}

function readPrefsMirror(slug) {
  if (!_prefsStorageReady) return null;
  try {
    const v = JSON.parse(localStorage.getItem(prefsMirrorKey(slug)) || "null");
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function writePrefsMirror(slug, prefs) {
  if (!_prefsStorageReady) return;
  try {
    localStorage.setItem(prefsMirrorKey(slug), JSON.stringify(prefs));
  } catch {}
}

/** Loads the active user's prefs into memory (sync, from the mirror or legacy keys). */
function hydrateUserState() {
  const slug = currentUserSlug();
  const mirror = readPrefsMirror(slug);
  let prefs;
  if (mirror) {
    prefs = normalizePrefs(mirror);
  } else {
    prefs = defaultPrefs();
    const legFav = readLsArray(LEGACY_FAVORITES_KEY).filter((x) => typeof x === "string");
    const legRec = readLsArray(LEGACY_RECENTS_KEY).filter((e) => e && typeof e.id === "string");
    if (legFav.length) prefs.favorites = legFav.slice();
    if (legRec.length) prefs.recents = legRec.slice(0, RECENTS_MAX);
    writePrefsMirror(slug, prefs);
    // One-time migration: drop the old per-browser keys so the next user starts clean.
    try { localStorage.removeItem(LEGACY_FAVORITES_KEY); localStorage.removeItem(LEGACY_RECENTS_KEY); } catch {}
  }
  prefs.name = getCurrentUserName() || prefs.name || "";
  _userState = prefs;
  _userStateSlug = slug;
  return prefs;
}

/** The active user's prefs object (re-hydrates if the selected user changed). */
function userState() {
  if (_userState === null || _userStateSlug !== currentUserSlug()) hydrateUserState();
  return _userState;
}

function emitUserPrefsChanged() {
  try {
    window.dispatchEvent(new CustomEvent("dc:user-prefs-changed"));
  } catch {}
}

function emitUserChanged() {
  try {
    window.dispatchEvent(new CustomEvent("dc:user-changed", { detail: { name: getCurrentUserName() } }));
  } catch {}
}

/** Writes prefs to the local mirror immediately and debounce-saves to the server for a real user. */
function persistUserPrefs() {
  const slug = currentUserSlug();
  const prefs = userState();
  prefs.name = getCurrentUserName() || prefs.name || "";
  prefs.updatedAt = Date.now();
  writePrefsMirror(slug, prefs);
  if (slug) {
    _pendingSave = { slug, prefs };
    clearTimeout(_prefsSaveTimer);
    _prefsSaveTimer = setTimeout(flushPendingPrefsSave, 400);
  }
}

/** Flushes any debounced server save immediately (e.g. before switching user). */
function flushPendingPrefsSave() {
  clearTimeout(_prefsSaveTimer);
  const p = _pendingSave;
  _pendingSave = null;
  if (p && p.slug) saveUserPrefsToServer(p.slug, p.prefs);
}

function fetchUserPrefs(slug) {
  if (!slug) return Promise.resolve(null);
  return fetch("/api/user-prefs?user=" + encodeURIComponent(slug))
    .then((r) => { if (!r.ok) throw new Error("unavailable"); return r.json(); })
    .catch(() => null);
}

function saveUserPrefsToServer(slug, prefs) {
  if (!slug) return Promise.resolve(false);
  return fetch("/api/user-prefs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: slug, prefs }),
  }).then((r) => r.ok).catch(() => false);
}

/** Pulls the authoritative server copy for the selected user; seeds the server file if none exists yet. */
function refreshUserPrefsFromServer() {
  const slug = currentUserSlug();
  if (!slug) return Promise.resolve(userState());
  return fetchUserPrefs(slug).then((server) => {
    // Ignore a stale response if the user switched while the request was in flight.
    if (currentUserSlug() !== slug) return _userState;
    if (server && typeof server === "object") {
      const incoming = normalizePrefs(server);
      const localTs = (userState().updatedAt) || 0;
      // Adopt the server copy only when it's at least as fresh as the local mirror;
      // otherwise the local mirror has newer offline/in-flight edits — keep and push them up.
      if ((incoming.updatedAt || 0) >= localTs) {
        incoming.name = getCurrentUserName() || incoming.name || "";
        _userState = incoming;
        _userStateSlug = slug;
        writePrefsMirror(slug, incoming);
        applyUserTheme();
        emitUserPrefsChanged();
      } else {
        persistUserPrefs();
      }
    } else {
      persistUserPrefs();
    }
    return _userState;
  });
}

/** Applies the active user's saved theme and keeps the dc-theme boot cache in lockstep so a reload never flashes the previous user's theme. */
function applyUserTheme() {
  const root = document.documentElement;
  const t = userState().theme;
  const explicit = t === "light" || t === "dark" ? t : null;
  if (explicit && root.getAttribute("data-theme") !== explicit) {
    root.setAttribute("data-theme", explicit);
  }
  // A user with no saved theme keeps the current document theme (the shared default).
  const effective = explicit || (root.getAttribute("data-theme") === "light" ? "light" : "dark");
  try { localStorage.setItem("dc-theme", effective); } catch {}
}

/** Switches the active user; loads their prefs and notifies the page. Pass "" to clear. */
function setCurrentUser(name) {
  flushPendingPrefsSave();
  const n = String(name || "").trim();
  try {
    if (n) localStorage.setItem(CURRENT_USER_KEY, n);
    else localStorage.removeItem(CURRENT_USER_KEY);
  } catch {}
  hydrateUserState();
  applyUserTheme();
  emitUserChanged();
  emitUserPrefsChanged();
  refreshUserPrefsFromServer();
}

function getFavoriteProjectIds() {
  return userState().favorites.filter((x) => typeof x === "string");
}

function isFavoriteProject(id) {
  return getFavoriteProjectIds().includes(id);
}

/** Toggles favorite state for a project id; returns the new state (true = favorited). */
function toggleFavoriteProject(id) {
  const list = userState().favorites;
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else list.unshift(id);
  persistUserPrefs();
  emitUserPrefsChanged();
  return list.includes(id);
}

/** Reorders favorites to match the given id order (drag-and-drop in the side rail). */
function setFavoriteOrder(ids) {
  const have = new Set(userState().favorites);
  const next = [];
  ids.forEach((id) => { if (have.has(id) && !next.includes(id)) next.push(id); });
  userState().favorites.forEach((id) => { if (!next.includes(id)) next.push(id); });
  _userState.favorites = next;
  persistUserPrefs();
  emitUserPrefsChanged();
}

/** Removes favorites and recents for projects that do not exist in this repo. */
function pruneUnknownProjectPrefs(projectIds) {
  const known = new Set((projectIds || []).filter((id) => typeof id === "string"));
  const prefs = userState();
  const favorites = prefs.favorites.filter((id) => known.has(id));
  const recents = prefs.recents.filter((entry) => entry && known.has(entry.id));
  if (favorites.length === prefs.favorites.length && recents.length === prefs.recents.length) return false;
  _userState.favorites = favorites;
  _userState.recents = recents;
  persistUserPrefs();
  emitUserPrefsChanged();
  return true;
}

/** Records that the user just opened a project (most-recent first, capped). */
function recordRecentProject(id) {
  if (!id) return;
  const list = userState().recents.filter((e) => e && e.id && e.id !== id);
  list.unshift({ id, ts: Date.now() });
  _userState.recents = list.slice(0, RECENTS_MAX);
  persistUserPrefs();
  emitUserPrefsChanged();
}

/** Recently opened project ids, most recent first. */
function getRecentProjectIds() {
  return userState().recents
    .filter((e) => e && typeof e.id === "string")
    .map((e) => e.id);
}

/** Collapsed state for the side rail (per user); falls back to the page default. */
function getNavCollapsed(defaultVal) {
  const v = userState().navCollapsed;
  return typeof v === "boolean" ? v : !!defaultVal;
}

function setNavCollapsed(val) {
  userState().navCollapsed = !!val;
  _userState.navCollapsed = !!val;
  persistUserPrefs();
}

/** Saved home sort/status filter for the active user. */
function getViewPref(which) {
  const f = userState().filters || {};
  return which === "status" ? (f.status || "") : (f.sort || "");
}

function setViewPrefs(sort, status) {
  userState().filters = { sort: sort || "", status: status || "" };
  _userState.filters = { sort: sort || "", status: status || "" };
  persistUserPrefs();
}

/** Saves the active user's theme choice (called by the nav theme toggle). */
function setUserTheme(theme) {
  userState().theme = theme === "light" || theme === "dark" ? theme : null;
  _userState.theme = userState().theme;
  persistUserPrefs();
}

/** Committed list of users for the picker; works on the static site too. */
function fetchUsersIndex() {
  return fetchJSON("data/users/index.json")
    .then((d) => (Array.isArray(d.users) ? d.users : []))
    .catch(() => []);
}

/** Names the identity picker can offer: the designer team plus any committed users. */
function fetchSelectableUsers() {
  return Promise.all([
    fetchDesignerProfile().then((p) => designerAttributionNames(p)).catch(() => []),
    fetchUsersIndex().then((list) => list.map((u) => u && u.name).filter(Boolean)).catch(() => []),
  ]).then(([a, b]) => {
    const seen = new Set();
    const out = [];
    [...a, ...b].forEach((n) => {
      const t = String(n || "").trim();
      const k = t.toLowerCase();
      if (t && !seen.has(k)) { seen.add(k); out.push(t); }
    });
    return out;
  });
}

/** Adds a name to the designer team so attribution pickers include it too. */
function addDesignerTeamMember(name) {
  const n = String(name || "").trim();
  if (!n) return Promise.resolve(false);
  return fetchDesignerProfile()
    .then((prof) => {
      const team = Array.isArray(prof.team) ? prof.team.slice() : [];
      if (team.some((m) => m && String(m.name || "").trim().toLowerCase() === n.toLowerCase())) return true;
      team.push({ name: n });
      return saveDesignerProfile({ name: prof.name || "", company: prof.company || "", team })
        .then(() => true)
        .catch(() => false);
    })
    .catch(() => false);
}

// Resolve site.json before reading the browser mirror so the storage key is
// scoped to this repo even when several checkouts all use localhost:3000.
// Until that short fetch finishes, callers see an empty in-memory preference
// object instead of another repo's cached favorites.
_userState = defaultPrefs();
_userStateSlug = currentUserSlug();
applyUserTheme();
try {
  loadSiteConfig().finally(() => {
    _prefsStorageReady = true;
    hydrateUserState();
    applyUserTheme();
    emitUserPrefsChanged();
    try { refreshUserPrefsFromServer(); } catch {}
  });
} catch {
  _prefsStorageReady = true;
  hydrateUserState();
  applyUserTheme();
  try { refreshUserPrefsFromServer(); } catch {}
}

/** One request that returns counts/dates for every project (local dev server only). */
function fetchProjectsSummary() {
  return fetch("/api/projects-summary").then((r) => {
    if (!r.ok) throw new Error("unavailable");
    return r.json();
  });
}

/* Slim notice shown only on the deployed (static) site, where there is no local
   tool server so authoring does not persist for others. Skipped on localhost
   and inside prototype embeds; dismissible and remembered per browser. */
const VIEWONLY_DISMISS_KEY = "design-core:viewonly-dismissed";
const VIEWONLY_EYE_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const VIEWONLY_CLOSE_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';

function mountViewOnlyNotice() {
  let isEmbed = false;
  try { isEmbed = new URLSearchParams(location.search).get("view") === "embed"; } catch {}
  if (isEmbed) return;
  try { if (localStorage.getItem(VIEWONLY_DISMISS_KEY) === "1") return; } catch {}
  isLocalToolServer().then((local) => {
    if (local || document.getElementById("dc-viewonly")) return;
    const bar = document.createElement("div");
    bar.id = "dc-viewonly";
    bar.className = "dc-viewonly";
    bar.innerHTML =
      '<span class="dc-viewonly__icon" aria-hidden="true">' + VIEWONLY_EYE_SVG + "</span>" +
      '<span class="dc-viewonly__text">View-only copy. To create or edit projects, run Design Core on your computer.</span>' +
      '<button type="button" class="dc-viewonly__close" aria-label="Dismiss">' + VIEWONLY_CLOSE_SVG + "</button>";
    function mount() {
      document.body.appendChild(bar);
      bar.querySelector(".dc-viewonly__close").addEventListener("click", () => {
        bar.remove();
        try { localStorage.setItem(VIEWONLY_DISMISS_KEY, "1"); } catch {}
      });
    }
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount);
  });
}

try { mountViewOnlyNotice(); } catch {}
