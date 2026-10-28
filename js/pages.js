/*
 * pages.js — builds the jsPsych pages.
 *
 * Every page is a form with a single Continue button in the lower-right
 * corner. There is no Back button.
 *
 * Each problem page saves one row with:
 *   kind              'practice' or 'problem'
 *   item_id, title, item_type ('typed' | 'choice' | 'yesno'), instrument_version
 *   raw_answer        the typed answer, the chosen option, or Yes/No
 *                     (problems with revealOn: the typed answer, or null when
 *                     the answer box was never shown)
 *   yes_no            (problems with revealOn only) 'Yes', 'No' or 'I don’t know', the button
 *                     the student picked before the answer box could appear
 *   explanation       the text in the explanation box
 *   is_correct        true/false; null when not scored automatically or when a
 *                     typed answer could not be read (left for a person)
 *   parsed            (typed) answer-parser.js result: value, structure, ...
 *   rt                ms from the page appearing to Continue (jsPsych)
 *   timing            first_input_ms, per-field first_ms / last_ms / n_events,
 *                     figure_load_ms (when every figure on the page had loaded)
 *   answer_history    successive versions of the typed answer, or each option
 *                     clicked (including Yes/No), with times: [{t, v}, ...]
 *   edit_sequence     the order in which the student worked on the page, one letter
 *                     per stretch of activity: A = answer (typing in the answer box,
 *                     or choosing an option), E = explanation box, C = calculator,
 *                     Y = the Yes/No buttons of a revealOn problem. "AE": answer,
 *                     then explanation; "CAE": calculator, answer, explanation;
 *                     "AEAE": back and forth. edit_runs gives each stretch's
 *                     times: [{f, start_ms, end_ms, n}, ...] (n = edits in it)
 *   refused_input     (typed) characters the answer box refused because they are
 *                     not in answerCharacters (config.js), with times: [{t, c}, ...]
 *   code              the answer's interpretation from codes.js (answer-coder.js):
 *                     {stage, note, rule, codes_version}; null if the problem has
 *                     no rules
 *   integrity_events  blocked copying, pasting and printing, screenshot keys,
 *                     and leaving full screen, with times (see "Assessment
 *                     integrity" below); also fullscreen_mode,
 *                     fullscreen_exit_count and fullscreen_away_ms
 *   calculator_enabled  true when the problem has `calculator: true` in content.js
 *   calculator        every key pressed on the calculator (input, edits, and each
 *                     result), with times: {events: [{t, k, x, q, r, s}, ...],
 *                     truncated} (see calculator.js); null without a calculator
 *   pointer_events   cursor/touch samples (see pointer-tracker.js)
 *   left_page_count, left_page_ms   times the student switched away from the page
 */
