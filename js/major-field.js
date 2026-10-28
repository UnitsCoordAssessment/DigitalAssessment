/*
 * major-field.js — the type-ahead "major" box on the "About you" page.
 *
 * The student starts typing; up to 8 matching majors from majors.js appear
 * below the box, and the student clicks one (or uses the arrow keys and Enter).
 * Only a major from the list can be submitted: if the student types something
 * and does not choose, the page asks them to choose from the list.
 *
 * A typed word matches the start of any word in a major's title or in its
 * other names ("bio" finds Biology and Biomedical Sciences; "immunology" finds
 * Microbiological Sciences and Immunology). Matches in the title come first.
 *
 *   MajorField.search(query, list, limit)  the matching entries (also used by tests)
 *   new MajorField.Widget(inputElement, { list, check, onChange })
 *     check(entry)  optional: a message when a chosen entry is not allowed
 *     onChange()    optional: called whenever the choice changes
 *     .value()  { title, cip, family, family_title, search } or null
 */
(function (root) {
  'use strict';

  var MAX_SHOWN = 8;

  function words(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   // é -> e
      .replace(/[’']/g, '')                           // don't -> dont
      .split(/[^a-z0-9]+/).filter(Boolean);
  }

  // Every query word starts some word in `target` (a list of words).
  function allMatch(query, target) {
    return query.every(function (q) {
      return target.some(function (w) { return w.indexOf(q) === 0; });
    });
  }

  /**
   * Prepares majors.js data once: [{ cip, title, family, family_title, titleWords, others }]
   */
  function prepare(data) {
    return data.majors.map(function (m) {
      var family = m[0].slice(0, 2);
      return {
        cip: m[0],
        title: m[1],
        family: family,
        family_title: data.families[family] || null,
        titleWords: words(m[1]),
        others: String(m[2] || '').split(';').map(function (s) { return s.trim(); }).filter(Boolean)
          .map(function (name) { return { name: name, words: words(name) }; })
      };
    });
  }

  /**
   * The entries matching `query`, best first. Each result is
   * { entry, via } where `via` is the other name that matched (null when the title did).
   */
  function search(query, list, limit) {
    var q = words(query);
    if (!q.length) return [];
    var joined = q.join(' ');
    // How many typed words are whole words of the target ("nurse" before "nursery")
    var whole = function (target) {
      return q.filter(function (w) { return target.indexOf(w) !== -1; }).length;
    };
    var hits = [];
    list.forEach(function (e) {
      // "X, General" comes first and "X, Other" catch-alls last among matches of the same kind
      var other = /, other$/i.test(e.title) ? 0.5 : /, general$/i.test(e.title) ? -0.25 : 0;
      if (allMatch(q, e.titleWords)) {
        // Title starts with what was typed > a title word starts it > other title matches
        var t = e.titleWords.join(' ');
        var rank = t.indexOf(joined) === 0 ? 0 : (' ' + t).indexOf(' ' + joined) !== -1 ? 1 : 2;
        hits.push({ entry: e, via: null, rank: rank + other, whole: whole(e.titleWords) });
        return;
      }
      var best = null;
      e.others.forEach(function (o) {
        if (allMatch(q, o.words) && (!best || whole(o.words) > best.whole)) best = { name: o.name, whole: whole(o.words) };
      });
      if (best) hits.push({ entry: e, via: best.name, rank: 3 + other, whole: best.whole });
    });
    hits.sort(function (a, b) {
      return a.rank - b.rank || b.whole - a.whole || a.entry.title.length - b.entry.title.length ||
        (a.entry.title < b.entry.title ? -1 : 1);
    });
    return hits.slice(0, limit || MAX_SHOWN).map(function (h) { return { entry: h.entry, via: h.via }; });
  }

  // ---------------------------------------------------------------------------
  // The widget (browser only)

  var CSS =
    '.major-field{position:relative}.major-field[hidden]{display:none}' +
    '.major-field .major-help{display:block;font-weight:400;font-size:16px;color:var(--muted,#5b6475);margin:2px 0 0}' +
    '.major-list{position:absolute;left:0;right:0;z-index:20;margin:0;padding:4px 0;list-style:none;' +
    'background:#fff;border:2px solid var(--accent,#1e5aa8);border-radius:8px;max-height:340px;overflow-y:auto;' +
    'box-shadow:0 6px 18px rgba(0,0,0,.15);font-weight:400}' +
    '.major-list[hidden]{display:none}' +
    '.major-list li{padding:8px 12px;cursor:pointer;line-height:1.3}' +
    '.major-list li[aria-selected="true"],.major-list li:hover{background:var(--accent-soft,#e7eef9)}' +
    '.major-list .major-via{display:block;font-size:15px;color:var(--muted,#5b6475)}' +
    '.major-list .major-none{cursor:default;color:var(--muted,#5b6475)}' +
    '.major-list .major-none:hover{background:none}';

  function addCss() {
    if (document.getElementById('major-field-css')) return;
    var style = document.createElement('style');
    style.id = 'major-field-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  var prepared = null;
  function defaultList() {
    if (!prepared) prepared = prepare(root.STUDY_MAJORS || { majors: [], families: {} });
    return prepared;
  }

  var NOT_CHOSEN = 'Please choose your major from the list. Start typing, then click the best fit.';

  function Widget(input, options) {
    options = options || {};
    addCss();
    this.input = input;
    this.list = options.list || defaultList();
    this.check = options.check || null;
    this.onChange = options.onChange || null;
    this.chosen = null;     // the entry chosen from the list
    this.lastTyped = '';    // what the student typed before choosing
    this.results = [];
    this.active = -1;

    var self = this;
    var id = input.id || ('major-' + Math.random().toString(36).slice(2));
    input.id = id;
    this.box = document.createElement('ul');
    this.box.className = 'major-list';
    this.box.id = id + '-list';
    this.box.setAttribute('role', 'listbox');
    this.box.hidden = true;
    input.parentNode.appendChild(this.box);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', this.box.id);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');

    input.addEventListener('input', function () {
      var had = !!self.chosen;
      self.chosen = null;
      self.lastTyped = input.value;
      self.update();
      self.checkValidity();
      if (had && self.onChange) self.onChange();
    });
    input.addEventListener('focus', function () { if (!self.chosen && input.value) self.update(); });
    input.addEventListener('keydown', function (e) { self.onKey(e); });
    input.addEventListener('blur', function () {
      // A typed title that exactly matches an entry counts as choosing it.
      if (!self.chosen && input.value.trim()) {
        var typed = input.value.trim().toLowerCase();
        var exact = self.list.filter(function (en) { return en.title.toLowerCase() === typed; })[0];
        if (exact) self.choose(exact);
      }
      self.close();
      self.checkValidity();
    });
    // mousedown (not click) so the box keeps focus until the choice is made
    this.box.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var li = e.target.closest('li[data-i]');
      if (li) self.choose(self.results[Number(li.getAttribute('data-i'))].entry);
    });
    this.checkValidity();
  }

  Widget.prototype.update = function () {
    this.results = search(this.input.value, this.list, MAX_SHOWN);
    this.active = -1;
    var html = this.results.map(function (r, i) {
      return '<li role="option" id="' + this.box.id + '-' + i + '" data-i="' + i + '" aria-selected="false">' +
        esc(r.entry.title) + (r.via ? '<span class="major-via">includes ' + esc(r.via) + '</span>' : '') + '</li>';
    }, this).join('');
    if (!html && this.input.value.trim()) {
      html = '<li class="major-none">No match. Try a shorter or different word, or choose the closest fit.</li>';
    }
    this.box.innerHTML = html;
    this.box.hidden = !html;
    // Near the bottom of the screen, scroll so the whole list can be seen.
    if (html && this.box.scrollIntoView) this.box.scrollIntoView({ block: 'nearest' });
    this.input.setAttribute('aria-expanded', html ? 'true' : 'false');
    this.input.removeAttribute('aria-activedescendant');
  };

  Widget.prototype.highlight = function (i) {
    var items = this.box.querySelectorAll('li[data-i]');
    if (!items.length) return;
    this.active = (i + items.length) % items.length;
    Array.prototype.forEach.call(items, function (li, k) {
      li.setAttribute('aria-selected', k === this.active ? 'true' : 'false');
    }, this);
    items[this.active].scrollIntoView({ block: 'nearest' });
    this.input.setAttribute('aria-activedescendant', items[this.active].id);
  };

  Widget.prototype.onKey = function (e) {
    var open = !this.box.hidden && this.results.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open) { this.update(); return; }
      e.preventDefault();
      this.highlight(this.active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      // Enter chooses the highlighted major (or the top one); the page then
      // moves to the next field, as Enter does in the other boxes.
      if (open) this.choose(this.results[this.active >= 0 ? this.active : 0].entry);
    } else if (e.key === 'Escape') {
      this.close();
    } else if (e.key === 'Tab' && open && this.active >= 0) {
      this.choose(this.results[this.active].entry);
    }
  };

  Widget.prototype.choose = function (entry) {
    this.chosen = entry;
    this.input.value = entry.title;
    this.close();
    this.checkValidity();
    if (this.onChange) this.onChange();
  };

  Widget.prototype.close = function () {
    this.box.hidden = true;
    this.active = -1;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  };

  // Something typed but not chosen blocks Continue with a message.
  Widget.prototype.checkValidity = function () {
    var message = !this.chosen ? (this.input.value.trim() ? NOT_CHOSEN : '')
      : this.check ? (this.check(this.chosen) || '') : '';
    this.input.setCustomValidity(message);
  };

  Widget.prototype.value = function () {
    var c = this.chosen;
    return c ? { title: c.title, cip: c.cip, family: c.family, family_title: c.family_title,
      search: this.lastTyped || null } : null;
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var api = { search: search, prepare: prepare, Widget: Widget };
  root.MajorField = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
