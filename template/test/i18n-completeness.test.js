'use strict';
/**
 * i18n completeness — every translatable string reaches every locale.
 *
 * Why this test exists
 * --------------------
 * The localization walk matches EXACT strings, and the translator falls back
 * to the source string when a key is absent. That fallback is the right
 * runtime behaviour — a missing translation must never blank the page — but it
 * fails SILENTLY. Nothing goes red; the Spanish and Portuguese pages simply
 * carry English sentences, and review has no way to see it.
 *
 * That is not hypothetical. In `olavo` a whole panel shipped with its headings
 * and twelve list items in the wrong language, and the defect was found by the
 * project owner looking at the rendered page. Fixing it surfaced three more of
 * the same kind, each invisible to every other check in the gate:
 *
 *   - prose hiding in a data field (`date: "undated in the corpus"`), where
 *     the field is correctly untranslated but the value was not a date;
 *   - a stale key, left behind when the English prose it translated was
 *     rewritten — so the translation sat unreachable while the new English
 *     rendered verbatim on both localized pages;
 *   - the project's own stance notes on each reference, which rode inside the
 *     `references` array and were skipped wholesale with the citation data.
 *
 * Both directions are checked, because each catches a different failure:
 *
 *   MISSING key  -> the localized page renders English.
 *   STALE key    -> a translation exists for text no longer in the dataset;
 *                   its live counterpart is almost certainly untranslated.
 *
 * The walk deliberately MIRRORS build.js's `localizeData` rather than
 * approximating it: the key sets are parsed out of build.js, and the
 * per-subtree allowlists and the array-inherits-the-parent-key rule are
 * reproduced exactly. A test that approximates the compiler is wrong in BOTH
 * directions — it passes while the page renders English, and it fails while the
 * page is right. Both have happened. In `olavo` the bibliography landed with
 * its own allowlist in build.js while this walk still had the old two-branch
 * version, so the suite demanded a Spanish translation for the Portuguese title
 * *O Jardim das Aflições*, which the compiler correctly leaves alone.
 *
 * So the mirror is not left to care: the last test in this file drives
 * `localizeData` itself with a marking dictionary and asserts it moved exactly
 * the strings the walk here selects.
 *
 * ADOPT points: the dataset filename, and the locales the repo publishes.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// >>> ADOPT: dataset  (this repo's dataset file)
// The template ships the example skeleton; an adopting repo points this at its
// own ('chronology.json', 'glossary.json') in the same commit.
const DATASET = 'chronology.example.json';
// <<< ADOPT

// A missing dataset is a FAILURE, never a skip. A completeness check that
// quietly passes when it cannot find what it is meant to check is worse than
// no check: it reports "translated" for a page rendering English.
const DATA_PATH = path.join(ROOT, 'data', DATASET);
assert.ok(
  fs.existsSync(DATA_PATH),
  `data/${DATASET} does not exist — point the ADOPT block at this repo's dataset`);
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

/** The locales this repo PUBLISHES, read from the build output.
 *
 * Derived rather than declared, deliberately. A hardcoded list is one more
 * thing to forget on adoption, and a completeness test that silently checks
 * nothing is the exact failure mode this file exists to close. `docs/<lang>/`
 * is what actually reaches a reader, so it is the honest source of truth: the
 * template publishes nothing and checks nothing, and the moment a repo emits a
 * locale tree the per-locale tests arm themselves.
 */
function publishedLocales() {
  const docs = path.join(ROOT, 'docs');
  if (!fs.existsSync(docs)) return [];
  return fs.readdirSync(docs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[a-z]{2}(-[a-z]{2})?$/i.test(e.name) && e.name !== 'en')
    .map((e) => e.name)
    .filter((lang) => fs.existsSync(path.join(ROOT, 'data', 'i18n', `${lang}.json`)))
    .sort();
}

const LANGS = publishedLocales();

/** Parse a `new Set([...])` literal out of build.js.
 *
 * Read out of the source rather than imported so that the audit fails LOUDLY on
 * a rename or a deletion, naming the declaration it could not find, instead of
 * quietly walking with an empty set and reporting a fully translated site.
 * Comments are stripped FIRST: an apostrophe inside one ("the lane's
 * grounding") desynchronizes quote pairing and silently drops every key after
 * it — which is exactly how an early version of this audit reported 8 missing
 * strings where there were 25. The count assertion makes that failure loud.
 */
