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
    .slice(0, 48);
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
