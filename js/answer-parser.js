/*
 * answer-parser.js
 *
 * Deterministic, notation-tolerant parser for students' typed numeric answers.
 * It treats 8*3*2, 8x3x2, 8 X 3 X 2, 8×3×2, 8·3·2, 8 times 3 times 2 and
 * 8(3)(2) as the same expression, evaluates it exactly (fractions included),
 * and reports the expression's structure (a product of factors, repeated
 * addition, a single number, ...) so researchers can see how a student wrote
 * the answer, not only whether the value is right.
 *
 * No AI or machine learning is involved: every judgment comes from an explicit
 * rule in this file, so scoring is reproducible and auditable.
 *
 * Letters (algebraic answers). When an answer key contains a letter, such as
 * correct: '5h/7', that letter is read as a variable on that problem, and any
 * answer equal to the key for every value of the letter is scored correct:
 * 5h/7, 5*h/7, (5/7)h, 5/7h, 5/7 h, h/7*5, (h+h+h+h+h)/7, "1/7 of 5h". As with
 * numbers, a slash between two numbers is a fraction bar, so 5/7h means
 * (5/7)·h; write 5/(7h) for 5 divided by 7h. x always means "times" and r a
 * remainder, so neither can be a variable. Exponents (^) are not read.
 *
 * Works in the browser (window.AnswerParser) and in Node (require()).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AnswerParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration: how words and symbols map to operators. Edit these lists to
  // change what the parser accepts; every mapping is applied before parsing.
  // ---------------------------------------------------------------------------

  // Multi-word phrases first, so "multiplied by" is not split by "by".
  var WORD_OPERATORS = [
    ['multiplied by', '*'],
    ['out of', '/'], // "3 out of 7" is the fraction 3/7 (listed before "of")
    ['groups of', '*'],
    ['divided by', '\u00F7'], // ÷, kept separate from the fraction bar
    ['times', '*'],
    ['of', '*'], // "1/3 of 1/4" means a product
    ['plus', '+'],
    ['minus', '-']
  ];

  var SYMBOL_MAP = {
    '×': '*', // ×
    '✕': '*', // ✕
    '✖': '*', // ✖
    '⋅': '*', // ⋅
    '·': '*', // ·
    '∙': '*', // ∙
    '•': '*', // •
    // ÷ is not mapped: it stays a division sign, separate from the fraction bar "/".
    '∕': '/', // ∕ (division slash)
    '−': '-', // − (minus sign)
    '–': '-', // – (en dash)
    '—': '-', // — (em dash)
    '＋': '+', // ＋
    '\u2044': '/', // ⁄ (fraction slash)
    '[': '(',
    ']': ')',
    '{': '(',
    '}': ')'
  };

  // Single-character fractions; "10¾" becomes the mixed number "10 3/4".
  var FRACTION_CHARS = {
    '\u00BC': '1/4', '\u00BD': '1/2', '\u00BE': '3/4', '\u2150': '1/7', '\u2151': '1/9',
    '\u2152': '1/10', '\u2153': '1/3', '\u2154': '2/3', '\u2155': '1/5', '\u2156': '2/5',
    '\u2157': '3/5', '\u2158': '4/5', '\u2159': '1/6', '\u215A': '5/6', '\u215B': '1/8',
    '\u215C': '3/8', '\u215D': '5/8', '\u215E': '7/8'
  };

  // Inch marks after a measurement (8", 10 3/4'') are read as the word "inches".
  var INCH_MARKS = /(''|"|\u2033|\u201C|\u201D)/g;

  // ---------------------------------------------------------------------------
  // Exact rational arithmetic with BigInt
  // ---------------------------------------------------------------------------

  function gcd(a, b) {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b !== 0n) {
      var t = a % b;
      a = b;
      b = t;
    }
    return a;
  }

  function frac(n, d) {
    if (d === undefined) d = 1n;
    if (d === 0n) throw new ParseError('division by zero');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    var g = gcd(n, d);
    if (g === 0n) g = 1n;
    return { n: n / g, d: d / g };
  }

  function add(a, b) { return frac(a.n * b.d + b.n * a.d, a.d * b.d); }
  function sub(a, b) { return frac(a.n * b.d - b.n * a.d, a.d * b.d); }
  function mul(a, b) { return frac(a.n * b.n, a.d * b.d); }
  function div(a, b) {
    if (b.n === 0n) throw new ParseError('division by zero');
    return frac(a.n * b.d, a.d * b.n);
  }
  function eq(a, b) { return a.n === b.n && a.d === b.d; }

  function fracFromNumberText(text) {
    // "12", "0.5", ".25" -> exact fraction
    var parts = text.split('.');
    var whole = parts[0] === '' ? '0' : parts[0];
    if (parts.length === 1) return frac(BigInt(whole));
    var decimals = parts[1];
    var scale = 10n ** BigInt(decimals.length);
    return frac(BigInt(whole) * scale + BigInt(decimals), scale);
  }

  function fracToText(f) {
    return f.d === 1n ? f.n.toString() : f.n.toString() + '/' + f.d.toString();
  }

  function fracToNumber(f) {
    return Number(f.n) / Number(f.d);
  }

  // Test values for letters (variables). Two expressions with a letter count as
  // equal when they agree at every one of these values; unusual fractions make an
  // accidental match practically impossible for students' answers.
  var TEST_VALUES = [frac(17n, 3n), frac(29n, 7n), frac(41n, 5n), frac(53n, 11n), frac(67n, 13n)];

  function ParseError(message) {
    this.name = 'ParseError';
    this.message = message;
  }
  ParseError.prototype = Object.create(Error.prototype);

  // ---------------------------------------------------------------------------
  // Normalization: symbols and words -> standard operators
  // ---------------------------------------------------------------------------

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeSymbols(raw) {
    var s = String(raw).toLowerCase().replace(INCH_MARKS, ' inches ');
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (Object.prototype.hasOwnProperty.call(FRACTION_CHARS, ch)) {
        out += ' ' + FRACTION_CHARS[ch] + ' ';
        continue;
      }
      out += Object.prototype.hasOwnProperty.call(SYMBOL_MAP, ch) ? SYMBOL_MAP[ch] : ch;
    }
    // Thousands separators: 1,000 or 12,345,678 (only well-formed groups).
    out = out.replace(/\d{1,3}(?:,\d{3})+(?!\d)/g, function (m) {
      return m.replace(/,/g, '');
    });
    return out.replace(/\s+/g, ' ').trim();
  }

  function replaceWordOperators(s) {
    for (var j = 0; j < WORD_OPERATORS.length; j++) {
      var re = new RegExp('\\b' + escapeRegex(WORD_OPERATORS[j][0]) + '\\b', 'g');
      s = s.replace(re, ' ' + WORD_OPERATORS[j][1] + ' ');
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  // Trailing words that leave an expression unfinished ("8 plus", "3 x").
  // Anything else after the last number is treated as a unit or label.
  var INCOMPLETE_TAILS = ['x', 'plus', 'minus', 'divided by', 'multiplied by', 'groups of', 'out of', 'of'];

  function isIncompleteTail(words) {
    for (var j = 0; j < INCOMPLETE_TAILS.length; j++) {
      var w = INCOMPLETE_TAILS[j];
      if (words === w) return true;
      if (w !== 'of' && words.indexOf(w + ' ') === 0) return true;
    }
    return false;
  }

  // Strip trailing words that name units or things, so that
  //   "72 marbles" -> 72,  "4 times" -> 4,  "1/3 of the trip" -> 1/3.
  // The removed words are returned so they are recorded, not silently discarded.
  // A tail that leaves the expression unfinished ("8 plus") is kept, so it fails to parse.
  function stripTrailingWords(s, letters) {
    var m = s.match(/^(.*?[0-9)])\s*([a-z][a-z\s.'-]*)$/);
    if (!m) return { text: s, stripped: '' };
    var words = m[2].trim();
    if (isIncompleteTail(words)) return { text: s, stripped: '' };
    // A variable right after the expression ("5h", "5/7 h") is part of it, not a unit.
    var text = m[1].trim();
    var parts = words.split(/\s+/);
    while (letters && parts.length && parts[0].length === 1 && letters.indexOf(parts[0]) !== -1) {
      text += ' ' + parts.shift();
    }
    return { text: text, stripped: parts.join(' ') };
  }

  // ---------------------------------------------------------------------------
  // Tokenizer
  // ---------------------------------------------------------------------------

  function isOperandEnd(tok) {
    return tok && (tok.type === 'num' || tok.type === 'mixed' || tok.type === ')' || tok.type === 'var');
  }

  function isNumberToken(tok) {
    return tok && (tok.type === 'num' || tok.type === 'mixed');
  }

  function tokenize(s, letters) {
    var tokens = [];
    var i = 0;
    while (i < s.length) {
      var ch = s[i];
      if (ch === ' ') { i++; continue; }
      // Mixed numbers: "2 1/4" or "2 and 1/4" mean 2 + 1/4.
      var mixed = s.slice(i).match(/^(\d+)\s+(?:and\s+)?(\d+)\/(\d+)(?![\d.\/])/);
      if (mixed) {
        tokens.push({ type: 'mixed', whole: mixed[1], top: mixed[2], bottom: mixed[3],
          text: mixed[1] + ' ' + mixed[2] + '/' + mixed[3] });
        i += mixed[0].length;
        continue;
      }
      var numMatch = s.slice(i).match(/^(\d+(?:\.\d+)?|\.\d+)/);
      if (numMatch) {
        tokens.push({ type: 'num', text: numMatch[1] });
        i += numMatch[1].length;
        continue;
      }
      if ('+-*/()\u00F7'.indexOf(ch) !== -1) {
        tokens.push({ type: ch, text: ch });
        i++;
        continue;
      }
      if (letters && ch !== 'x' && letters.indexOf(ch) !== -1) {
        tokens.push({ type: 'var', name: ch, text: ch });
        i++;
        continue;
      }
      if (ch === 'x') {
        // "x" is multiplication only when it sits between two operands.
        var prev = tokens[tokens.length - 1];
        var rest = s.slice(i + 1).replace(/^ +/, '');
        var nextStartsOperand = /^(\d|\.\d|\()/.test(rest) ||
          !!(letters && rest && letters.indexOf(rest[0]) !== -1);
        if (isOperandEnd(prev) && nextStartsOperand) {
          tokens.push({ type: '*', text: '*' });
          i++;
          continue;
        }
        throw new ParseError('"x" must appear between two numbers');
      }
      throw new ParseError('unrecognized character "' + ch + '"');
    }
    return insertImplicitMultiplication(tokens);
  }

  // 8(3)(2) -> 8*(3)*(2);  (8)(3) -> (8)*(3);  (8)3 -> (8)*3;  5h -> 5*h;  h(2) -> h*(2)
  function insertImplicitMultiplication(tokens) {
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var prev = out[out.length - 1];
      if (prev && (t.type === '(' || isNumberToken(t) || t.type === 'var') && isOperandEnd(prev)) {
        if (isNumberToken(prev) && isNumberToken(t)) {
          throw new ParseError('two numbers in a row without an operation between them');
        }
        if (prev.type === 'var' && isNumberToken(t)) {
          throw new ParseError('a number right after a letter is unclear');
        }
        out.push({ type: '*', text: '*', implicit: true });
      }
      out.push(t);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Recursive-descent parser
  //   expr    := term (('+'|'-') term)*
  //   term    := unary (('*'|'/'|'÷') unary)*
  //   unary   := '-' unary | primary
  //   primary := fraction | number | '(' expr ')'
  //   fraction:= number '/' number          <- a slash between two numbers is a
  //                                            fraction bar and binds tightest
  //
  // So 2/3 ÷ 1/6 and 2/3 / 1/6 both mean (2/3) ÷ (1/6) = 4, the way students
  // write fraction division, and 1/3 x 1/4 is a product of two fractions.
  // A slash next to parentheses, as in 12/(2*3), is ordinary division.
  // ---------------------------------------------------------------------------

  function parseTokens(tokens) {
    var pos = 0;

    function peek(k) { return tokens[pos + (k || 0)]; }
    function next() { return tokens[pos++]; }

    function expr() {
      var node = term();
      while (peek() && (peek().type === '+' || peek().type === '-')) {
        var op = next().type;
        node = { type: 'bin', op: op, left: node, right: term() };
      }
      return node;
    }
    function term() {
      var node = unary();
      while (peek() && (peek().type === '*' || peek().type === '/' || peek().type === '÷')) {
        var op = next().type;
        node = { type: 'bin', op: op, left: node, right: unary() };
      }
      return node;
    }
    function unary() {
      if (peek() && peek().type === '-') {
        next();
        return { type: 'neg', arg: unary() };
      }
      return primary();
    }
    function primary() {
      var t = next();
      if (!t) throw new ParseError('the expression ends too early');
      if (t.type === 'num') {
        if (peek() && peek().type === '/' && !peek().implicit && peek(1) && peek(1).type === 'num') {
          next();
          var bottom = next();
          return { type: 'fraction', top: t.text, bottom: bottom.text };
        }
        return { type: 'num', text: t.text };
      }
      if (t.type === 'mixed') return { type: 'mixed', whole: t.whole, top: t.top, bottom: t.bottom };
      if (t.type === 'var') return { type: 'var', name: t.name };
      if (t.type === '(') {
        var inner = expr();
        var close = next();
        if (!close || close.type !== ')') throw new ParseError('missing closing parenthesis');
        return { type: 'group', arg: inner };
      }
      throw new ParseError('unexpected "' + t.text + '"');
    }

    if (tokens.length === 0) throw new ParseError('empty answer');
    var ast = expr();
    if (pos < tokens.length) throw new ParseError('unexpected "' + tokens[pos].text + '"');
    return ast;
  }

  // env: values for variables, e.g. { h: 17/3 } (only for expressions with letters)
  function evaluate(node, env) {
    switch (node.type) {
      case 'var':
        if (!env || !env[node.name]) throw new ParseError('"' + node.name + '" has no value here');
        return env[node.name];
      case 'num': return fracFromNumberText(node.text);
      case 'fraction': return div(fracFromNumberText(node.top), fracFromNumberText(node.bottom));
      case 'mixed':
        return add(fracFromNumberText(node.whole),
          div(fracFromNumberText(node.top), fracFromNumberText(node.bottom)));
      case 'group': return evaluate(node.arg, env);
      case 'neg': return mul(frac(-1n), evaluate(node.arg, env));
      case 'bin':
        var l = evaluate(node.left, env);
        var r = evaluate(node.right, env);
        if (node.op === '+') return add(l, r);
        if (node.op === '-') return sub(l, r);
        if (node.op === '*') return mul(l, r);
        return div(l, r); // '/' or '÷'
    }
    throw new ParseError('internal error');
  }

  // Writes the expression back out with standard symbols. Fractions that are
  // divided are put in parentheses so the reading is unambiguous:
  //   "2/3 divided by 1/6" -> "(2/3)÷(1/6)",  "8 x 3 x 2" -> "8*3*2"
  function serialize(node, parentOp) {
    switch (node.type) {
      case 'num': return node.text;
      case 'var': return node.name;
      case 'fraction':
        var f = node.top + '/' + node.bottom;
        return parentOp === '/' || parentOp === '÷' ? '(' + f + ')' : f;
      case 'mixed':
        var m = node.whole + ' ' + node.top + '/' + node.bottom;
        return parentOp ? '(' + m + ')' : m;
      case 'group': return '(' + serialize(node.arg) + ')';
      case 'neg': return '-' + serialize(node.arg, 'neg');
      case 'bin': return serialize(node.left, node.op) + node.op + serialize(node.right, node.op);
    }
    return '';
  }

  // ---------------------------------------------------------------------------
  // Structure: describes how the answer was written
  // ---------------------------------------------------------------------------

  function stripGroups(node) {
    while (node.type === 'group') node = node.arg;
    return node;
  }

  function leafText(node) {
    node = stripGroups(node);
    if (node.type === 'num') return node.text;
    if (node.type === 'fraction') return node.top + '/' + node.bottom;
    if (node.type === 'mixed') return node.whole + ' ' + node.top + '/' + node.bottom;
    if (node.type === 'var') return node.name;
    return null;
  }

  // Two leaves are the same: equal numbers, or the same letter.
  function sameLeaf(a, b) {
    if (/[a-z]/.test(a) || /[a-z]/.test(b)) return a === b;
    return eq(leafValue(a), leafValue(b));
  }

  // The letters an expression uses, e.g. "h"
  function lettersUsed(node, set) {
    set = set || {};
    if (node.type === 'var') set[node.name] = true;
    if (node.type === 'bin') { lettersUsed(node.left, set); lettersUsed(node.right, set); }
    if (node.type === 'group' || node.type === 'neg') lettersUsed(node.arg, set);
    return Object.keys(set).sort().join('');
  }

  // Value of a leaf: "6", "0.5", "1/4" or "2 1/4".
  function leafValue(text) {
    var spaced = text.split(' ');
    if (spaced.length === 2) return add(fracFromNumberText(spaced[0]), leafValue(spaced[1]));
    var parts = text.split('/');
    return parts.length === 2
      ? div(fracFromNumberText(parts[0]), fracFromNumberText(parts[1]))
      : fracFromNumberText(text);
  }

  // Collect the leaves of a chain that uses one kind of operator, e.g.
  // 8*3*2 -> [8,3,2] and 1/3*1/4 -> [1/3, 1/4].
  function chainLeaves(node, ops) {
    node = stripGroups(node);
    var leaf = leafText(node);
    if (leaf !== null) return [leaf];
    if (node.type === 'bin' && ops.indexOf(node.op) !== -1) {
      var left = chainLeaves(node.left, ops);
      var right = chainLeaves(node.right, ops);
      return left && right ? left.concat(right) : null;
    }
    return null;
  }

  function operatorsUsed(node, set) {
    set = set || {};
    if (node.type === 'bin') {
      set[node.op] = true;
      operatorsUsed(node.left, set);
      operatorsUsed(node.right, set);
    } else if (node.type === 'group' || node.type === 'neg') {
      if (node.type === 'neg') set['negation'] = true;
      operatorsUsed(node.arg, set);
    }
    return set;
  }

  function describeStructure(ast) {
    var root = stripGroups(ast);
    if (root.type === 'num') return { kind: 'number' };
    if (root.type === 'fraction') return { kind: 'fraction' };
    if (root.type === 'mixed') return { kind: 'mixed_number' };
    if (root.type === 'var') return { kind: 'letter' };
    var factors = chainLeaves(root, ['*']);
    if (factors) return { kind: 'product', factors: factors };
    var terms = chainLeaves(root, ['+']);
    if (terms) {
      var allSame = terms.every(function (t) { return sameLeaf(t, terms[0]); });
      return { kind: allSame ? 'repeated_addition' : 'sum', terms: terms };
    }
    if (root.type === 'bin' && (root.op === '/' || root.op === '÷')) {
      var a = leafText(root.left);
      var b = leafText(root.right);
      if (a !== null && b !== null) return { kind: 'quotient', dividend: a, divisor: b };
    }
    return { kind: 'mixed', operators: Object.keys(operatorsUsed(root)).sort() };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function parseSide(text, letters) {
    // A whole answer written tape-measure style, "10-3/4", means the mixed number
    // 10 3/4. Inside a longer expression a hyphen is still subtraction.
    var hyphenMixed = text.match(/^(\d+)\s?-\s?(\d+\/\d+)$/);
    if (hyphenMixed && !/\s-\s/.test(text)) text = hyphenMixed[1] + ' ' + hyphenMixed[2];
    var tokens = tokenize(text, letters);
    var ast = parseTokens(tokens);
    return { ast: ast, normalized: serialize(ast), structure: describeStructure(ast), letters: lettersUsed(ast) };
  }

  // What two expressions are compared by: the exact value, or, when the problem has
  // letters, the values at every test value (the same letters for both expressions).
  function signature(side, letters) {
    if (!letters) return fracToText(evaluate(side.ast));
    return TEST_VALUES.map(function (_, k) {
      var env = {};
      Array.from(letters).forEach(function (v, i) { env[v] = TEST_VALUES[(k + 2 * i) % TEST_VALUES.length]; });
      return fracToText(evaluate(side.ast, env));
    }).join('|');
  }

  // An expression in one letter written as a*h + b ("5/7*h"), or null when it is
  // not of that form (h*h, 1/h, ...).
  function linearText(side, v) {
    var at = function (x) { var env = {}; env[v] = x; return evaluate(side.ast, env); };
    var x0 = TEST_VALUES[0];
    var y0 = at(x0);
    var a = div(sub(at(TEST_VALUES[1]), y0), sub(TEST_VALUES[1], x0));
    var b = sub(y0, mul(a, x0));
    for (var k = 2; k < TEST_VALUES.length; k++) {
      if (!eq(at(TEST_VALUES[k]), add(mul(a, TEST_VALUES[k]), b))) return null;
    }
    if (a.n === 0n) return fracToText(b);
    var term = eq(a, frac(1n)) ? v : eq(a, frac(-1n)) ? '-' + v : fracToText(a) + '*' + v;
    if (b.n === 0n) return term;
    return term + (b.n < 0n ? '-' + fracToText(mul(b, frac(-1n))) : '+' + fracToText(b));
  }

  /**
   * variablesIn(answerKey): the letters an answer key uses as variables, e.g.
   * '5h/7' -> 'h'. x (times) and r (remainder) never count.
   */
  function variablesIn(text) {
    if (text == null) return '';
    var letters = String(text).toLowerCase().replace(/[^a-z]/g, '').replace(/[xr]/g, '');
    return Array.from(new Set(Array.from(letters))).sort().join('');
  }

  function analyze(input, letters) {
    letters = variablesIn(letters);
    var result = {
      ok: false,
      input: input == null ? '' : String(input),
      normalized: null,
      value_text: null,
      value_decimal: null,
      structure: null,
      has_equals: false,
      stripped_words: '',
      error: null
    };
    var sides = null;
    try {
      var stripped = stripTrailingWords(normalizeSymbols(result.input), letters);
      result.stripped_words = stripped.stripped;
      var text = replaceWordOperators(stripped.text);
      if (text === '') throw new ParseError('empty answer');

      var texts = text.split('=').map(function (s) { return s.trim(); });
      result.has_equals = texts.length > 1;
      sides = texts.map(function (s) {
        if (s === '') throw new ParseError('one side of the equals sign is empty');
        return parseSide(s, letters);
      });
      var first = signature(sides[0], letters);
      for (var i = 1; i < sides.length; i++) {
        if (signature(sides[i], letters) !== first) {
          throw new ParseError('the two sides of the equals sign are not equal');
        }
      }
      result.normalized = sides.map(function (p) { return p.normalized; }).join('=');
      var used = sides[0].letters;
      if (!used) {
        var value = evaluate(sides[0].ast);
        result.value_text = fracToText(value);
        result.value_decimal = fracToNumber(value);
      } else {
        result.letters = used;
        result.value_text = used.length === 1 ? linearText(sides[0], used) : null;
      }
      result.structure = sides[0].structure; // structure of what the student wrote first
      result.ok = true;
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      result.error = e.message;
      sides = null;
    }
    return { result: result, sides: sides, letters: letters };
  }

  /**
   * parse(input, options) -> {
   *   ok: boolean,
   *   input: original text,
   *   normalized: e.g. "8*3*2" (null when ok is false),
   *   value_text: exact value, e.g. "48" or "1/12"; for an expression with a
   *               letter, its simplest form when that is a*h + b (e.g. "5/7*h"),
   *   value_decimal: number (null for an expression with a letter),
   *   letters: (only when the expression uses letters) e.g. "h",
   *   structure: { kind: 'number'|'fraction'|'mixed_number'|'letter'|'product'|
   *                       'repeated_addition'|'sum'|'quotient'|'mixed', ... },
   *   has_equals: true if the student wrote an equation such as 8*3*2=48,
   *   stripped_words: trailing words removed, e.g. "marbles",
   *   error: message when ok is false
   * }
   * options.variables: letters to read as variables, e.g. 'h' (or an answer
   * key such as '5h/7', whose letters are used). Without it, letters are not read.
   */
  function parse(input, options) {
    return analyze(input, options && options.variables).result;
  }

  // Compares input with target; null when either cannot be read.
  function compare(input, target) {
    var letters = variablesIn(target);
    var a = analyze(input, letters);
    var b = analyze(typeof target === 'number' ? String(target) : target, letters);
    if (!a.sides || !b.sides) return { a: a, b: b, same: null };
    return { a: a, b: b, same: signature(a.sides[0], letters) === signature(b.sides[0], letters) };
  }

  /** equivalent(input, target): true when input has the same value as target (for every value of any letter in target). */
  function equivalent(input, target) {
    return compare(input, target).same === true;
  }

  /**
   * score(input, target): true or false when the answer can be read, and null
   * when it cannot (for example "7 rows and 5 left over"), so that unreadable
   * answers are left for a person to judge instead of being marked wrong.
   * A letter in target (e.g. '5h/7') is a variable: see the top of this file.
   */
  function score(input, target) {
    if (target == null) return null;
    var c = compare(input, String(target));
    if (!c.b.sides) throw new Error('The correct answer "' + target + '" cannot be parsed');
    return c.a.sides ? c.same : null;
  }

  return {
    parse: parse,
    equivalent: equivalent,
    score: score,
    variablesIn: variablesIn,
    WORD_OPERATORS: WORD_OPERATORS,
    SYMBOL_MAP: SYMBOL_MAP
  };
});
