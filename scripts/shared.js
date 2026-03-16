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

function prototypeUrl(projectId, protoId) {
  const origin = window.location.origin;
  const base = document.baseURI || origin + "/";
  return base + "prototype.html?project=" + projectId + "&proto=" + protoId;
}
