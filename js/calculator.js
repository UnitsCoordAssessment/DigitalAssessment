/*
 * calculator.js — a simple on-screen calculator for selected problem pages.
 *
 * A problem in content.js shows the calculator when it has `calculator: true`
 * (`calculator: false` or no line: no calculator). The calculator sits on the
 * right-hand side of the screen, to the right of the problem, toward the bottom
 * (above the Continue button); on calculator pages the problem column moves
 * left when needed so the two never overlap. On narrow screens it appears
 * below the problem instead.
 *
 * Keys: digits 0-9, + − × ÷, ^ (exponent), parentheses, ⌫ (delete the last
 * character), C (clear) and =. There is no decimal-point key, but results can
 * be decimals. After =, a digit or "(" starts a new calculation and an
 * operator continues from the result. Once a key has been clicked, the
 * keyboard works too (digits, + - * x / ^ ( ), Enter or = to calculate,
 * Backspace to delete, Escape to clear).
 *
 * Everything the student does with the calculator is saved with the page
 * (data.calculator):
 *   events     [{t, k, x, q, r, s}, ...], one per key press:
 *                t  ms since the page appeared (same clock as timing and answer_history)
 *                k  the key: '0'-'9', '+', '-', '*', '/', '^', '(', ')'   (input)
 *                   'back', 'clear'                                     (edits)
 *                   '='                                                 (calculate)
 *                x  what the display shows after the key, e.g. '6*7^'
 *                q  (only for '=') the expression that was calculated, e.g. '6*7^3'
 *                r  (only for '=') the result shown, e.g. '2058', or 'Error'
 *                s  'key' when typed on the keyboard (left out for clicks)
 *   truncated  true if more than maxEvents key presses were made (the rest are not saved)
 * On problems without a calculator, data.calculator is null.
 *
 * Expressions are evaluated by the small parser below, never by eval().
 * Order of operations: parentheses, then ^ (right to left), then a leading
 * minus sign, then × ÷, then + −, so -2^2 = -4 and 2^3^2 = 512. A number next
 * to a parenthesis multiplies: 2(3+4) = 14.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Calculator = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Evaluation
  // ---------------------------------------------------------------------------

  function tokenize(expr) {
    var tokens = [];
    var i = 0;
    while (i < expr.length) {
      var c = expr[i];
      if (c === ' ') { i++; continue; }
      if (/[0-9.]/.test(c)) {
        var j = i;
        while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
        // Exponential notation from an earlier, very large or small result (1e+21)
        if (expr[j] === 'e' && /^[+\-]?[0-9]/.test(expr.slice(j + 1))) {
          j++;
          if (expr[j] === '+' || expr[j] === '-') j++;
          while (j < expr.length && /[0-9]/.test(expr[j])) j++;
        }
        var s = expr.slice(i, j);
        if (s === '.' || (s.match(/\./g) || []).length > 1) throw new Error('bad number');
        tokens.push({ type: 'num', value: Number(s) });
        i = j;
        continue;
      }
      if ('+-*/^()'.indexOf(c) !== -1) { tokens.push({ type: c }); i++; continue; }
      throw new Error('bad character');
    }
    // A number or ")" followed by "(" or a number multiplies: 2(3), (2)(3), (2)3
    var out = [];
    tokens.forEach(function (t) {
      var prev = out[out.length - 1];
      if (prev && (prev.type === 'num' || prev.type === ')') && (t.type === '(' || t.type === 'num')) {
        out.push({ type: '*' });
      }
      out.push(t);
    });
    return out;
  }

  /** The value of an expression such as "6*7^3" or "(98-42)/7". Throws if it has none. */
  function evaluate(expr) {
    var tokens = tokenize(String(expr));
    var pos = 0;
    function peek() { return tokens[pos]; }
    function is(type) { return pos < tokens.length && tokens[pos].type === type; }
    function take(type) {
      var t = tokens[pos];
      if (!t || (type && t.type !== type)) throw new Error('syntax');
      pos++;
      return t;
    }
    // sum := product (('+' | '-') product)*
    function sum() {
      var v = product();
      while (is('+') || is('-')) {
        var op = take().type;
        var w = product();
        v = op === '+' ? v + w : v - w;
      }
      return v;
    }
    // product := signed (('*' | '/') signed)*
    function product() {
      var v = signed();
      while (is('*') || is('/')) {
        var op = take().type;
        var w = signed();
        if (op === '/' && w === 0) throw new Error('divide by zero');
        v = op === '*' ? v * w : v / w;
      }
      return v;
    }
    // signed := '-' signed | power
    function signed() {
      if (is('-')) { take(); return -signed(); }
      return power();
    }
    // power := primary ('^' signed)?     (so 2^3^2 = 2^(3^2) and 2^-1 = 0.5)
    function power() {
      var base = primary();
      if (is('^')) { take(); return Math.pow(base, signed()); }
      return base;
    }
    // primary := number | '(' sum ')'
    function primary() {
      var t = peek();
      if (!t) throw new Error('syntax');
      if (t.type === 'num') { pos++; return t.value; }
      if (t.type === '(') { pos++; var v = sum(); take(')'); return v; }
      throw new Error('syntax');
    }
    if (!tokens.length) throw new Error('empty');
    var value = sum();
    if (pos !== tokens.length) throw new Error('syntax');
    if (!isFinite(value)) throw new Error('not finite');
    return value;
  }

  /** How a result is shown: whole numbers in full, otherwise 10 significant digits. */
  function format(value) {
    if (value === 0) return '0'; // also turns -0 into 0
    if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
    return String(Number(value.toPrecision(10)));
  }

  // ---------------------------------------------------------------------------
  // Widget
  // ---------------------------------------------------------------------------

  // [key saved in the data, label on the button, spoken label]
  var KEYS = [
    ['clear', 'C', 'clear'], ['back', '⌫', 'delete'], ['(', '(', 'open parenthesis'], [')', ')', 'close parenthesis'],
    ['7', '7'], ['8', '8'], ['9', '9'], ['/', '÷', 'divide'],
    ['4', '4'], ['5', '5'], ['6', '6'], ['*', '×', 'times'],
    ['1', '1'], ['2', '2'], ['3', '3'], ['-', '−', 'minus'],
    ['0', '0'], ['^', '^', 'to the power of'], ['=', '=', 'equals'], ['+', '+', 'plus']
  ];

  var KEYBOARD = {
    '0': '0', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
    '+': '+', '-': '-', '*': '*', 'x': '*', 'X': '*', '/': '/', '^': '^', '(': '(', ')': ')',
    '=': '=', 'Enter': '=', 'Backspace': 'back', 'Escape': 'clear', 'Delete': 'clear'
  };

  // How the stored expression is shown to students: 6*7^3 -> 6 × 7^3
  function pretty(expr) {
    return expr
      .replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/\+/g, ' + ').replace(/-/g, ' − ')
      .replace(/e \+ /g, 'e+').replace(/e − /g, 'e−')
      .replace(/\( /g, '(').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Panel on the right, toward the bottom, above the Continue button (which is
  // fixed 24px from the bottom right). On calculator pages (html.has-calculator)
  // the problem column keeps its centered position when there is room, and
  // otherwise moves left so its right edge stays 16px clear of the panel.
  var CSS =
    '.calc-panel{position:fixed;right:24px;bottom:96px;z-index:15;width:248px;box-sizing:border-box;' +
    'padding:12px;border:2px solid #c9d1de;border-radius:14px;background:#f5f7fb;' +
    'box-shadow:0 4px 18px rgba(29,36,51,.14);font-size:18px;line-height:1.4}' +
    '.calc-title{margin:0 0 8px;font-weight:600}' +
    '.calc-display{min-height:3.2em;padding:6px 10px;margin-bottom:10px;border:1px solid #c9d1de;border-radius:8px;' +
    'background:#fff;text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}' +
    '.calc-result{min-height:1.4em;color:#1e5aa8;font-weight:600}' +
    '.calc-keys{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}' +
    '.jspsych-display-element .calc-key{font:inherit;min-height:42px;padding:0;border:1px solid #c9d1de;' +
    'border-radius:8px;background:#fff;color:#1d2433;cursor:pointer;-webkit-user-select:none;user-select:none;' +
    'touch-action:manipulation}' +
    '.jspsych-display-element .calc-op{background:#e7eef9}' +
    '.jspsych-display-element .calc-equals{background:#1e5aa8;border-color:#1e5aa8;color:#fff;font-weight:600}' +
    '.jspsych-display-element .calc-key:hover{border-color:#1e5aa8}' +
    '.jspsych-display-element .calc-key:active{filter:brightness(.93)}' +
    '.jspsych-display-element .calc-key:focus-visible{outline:3px solid #f2c66d;outline-offset:1px}' +
    'html.has-calculator .jspsych-content{margin-left:max(16px,min(calc(50vw - 380px),calc(100vw - 1048px)));' +
    'margin-right:0;max-width:min(760px,calc(100vw - 304px))}' +
    '@media (max-width:899px){.calc-panel{position:static;width:auto;max-width:300px;margin:1.2em 0 0}' +
    'html.has-calculator .jspsych-content{margin-left:auto;margin-right:auto;max-width:760px}}';

  /** Adds the calculator's styles to the page (once). */
  function addStyle() {
    if (typeof document === 'undefined' || document.getElementById('calculator-style')) return;
    var style = document.createElement('style');
    style.id = 'calculator-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /** The calculator's HTML. `label` is the heading on the panel (default "Calculator"). */
  function html(label) {
    return '<div class="calculator calc-panel" data-track="calculator" role="group" aria-label="Calculator">' +
      '<p class="calc-title">' + escapeHtml(label || 'Calculator') + '</p>' +
      '<div class="calc-display">' +
      '<div class="calc-expr" aria-live="polite"></div>' +
      '<div class="calc-result" aria-live="polite"></div>' +
      '</div><div class="calc-keys">' +
      KEYS.map(function (k) {
        var cls = 'calc-key ' + (/[0-9]/.test(k[0]) ? 'calc-digit' : k[0] === '=' ? 'calc-equals' : 'calc-op');
        return '<button type="button" class="' + cls + '" data-key="' + escapeHtml(k[0]) + '"' +
          (k[2] ? ' aria-label="' + k[2] + '"' : '') + '>' + k[1] + '</button>';
      }).join('') +
      '</div></div>';
  }

  /**
   * Gives the calculator inside `container` its behavior. `options.t0` is the
   * page's start time (performance.now()), so calculator times line up with
   * the page's other timing data.
   */
  function Widget(container, options) {
    options = options || {};
    this.t0 = options.t0 != null ? options.t0 : (typeof performance !== 'undefined' ? performance.now() : 0);
    this.maxEvents = options.maxEvents || 1000;
    this.onPress = options.onPress || null;   // called after every key press (pages.js: edit_sequence)
    this.expr = '';
    this.justEvaluated = false;
    this.events = [];
    this.truncated = false;
    this.el = container ? container.querySelector('.calculator') : null;
    if (!this.el) return;
    this.exprEl = this.el.querySelector('.calc-expr');
    this.resultEl = this.el.querySelector('.calc-result');
    var self = this;
    this.el.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-key]') : null;
      if (!b) return;
      b.focus(); // Safari does not focus buttons on click; keyboard input needs focus here
      self.press(b.getAttribute('data-key'), false);
    });
    this.el.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var k = KEYBOARD[e.key];
      if (!k) return;
      e.preventDefault();
      e.stopPropagation();
      self.press(k, true);
    });
    this.render('', '');
  }

  Widget.prototype.render = function (result, evaluated) {
    if (!this.el) return;
    // After =, the top line keeps the calculation and the result shows below it.
    this.exprEl.textContent = pretty(result ? evaluated : this.expr) || '0';
    this.resultEl.textContent = !result ? '' : result === 'Error' ? 'Error' : '= ' + result;
  };

  /** One key press (also used by the tests). */
  Widget.prototype.press = function (k, fromKeyboard) {
    var result = '';
    var evaluated = this.expr;
    var ev = { t: Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - this.t0), k: k };
    if (k === 'clear') {
      this.expr = '';
      this.justEvaluated = false;
    } else if (k === 'back') {
      this.expr = this.justEvaluated ? '' : this.expr.slice(0, -1);
      this.justEvaluated = false;
    } else if (k === '=') {
      if (this.expr) {
        try { result = format(evaluate(this.expr)); } catch (err) { result = 'Error'; }
        ev.q = this.expr;
        ev.r = result;
        if (result !== 'Error') { this.expr = result; this.justEvaluated = true; }
      }
    } else if (KEYBOARD[k] === k) {
      if (this.justEvaluated) {
        // A digit or "(" starts a new calculation; an operator continues from the result.
        if (/[0-9(]/.test(k)) this.expr = '';
        else if (k === '^' && this.expr[0] === '-') this.expr = '(' + this.expr + ')';
      }
      this.justEvaluated = false;
      if (this.expr.length < 200) this.expr += k;
    } else {
      return;
    }
    ev.x = this.expr;
    if (fromKeyboard) ev.s = 'key';
    if (this.events.length < this.maxEvents) this.events.push(ev); else this.truncated = true;
    if (this.onPress) this.onPress(ev);
    this.render(result, evaluated);
  };

  Widget.prototype.result = function () {
    return { events: this.events, truncated: this.truncated };
  };

  return { evaluate: evaluate, format: format, pretty: pretty, html: html, addStyle: addStyle, Widget: Widget };
});
