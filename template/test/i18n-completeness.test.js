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
 * references allowlist and the array-inherits-the-parent-key rule are
 * reproduced exactly. A test that checked a different set of strings than the
 * compiler translates would pass while the page was wrong.
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
 * Parsed rather than exported because requiring build.js runs the whole build.
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

/** Every string build.js would route through the dictionaries. */
function translatableStrings() {
  const KEYS = parseSet('TRANSLATABLE_KEYS', 10);
  const REF_KEYS = parseSet('REFERENCE_TRANSLATABLE', 1);
  const out = [];
  const walk = (val, key, inRefs) => {
    const keys = inRefs ? REF_KEYS : KEYS;
    const refs = inRefs || key === 'references';
    if (Array.isArray(val)) return val.forEach((v) => walk(v, key, refs));
    if (val && typeof val === 'object') {
      return Object.keys(val).forEach((k) => walk(val[k], k, refs));
    }
    if (typeof val === 'string' && keys.has(key)) out.push(val);
  };
  walk(data, null, false);
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
