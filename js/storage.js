/*
 * storage.js — saves data to Supabase, or keeps it in the page in demo mode.
 *
 * How saving works
 *   - One row in `sessions` (site, course, demographics) and one row in
 *     `participants` (name and email) when the student finishes the
 *     "about you" page. Nothing is saved before that.
 *   - One row in `trials` per problem page, saved as soon as the student
 *     clicks Continue, so a closed tab loses at most the current page.
 *   - One row in `completions` when the student reaches the last page.
 *
 * Every row goes into an ordered queue. If a save fails (for example the
 * Wi-Fi drops), the row stays queued, is copied into this browser's local
 * storage, and is retried with the next save. Rows left over from an earlier
 * visit on the same device are retried automatically when the page loads.
 * Retrying is safe: the database rejects exact duplicates, and the code
 * treats a duplicate as already saved.
 *
 * The browser only ever INSERTS. It never asks to read rows back, which is
 * what lets the database refuse all reads from the public key.
 */
(function (root) {
  'use strict';

  var BACKUP_PREFIX = 'uca-unsaved-';

  function uuid() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    var b = new Uint8Array(16);
    root.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  function safeLocal(fn) {
    try { return fn(root.localStorage); } catch (e) { return null; }
  }

  function Storage(config) {
    this.mode = config.supabaseUrl && config.supabaseAnonKey ? 'supabase' : 'demo';
    this.sessionId = null;
    this.queue = [];        // rows not yet saved, in order
    this.saved = [];        // every row saved (or kept, in demo mode) this visit
    this.lastError = null;
    this.flushing = null;
    if (this.mode === 'supabase') {
      this.client = root.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
    }
  }

  Storage.prototype._backupKey = function () { return BACKUP_PREFIX + this.sessionId; };

  Storage.prototype._writeBackup = function () {
    var self = this;
    if (!this.sessionId) return;
    safeLocal(function (ls) {
      if (self.queue.length) ls.setItem(self._backupKey(), JSON.stringify(self.queue));
      else ls.removeItem(self._backupKey());
    });
  };

  Storage.prototype._insert = async function (item) {
    if (this.mode === 'demo') return { ok: true };
    // insert() without .select() asks for nothing back, so no read permission is needed.
    var res = await this.client.from(item.table).insert(item.row);
    if (!res.error) return { ok: true };
    if (res.error.code === '23505') return { ok: true, duplicate: true }; // saved on an earlier try
    return { ok: false, error: res.error };
  };

  /** Sends queued rows in order; stops at the first failure so order is kept. */
  Storage.prototype.flush = function () {
    var self = this;
    if (this.flushing) return this.flushing;
    this.flushing = (async function () {
      while (self.queue.length) {
        var item = self.queue[0];
        var result;
        try {
          result = await self._insert(item);
        } catch (e) {
          result = { ok: false, error: { message: String(e && e.message || e) } };
        }
        if (!result.ok) {
          self.lastError = result.error;
          console.warn('Save failed; will retry.', item.table, result.error);
          break;
        }
        self.saved.push(self.queue.shift());
        self.lastError = null;
      }
      self._writeBackup();
      self.flushing = null;
      return self.queue.length;
    })();
    return this.flushing;
  };

  Storage.prototype._enqueue = function (table, row) {
    this.queue.push({ table: table, row: row });
    this._writeBackup();
    return this.flush();
  };

  /**
   * Creates the session. `session` holds site, course and demographics;
   * `participant` holds name and email, which go to their own table.
   */
  Storage.prototype.startSession = function (session, participant) {
    this.sessionId = uuid();
    this.queue.push({ table: 'sessions', row: Object.assign({ id: this.sessionId }, session) });
    if (participant) {
      this.queue.push({ table: 'participants',
        row: Object.assign({ session_id: this.sessionId }, participant) });
    }
    this._writeBackup();
    return this.flush();
  };

  // Columns pulled out of jsPsych's data for easy querying; everything is also kept in `data`.
  Storage.prototype.saveTrial = function (d) {
    if (!this.sessionId) return Promise.resolve(0);
    return this._enqueue('trials', {
      session_id: this.sessionId,
      trial_index: d.trial_index,
      kind: d.kind,
      item_id: d.item_id,
      item_type: d.item_type,
      instrument_version: d.instrument_version,
      raw_answer: d.raw_answer == null ? null : String(d.raw_answer),
      explanation: d.explanation == null ? null : String(d.explanation),
      is_correct: typeof d.is_correct === 'boolean' ? d.is_correct : null,
      rt_ms: typeof d.rt === 'number' ? Math.round(d.rt) : null,
      time_elapsed_ms: typeof d.time_elapsed === 'number' ? Math.round(d.time_elapsed) : null,
      left_page_count: d.left_page_count == null ? null : d.left_page_count,
      left_page_ms: d.left_page_ms == null ? null : d.left_page_ms,
      data: d
    });
  };

  Storage.prototype.finishSession = function (summary) {
    if (!this.sessionId) return Promise.resolve(0);
    return this._enqueue('completions', {
      session_id: this.sessionId,
      finished_at: new Date().toISOString(),
      n_trials: summary.n_trials,
      summary: summary
    });
  };

  /** Retries rows left in this browser by an earlier, unfinished visit. */
  Storage.prototype.recoverPrevious = async function () {
    if (this.mode === 'demo') return 0;
    var keys = safeLocal(function (ls) {
      var out = [];
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (k && k.indexOf(BACKUP_PREFIX) === 0) out.push(k);
      }
      return out;
    }) || [];
    var recovered = 0;
    for (var i = 0; i < keys.length; i++) {
      var items = safeLocal(function (ls) { return JSON.parse(ls.getItem(keys[i]) || '[]'); }) || [];
      var remaining = items.slice();
      while (remaining.length) {
        var r = await this._insert(remaining[0]).catch(function () { return { ok: false }; });
        if (!r.ok) break;
        remaining.shift();
        recovered++;
      }
      safeLocal(function (ls) {
        if (remaining.length) ls.setItem(keys[i], JSON.stringify(remaining));
        else ls.removeItem(keys[i]);
      });
    }
    return recovered;
  };

  /** Everything from this visit, saved or not, for a backup download. */
  Storage.prototype.allRows = function () {
    return this.saved.concat(this.queue);
  };

  Storage.prototype.downloadBackup = function (filenameHint) {
    var blob = new Blob([JSON.stringify({
      exported_at: new Date().toISOString(),
      mode: this.mode,
      session_id: this.sessionId,
      unsaved_count: this.queue.length,
      rows: this.allRows()
    }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (filenameHint || 'assessment') + '-' + (this.sessionId || 'no-session') + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  root.StudyStorage = Storage;
})(window);
