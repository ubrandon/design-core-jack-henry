/**
 * Shared pan/zoom/touch logic for infinite canvas pages.
 *
 * Usage:
 *   const pz = initPanZoom(viewportEl, stageEl, { restoreState });
 *   // pz.zoom, pz.panX, pz.panY, pz.zoomBy(delta), pz.resetView(),
 *   // pz.clientToStage(clientX, clientY)
 */
function initPanZoom(viewport, stage, opts) {
  const MIN_ZOOM = 0.05;
  const MAX_ZOOM = 2;

  var restore = opts && opts.restoreState;
  var panX = restore && typeof restore.panX === "number" ? restore.panX : 0;
  var panY = restore && typeof restore.panY === "number" ? restore.panY : 0;
  var zoom = restore && typeof restore.zoom === "number" ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, restore.zoom)) : 1;
  var isPanning = false, panStartX = 0, panStartY = 0, panOriginX = 0, panOriginY = 0;
  var panPending = null;
  var panPointerId = null;
  var didPan = false;
  var spaceHeld = false;
  var dragToPan = !(opts && opts.dragToPan === false);
  var lastTouchDist = 0, lastTouchMidX = 0, lastTouchMidY = 0;

  function isEditableTarget(target) {
    return Boolean(target && target.closest && target.closest("input, textarea, select, button, [contenteditable]"));
  }

  function updatePanReadyVisual() {
    viewport.classList.toggle("is-pan-ready", spaceHeld || dragToPan);
  }

  function clearPanVisual() {
    viewport.classList.remove("is-panning");
  }

  function releasePanCapture(pointerId) {
    if (pointerId == null) return;
    try {
      if (viewport.releasePointerCapture) viewport.releasePointerCapture(pointerId);
    } catch (_) {}
  }

  function endPanForPointer(e, recordDidPan) {
    var pid = e && e.pointerId;
    if (panPending && pid === panPending.id) {
      panPending = null;
      return;
    }
    if (panPointerId == null || pid !== panPointerId) return;
    if (recordDidPan) didPan = isPanning;
    isPanning = false;
    panPending = null;
    panPointerId = null;
    clearPanVisual();
    releasePanCapture(pid);
  }

  function applyTransform() {
    stage.style.transform = "translate(" + panX + "px, " + panY + "px) scale(" + zoom + ")";
    var label = document.getElementById("zoom-label");
    if (label) label.textContent = Math.round(zoom * 100) + "%";
  }

  /** Convert viewport client coordinates into unscaled stage coordinates. */
  function clientToStage(clientX, clientY) {
    var rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - rect.width / 2 - panX) / zoom,
      y: (clientY - rect.top - rect.height / 2 - panY) / zoom,
    };
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
    if (e.code === "Space" && !isEditableTarget(e.target)) {
      e.preventDefault();
      spaceHeld = true;
      updatePanReadyVisual();
    }
  });
  window.addEventListener("keyup", function (e) {
    if (e.code === "Space") {
      if (!isEditableTarget(e.target)) e.preventDefault();
      spaceHeld = false;
      updatePanReadyVisual();
      if (isPanning || panPointerId != null) {
        didPan = isPanning;
        isPanning = false;
        panPending = null;
        releasePanCapture(panPointerId);
        panPointerId = null;
        clearPanVisual();
      }
    }
  });

  window.addEventListener("blur", function () {
    spaceHeld = false;
    panPending = null;
    if (panPointerId != null) releasePanCapture(panPointerId);
    panPointerId = null;
    isPanning = false;
    clearPanVisual();
    updatePanReadyVisual();
  });

  viewport.addEventListener("pointerdown", function (e) {
    didPan = false;
    if (spaceHeld || e.button === 1) {
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panOriginX = panX;
      panOriginY = panY;
      panPointerId = e.pointerId;
      viewport.setPointerCapture(e.pointerId);
      viewport.classList.add("is-panning");
      e.preventDefault();
      return;
    }
    if (e.button === 0 && (dragToPan || e.pointerType === "touch") && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      panPending = { x: e.clientX, y: e.clientY, id: e.pointerId };
    }
  });

  viewport.addEventListener("pointermove", function (e) {
    if (isPanning && e.pointerId === panPointerId) {
      panX = panOriginX + (e.clientX - panStartX);
      panY = panOriginY + (e.clientY - panStartY);
      applyTransform();
      return;
    }
    if (panPending && e.pointerId === panPending.id) {
      var dx = e.clientX - panPending.x;
      var dy = e.clientY - panPending.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        isPanning = true;
        panStartX = panPending.x;
        panStartY = panPending.y;
        panOriginX = panX;
        panOriginY = panY;
        panPointerId = panPending.id;
        viewport.setPointerCapture(panPending.id);
        viewport.classList.add("is-panning");
        panPending = null;
      }
    }
  });

  viewport.addEventListener("pointerup", function (e) {
    endPanForPointer(e, true);
  });

  viewport.addEventListener("pointercancel", function (e) {
    endPanForPointer(e, true);
  });

  viewport.addEventListener("lostpointercapture", function (e) {
    if (panPointerId != null && e.pointerId === panPointerId) {
      didPan = isPanning;
      isPanning = false;
      panPending = null;
      panPointerId = null;
      clearPanVisual();
    }
  });

  viewport.addEventListener("wheel", function (e) {
    e.preventDefault();
    var rect = viewport.getBoundingClientRect();
    var mx = e.clientX - rect.left - rect.width / 2;
    var my = e.clientY - rect.top - rect.height / 2;

    if (e.ctrlKey || e.metaKey) {
      var step = Math.max(-50, Math.min(50, e.deltaY));
      var zoomFactor = Math.exp(-step * 0.01);
      var oldZoom = zoom;
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * zoomFactor));
      panX = mx - (mx - panX) * (zoom / oldZoom);
      panY = my - (my - panY) * (zoom / oldZoom);
    } else {
      const horizontalFromShift = e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY);
      panX -= horizontalFromShift ? e.deltaY : e.deltaX;
      if (!horizontalFromShift) panY -= e.deltaY;
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

  viewport.addEventListener("dragstart", function (e) { e.preventDefault(); });

  updatePanReadyVisual();
  applyTransform();

  var api = {
    get panX() { return panX; },
    set panX(v) { panX = v; },
    get panY() { return panY; },
    set panY(v) { panY = v; },
    get zoom() { return zoom; },
    set zoom(v) { zoom = v; },
    get spaceHeld() { return spaceHeld; },
    get dragToPan() { return dragToPan; },
    set dragToPan(v) {
      dragToPan = Boolean(v);
      panPending = null;
      updatePanReadyVisual();
    },
    applyTransform: applyTransform,
    clientToStage: clientToStage,
    zoomBy: zoomBy,
    resetView: resetView,
    get isPanning() { return isPanning; },
    set isPanning(v) { isPanning = v; },
    get didPan() { return didPan; },
  };

  return api;
}
