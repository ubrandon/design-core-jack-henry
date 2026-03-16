/**
 * Shared pan/zoom/touch logic for infinite canvas pages.
 *
 * Usage:
 *   const pz = initPanZoom(viewportEl, stageEl, { navHeight: 52 });
 *   // pz.zoom, pz.panX, pz.panY, pz.zoomBy(delta), pz.resetView()
 */
function initPanZoom(viewport, stage, opts) {
  const navHeight = (opts && opts.navHeight) || 52;
  const MIN_ZOOM = 0.2;
  const MAX_ZOOM = 2;

  var restore = opts && opts.restoreState;
  var panX = restore && typeof restore.panX === "number" ? restore.panX : 0;
  var panY = restore && typeof restore.panY === "number" ? restore.panY : 0;
  var zoom = restore && typeof restore.zoom === "number" ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, restore.zoom)) : 1;
  var isPanning = false, panStartX = 0, panStartY = 0, panOriginX = 0, panOriginY = 0;
  var spaceHeld = false;
  var lastTouchDist = 0, lastTouchMidX = 0, lastTouchMidY = 0;

  function applyTransform() {
    stage.style.transform = "translate(" + panX + "px, " + panY + "px) scale(" + zoom + ")";
    var label = document.getElementById("zoom-label");
    if (label) label.textContent = Math.round(zoom * 100) + "%";
  }

  function zoomBy(delta) {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta));
    applyTransform();
  }

  function resetView() {
    panX = 0;
    panY = 0;
    zoom = 1;
    applyTransform();
  }

  window.addEventListener("keydown", function (e) {
    if (e.code === "Space") { e.preventDefault(); spaceHeld = true; }
  });
  window.addEventListener("keyup", function (e) {
    if (e.code === "Space") { e.preventDefault(); spaceHeld = false; if (isPanning) isPanning = false; }
  });

  viewport.addEventListener("pointerdown", function (e) {
    if (spaceHeld) {
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panOriginX = panX;
      panOriginY = panY;
      viewport.setPointerCapture(e.pointerId);
    }
  });

  viewport.addEventListener("pointermove", function (e) {
    if (isPanning) {
      panX = panOriginX + (e.clientX - panStartX);
      panY = panOriginY + (e.clientY - panStartY);
      applyTransform();
    }
  });

  viewport.addEventListener("pointerup", function () {
    isPanning = false;
  });

  viewport.addEventListener("wheel", function (e) {
    e.preventDefault();
    var rect = viewport.getBoundingClientRect();
    var mx = e.clientX - rect.left - rect.width / 2;
    var my = e.clientY - rect.top - rect.height / 2 + navHeight;

    if (e.ctrlKey || e.metaKey) {
      var delta = e.deltaY > 0 ? -0.06 : 0.06;
      var oldZoom = zoom;
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta));
      panX = mx - (mx - panX) * (zoom / oldZoom);
      panY = my - (my - panY) * (zoom / oldZoom);
    } else {
      panX -= e.deltaX;
      panY -= e.deltaY;
    }
    applyTransform();
  }, { passive: false });

  viewport.addEventListener("touchstart", function (e) {
    if (e.touches.length === 2) {
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist = Math.hypot(dx, dy);
      lastTouchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      lastTouchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    }
  }, { passive: true });

  viewport.addEventListener("touchmove", function (e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      var dist = Math.hypot(dx, dy);
      var midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      var midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

      panX += midX - lastTouchMidX;
      panY += midY - lastTouchMidY;
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (dist / lastTouchDist)));

      lastTouchDist = dist;
      lastTouchMidX = midX;
      lastTouchMidY = midY;
      applyTransform();
    }
  }, { passive: false });

  applyTransform();

  var api = {
    get panX() { return panX; },
    set panX(v) { panX = v; },
    get panY() { return panY; },
    set panY(v) { panY = v; },
    get zoom() { return zoom; },
    set zoom(v) { zoom = v; },
    get spaceHeld() { return spaceHeld; },
    applyTransform: applyTransform,
    zoomBy: zoomBy,
    resetView: resetView,
    get isPanning() { return isPanning; },
    set isPanning(v) { isPanning = v; },
  };

  return api;
}