function parseSet(name, min) {
  const src = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
  const parts = src.split(`const ${name} = new Set([`);
  assert.strictEqual(parts.length, 2, `build.js does not declare ${name}`);
  const block = parts[1].split(/\]\);/)[0];
  const code = block.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const keys = (code.match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
  assert.ok(keys.length >= min, `failed to parse ${name} out of build.js (got ${keys.length})`);
  return new Set(keys);
}

/** The per-subtree allowlists, parsed out of build.js's SUBTREE_TRANSLATABLE.
 *
 * A map from a subtree's key to the keys that are prose INSIDE it, because the
 * exceptions multiply: `references` first, then a bibliography where `title` is
 * a book's name and must not be translated. As booleans threaded through the
 * walk each new exception touched every call site; as entries in a map they
 * cost one line and this parser stays the same.
 *
 * Every entry beyond `references` is OPTIONAL by construction — a repo with no
 * bibliography declares no `works` allowlist, the walk never narrows there, and
 * a dataset with no such key builds byte-identically (core adr/0001).
 *
 * Comments are stripped BEFORE parsing: the ADOPT block inside the map carries
 * a commented example entry, and an example a repo has not adopted must not be
 * read as one it has.
 */
function parseSubtreeSets() {
  const src = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
  const parts = src.split('const SUBTREE_TRANSLATABLE = {');
  assert.strictEqual(parts.length, 2, 'build.js does not declare SUBTREE_TRANSLATABLE');
  const body = parts[1].split(/^};/m)[0];
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const map = {};
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*new Set\(\[([^\]]*)\]\)/g)) {
    map[m[1]] = new Set((m[2].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)));
  }
  assert.ok(
    map.references && map.references.size,
    'failed to parse SUBTREE_TRANSLATABLE out of build.js');
  return map;
}

/** Every string build.js would route through the dictionaries.
 *
 * Line for line the walk in `localizeData`, including the rule that resolves
 * the allowlist: the nearest enclosing declared subtree wins and is sticky.
 */
function translatableStrings() {
  const KEYS = parseSet('TRANSLATABLE_KEYS', 10);
  const SUBTREES = parseSubtreeSets();
  const out = [];
  const walk = (val, key, subtree) => {
    const here = Object.prototype.hasOwnProperty.call(SUBTREES, key) ? key : subtree;
    const keys = SUBTREES[here] || KEYS;
    if (Array.isArray(val)) return val.forEach((v) => walk(v, key, here));
    if (val && typeof val === 'object') {
      return Object.keys(val).forEach((k) => walk(val[k], k, here));
    }
    if (typeof val === 'string' && keys.has(key)) out.push(val);
  };
  walk(data, null, null);
  return [...new Set(out)];
}

/** Every string anywhere in the dataset — the universe a key may name. */
function allStrings() {
  const seen = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') return Object.values(v).forEach(walk);
    if (typeof v === 'string') seen.add(v);
  };
  walk(data);
  return seen;
}

const load = (lang) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'i18n', `${lang}.json`), 'utf8'));

test('the locale sweep found the trees it is meant to check', () => {
  const docs = path.join(ROOT, 'docs');
  const trees = fs.existsSync(docs)
    ? fs.readdirSync(docs).filter((n) => /^[a-z]{2}(-[a-z]{2})?$/i.test(n) && n !== 'en')
    : [];
  assert.deepStrictEqual(
    LANGS, trees.sort(),
    `docs/ publishes ${JSON.stringify(trees)} but this check covers ${JSON.stringify(LANGS)} — ` +
    `a locale tree without a data/i18n/<lang>.json renders English and nothing here would say so`);
});

