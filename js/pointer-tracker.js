/*
 * pointer-tracker.js
 *
 * Records how a student's pointer moves during one page, using Pointer Events,
 * which cover a mouse, a trackpad, a stylus and a finger on a touchscreen.
 * (jsPsych's mouse-tracking extension only listens for mouse events, so on an
 * iPad it would capture taps but no movement.)
 *
 * Each sample: { t, type, x, y, nx, ny, pt, target, rx, ry }
 *   t       ms since the page appeared
 *   type    down | move | up | cancel
 *   x, y    pixels relative to the page's content area (scrolling included)
 *   nx, ny  the same position as a fraction (0–1) of the content area, so
 *           samples from different screen sizes can be compared
 *   pt      pointer type: mouse | touch | pen
 *   target  data-track label of the element under the pointer, if any
 *           (figure, answer-box, explanation-box, option-C, ...)
 *   rx, ry  when the pointer is over a figure: its position as a fraction
 *           (0–1) of the figure's width and height, so positions on the same
 *           image can be compared across screen sizes
 *
 * Note: on a touchscreen there is no movement between touches (no hovering),
 * so touch records only contain the paths of actual drags.
 *
 * Also counts how often and how long the student left the page during the
 * item (switching tabs or apps), which is useful evidence when checking
 * whether answers might have come from another tool.
 */
(function (root) {
  'use strict';

  function PointerTracker(options) {
    this.sampleMs = options.sampleMs || 25;
    this.maxEvents = options.maxEvents || 4000;
    this.enabled = options.enabled !== false;
    this._reset();
  }

  PointerTracker.prototype._reset = function () {
    this.events = [];
    this.truncated = false;
    this.lastMoveT = -Infinity;
    this.area = null;
    this.t0 = 0;
    this.focus = { leave_count: 0, away_ms: 0, _leftAt: null };
  };

  PointerTracker.prototype.start = function (areaElement) {
    this._reset();
    this.area = areaElement;
    this.t0 = performance.now();
    var self = this;

    this._onPointer = function (e) {
      if (!self.enabled) return;
      var type = e.type.replace('pointer', '');
      var t = performance.now() - self.t0;
      if (type === 'move') {
        if (t - self.lastMoveT < self.sampleMs) return;
        self.lastMoveT = t;
      }
      if (self.events.length >= self.maxEvents) {
        self.truncated = true;
        return;
      }
      var rect = self.area.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      var tracked = e.target && e.target.closest ? e.target.closest('[data-track]') : null;
      var sample = {
        t: Math.round(t),
        type: type,
        x: Math.round(x),
        y: Math.round(y),
        nx: rect.width ? +(x / rect.width).toFixed(4) : null,
        ny: rect.height ? +(y / rect.height).toFixed(4) : null,
        pt: e.pointerType || 'unknown',
        target: tracked ? tracked.getAttribute('data-track') : null
      };
      if (tracked && tracked.hasAttribute('data-track-relative')) {
        var r = tracked.getBoundingClientRect();
        if (r.width && r.height) {
          sample.rx = +((e.clientX - r.left) / r.width).toFixed(4);
          sample.ry = +((e.clientY - r.top) / r.height).toFixed(4);
        }
      }
      self.events.push(sample);
    };

    this._onVisibility = function () {
      if (document.visibilityState === 'hidden') self._leave();
      else self._return();
    };
    this._onBlur = function () { self._leave(); };
    this._onFocus = function () { self._return(); };

    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(function (name) {
      document.addEventListener(name, self._onPointer, { passive: true, capture: true });
    });
    document.addEventListener('visibilitychange', this._onVisibility);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('focus', this._onFocus);
  };

  PointerTracker.prototype._leave = function () {
    if (this.focus._leftAt === null) {
      this.focus._leftAt = performance.now();
      this.focus.leave_count += 1;
    }
  };

  PointerTracker.prototype._return = function () {
    if (this.focus._leftAt !== null) {
      this.focus.away_ms += performance.now() - this.focus._leftAt;
      this.focus._leftAt = null;
    }
  };

  /** Stops recording and returns the data to store with the trial. */
  PointerTracker.prototype.stop = function () {
    var self = this;
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(function (name) {
      document.removeEventListener(name, self._onPointer, { capture: true });
    });
    document.removeEventListener('visibilitychange', this._onVisibility);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('focus', this._onFocus);
    this._return();

    var rect = this.area ? this.area.getBoundingClientRect() : { width: 0, height: 0 };
    return {
      pointer_events: this.enabled ? this.events : null,
      pointer_truncated: this.truncated,
      pointer_area: { width: Math.round(rect.width), height: Math.round(rect.height) },
      left_page_count: this.focus.leave_count,
      left_page_ms: Math.round(this.focus.away_ms)
    };
  };

  root.PointerTracker = PointerTracker;
})(window);
