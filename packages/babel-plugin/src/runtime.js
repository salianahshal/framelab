'use strict';

const RUNTIME_SOURCE = `(function(){
  if (typeof window === 'undefined') return;
  if (window.__framelab_click_installed) return;
  window.__framelab_click_installed = true;

  var DRAG_THRESHOLD = 5;
  var hasParent = window.parent && window.parent !== window;
  function post(msg){ if (hasParent) window.parent.postMessage(msg, '*'); }

  function rectOf(el){
    var r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
  }
  function computedOf(el){
    try {
      var cs = (typeof getComputedStyle === 'function') ? getComputedStyle(el) : null;
      if (!cs) return null;
      return {
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        borderColor: cs.borderTopColor,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        opacity: cs.opacity,
        display: cs.display
      };
    } catch (e) { return null; }
  }
  function tagged(el){
    return el && el.closest ? el.closest('[data-framelab-id]') : null;
  }
  function idOf(el){ return el ? el.getAttribute('data-framelab-id') : null; }
  function elementUnder(x, y, exclude){
    var prev = exclude ? exclude.style.pointerEvents : null;
    if (exclude) exclude.style.pointerEvents = 'none';
    var hit = document.elementFromPoint(x, y);
    if (exclude) exclude.style.pointerEvents = prev;
    return tagged(hit);
  }
  function dropPosition(el, y){
    var r = el.getBoundingClientRect();
    return (y < r.top + r.height / 2) ? 'before' : 'after';
  }

  // ---------- Drag state ----------
  var drag = null;

  document.addEventListener('mousedown', function(e){
    if (e.button !== 0) return;
    var el = tagged(e.target);
    if (!el) return;
    drag = {
      sourceEl: el,
      sourceId: idOf(el),
      startX: e.clientX, startY: e.clientY,
      started: false,
      prevOpacity: el.style.opacity
    };
  }, true);

  document.addEventListener('mousemove', function(e){
    if (!drag) {
      trackHover(e);
      return;
    }
    if (!drag.started) {
      var dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
      if (dx*dx + dy*dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      drag.started = true;
      drag.sourceEl.style.opacity = '0.4';
      clearHover();
      post({ type: 'FRAMELAB_DRAG_START', sourceId: drag.sourceId });
    }
    e.preventDefault();
    var target = elementUnder(e.clientX, e.clientY, drag.sourceEl);
    if (!target || target === drag.sourceEl) {
      post({ type: 'FRAMELAB_DRAG_OVER', sourceId: drag.sourceId, targetId: null });
      return;
    }
    var pos = dropPosition(target, e.clientY);
    post({
      type: 'FRAMELAB_DRAG_OVER',
      sourceId: drag.sourceId,
      targetId: idOf(target),
      position: pos,
      rect: rectOf(target)
    });
  }, true);

  function endDrag(commit, e){
    if (!drag) return;
    drag.sourceEl.style.opacity = drag.prevOpacity || '';
    if (drag.started) {
      e && e.preventDefault();
      e && e.stopPropagation();
      var ended = drag;
      drag = null;
      if (commit && e) {
        var target = elementUnder(e.clientX, e.clientY, ended.sourceEl);
        if (target && target !== ended.sourceEl) {
          post({
            type: 'FRAMELAB_DROP',
            sourceId: ended.sourceId,
            targetId: idOf(target),
            position: dropPosition(target, e.clientY)
          });
          window.__framelab_suppress_next_click = true;
          return;
        }
      }
      post({ type: 'FRAMELAB_DRAG_CANCEL', sourceId: ended.sourceId });
      window.__framelab_suppress_next_click = true;
    } else {
      drag = null;
    }
  }

  document.addEventListener('mouseup', function(e){
    if (e.button !== 0) return;
    endDrag(true, e);
  }, true);

  // ---------- Hover ----------
  // The canvas paints the hover outline, so the page only reports which
  // element is under the cursor. rAF-throttled: mousemove fires far more often
  // than the parent can usefully repaint.
  var hoveredEl = null;
  var hoverQueued = false;
  var pendingHover = null;
  function flushHover(){
    hoverQueued = false;
    if (!pendingHover) return;
    if (!pendingHover.isConnected) { pendingHover = null; return; }
    post({
      type: 'FRAMELAB_HOVER',
      framelabId: idOf(pendingHover),
      rect: rectOf(pendingHover)
    });
  }
  function scheduleHover(){
    if (hoverQueued) return;
    hoverQueued = true;
    var raf = window.requestAnimationFrame || window.setTimeout;
    raf(flushHover, 0);
  }
  function clearHover(){
    if (!hoveredEl) return;
    hoveredEl = null;
    pendingHover = null;
    post({ type: 'FRAMELAB_HOVER_OUT' });
  }
  function trackHover(e){
    var el = tagged(e.target);
    if (el === hoveredEl) {
      if (el) { pendingHover = el; scheduleHover(); }
      return;
    }
    if (!el) { clearHover(); return; }
    hoveredEl = el;
    pendingHover = el;
    scheduleHover();
  }
  if (window.addEventListener) {
    window.addEventListener('mouseout', function(e){
      if (!e.relatedTarget) clearHover();
    }, true);
  }

  // ---------- Selection tracking ----------
  // The parent draws the selection outline from a rect captured at click time.
  // When the app scrolls or the viewport resizes inside the iframe, that rect
  // goes stale and the outline appears "stuck". Re-post the selected element's
  // current rect (rAF-throttled) so the parent can keep the outline glued to it.
  var selectedEl = null;
  var rectUpdateQueued = false;
  function flushRectUpdate(){
    rectUpdateQueued = false;
    if (!selectedEl) return;
    if (selectedEl.isConnected === false) { selectedEl = null; return; }
    post({
      type: 'FRAMELAB_RECT_UPDATE',
      framelabId: idOf(selectedEl),
      rect: rectOf(selectedEl)
    });
  }
  function scheduleRectUpdate(){
    if (rectUpdateQueued || !selectedEl) return;
    rectUpdateQueued = true;
    var raf = window.requestAnimationFrame || window.setTimeout;
    raf(flushRectUpdate, 0);
  }
  // Guarded: the plugin's test sandbox has no window.addEventListener.
  if (window.addEventListener) {
    window.addEventListener('scroll', scheduleRectUpdate, true);
    window.addEventListener('resize', scheduleRectUpdate, true);
  }

  document.addEventListener('click', function(e){
    if (window.__framelab_suppress_next_click) {
      window.__framelab_suppress_next_click = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    var el = tagged(e.target);
    if (!el) {
      // Clicking bare page background clears the selection: click-out should
      // mean the same thing here as it does in any design tool.
      selectedEl = null;
      post({ type: 'FRAMELAB_DESELECT' });
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    selectedEl = el;
    post({
      type: 'FRAMELAB_CLICK',
      framelabId: idOf(el),
      rect: rectOf(el),
      computed: computedOf(el)
    });
  }, true);

  // Keyboard reaches the page, not the canvas, once the user has clicked
  // something here — the canvas lives in the parent frame. Forward the editor
  // shortcuts so arrow-key navigation and undo keep working after a click.
  var FORWARD_KEYS = {
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
    Delete: 1, Backspace: 1,
    Escape: 1, z: 1, Z: 1, b: 1, B: 1, j: 1, J: 1
  };
  // Keys that only make sense against a selection, and that must never reach
  // the page itself (Backspace would navigate back).
  var SELECTION_KEYS = {
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Delete: 1, Backspace: 1
  };
  function isTextEntry(el){
    if (!el || !el.tagName) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
  }

  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') {
      if (drag && drag.started) { endDrag(false); return; }
      selectedEl = null;
      clearHover();
      post({ type: 'FRAMELAB_DESELECT' });
      return;
    }
    if (isTextEntry(e.target)) return;
    if (!FORWARD_KEYS[e.key]) return;
    var needsSelection = !!SELECTION_KEYS[e.key];
    var isChord = e.metaKey || e.ctrlKey;
    if (!needsSelection && !isChord) return;
    if (needsSelection && !selectedEl) return;
    if (e.preventDefault) e.preventDefault();
    post({
      type: 'FRAMELAB_KEY',
      key: e.key,
      metaKey: !!e.metaKey,
      ctrlKey: !!e.ctrlKey,
      shiftKey: !!e.shiftKey
    });
  }, true);

  // ---------- Commands from the canvas ----------
  // Selecting from the layer tree or the breadcrumb has to light up the same
  // outline as a click, so the canvas asks the page to measure an element.
  if (window.addEventListener) {
    window.addEventListener('message', function(e){
      var data = e.data || {};
      if (data.type === 'FRAMELAB_SELECT' && data.framelabId) {
        var sel = '[data-framelab-id="' + String(data.framelabId).replace(/["\\\\]/g, '\\\\$&') + '"]';
        var el = document.querySelector ? document.querySelector(sel) : null;
        if (!el) { post({ type: 'FRAMELAB_NOT_FOUND', framelabId: data.framelabId }); return; }
        selectedEl = el;
        if (data.scroll && el.scrollIntoView) {
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
        post({
          type: 'FRAMELAB_CLICK',
          framelabId: idOf(el),
          rect: rectOf(el),
          computed: computedOf(el),
          fromCanvas: true
        });
      } else if (data.type === 'FRAMELAB_CLEAR') {
        selectedEl = null;
        clearHover();
      } else if (data.type === 'FRAMELAB_MEASURE') {
        scheduleRectUpdate();
      }
    }, false);
  }
})();`;

module.exports = { RUNTIME_SOURCE };