for (const lang of LANGS) {
  test(`${lang}: every translatable dataset string has a translation`, () => {
    const d = load(lang).strings;
    const missing = translatableStrings().filter((s) => !(s in d));
    assert.deepStrictEqual(
      missing, [],
      `${missing.length} string(s) would render untranslated on the ${lang} page. ` +
      `Add them to data/i18n/${lang}.json verbatim — the walk matches exact strings.`);
  });

  test(`${lang}: no dictionary key has gone stale`, () => {
    const universe = allStrings();
    const stale = Object.keys(load(lang).strings).filter((k) => !universe.has(k));
    assert.deepStrictEqual(
      stale, [],
      `${stale.length} key(s) in data/i18n/${lang}.json match nothing in the dataset. ` +
      `The source prose was almost certainly rewritten: re-key the translation to ` +
      `the current string rather than leaving both.`);
  });
}

// >>> ADOPT: publisher-parenthetical-exceptions  (ids whose bracket NAMES the source)
// A parenthetical that NAMES rather than characterises is bibliography and
// stays: an imprint and year, the presenters, the parent publisher. List those
// reference ids here so the check below stays a real signal.
const PUBLISHER_BRACKET_OK = new Set([]);
// <<< ADOPT

test('references: publisherNote carries the prose, publisher the citation', () => {
  for (const r of data.references || []) {
    const m = /\(([^()]*)\)\s*$/.exec(r.publisher || '');
    if (!m || PUBLISHER_BRACKET_OK.has(r.id)) continue;
    // A one-word bracket is an edition or imprint marker — "(EN)", "(UOL)".
    // Two or more words is prose glued to a citation, and prose glued to a
    // citation is what renders untranslated on every localized page.
    assert.ok(
      m[1].trim().split(/\s+/).length < 2,
      `reference "${r.id}": publisher ends in a prose parenthetical — ${JSON.stringify(r.publisher)}. ` +
      `If it CHARACTERISES the source it belongs in publisherNote, which IS translated. ` +
      `If it NAMES the source (an imprint, a parent publisher, the presenters), add the id ` +
      `to PUBLISHER_BRACKET_OK with that reason.`);
  }
});

/* The mirror, asserted rather than intended.
 *
 * Everything above trusts that the walk in this file selects the same strings
 * `localizeData` translates. That trust is exactly what broke when the walk and
 * the compiler drifted, so it is checked directly: translate the dataset with a
 * dictionary that MARKS every string, then read back which ones the compiler
 * actually moved. Marking per string (rather than one sentinel for all)
 * preserves the identity of each, so the two sets are comparable.
 *
 * Any divergence — a new subtree allowlist in build.js, a boolean smuggled back
 * into the walk, a rule reproduced slightly differently here — surfaces as a
 * named list of strings instead of as a mistranslated page.
 */
test('this walk selects exactly the strings localizeData translates', () => {
  const { localizeData } = require('../build.js');
  // NUL: legal in a JSON string and present in no real one, so a marked value
  // cannot collide with dataset prose. (build.js only builds when run directly,
  // so requiring it here compiles nothing.)
  const MARK = '\u0000';
  const dict = {};
  for (const s of allStrings()) dict[s] = MARK + s;
  const localized = localizeData(data, dict, 'en');

  const moved = new Set();
  const collect = (v) => {
    if (Array.isArray(v)) return v.forEach(collect);
    if (v && typeof v === 'object') return Object.values(v).forEach(collect);
    if (typeof v === 'string' && v.startsWith(MARK)) moved.add(v.slice(MARK.length));
  };
  collect(localized);

  const selected = new Set(translatableStrings());
  // Two empty sets agree about nothing. A dataset that routes no string at all
  // through the dictionaries would make this test vacuous rather than green.
  assert.ok(selected.size, 'no translatable strings found — this comparison would be vacuous');
  const onlyCompiler = [...moved].filter((s) => !selected.has(s)).sort();
  const onlyTest = [...selected].filter((s) => !moved.has(s)).sort();
  assert.deepStrictEqual(
    { onlyCompiler, onlyTest }, { onlyCompiler: [], onlyTest: [] },
    `this file no longer mirrors localizeData. onlyCompiler = strings the build ` +
    `translates and this audit ignores (they will render untranslated and nothing ` +
    `else would say so); onlyTest = strings this audit demands translations for ` +
    `that the build never translates (a Spanish "translation" of a book title).`);
});
