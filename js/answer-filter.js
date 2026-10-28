/*
 * answer-filter.js
 *
 * Limits what students can type in the answer box of typed problems. The
 * "Explain your answer" boxes are never limited.
 *
 * The allowed characters are set in config.js (answerCharacters). Anything
 * else is refused as it is typed or pasted: it simply does not appear in the
 * box. Refused characters are returned so pages.js can record them
 * (refused_input in the saved data) and show a short note to the student.
 *
 * A few look-alike characters are converted rather than refused, so a
 * student is not blocked by how their keyboard writes a symbol:
 *   X × ✕ -> x     r -> R     ÷ ∕ ⁄ -> /     − – — -> -     · ⋅ ∙ -> *
 *   ˆ ＾ -> ^
 * A conversion is used only when the converted character is itself allowed.
 *
 * Works in the browser (window.AnswerFilter) and in Node (require()).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AnswerFilter = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CONVERSIONS = {
    'X': 'x',
    '×': 'x', // ×
    '✕': 'x', // ✕
    'r': 'R',
    '÷': '/', // ÷
    '∕': '/', // ∕ (division slash)
    '⁄': '/', // ⁄ (fraction slash)
    '−': '-', // − (minus sign)
    '–': '-', // – (en dash, e.g. iPad smart punctuation)
    '—': '-', // — (em dash)
    '·': '*', // ·
    '⋅': '*', // ⋅
    '∙': '*', // ∙
    'ˆ': '^', // ˆ (modifier circumflex)
    '＾': '^', // ＾ (full-width caret)
    ' ': ' ', // non-breaking space
    '\t': ' '
  };

  /**
   * clean(value, caret, allowed)
   *   value    the box's current text
   *   caret    the cursor position in value (may be null)
   *   allowed  a string listing every allowed character; '' or null = no limit
   * Returns { value, caret, refused }: the text with conversions applied and
   * refused characters removed, the matching cursor position, and the
   * refused characters in the order they appeared ('' if none).
   */
  function clean(value, caret, allowed) {
    value = String(value == null ? '' : value);
    if (!allowed) return { value: value, caret: caret, refused: '' };
    var out = '';
    var refused = '';
    var newCaret = caret;
    var chars = Array.from(value); // whole characters, even outside the BMP
    var pos = 0; // position in value, in UTF-16 units, to compare with caret
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      var conv = Object.prototype.hasOwnProperty.call(CONVERSIONS, ch) ? CONVERSIONS[ch] : null;
      if (allowed.indexOf(ch) !== -1) {
        out += ch;
      } else if (conv !== null && allowed.indexOf(conv) !== -1) {
        out += conv;
        if (caret != null && pos < caret) newCaret += conv.length - ch.length;
      } else {
        refused += ch;
        if (caret != null && pos < caret) newCaret -= ch.length;
      }
      pos += ch.length;
    }
    return { value: out, caret: newCaret, refused: refused };
  }

  /** The allowed symbols (not digits or spaces), for the note shown to students. */
  function symbolsText(allowed) {
    return Array.from(String(allowed || ''))
      .filter(function (c) { return !/[0-9\s]/.test(c); })
      .join(' ');
  }

  /**
   * attach(input, allowed, onRefused)
   * Limits a text box as the student types, pastes, drags or dictates into it.
   * onRefused(refusedText) is called whenever something was refused.
   */
  function attach(input, allowed, onRefused) {
    if (!input || !allowed) return;
    function apply() {
      var r = clean(input.value, input.selectionStart, allowed);
      var changed = r.value !== input.value;
      if (changed) {
        input.value = r.value;
        if (r.caret != null && document.activeElement === input) {
          try { input.setSelectionRange(r.caret, r.caret); } catch (e) { /* not focusable */ }
        }
      }
      if (r.refused && onRefused) onRefused(r.refused);
      return changed;
    }
    // Runs on the box itself, before the page's recorder sees the event on
    // the form, so the answer history only ever contains allowed text.
    input.addEventListener('input', function (e) {
      if (e.isComposing) return; // wait for the keyboard to finish composing
      apply();
    });
    // Some keyboards (e.g. for Chinese or Japanese) compose text first. Clean
    // it when they finish, then let the recorder see the cleaned answer.
    input.addEventListener('compositionend', function () {
      if (apply()) input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  return { clean: clean, attach: attach, symbolsText: symbolsText, CONVERSIONS: CONVERSIONS };
});
