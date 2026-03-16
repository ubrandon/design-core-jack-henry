/**
 * Shared nav component used by all pages.
 *
 * Usage:
 *   renderNav({
 *     breadcrumbs: [{ label: "Project Name", href: "project.html?id=foo" }],
 *     actions: [{ label: "Tidy", href: "#", onclick: "event.preventDefault(); tidyLayout();" }],
 *     hint: "Space+drag to pan · Ctrl+scroll to zoom",
 *     fixed: true,  // fixed position (canvas pages) vs sticky (scrollable pages)
 *   });
 */

const NAV_ICONS = {
  projects:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  captures:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  designSystem:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
};

function navItem(href, label, icon, isActive) {
  const a = document.createElement("a");
  a.href = href;
  a.className = "site-nav__item" + (isActive ? " site-nav__item--active" : "");
  a.innerHTML = icon + '<span class="site-nav__item-label">' + label + "</span>";
  return a;
}

function renderNav(opts = {}) {
  const breadcrumbs = opts.breadcrumbs || [];
  const actions = opts.actions || [];
  const hint = opts.hint || "";
  const fixed = opts.fixed || false;

  const path = window.location.pathname;
  const isHome = path.endsWith("/") || path.endsWith("index.html");
  const isCaptures = path.endsWith("captures.html");
  const isDesignSystem = path.endsWith("design-system.html");

  const nav = document.createElement("nav");
  nav.className = "site-nav" + (fixed ? " site-nav--fixed" : "");
  nav.id = "site-nav";

  const inner = document.createElement("div");
  inner.className = "site-nav__inner";

  const left = document.createElement("div");
  left.className = "site-nav__left";

  const brand = document.createElement("a");
  brand.href = "index.html";
  brand.className = "site-nav__brand";
  brand.textContent = "Design Core";
  left.appendChild(brand);

  for (const crumb of breadcrumbs) {
    const sep = document.createElement("span");
    sep.className = "site-nav__sep";
    sep.textContent = "/";
    left.appendChild(sep);

    if (crumb.href) {
      const link = document.createElement("a");
      link.href = crumb.href;
      link.className = "site-nav__crumb";
      link.textContent = crumb.label;
      if (crumb.id) link.id = crumb.id;
      left.appendChild(link);
    } else {
      const span = document.createElement("span");
      span.className = "site-nav__crumb site-nav__crumb--active";
      span.textContent = crumb.label;
      if (crumb.id) span.id = crumb.id;
      left.appendChild(span);
    }
  }

  inner.appendChild(left);

  const right = document.createElement("div");
  right.className = "site-nav__right";

  right.appendChild(navItem("index.html", "Projects", NAV_ICONS.projects, isHome));
  right.appendChild(navItem("captures.html", "Captures", NAV_ICONS.captures, isCaptures));
  right.appendChild(navItem("design-system.html", "Design System", NAV_ICONS.designSystem, isDesignSystem));

  for (const action of actions) {
    const link = document.createElement("a");
    link.href = action.href || "#";
    link.className = "site-nav__action";
    link.textContent = action.label;
    if (action.id) link.id = action.id;
    if (action.onclick) link.setAttribute("onclick", action.onclick);
    right.appendChild(link);
  }

  if (hint) {
    const hintEl = document.createElement("span");
    hintEl.className = "site-nav__hint";
    hintEl.textContent = hint;
    right.appendChild(hintEl);
  }

  inner.appendChild(right);
  nav.appendChild(inner);

  document.body.prepend(nav);
  return nav;
}