(function (root) {
  'use strict';

  var cfg = root.STUDY_CONFIG;
  var text = root.STUDY_CONTENT;

  // This student's answers so far, for codebook rules that look at an
  // earlier problem (e.g. a follow-up problem). There is no Back button, so
  // earlier problems are always finished.
  var answersSoFar = {};

  function codeAnswer(itemId, answer) {
    if (!root.AnswerCoder || !root.STUDY_CODES) return null;
    try {
      return root.AnswerCoder.code(root.STUDY_CODES, itemId, answer, function (id) {
        return answersSoFar[id] || null;
      });
    } catch (e) {
      // A mistake in codes.js must never stop the assessment.
      return { stage: null, note: 'Coding error: ' + e.message, rule: null,
        codes_version: root.STUDY_CODES.version || null };
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Enter in a one-line box moves to the next field instead of submitting the page.
  function enterMovesToNextField(form) {
    form.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
      if (e.target.type === 'submit') return;
      e.preventDefault();
      var fields = Array.prototype.filter.call(form.elements, function (el) {
        return !el.disabled && el.type !== 'hidden' && el.type !== 'submit' && el.offsetParent !== null;
      });
      var next = fields[fields.indexOf(e.target) + 1];
      if (next) next.focus();
    });
  }

  /**
   * A page with a Continue button. All pages use this, so every page looks
   * and behaves the same way.
   */
  function page(options) {
    var userOnLoad = options.on_load;
    return {
      type: root.jsPsychSurveyHtmlForm,
      html: '<div class="page">' + options.html + '</div>',
      button_label: text.continueLabel,
      autofocus: '',
      data: options.data || {},
      on_load: function () {
        var form = document.getElementById('jspsych-survey-html-form');
        if (form) enterMovesToNextField(form);
        window.scrollTo(0, 0);
        if (userOnLoad) userOnLoad.apply(this, arguments);
      },
      on_finish: options.on_finish
    };
  }

  // ---------------------------------------------------------------------------
  // Assessment integrity
  //
  // On problem pages (practice and assessment):
  //   - nothing can be copied or cut, and the problem text and figures cannot
  //     be selected, dragged or right-clicked (config.js blockCopying);
  //   - nothing can be pasted or dropped into the answer and explanation boxes
  //     (config.js blockPasting);
  //   - printing (Ctrl/Cmd+P) and saving the page (Ctrl/Cmd+S) are blocked, and
  //     problem pages print blank;
  //   - screenshot keys are noticed when the browser sees them: Print Screen on
  //     Windows (alone or with Alt, Ctrl or the Windows key), and Windows+Shift+S
  //     or Cmd+Shift+3/4/5 when the computer passes them on (usually it does
  //     not). Phone photos and screenshot tools started with the mouse cannot
  //     be noticed, and no web page can block screenshots.
  // A short note tells the student when copying, pasting or printing is blocked.
  //
  // Full screen (config.js requireFullscreen): after "About you", a page asks the
  // student to continue in full screen. From then on, leaving full screen
  // covers the whole screen in blue with "Please return to full-screen mode to
  // continue the assessment." and a button that returns to full screen. Inside
  // Safe Exam Browser, or in a browser without full-screen support, this step is
  // skipped (fullscreen_mode says which).
  //
  // Saved with each problem page:
  //   integrity_events  [{t, e, field, chars, key}, ...], t in ms since the page appeared
  //       e: 'copy' | 'cut' | 'menu' (right-click) | 'drag' | 'paste' | 'drop' |
  //          'print' | 'save' | 'screenshot_key' | 'fullscreen_exit' | 'fullscreen_return'
  //       field: 'answer' or 'explanation' when it happened in a box
  //       chars: (paste, drop) how many characters were blocked; the text itself
  //              is never read into the data
  //       key:   (screenshot_key) e.g. 'PrintScreen', 'Alt+PrintScreen', 'Win+Shift+S'
  //   fullscreen_mode        'required' | 'safe_exam_browser' | 'unavailable' | 'off'
  //   fullscreen_exit_count  times the student left full screen on this page
  //   fullscreen_away_ms     time spent out of full screen on this page
  // ---------------------------------------------------------------------------

  var DEFAULTS = {
    copyPasteNote: 'Copying and pasting are turned off during the assessment.',
    printNote: 'Printing and saving are turned off during the assessment.',
    fullscreenHtml:
      '<p>This assessment is taken in full-screen mode. When you click Continue, your screen will ' +
      'switch to full screen.</p>' +
      '<p>Please stay in full-screen mode until you finish. If you leave full-screen mode, the ' +
      'problems will be hidden until you return to it.</p>',
    fullscreenReturnText: 'Please return to full-screen mode to continue the assessment.',
    fullscreenReturnButton: 'Return to full screen',
    // "About you" page: the major (major-field.js, list in majors.js)
    majorLabel: 'Current Major or Program of Study:',
    majorHelp: 'Start typing, then choose the major or program that best fits from the list. ' +
      'If you have not chosen a major yet, choose \u201cUndeclared / Undecided.\u201d',
    secondMajorQuestion: 'Do you have a second major?',
    secondMajorLabel: 'Second Major or Program of Study:',
    sameMajorNote: 'This is the same as your first major. Choose a different one, or answer No above.'
  };
  function wording(key) { return text[key] || DEFAULTS[key]; }

  var INTEGRITY_CSS =
    '.no-copy{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}' +
    '.no-copy input,.no-copy textarea{-webkit-user-select:text;user-select:text}' +
    '@media print{.no-copy{display:none!important}}' +
    '#integrity-note{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:30;' +
    'max-width:90vw;padding:10px 18px;border-radius:8px;background:#1d2433;color:#fff;' +
    'font:16px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25)}' +
    '#integrity-note[hidden]{display:none}' +
    '#fullscreen-overlay{position:fixed;inset:0;z-index:2147483647;background:#1e5aa8;color:#fff;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:48px;' +
    'padding:40px;box-sizing:border-box;text-align:center}' +
    '#fullscreen-overlay[hidden]{display:none}' +
    '#fullscreen-overlay p{margin:0;max-width:960px;font:700 clamp(30px,4.6vw,56px)/1.25 system-ui,sans-serif}' +
    '#fullscreen-overlay button{font:600 24px/1 system-ui,sans-serif;padding:20px 36px;border:0;' +
    'border-radius:12px;background:#fff;color:#1e5aa8;cursor:pointer}' +
    '#fullscreen-overlay button:focus-visible{outline:4px solid #f2c66d;outline-offset:4px}' +
    'html.fullscreen-locked .jspsych-content-wrapper,html.fullscreen-locked #jspsych-progressbar-container' +
    '{visibility:hidden}';

  function addIntegrityStyle() {
    if (document.getElementById('integrity-style')) return;
    var style = document.createElement('style');
    style.id = 'integrity-style';
    style.textContent = INTEGRITY_CSS;
    document.head.appendChild(style);
  }

  var noteTimer = null;
  function showNote(message) {
    var el = document.getElementById('integrity-note');
    if (!el) {
      el = document.createElement('div');
      el.id = 'integrity-note';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { el.hidden = true; }, 4000);
  }

  function boxName(el) {
    return el && (el.name === 'answer' || el.name === 'explanation') ? el.name : null;
  }
  function isOwnBox(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  /** Blocks and records copying, pasting, printing and screenshot keys on one problem page. */
  function IntegrityGuard(t0) {
    this.t0 = t0;
    this.events = [];
    this.handlers = [];
    this.lastShot = -Infinity;
  }

  IntegrityGuard.prototype.note = function (e, extra) {
    if (this.events.length >= 300) return;
    var ev = { t: Math.round(performance.now() - this.t0), e: e };
    Object.keys(extra || {}).forEach(function (k) { if (extra[k] != null) ev[k] = extra[k]; });
    this.events.push(ev);
  };

  IntegrityGuard.prototype.on = function (target, type, fn) {
    target.addEventListener(type, fn, true);
    this.handlers.push([target, type, fn]);
  };

  IntegrityGuard.prototype.start = function () {
    var self = this;
    if (cfg.blockCopying !== false) {
      ['copy', 'cut'].forEach(function (type) {
        self.on(document, type, function (e) {
          e.preventDefault();
          self.note(type, { field: boxName(e.target) });
          showNote(wording('copyPasteNote'));
        });
      });
      self.on(document, 'contextmenu', function (e) {
        if (isOwnBox(e.target)) return;   // spelling suggestions still work in the boxes
        e.preventDefault();
        self.note('menu');
      });
      self.on(document, 'dragstart', function (e) {
        if (isOwnBox(e.target)) return;
        e.preventDefault();
        self.note('drag');
      });
    }
    if (cfg.blockPasting !== false) {
      self.on(document, 'paste', function (e) {
        e.preventDefault();
        var pasted = '';
        try { pasted = (e.clipboardData || window.clipboardData).getData('text') || ''; } catch (err) { /* unavailable */ }
        self.note('paste', { field: boxName(e.target), chars: pasted.length });
        showNote(wording('copyPasteNote'));
      });
      self.on(document, 'drop', function (e) {
        e.preventDefault();
        var dropped = '';
        try { dropped = e.dataTransfer.getData('text') || ''; } catch (err) { /* unavailable */ }
        self.note('drop', { field: boxName(e.target), chars: dropped.length });
        showNote(wording('copyPasteNote'));
      });
      // Pasting that does not raise a paste event (some keyboards and menus)
      self.on(document, 'beforeinput', function (e) {
        if (!/^insertFrom(Paste|PasteAsQuotation|Drop)$/.test(e.inputType || '')) return;
        e.preventDefault();
        self.note(e.inputType === 'insertFromDrop' ? 'drop' : 'paste', { field: boxName(e.target) });
        showNote(wording('copyPasteNote'));
      });
    }
    self.on(document, 'keydown', function (e) { self.onKey(e, true); });
    self.on(document, 'keyup', function (e) { self.onKey(e, false); });
    self.on(window, 'beforeprint', function () { self.note('print'); });
  };

  IntegrityGuard.prototype.onKey = function (e, down) {
    var k = e.key || '';
    var command = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (down && command && !e.shiftKey && (k === 'p' || k === 'P' || k === 's' || k === 'S')) {
      e.preventDefault();
      this.note(k.toLowerCase() === 'p' ? 'print' : 'save');
      showNote(wording('printNote'));
      return;
    }
    var shot = null;
    if (k === 'PrintScreen' || e.code === 'PrintScreen') {
      shot = (e.altKey ? 'Alt+' : '') + (e.ctrlKey ? 'Ctrl+' : '') + (e.metaKey ? 'Win+' : '') + 'PrintScreen';
    } else if (down && e.metaKey && e.shiftKey && (k === 's' || k === 'S')) {
      shot = 'Win+Shift+S';
    } else if (down && e.metaKey && e.shiftKey && /^Digit[345]$/.test(e.code || '')) {
      shot = (e.ctrlKey ? 'Cmd+Ctrl+Shift+' : 'Cmd+Shift+') + e.code.slice(-1);
    }
    if (!shot) return;
    var now = performance.now();
    if (now - this.lastShot < 1000) return;   // one press can arrive as both keydown and keyup
    this.lastShot = now;
    this.note('screenshot_key', { key: shot });
  };

  IntegrityGuard.prototype.stop = function () {
    this.handlers.forEach(function (h) { h[0].removeEventListener(h[1], h[2], true); });
    this.handlers = [];
    return this.events;
  };

  // ---- Full screen ------------------------------------------------------------

  function inSafeExamBrowser() {
    return !!window.SafeExamBrowser || /\bSEB\//.test(navigator.userAgent || '');
  }

  var fullscreen = {
    mode: 'off',      // 'required' | 'safe_exam_browser' | 'unavailable' | 'off'
    active: false,    // true once the student has been asked to go full screen
    locked: false,    // true while the blue screen is up
    exits: [],        // [{start, end}] in performance.now() ms
    page: null        // the IntegrityGuard of the page on screen, for its record
  };

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function fullscreenSupported() {
    var d = document.documentElement;
    return !!(d.requestFullscreen || d.webkitRequestFullscreen);
  }

  function requestFullscreen() {
    var d = document.documentElement;
    try {
      var p = d.requestFullscreen ? d.requestFullscreen({ navigationUI: 'hide' }) : d.webkitRequestFullscreen();
      if (p && p.catch) p.catch(function () { /* the blue screen offers the button again */ });
    } catch (e) { /* the blue screen offers the button again */ }
  }

  function overlay() {
    var el = document.getElementById('fullscreen-overlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'fullscreen-overlay';
    el.hidden = true;
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = '<p></p><button type="button"></button>';
    el.querySelector('p').textContent = wording('fullscreenReturnText');
    var button = el.querySelector('button');
    button.textContent = wording('fullscreenReturnButton');
    button.addEventListener('click', requestFullscreen);
    document.body.appendChild(el);
    return el;
  }

  function setLocked(locked) {
    if (locked === fullscreen.locked) return;
    fullscreen.locked = locked;
    var now = performance.now();
    if (locked) fullscreen.exits.push({ start: now, end: null });
    else if (fullscreen.exits.length) fullscreen.exits[fullscreen.exits.length - 1].end = now;
    var el = overlay();
    el.hidden = !locked;
    document.documentElement.classList.toggle('fullscreen-locked', locked);
    if (locked) {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      el.querySelector('button').focus();
    }
    if (fullscreen.page) fullscreen.page.note(locked ? 'fullscreen_exit' : 'fullscreen_return');
  }

  function checkFullscreen() {
    if (fullscreen.active) setLocked(!fullscreenElement());
  }

  /** True when the "continue in full screen" page should be shown (and sets fullscreen_mode). */
  function fullscreenNeeded() {
    if (cfg.requireFullscreen === false) fullscreen.mode = 'off';
    else if (inSafeExamBrowser()) fullscreen.mode = 'safe_exam_browser';
    else if (!fullscreenSupported()) fullscreen.mode = 'unavailable';
    else fullscreen.mode = 'required';
    return fullscreen.mode === 'required';
  }

  // The page before the practice problems. Its Continue click (a user action,
  // which browsers require) switches to full screen and starts the check.
  function fullscreenStartPage() {
    return page({
      html: '<div class="info">' + wording('fullscreenHtml') + '</div>',
      data: { kind: 'fullscreen_start' },
      on_load: function () {
        addIntegrityStyle();
        var button = document.getElementById('jspsych-survey-html-form-next');
        if (!button) return;
        button.addEventListener('click', function () {
          requestFullscreen();
          if (fullscreen.active) return;
          fullscreen.active = true;
          document.addEventListener('fullscreenchange', checkFullscreen);
          document.addEventListener('webkitfullscreenchange', checkFullscreen);
          setTimeout(checkFullscreen, 1500);   // if full screen did not start, show the blue screen
        });
      }
    });
  }

  // On the final page: stop checking and leave full screen.
  function fullscreenStop() {
    if (!fullscreen.active) return;
    fullscreen.active = false;
    document.removeEventListener('fullscreenchange', checkFullscreen);
    document.removeEventListener('webkitfullscreenchange', checkFullscreen);
    setLocked(false);
    try {
      if (fullscreenElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } catch (e) { /* already left */ }
  }

  // Times the student left full screen during [from, to] (performance.now() ms).
  function fullscreenAway(from, to) {
    var count = 0;
    var ms = 0;
    fullscreen.exits.forEach(function (x) {
      var end = x.end === null ? to : x.end;
      if (x.start >= from && x.start <= to) count += 1;
      ms += Math.max(0, Math.min(end, to) - Math.max(x.start, from));
    });
    return { count: count, ms: Math.round(ms) };
  }

  // ---------------------------------------------------------------------------
  // Problem pages
  // ---------------------------------------------------------------------------

  // track: the label cursor samples get over this figure ('figure', 'figure-2')
  function figureHtml(figure, track) {
    if (!figure) return '';
    return '<figure class="problem-figure">' +
      '<img src="' + escapeHtml(figure.src) + '" alt="' + escapeHtml(figure.alt || '') + '" ' +
      'style="width:' + Number(figure.width) + 'px" draggable="false" ' +
      'data-track="' + (track || 'figure') + '" data-track-relative>' +
      '</figure>';
  }

  function optionLetter(option, i) {
    var m = /([A-Z])$/.exec(option);
    return m ? m[1] : String(i + 1);
  }

  // dontKnow: true in content.js adds a third button, "I don't know" (text.dontKnowLabel).
  function yesNoHtml(req, item) {
    var values = ['Yes', 'No'];
    if (item && item.dontKnow) values.push(text.dontKnowLabel || 'I don\u2019t know');
    return '<fieldset class="choices yesno" data-track="yesno"><legend class="visually-hidden">Yes or No</legend>' +
      values.map(function (v, i) {
        return '<label class="choice" data-track="option-' + (i < 2 ? v : 'DontKnow') + '">' +
          '<input type="radio" name="yesno" value="' + escapeHtml(v) + '"' + req + '><span>' + escapeHtml(v) + '</span></label>';
      }).join('') +
      '</fieldset>';
  }

  function responseHtml(item) {
    var req = cfg.requireAnswers ? ' required' : '';
    var html = '<div class="response">';
    if (item.revealOn) {
      if (item.response !== 'typed' || (item.revealOn !== 'Yes' && item.revealOn !== 'No')) {
        throw new Error(item.id + ': revealOn must be \'Yes\' or \'No\', on a typed problem');
      }
      // Yes/No first; the answer and explanation boxes below start hidden (see showRevealed).
      html += yesNoHtml(req, item) + '<div class="revealed" style="margin-top: 0.8em" hidden>';
    }
    if (item.response === 'typed') {
      if (item.hint !== false) html += '<p class="hint">' + escapeHtml(text.typedHint) + '</p>';
      html +=
        '<input name="answer" type="text" class="answer-input" autocomplete="off" ' +
        'autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="200" ' +
        'aria-label="Your answer" data-track="answer-box"' + req + '>' +
        // Filled in by answer-filter.js when a character is refused.
        '<p class="answer-note" role="status" aria-live="polite"></p>';
    } else if (item.response === 'choice') {
      var columns = Number(item.optionColumns) || 0;
      var layout = columns ? ' columns' : item.options.length > 6 ? ' many' : '';
      var style = columns ? ' style="--option-columns: ' + columns + '"' : '';
      html += '<fieldset class="choices' + layout + '"' + style + ' data-track="choices">' +
        '<legend class="visually-hidden">Choose one option</legend>';
      item.options.forEach(function (option, i) {
        html += '<label class="choice" data-track="option-' + optionLetter(option, i) + '">' +
          '<input type="radio" name="choice" value="' + escapeHtml(option) + '"' + req + '>' +
          '<span>' + escapeHtml(option) + '</span></label>';
      });
      html += '</fieldset>';
    } else if (item.response === 'yesno') {
      html += yesNoHtml(req, item);
    } else {
      throw new Error('Unknown response type "' + item.response + '" for ' + item.id);
    }

    // explain: false in content.js leaves out the explanation box on this problem.
    if (item.explain !== false) {
      var label = item.response === 'yesno' ? text.yesExplainLabel : text.explainLabel;
      var explainRequired = item.response === 'yesno' ? '' : req; // Yes/No: set when Yes is chosen
      html +=
        '<label class="explain-label" for="explanation-' + item.id + '">' + escapeHtml(label) + '</label>' +
        '<textarea id="explanation-' + item.id + '" name="explanation" class="explanation-input" rows="5" ' +
        'maxlength="10000" data-track="explanation-box"' + explainRequired + '></textarea>';
    }
    if (item.revealOn) html += '</div>';
    return html + '</div>';
  }

  // revealOn problems: the answer and explanation boxes are shown only after
  // the student picks item.revealOn. While hidden they are disabled, so they
  // are neither required nor submitted.
  function showRevealed(form, show) {
    var block = form.querySelector('.revealed');
    if (!block) return;
    block.hidden = !show;
    Array.prototype.forEach.call(block.querySelectorAll('input, textarea'), function (el) {
      el.disabled = !show;
    });
  }

  // Records when each field is first and last changed, and how the answer evolved.
  function ResponseRecorder(item) {
    this.item = item;
    this.t0 = performance.now();
    this.first = null;
    this.fields = {};
    this.history = [];
    this.historyTruncated = false;
    this.refused = [];
    this.figureLoadMs = null;
    this.runs = [];   // stretches of activity for edit_sequence
  }

  // One edit (A, E, C or Y): extends the current stretch or starts a new one.
  ResponseRecorder.prototype.noteActivity = function (letter) {
    var t = Math.round(performance.now() - this.t0);
    var last = this.runs[this.runs.length - 1];
    if (last && last.f === letter) { last.end_ms = t; last.n += 1; return; }
    if (this.runs.length < 500) this.runs.push({ f: letter, start_ms: t, end_ms: t, n: 1 });
  };

  // Characters the answer box refused (see answer-filter.js), with times.
  ResponseRecorder.prototype.noteRefused = function (chars) {
    if (this.refused.length >= 200) return;
    this.refused.push({ t: Math.round(performance.now() - this.t0), c: chars });
  };

  ResponseRecorder.prototype.attach = function (form) {
    var self = this;
    function onEvent(e) {
      var name = e.target && e.target.name;
      if (!name) return;
      var t = Math.round(performance.now() - self.t0);
      if (self.first === null) self.first = t;
      var f = self.fields[name] || (self.fields[name] = { first_ms: t, last_ms: t, n_events: 0 });
      f.last_ms = t;
      f.n_events += 1;
      // edit_sequence: typing counts once per input event, options once per change
      if (e.type === 'input' && name === 'answer') self.noteActivity('A');
      else if (e.type === 'input' && name === 'explanation') self.noteActivity('E');
      else if (e.type === 'change' && name === 'choice') self.noteActivity('A');
      else if (e.type === 'change' && name === 'yesno') self.noteActivity(self.item.response === 'yesno' ? 'A' : 'Y');
      var tracked = (name === 'answer' && e.type === 'input') ||
        ((name === 'choice' || name === 'yesno') && e.type === 'change');
      if (!tracked) return;
      var v = e.target.value;
      var last = self.history[self.history.length - 1];
      if (last && last.v === v) return;
      if (self.history.length >= cfg.answerHistoryMax) { self.historyTruncated = true; return; }
      self.history.push({ t: t, v: v });
    }
    form.addEventListener('input', onEvent);
    form.addEventListener('change', onEvent);

    // figure_load_ms: when every figure on the page has loaded
    var imgs = form.querySelectorAll('.problem-figure img');
    var waiting = imgs.length;
    var done = function () {
      waiting -= 1;
      if (waiting === 0) self.figureLoadMs = Math.round(performance.now() - self.t0);
    };
    Array.prototype.forEach.call(imgs, function (img) {
      if (img.complete) done(); else img.addEventListener('load', done);
    });
  };

  ResponseRecorder.prototype.result = function () {
    return {
      timing: { first_input_ms: this.first, fields: this.fields, figure_load_ms: this.figureLoadMs },
      answer_history: this.history,
      edit_sequence: this.runs.map(function (r) { return r.f; }).join(''),
      edit_runs: this.runs,
      answer_history_truncated: this.historyTruncated,
      refused_input: this.refused
    };
  };

  // The note shown under the answer box when a character is refused.
  // content.js can override the wording with answerRefusedNote; "{symbols}"
  // in it is replaced by the allowed symbols.
  function refusedNoteText(allowed) {
    var symbols = root.AnswerFilter.symbolsText(allowed);
    var template = text.answerRefusedNote ||
      'Your answer can include only numbers and these symbols: {symbols}';
    return template.replace('{symbols}', symbols);
  }

  function limitAnswerBox(form, item, recorder) {
    var allowed = item.answerCharacters !== undefined ? item.answerCharacters : cfg.answerCharacters;
    var box = form.querySelector('input[name="answer"]');
    var note = form.querySelector('.answer-note');
    if (!box || !allowed) return;
    var timer = null;
    root.AnswerFilter.attach(box, allowed, function (chars) {
      recorder.noteRefused(chars);
      if (!note) return;
      note.textContent = refusedNoteText(allowed);
      clearTimeout(timer);
      timer = setTimeout(function () { note.textContent = ''; }, 6000);
    });
  }

  function problemPage(item, isPractice) {
    var tracker = new root.PointerTracker({
      enabled: cfg.pointerTracking,
      sampleMs: cfg.pointerSampleMs,
      maxEvents: cfg.pointerMaxEventsPerTrial
    });
    var recorder;
    // content.js: calculator: true shows the calculator panel (calculator.js); false or no line, none.
    var calculatorOn = item.calculator === true && !!root.Calculator;
    if (item.calculator === true && !root.Calculator) {
      console.error(item.id + ': calculator: true, but js/calculator.js is not loaded in index.html');
    }
    var calculator = null;
    var guard = null;

    var html =
      '<h2 class="problem-title">' + escapeHtml(item.title) + '</h2>' +
      (item.lead || '') +
      figureHtml(item.figure, 'figure') +
      (item.prompt || '') +
      figureHtml(item.figure2, 'figure-2') +   // optional second figure and the text below it
      (item.prompt2 || '') +
      responseHtml(item) +
      (calculatorOn ? root.Calculator.html(text.calculatorLabel) : '');   // fixed to the lower right

    // main.js starts downloading each problem's first figure; start the second one here.
    if (item.figure2) new Image().src = item.figure2.src;

    if (cfg.blockCopying !== false) html = '<div class="no-copy">' + html + '</div>';

    return page({
      html: html,
      data: {
        kind: isPractice ? 'practice' : 'problem',
        item_id: item.id,
        title: item.title,
        item_type: item.response,
        instrument_version: cfg.instrumentVersion,
        form: item.form || null,          // A or B (null on practice problems)
        position: item.position || null  // 1-26: where the problem came for this student
      },
      on_load: function () {
        var form = document.getElementById('jspsych-survey-html-form');
        recorder = new ResponseRecorder(item);
        recorder.attach(form);
        if (calculatorOn) {
          root.Calculator.addStyle();
          document.documentElement.classList.add('has-calculator');   // keeps the problem clear of the panel
          calculator = new root.Calculator.Widget(form, {
            t0: recorder.t0, maxEvents: cfg.calculatorMaxEvents,
            onPress: function () { recorder.noteActivity('C'); }   // C in edit_sequence
          });
        }
        addIntegrityStyle();
        guard = new IntegrityGuard(recorder.t0);
        guard.start();
        fullscreen.page = guard;
        if (item.response === 'typed') limitAnswerBox(form, item, recorder);
        tracker.start(document.querySelector('.jspsych-content') || document.body);
        if (item.revealOn) {
          showRevealed(form, false);
          form.addEventListener('change', function (e) {
            if (e.target.name === 'yesno') showRevealed(form, e.target.value === item.revealOn);
          });
        }
        var box = form.querySelector('textarea[name="explanation"]');
        if (item.response === 'yesno' && cfg.requireAnswers && box) {
          form.addEventListener('change', function (e) {
            if (e.target.name === 'yesno') box.required = e.target.value === 'Yes';
          });
        }
      },
      on_finish: function (data) {
        var r = data.response || {};
        // revealOn problems: the answer box counts only if it was shown.
        var answered = !item.revealOn || r.yesno === item.revealOn;
        if (item.revealOn) data.yes_no = r.yesno || null;
        var raw = !answered ? null
          : item.response === 'typed' ? (r.answer || '')
          : item.response === 'choice' ? (r.choice || null)
          : (r.yesno || null);
        data.raw_answer = raw;
        // null: this problem has no explanation box (explain: false)
        data.explanation = item.explain === false ? null : answered ? (r.explanation || '') : '';
        if (!answered) {
          data.parsed = null;
          data.is_correct = null;
        } else if (item.response === 'typed') {
          // A letter in the answer key (correct: '5h/7') is read as a variable (answer-parser.js).
          data.parsed = root.AnswerParser.parse(raw, { variables: item.correct });
          try {
            data.is_correct = root.AnswerParser.score(raw, item.correct);
          } catch (e) {
            // An answer key that cannot be read must never stop the assessment.
            console.error(item.id + ': ' + e.message);
            data.is_correct = null;
          }
        } else if (item.response === 'choice') {
          data.is_correct = item.correct == null || raw == null ? null : raw === item.correct;
        } else {
          data.is_correct = null;
        }
        var answer = { raw: raw, parsed: data.parsed || null, is_correct: data.is_correct, response: item.response };
        if (item.revealOn) answer.yes_no = data.yes_no;
        data.code = codeAnswer(item.id, answer);
        answersSoFar[item.id] = answer;
        fullscreen.page = null;
        data.integrity_events = guard.stop();
        var away = fullscreenAway(recorder.t0, performance.now());
        data.fullscreen_mode = fullscreen.mode;
        data.fullscreen_exit_count = away.count;
        data.fullscreen_away_ms = away.ms;
        data.calculator_enabled = calculatorOn;
        data.calculator = calculator ? calculator.result() : null;
        document.documentElement.classList.remove('has-calculator');
        var rec = recorder.result();
        Object.keys(rec).forEach(function (k) { data[k] = rec[k]; });
        var tracked = tracker.stop();
        Object.keys(tracked).forEach(function (k) { data[k] = tracked[k]; });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Other pages
  // ---------------------------------------------------------------------------

  function requiredYesNo(name, question) {
    return '<p class="question">' + escapeHtml(question) + '</p>' +
      '<fieldset class="choices yesno"><legend class="visually-hidden">' +
      escapeHtml(question) + '</legend>' +
      '<label class="choice"><input type="radio" name="' + name + '" value="Yes" required><span>Yes</span></label>' +
      '<label class="choice"><input type="radio" name="' + name + '" value="No" required><span>No</span></label>' +
      '</fieldset>';
  }

  // Consent page: the study information, then "18 or older?" (when content.js
  // has ageQuestion), then the consent question. Both answers are required.
  // onAnswer receives { adult: true/false, agreed: true/false }.
  function consentPage(onAnswer) {
    return page({
      html:
        '<div class="consent">' + text.consentHtml + '</div>' +
        (text.ageQuestion ? requiredYesNo('adult', text.ageQuestion) : '') +
        requiredYesNo('consent', text.consentQuestion),
      data: { kind: 'consent' },
      on_finish: function (data) {
        var response = data.response || {};
        onAnswer({
          adult: text.ageQuestion ? response.adult === 'Yes' : true,
          agreed: response.consent === 'Yes'
        });
      }
    });
  }

  function selectHtml(name, label, options) {
    return '<label class="field">' + escapeHtml(label) +
      '<select name="' + name + '" required>' +
      '<option value="">Choose…</option>' +
      options.map(function (o) {
        return '<option value="' + escapeHtml(o) + '">' + escapeHtml(o) + '</option>';
      }).join('') +
      '</select></label>';
  }

  function majorHtml(name, label, help, hidden) {
    return '<div class="field major-field"' + (hidden ? ' hidden' : '') + '>' +
      '<label for="' + name + '">' + escapeHtml(label) + '</label>' +
      (help ? '<span class="major-help" id="' + name + '-help">' + escapeHtml(help) + '</span>' : '') +
      '<input id="' + name + '" type="text" maxlength="200" required' + (hidden ? ' disabled' : '') +
      (help ? ' aria-describedby="' + name + '-help"' : '') + '>' +
      '</div>';
  }

  // "About you": name, age, email, academic program, major (type-ahead, from
  // majors.js), and "Do you have a second major?" (Yes shows a second major box).
  // The majors are saved with the session (main.js), by CIP code and CIP family.
  function demographicsPage(onSubmit) {
    var name = function (field, label, auto) {
      return '<label class="field">' + label +
        '<input name="' + field + '" type="text" required maxlength="100" pattern=".*\\S.*" ' +
        'autocomplete="' + auto + '" spellcheck="false"></label>';
    };
    var first = null;
    var second = null;
    return page({
      html:
        '<div class="intro">' + text.demographicsIntroHtml + '</div>' +
        name('first_name', 'First name:', 'given-name') +
        name('last_name', 'Last name:', 'family-name') +
        selectHtml('age_range', 'Current Age:', text.ageOptions) +
        '<label class="field">College/University Email Address:' +
        '<input name="email" type="email" required maxlength="254" autocomplete="email" ' +
        'inputmode="email" autocapitalize="off" spellcheck="false" ' +
        'pattern="[^@\\s]+@[^@\\s]+\\.[^@\\s]+" ' +
        'title="Enter an email address such as name@school.edu"></label>' +
        selectHtml('academic_program', 'Current Degree Program:', text.academicProgramOptions) +
        majorHtml('major', wording('majorLabel'), wording('majorHelp'), false) +
        '<div class="field">' + requiredYesNo('has_second_major', wording('secondMajorQuestion')) + '</div>' +
        majorHtml('second_major', wording('secondMajorLabel'), '', true),
      data: { kind: 'demographics' },
      on_load: function () {
        var form = document.getElementById('jspsych-survey-html-form');
        var secondBox = document.getElementById('second_major');
        first = new root.MajorField.Widget(document.getElementById('major'), {
          onChange: function () { if (second) second.checkValidity(); }
        });
        second = new root.MajorField.Widget(secondBox, {
          check: function (entry) {
            var f = first.value();
            return f && f.cip === entry.cip ? wording('sameMajorNote') : '';
          }
        });
        form.addEventListener('change', function (e) {
          if (e.target.name !== 'has_second_major') return;
          var yes = e.target.value === 'Yes';
          secondBox.parentNode.hidden = !yes;
          secondBox.disabled = !yes;   // hidden: neither required nor saved
          if (yes) secondBox.focus();
        });
      },
      on_finish: function (data) {
        var r = data.response || {};
        var major = first ? first.value() : null;
        var hasSecond = r.has_second_major === 'Yes';
        var secondMajor = hasSecond && second ? second.value() : null;
        onSubmit({
          first_name: (r.first_name || '').trim(),
          last_name: (r.last_name || '').trim(),
          email: (r.email || '').trim(),
          age_range: r.age_range || null,
          academic_program: r.academic_program || null,
          major: major,
          has_second_major: r.has_second_major ? hasSecond : null,
          second_major: secondMajor
        });
        data.response = null; // names and email are not kept in the page data
      }
    });
  }

  // Optional break: a message and Continue. Saved (kind 'break') so the time spent
  // (rt) and any switching away from the page are recorded; no pointer samples.
  function breakPage(html) {
    var tracker = new root.PointerTracker({ enabled: false });
    return page({
      html: '<div class="info break">' + html + '</div>',
      data: { kind: 'break', item_id: 'break_midpoint', instrument_version: cfg.instrumentVersion },
      on_load: function () { tracker.start(document.body); },
      on_finish: function (data) {
        var tracked = tracker.stop();
        data.left_page_count = tracked.left_page_count;
        data.left_page_ms = tracked.left_page_ms;
      }
    });
  }

  function infoPage(html, kind) {
    return page({ html: '<div class="info">' + html + '</div>', data: { kind: kind } });
  }

  root.Pages = {
    fullscreenNeeded: fullscreenNeeded,
    fullscreenStart: fullscreenStartPage,
    fullscreenStop: fullscreenStop,
    inSafeExamBrowser: inSafeExamBrowser,
    consent: consentPage,
    demographics: demographicsPage,
    info: infoPage,
    breakPage: breakPage,
    problem: problemPage
  };
})(window);
