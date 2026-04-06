/**
 * Live-reload client for Design Core.
 *
 * In dev mode, connects to Vite's WebSocket and listens for
 * "design-core:data-changed" custom events pushed by the liveDataPlugin.
 * Calls page-specific handlers registered via window.__onDataChanged(paths).
 *
 * Pages register a handler before or after this script loads:
 *   window.__onDataChanged = function(paths) { ... };
 *
 * `paths` is an array of relative data paths, e.g.
 *   ["data/projects/my-app/screens/home.html",
 *    "data/projects/my-app/canvas.json"]
 *
 * On deployed (non-Vite) sites this script is a no-op — the token global
 * won't exist, so the WebSocket connection is never attempted.
 */
(function () {
  var token = window.__VITE_WS_TOKEN__;
  if (!token) return;

  var base = window.__VITE_HMR_BASE__ || "/";
  var protocol = location.protocol === "https:" ? "wss:" : "ws:";
  var socketUrl =
    protocol +
    "//" +
    location.host +
    base +
    "?token=" +
    encodeURIComponent(token);
  var ws;

  try {
    ws = new WebSocket(socketUrl, "vite-hmr");
  } catch (_) {
    return;
  }

  ws.addEventListener("message", function (event) {
    var msg;
    try {
      msg = JSON.parse(event.data);
    } catch (_) {
      return;
    }
    if (msg.type === "custom" && msg.event === "design-core:data-changed") {
      var paths = (msg.data && msg.data.paths) || [];
      if (document.hidden) {
        window.__liveReloadPending = true;
        return;
      }
      dispatch(paths);
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && window.__liveReloadPending) {
      window.__liveReloadPending = false;
      if (typeof window.__onDataChanged === "function") {
        window.__onDataChanged([]);
      }
    }
  });

  function dispatch(paths) {
    if (typeof window.__onDataChanged === "function") {
      window.__onDataChanged(paths);
    }
  }
})();
