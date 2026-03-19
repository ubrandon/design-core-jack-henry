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

/** For home list cards: screen/proto counts and dates from project files. Counts are null if the file failed to load. */
function fetchProjectListDetails(projectId) {
  const b = "data/projects/" + encodeURIComponent(projectId) + "/";
  return Promise.all([
    fetchJSON(b + "project.json").catch(() => ({})),
    fetchJSON(b + "canvas.json")
      .then((c) => ({ ok: true, count: (c.screens || []).length }))
      .catch(() => ({ ok: false, count: 0 })),
    fetchJSON(b + "prototypes/index.json")
      .then((d) => ({ ok: true, count: (d.prototypes || []).length }))
      .catch(() => ({ ok: false, count: 0 })),
  ]).then(([proj, canvas, protos]) => ({
    updatedAt: proj.updatedAt || null,
    createdAt: proj.createdAt || null,
    screenCount: canvas.ok ? canvas.count : null,
    protoCount: protos.ok ? protos.count : null,
  }));
}

function parseDateMs(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function prototypeUrl(projectId, protoId) {
  const base = shareBaseUrl();
  const q = `prototype.html?project=${encodeURIComponent(projectId)}&proto=${encodeURIComponent(protoId)}`;
  try {
    return new URL(q, base).href;
  } catch {
    return `${base.replace(/\/?$/, "/")}${q}`;
  }
}
