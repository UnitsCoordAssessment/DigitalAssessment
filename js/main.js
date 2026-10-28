/*
 * main.js — the order of pages:
 *   consent -> about you -> "continue in full screen" (see pages.js,
 *   "Assessment integrity") -> practice introduction -> 2 practice problems ->
 *   "the assessment will now begin" -> the problems, in the order of the
 *   student's form (A or B, see content.js), with the optional break page
 *   partway through -> final page
 */
(async function () {
  'use strict';

  var cfg = window.STUDY_CONFIG;
  var text = window.STUDY_CONTENT;
  var Pages = window.Pages;

  // config.js requireSafeExamBrowser: true -> the assessment opens only inside Safe Exam Browser.
  if (cfg.requireSafeExamBrowser && !Pages.inSafeExamBrowser()) {
    document.body.innerHTML =
      '<div class="page info" style="max-width:680px;margin:60px auto;padding:0 16px;font-size:19px;line-height:1.6">' +
      (text.safeExamBrowserRequiredHtml ||
        '<p>This assessment must be opened in Safe Exam Browser.</p>' +
        '<p>Please ask the person running the session for help.</p>') +
      '</div>';
    return;
  }
  var storage = new window.StudyStorage(cfg);
  var finished = false;
  var openedAt = new Date().toISOString();
  var consentedAt = null;

  if (storage.mode === 'demo') document.body.classList.add('demo-mode');

  // Send anything an earlier, interrupted visit on this device left unsaved.
  storage.recoverPrevious().then(function (n) {
    if (n) console.info('Recovered ' + n + ' unsaved rows from an earlier visit.');
  });

  // Start downloading every figure now, so problem pages show them immediately.
  text.practice.concat(text.problems).forEach(function (item) {
    if (item.figure) new Image().src = item.figure.src;
  });

  var jsPsych = initJsPsych({
    show_progress_bar: !!cfg.showProgressBar,
    auto_update_progress_bar: false,
    message_progress_bar: text.progressLabel || '',
    on_data_update: function (data) {
      if (data.kind === 'practice' || data.kind === 'problem' || data.kind === 'break') storage.saveTrial(data);
    },
    on_finish: function () {
      finished = true;
      // No session means the student declined; jsPsych is already showing that message.
      if (storage.sessionId) showFinalPage();
    }
  });

  // Site, course, section and term come from the link, never from the student:
  //   ?site=CSU&course=MATH117&section=003&term=F27
  //   site     one of cfg.sites (capital letters; ?site=csu also works)
  //   course, section, term   your own codes, any letters and numbers. Saved as
  //            lowercase letters, digits and _ ("math117", "003", "f27").
  //            course_key.csv gives each course its category and name (and,
  //            optionally, each section its instructor) for analysis.
  // course is a column of the sessions table; section and term are saved with
  // the session's other details (client), so the database needs no change.
  var url = jsPsych.data.urlVariables();
  var siteCode = String(url.site || '').toUpperCase();
  var site = (cfg.sites || []).indexOf(siteCode) !== -1 ? siteCode : null;
  var course = linkCode(url.course, 40);
  var section = linkCode(url.section, 20);
  var term = linkCode(url.term, 20);

  function linkCode(value, max) {
    var code = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max);
    return code || null;
  }

  // Form: chosen by the link (?form=A) when given, otherwise at random.
  var forms = text.forms || {};
  var formNames = Object.keys(forms);
  var requestedForm = String(url.form || '').toUpperCase();
  var form = formNames.indexOf(requestedForm) !== -1 ? requestedForm
    : formNames.length ? formNames[Math.floor(Math.random() * formNames.length)] : null;
  var assessmentItems = itemsInFormOrder(form);
  if (!assessmentItems) {
    console.error('Form ' + form + ' in content.js does not list every problem exactly once; using the listed order.');
    form = null;
    assessmentItems = itemsInFormOrder(null);
  }

  // The problems in the form's order, titled by position ("Problem 1", ...).
  // Returns null if the form does not list every problem exactly once.
  function itemsInFormOrder(name) {
    var byId = {};
    text.problems.forEach(function (p) { byId[p.id] = p; });
    var ids = name ? forms[name] : text.problems.map(function (p) { return p.id; });
    var seen = {};
    var ok = ids.length === text.problems.length && ids.every(function (id) {
      if (!byId[id] || seen[id]) return false;
      seen[id] = true;
      return true;
    });
    if (!ok) return null;
    return ids.map(function (id, i) {
      var copy = Object.assign({}, byId[id]);
      copy.title = 'Problem ' + (i + 1);
      copy.position = i + 1;
      copy.form = name;
      return copy;
    });
  }

  function warnBeforeLeaving(e) {
    if (finished) return;
    e.preventDefault();
    e.returnValue = '';
  }

  function hideProgressBar() {
    var bar = document.getElementById('jspsych-progressbar-container');
    if (bar) bar.style.display = 'none';
  }

  var consent = Pages.consent(function (answer) {
    // Under 18 ends the session first, whatever the consent answer was.
    if (!answer.adult || !answer.agreed) hideProgressBar();
    if (!answer.adult) {
      jsPsych.abortExperiment('<div class="page info">' + (text.underageHtml || text.declinedHtml) + '</div>');
      return;
    }
    if (!answer.agreed) {
      jsPsych.abortExperiment('<div class="page info">' + text.declinedHtml + '</div>');
      return;
    }
    consentedAt = new Date().toISOString();
    window.addEventListener('beforeunload', warnBeforeLeaving);
  });

  var aboutYou = Pages.demographics(function (answers) {
    storage.startSession({
      site: site,
      course: course,
      instrument_version: cfg.instrumentVersion,
      started_at: openedAt,
      consented_at: consentedAt,
      age_range: answers.age_range,
      academic_program: answers.academic_program,
      program_of_study: answers.major ? answers.major.title : null,   // the major; codes are in client, below
      client: {
        user_agent: navigator.userAgent,
        screen: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio || 1 },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        max_touch_points: navigator.maxTouchPoints || 0,
        coarse_pointer: window.matchMedia ? matchMedia('(pointer: coarse)').matches : null,
        form: form,   // which problem order (content.js forms) this student got
        section: section,   // from the link (?section=...)
        term: term,         // from the link (?term=...)
        // Majors from the "About you" page (majors.js; CIP 2020 codes and families)
        major: answers.major ? answers.major.title : null,
        major_cip: answers.major ? answers.major.cip : null,
        major_family: answers.major ? answers.major.family : null,
        major_family_title: answers.major ? answers.major.family_title : null,
        major_search: answers.major ? answers.major.search : null,   // what was typed before choosing
        has_second_major: answers.has_second_major,
        second_major: answers.second_major ? answers.second_major.title : null,
        second_major_cip: answers.second_major ? answers.second_major.cip : null,
        second_major_family: answers.second_major ? answers.second_major.family : null,
        second_major_family_title: answers.second_major ? answers.second_major.family_title : null,
        second_major_search: answers.second_major ? answers.second_major.search : null,
        safe_exam_browser: Pages.inSafeExamBrowser(),
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }
    }, {
      first_name: answers.first_name,
      last_name: answers.last_name,
      email: answers.email
    });
  });

  var practicePages = text.practice.map(function (item) { return Pages.problem(item, true); });
  var assessmentPages = assessmentItems.map(function (item) { return Pages.problem(item, false); });
  var problemPages = practicePages.concat(assessmentPages);

  problemPages.forEach(function (trial, i) {
    var userOnFinish = trial.on_finish;
    trial.on_finish = function (data) {
      if (userOnFinish) userOnFinish.apply(this, arguments);
      if (jsPsych.progressBar) jsPsych.progressBar.progress = (i + 1) / problemPages.length;
    };
  });

  // ---------------------------------------------------------------------------
  // Final page: the completion message, with no Continue button. If any
  // answers could not be saved, a notice and a backup download appear below it.
  // ---------------------------------------------------------------------------
  async function showFinalPage() {
    Pages.fullscreenStop();
    var el = jsPsych.getDisplayElement();
    renderFinal(el, null);
    await storage.finishSession({
      n_trials: storage.allRows().filter(function (r) { return r.table === 'trials'; }).length,
      total_time_ms: jsPsych.getTotalTime()
    });
    renderFinal(el, await storage.flush());
  }

  function renderFinal(el, remaining) {
    var html = '<div class="page final">' + text.completionHtml;
    if (storage.mode === 'demo') {
      html += '<div class="save-status demo">' +
        '<p><strong>Demo mode:</strong> nothing was sent anywhere. This is what would have been saved.</p>' +
        '<p><button type="button" class="jspsych-btn" id="download-backup">Download the data (JSON)</button></p>' +
        '<pre class="data-preview">' + escapeHtml(JSON.stringify(storage.allRows(), null, 2)) + '</pre></div>';
    } else if (remaining === null) {
      html += '<p class="save-status saving">Saving your answers…</p>';
    } else if (remaining > 0) {
      html += '<div class="save-status warning">' +
        '<p><strong>Some of your answers have not been saved yet.</strong> Please keep this page ' +
        'open and let the person running the session know.</p>' +
        '<p><button type="button" class="jspsych-btn" id="retry-save">Try saving again</button> ' +
        '<button type="button" class="jspsych-btn" id="download-backup">Download a backup file</button></p>' +
        '<p class="hint">Unsaved items: ' + remaining + '</p></div>';
    } else {
      html += '<p class="save-status saved">Your answers have been saved.</p>';
    }
    el.innerHTML = html + '</div>';

    var dl = document.getElementById('download-backup');
    if (dl) dl.addEventListener('click', function () { storage.downloadBackup(site || 'assessment'); });
    var retry = document.getElementById('retry-save');
    if (retry) {
      retry.addEventListener('click', async function () {
        retry.disabled = true;
        renderFinal(el, await storage.flush());
      });
    }
  }

  // The optional break page goes after problem number text.breakAfterProblem.
  function withBreak(pages) {
    var n = text.breakAfterProblem;
    if (!n || n >= pages.length || !text.breakHtml) return pages;
    var pause = Pages.breakPage(text.breakHtml);
    pause.data.form = form;
    pause.data.position = n + 0.5;   // between problem n and problem n + 1
    return pages.slice(0, n).concat([pause], pages.slice(n));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
  }

  // "Continue in full screen" page, unless full screen is off, not available,
  // or the student is in Safe Exam Browser (which is full screen already).
  var fullscreenPages = Pages.fullscreenNeeded() ? [Pages.fullscreenStart()] : [];

  await jsPsych.run([
    consent,
    aboutYou
  ].concat(fullscreenPages, [
    Pages.info(text.practiceIntroHtml, 'practice_intro')
  ], practicePages, [
    Pages.info(text.assessmentIntroHtml, 'assessment_intro')
  ], withBreak(assessmentPages)));
})();
