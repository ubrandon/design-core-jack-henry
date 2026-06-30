/**
 * Collapsible left rail shared by all tool pages.
 *
 * Shows the active user's favorites as a drag-to-reorder list. Self-initializes
 * on DOMContentLoaded, skips the prototype embed view, and defaults to collapsed
 * on the canvas / prototype pages so it never blocks the workspace.
 * Reads/writes favorites and collapsed state through shared.js (per user).
 */
(function () {
  const RAIL_ICONS = {
    chevron:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    projects:
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    captures:
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    designSystem:
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    star:
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 16.77 6.99 19.5l.99-5.8-4.21-4.1 5.82-.85z"/></svg>',
    grip:
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    user:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>',
    caret:
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  };

  function esc(s) {
    return typeof escapeHtml === "function" ? escapeHtml(s) : String(s == null ? "" : s);
  }
  function initialsOf(s) {
    return typeof initials === "function" ? initials(s) : String(s || "?").slice(0, 2).toUpperCase();
  }
  function hueOf(id) {
    return typeof projectHue === "function" ? projectHue(id) : 0;
  }

  let projectNames = {};
  let railEl = null;
  let listEl = null;
  let userBtnEl = null;
  let userMenuEl = null;

  function pageFlags() {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    return {
      isHome: path.endsWith("/") || path.endsWith("index.html"),
      isCaptures: path.endsWith("captures.html"),
      isDesignSystem: path.endsWith("design-system.html"),
      isCanvas: path.endsWith("canvas.html"),
      isPrototype: path.endsWith("prototype.html"),
      isEmbed: params.get("view") === "embed",
    };
  }

  function railLink(href, label, icon, active) {
    return (
      '<a class="dc-rail__link' + (active ? " is-active" : "") + '" href="' + href + '" title="' + esc(label) + '">' +
      '<span class="dc-rail__link-icon">' + icon + "</span>" +
      '<span class="dc-rail__link-label">' + esc(label) + "</span>" +
      "</a>"
    );
  }

  function favItemHtml(id) {
    const name = projectNames[id] || id;
    return (
      '<li class="dc-rail__fav" draggable="true" data-id="' + esc(id) + '" title="' + esc(name) + '">' +
      '<span class="dc-rail__grip" aria-hidden="true">' + RAIL_ICONS.grip + "</span>" +
      '<a class="dc-rail__fav-link" href="project.html?id=' + encodeURIComponent(id) + '">' +
      '<span class="dc-rail__fav-avatar" style="--card-hue:' + hueOf(id) + '">' + esc(initialsOf(name)) + "</span>" +
      '<span class="dc-rail__fav-name">' + esc(name) + "</span>" +
      "</a></li>"
    );
  }

  function renderFavorites() {
    if (!listEl) return;
    const ids = typeof getFavoriteProjectIds === "function" ? getFavoriteProjectIds() : [];
    listEl.innerHTML = ids.map(favItemHtml).join("");
    const empty = railEl.querySelector(".dc-rail__empty");
    if (empty) empty.hidden = ids.length > 0;
  }

  function dragAfterElement(container, y) {
    const items = [...container.querySelectorAll(".dc-rail__fav:not(.is-dragging)")];
    let closest = { offset: -Infinity, el: null };
    for (const child of items) {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) closest = { offset, el: child };
    }
    return closest.el;
  }

  function wireDrag() {
    let dragging = null;
    listEl.addEventListener("dragstart", (e) => {
      const li = e.target.closest(".dc-rail__fav");
      if (!li) return;
      dragging = li;
      li.classList.add("is-dragging");
      try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", li.dataset.id); } catch (_) {}
    });
    listEl.addEventListener("dragover", (e) => {
      if (!dragging) return;
      e.preventDefault();
      const after = dragAfterElement(listEl, e.clientY);
      if (after == null) listEl.appendChild(dragging);
      else listEl.insertBefore(dragging, after);
    });
    listEl.addEventListener("drop", (e) => { if (dragging) e.preventDefault(); });
    listEl.addEventListener("dragend", () => {
      if (!dragging) return;
      dragging.classList.remove("is-dragging");
      dragging = null;
      const order = [...listEl.querySelectorAll(".dc-rail__fav")].map((li) => li.dataset.id);
      if (typeof setFavoriteOrder === "function") setFavoriteOrder(order);
    });
  }

  function applyCollapsed(collapsed) {
    railEl.setAttribute("data-collapsed", collapsed ? "true" : "false");
    document.body.setAttribute("data-rail", collapsed ? "collapsed" : "expanded");
    const toggle = railEl.querySelector(".dc-rail__toggle");
    if (toggle) {
      toggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
  }

  function curName() {
    return typeof getCurrentUserName === "function" ? getCurrentUserName() : "";
  }

  function paintUser() {
    if (!userBtnEl) return;
    const name = curName();
    const avatar = userBtnEl.querySelector(".dc-rail__user-avatar");
    const nameEl = userBtnEl.querySelector(".dc-rail__user-name");
    if (name) {
      avatar.classList.remove("is-empty");
      avatar.textContent = initialsOf(name);
      nameEl.textContent = name;
      userBtnEl.title = "Switch user";
    } else {
      avatar.classList.add("is-empty");
      avatar.innerHTML = RAIL_ICONS.user;
      nameEl.textContent = "Select user";
      userBtnEl.title = "Select who you are";
    }
  }

  function closeUserMenu() {
    if (userMenuEl) userMenuEl.hidden = true;
    if (userBtnEl) userBtnEl.setAttribute("aria-expanded", "false");
  }

  function pickUser(name) {
    if (typeof setCurrentUser === "function") setCurrentUser(name);
    paintUser();
    closeUserMenu();
  }

  function renderUserMenu(users) {
    const current = curName().toLowerCase();
    const rows = users
      .map((n) => {
        const active = n.toLowerCase() === current;
        return (
          '<button type="button" class="user-menu__item' + (active ? " is-active" : "") +
          '" data-user-name="' + esc(n) + '">' +
          '<span class="user-menu__avatar">' + esc(initialsOf(n)) + "</span>" +
          '<span class="user-menu__label">' + esc(n) + "</span>" +
          (active ? '<span class="user-menu__check">&#10003;</span>' : "") +
          "</button>"
        );
      })
      .join("");
    userMenuEl.innerHTML =
      '<div class="user-menu__title">Switch user</div>' +
      '<div class="user-menu__list">' + (rows || '<p class="user-menu__empty">No users yet. Add yourself below.</p>') + "</div>" +
      '<div class="user-menu__add">' +
      '<input type="text" class="user-menu__input" placeholder="Add a new user…" autocomplete="name" aria-label="Add a new user">' +
      '<button type="button" class="user-menu__add-btn">Add</button>' +
      "</div>";
    userMenuEl.querySelectorAll("[data-user-name]").forEach((b) => {
      b.addEventListener("click", () => pickUser(b.getAttribute("data-user-name")));
    });
    const input = userMenuEl.querySelector(".user-menu__input");
    const addBtn = userMenuEl.querySelector(".user-menu__add-btn");
    function commitAdd() {
      const v = (input.value || "").trim();
      if (!v) { input.focus(); return; }
      if (typeof addDesignerTeamMember === "function") addDesignerTeamMember(v);
      pickUser(v);
    }
    addBtn.addEventListener("click", commitAdd);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commitAdd(); }
    });
  }

  function openUserMenu() {
    if (!userMenuEl) return;
    userMenuEl.hidden = false;
    userBtnEl.setAttribute("aria-expanded", "true");
    userMenuEl.innerHTML = '<div class="user-menu__title">Loading…</div>';
    const load = typeof fetchSelectableUsers === "function" ? fetchSelectableUsers() : Promise.resolve([]);
    load.then((u) => renderUserMenu(u || [])).catch(() => renderUserMenu([]));
  }

  function setupUserSection() {
    userBtnEl = railEl.querySelector(".dc-rail__user");
    userMenuEl = railEl.querySelector(".dc-rail__user-menu");
    if (!userBtnEl) return;
    paintUser();
    userBtnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!userMenuEl.hidden) { closeUserMenu(); return; }
      if (railEl.getAttribute("data-collapsed") === "true") {
        applyCollapsed(false);
        if (typeof setNavCollapsed === "function") setNavCollapsed(false);
      }
      openUserMenu();
    });
    document.addEventListener("click", (e) => {
      const wrap = railEl.querySelector(".dc-rail__user-wrap");
      if (userMenuEl && !userMenuEl.hidden && wrap && !wrap.contains(e.target)) closeUserMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && userMenuEl && !userMenuEl.hidden) closeUserMenu();
    });
    // Other pages can open the picker (e.g. an empty-state CTA).
    window.__openUserMenu = function () {
      if (railEl.getAttribute("data-collapsed") === "true") {
        applyCollapsed(false);
        if (typeof setNavCollapsed === "function") setNavCollapsed(false);
      }
      openUserMenu();
    };
  }

  function build(flags) {
    const collapsedDefault = flags.isCanvas || flags.isPrototype;
    const collapsed = typeof getNavCollapsed === "function" ? getNavCollapsed(collapsedDefault) : collapsedDefault;
    // Overlay only on the full-bleed canvas. The prototype page has a sticky
    // full-width nav, so it must push (not overlay) or the rail sits under the nav.
    const overlay = flags.isCanvas;

    const rail = document.createElement("aside");
    rail.className = "dc-rail";
    rail.id = "dc-rail";
    rail.innerHTML =
      '<div class="dc-rail__head">' +
      '<button type="button" class="dc-rail__toggle" aria-controls="dc-rail" title="Toggle sidebar">' + RAIL_ICONS.chevron + "</button>" +
      "</div>" +
      '<nav class="dc-rail__links">' +
      railLink("index.html", "Projects", RAIL_ICONS.projects, flags.isHome) +
      railLink("captures.html", "Captures", RAIL_ICONS.captures, flags.isCaptures) +
      railLink("design-system.html", "Design System", RAIL_ICONS.designSystem, flags.isDesignSystem) +
      "</nav>" +
      '<div class="dc-rail__favs">' +
      '<div class="dc-rail__favs-head"><span class="dc-rail__favs-icon">' + RAIL_ICONS.star + "</span>" +
      '<span class="dc-rail__favs-title">Favorites</span></div>' +
      '<ul class="dc-rail__list" role="list"></ul>' +
      '<p class="dc-rail__empty" hidden>Star a project to pin it here.</p>' +
      "</div>" +
      '<div class="dc-rail__user-wrap">' +
      '<button type="button" class="dc-rail__user" aria-haspopup="true" aria-expanded="false">' +
      '<span class="dc-rail__user-avatar"></span>' +
      '<span class="dc-rail__user-name"></span>' +
      '<span class="dc-rail__user-caret">' + RAIL_ICONS.caret + "</span>" +
      "</button>" +
      '<div class="user-menu dc-rail__user-menu" hidden></div>' +
      "</div>";

    document.body.appendChild(rail);
    railEl = rail;
    listEl = rail.querySelector(".dc-rail__list");

    document.body.setAttribute("data-rail-mode", overlay ? "overlay" : "push");
    applyCollapsed(collapsed);

    rail.querySelector(".dc-rail__toggle").addEventListener("click", () => {
      const next = railEl.getAttribute("data-collapsed") !== "true";
      applyCollapsed(next);
      if (typeof setNavCollapsed === "function") setNavCollapsed(next);
    });

    wireDrag();
    renderFavorites();
    setupUserSection();

    window.addEventListener("dc:user-prefs-changed", renderFavorites);
    window.addEventListener("dc:user-changed", () => {
      applyCollapsed(typeof getNavCollapsed === "function" ? getNavCollapsed(collapsedDefault) : collapsedDefault);
      renderFavorites();
      paintUser();
    });
  }

  function loadProjectNames() {
    if (typeof fetchJSON !== "function") return Promise.resolve();
    return fetchJSON("data/projects/index.json")
      .then((d) => {
        (d.projects || []).forEach((p) => { if (p && p.id) projectNames[p.id] = p.name || p.id; });
      })
      .catch(() => {});
  }

  function init() {
    if (document.getElementById("dc-rail")) return;
    const flags = pageFlags();
    if (flags.isEmbed) return;
    build(flags);
    loadProjectNames().then(renderFavorites);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
