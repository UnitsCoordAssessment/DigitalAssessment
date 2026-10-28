/*
 * config.js — technical settings. Student-facing wording and the problems
 * themselves are in content.js.
 *
 * DEMO MODE: leave supabaseUrl and supabaseAnonKey empty. Nothing is sent
 * anywhere; the last page shows the data that would have been saved and
 * offers a download.
 *
 * LIVE MODE: paste your project's URL and its public key from the Supabase
 * dashboard (Project Settings > API Keys). Newer projects call it the
 * "publishable" key (starts with sb_publishable_); older ones call it "anon".
 * Never put the "secret" / "service_role" key here: this file is public, and
 * that key bypasses every access rule.
 */
window.STUDY_CONFIG = {
  // --- Backend --------------------------------------------------------------
  supabaseUrl: 'https://sjqrruxcdzkpfdoyyaby.supabase.co',      // e.g. 'https://abcdefghijklmnop.supabase.co'
  supabaseAnonKey: 'sb_publishable_o5N4W1Y4ZZO-UJHL3Ihrzg_XowHYaJw',  // publishable/anon key (safe to publish once schema.sql has been run)

  // --- Study identity ---------------------------------------------------------
  // Increase instrumentVersion whenever content.js changes, so every saved row
  // records exactly which version of the assessment the student saw.
  instrumentVersion: '1.4.1',

  // Site and course are read from the link and never shown to students, e.g.
  //   index.html?site=CSU&course=calc1
  // Give each class its own link. A link without them still works; site and
  // course are then saved as blank. Site codes must be 2-10 capital letters.
  sites: ['CSU', 'OSU', 'FRCC', 'TCC', 'TEST'],
  courses: {
    preservice_elem: 'Mathematics for elementary teachers',
    college_algebra: 'College algebra',
    nonstem: 'Non-STEM / quantitative reasoning',
    calc1: 'Calculus I',
    calc2: 'Calculus II'
  },

  // --- Problem pages -----------------------------------------------------------
  // true: students must answer and explain before Continue works.
  // (On Yes/No follow-ups the explanation is required only after "Yes".)
  requireAnswers: true,
  showProgressBar: true,   // bar at the top that fills as students finish problem pages
  blockCopying: true,       // problem pages: nothing can be copied; the problem cannot be selected or printed
  blockPasting: true,       // problem pages: nothing can be pasted or dropped into the boxes
  requireFullscreen: true,  // full screen from the practice problems on; leaving it shows a blue screen
  requireSafeExamBrowser: false,  // true: the assessment opens only inside Safe Exam Browser

  // The only characters students can type in the answer box of typed problems
  // (the "Explain your answer" boxes are not limited). The list below is the
  // digits, a space, and + * x - / . ( ) R ^. Anything else is refused as it is
  // typed or pasted, a short note tells the student which symbols they can
  // use, and the refused characters are saved (refused_input). Uppercase X,
  // lowercase r, ×, ÷ and dashes are converted to x, R, x, / and -. A problem
  // in content.js can set its own answerCharacters; '' turns the limit off.
  answerCharacters: '0123456789 +*x-/.()R^',

  // --- Data collection -----------------------------------------------------------
  pointerTracking: true,      // record cursor/touch positions on problem pages
  pointerSampleMs: 25,        // minimum time between recorded movement samples
  pointerMaxEventsPerTrial: 6000,
  answerHistoryMax: 100       // how many successive versions of a typed answer to keep
};
