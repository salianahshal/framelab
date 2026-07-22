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
        opacity: cs.opacity
      };
    } catch (e) { return null; }
  }
  function tagged(el){
    return el && el.closest ? el.closest('[data-framelab-id]') : null;
  }
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
  // drag = { sourceEl, sourceId, startX, startY, started, prevOpacity }

  document.addEventListener('mousedown', function(e){
    if (e.button !== 0) return;
    var el = tagged(e.target);
    if (!el) return;
    drag = {
      sourceEl: el,
      sourceId: el.getAttribute('data-framelab-id'),
      startX: e.clientX, startY: e.clientY,
      started: false,
      prevOpacity: el.style.opacity
    };
  }, true);

  document.addEventListener('mousemove', function(e){
    if (!drag) return;
    if (!drag.started) {
      var dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
      if (dx*dx + dy*dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      drag.started = true;
      drag.sourceEl.style.opacity = '0.4';
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
      targetId: target.getAttribute('data-framelab-id'),
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
          var pos = dropPosition(target, e.clientY);
          post({
            type: 'FRAMELAB_DROP',
            sourceId: ended.sourceId,
            targetId: target.getAttribute('data-framelab-id'),
            position: pos
          });
          // Suppress the upcoming click event so canvas doesn't re-select
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
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && drag && drag.started) endDrag(false);
  }, true);

  document.addEventListener('click', function(e){
    if (window.__framelab_suppress_next_click) {
      window.__framelab_suppress_next_click = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    var el = tagged(e.target);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    post({
      type: 'FRAMELAB_CLICK',
      framelabId: el.getAttribute('data-framelab-id'),
      rect: rectOf(el),
      computed: computedOf(el)
    });
  }, true);
})();`;

module.exports = { RUNTIME_SOURCE };
