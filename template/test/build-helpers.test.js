'use strict';
// Unit tests for build.js's pure helpers (zero-dependency; node --test).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { esc, formatArchiveTs, renderCites, renderVizChips, decadeOf, translator, siteBase, alternates, localizeData } = require('../build.js');

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(5), '5');
});

test('formatArchiveTs renders a Wayback timestamp as YYYY-MM-DD', () => {
  assert.equal(formatArchiveTs('20260714120000'), '2026-07-14');
  assert.equal(formatArchiveTs(''), '');
  assert.equal(formatArchiveTs(undefined), '');
});

test('renderCites links known ids, passes raw URLs through, drops unknowns', () => {
  const nums = new Map([['wiki', 1], ['official', 2]]);
  const html = renderCites(['wiki', 'official'], nums);
  assert.match(html, /#ref-1/);
  assert.match(html, /#ref-2/);
  assert.match(renderCites(['https://example.org/x'], nums), /\[web\]/);
  assert.equal(renderCites(['nope'], nums), '');
  assert.equal(renderCites([], nums), '');
  assert.equal(renderCites(undefined, nums), '');
});

test('renderVizChips renders header pill links, or nothing when undeclared', () => {
  const html = renderVizChips([{ href: '#chronology', label: '📜 Chronology' }]);
  assert.match(html, /class="viz-chips"/);
  assert.match(html, /<a href="#chronology">📜 Chronology<\/a>/);
  assert.equal(renderVizChips([]), '');
  assert.equal(renderVizChips(undefined), '');
  assert.match(renderVizChips([{ href: '#a"b', label: '<x>' }]), /#a&quot;b.*&lt;x&gt;/);
});

test('decadeOf groups years into decades', () => {
  assert.equal(decadeOf(1970), '1970s');
  assert.equal(decadeOf(1979), '1970s');
  assert.equal(decadeOf(2026), '2020s');
});

test('translator returns the translation when present, else the English source', () => {
  const t = translator({ Hello: 'Hola' });
  assert.equal(t('Hello'), 'Hola');
  assert.equal(t('Missing'), 'Missing');
  assert.equal(t(null), null);
});

test('siteBase normalizes to exactly one trailing slash', () => {
  assert.equal(siteBase({ siteUrl: 'https://x.io/fsp' }), 'https://x.io/fsp/');
  assert.equal(siteBase({ siteUrl: 'https://x.io/fsp///' }), 'https://x.io/fsp/');
  assert.match(siteBase({}), /\/$/);
});

test('alternates emits a self canonical + hreflang for every locale + x-default', () => {
  const html = alternates('https://x.io/fsp/', 'a.html', 'pt');
  assert.match(html, /<link rel="canonical" href="https:\/\/x\.io\/fsp\/pt\/a\.html">/);
  assert.match(html, /hreflang="en" href="https:\/\/x\.io\/fsp\/en\/a\.html"/);
  assert.match(html, /hreflang="x-default" href="https:\/\/x\.io\/fsp\/"/);
});

test('localizeData translates whitelisted prose, sets lang, and never touches references', () => {
  const data = {
    meta: { title: 'T', description: 'Hello', language: 'en' },
    events: [{ year: 1970, title: 'Hello', place: 'Rome', date: '1970', dateVerified: true, sources: ['r'] }],
    figures: [{ name: 'Hello', role: 'Hello', sources: ['r'] }],
    references: [{ id: 'r', title: 'Hello', url: 'https://x', publisher: 'P', type: 'x' }],
  };
  const es = localizeData(data, { Hello: 'Hola' }, 'es');
  assert.equal(es.meta.language, 'es');
  assert.equal(es.meta.description, 'Hola');       // description: translated
  assert.equal(es.events[0].title, 'Hola');        // event title: translated
  assert.equal(es.figures[0].name, 'Hello');       // proper name: NOT translated
  assert.equal(es.references[0].title, 'Hello');   // reference title: NOT translated
  assert.equal(es.events[0].date, '1970');         // dates untouched
  // English (empty dict) is the identity transform on content.
  const en = localizeData(data, {}, 'en');
  assert.equal(JSON.stringify(en.events), JSON.stringify(data.events));
});

/* The translation disclaimer states how a locale's strings were actually made.
 *
 * This is a provenance claim on the public page, so it is pinned here: the
 * template used to hardcode "machine translation" for es/pt, and every repo in
 * the 2026-08-05 bootstrap wave shipped that sentence over prose no machine had
 * touched. See cronologia/core#64. */
const { disclaimerFor, UI } = require('../build.js');

test('disclaimerFor: English carries no translation note', () => {
  assert.equal(disclaimerFor({}, UI.en), null);
  assert.equal(disclaimerFor({ humanReviewed: true }, UI.en), null);
});

test('disclaimerFor: a human-reviewed cache says so, in both locales', () => {
  for (const lang of ['es', 'pt']) {
    assert.equal(disclaimerFor({ humanReviewed: true }, UI[lang]), UI[lang].disclaimers.reviewed);
  }
});

test('disclaimerFor: only translate.js provenance claims machine translation', () => {
  const byBackend = { generatedBy: 'scripts/translate.js via TRANSLATE_ENDPOINT' };
  assert.equal(disclaimerFor(byBackend, UI.es), UI.es.disclaimers.machine);
  assert.match(UI.es.disclaimers.machine, /autom/);
});

test('disclaimerFor: authored is the default, and unknown provenance is NOT machine', () => {
  // The wrong way to be wrong is to disclaim prose a person stands behind, so
  // anything that does not name the backend falls to `authored`.
  for (const meta of [
    {},
    null,
    undefined,
    { generatedBy: 'hand-authored by the assistant during the bootstrap' },
    { generatedBy: 'unknown — record its real origin here' },
    { humanReviewed: false },
  ]) {
    assert.equal(disclaimerFor(meta, UI.pt), UI.pt.disclaimers.authored, JSON.stringify(meta));
  }
});

test('disclaimerFor: humanReviewed wins over a machine generatedBy, and only `true` counts', () => {
  const both = { humanReviewed: true, generatedBy: 'scripts/translate.js via TRANSLATE_ENDPOINT' };
  assert.equal(disclaimerFor(both, UI.es), UI.es.disclaimers.reviewed);
  // A truthy non-true value (a name, a date) must not be read as "reviewed".
  const sloppy = { humanReviewed: 'yes, by DJ' };
  assert.equal(disclaimerFor(sloppy, UI.es), UI.es.disclaimers.authored);
});
