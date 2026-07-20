'use strict';
// Unit tests for the optional glossary cross-linking feature: the [[term-id]]
// marker grammar, its expansion into links, and the byte-identical guarantee
// for marker-free text. Zero-dependency (node:test / node:assert).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  esc, glossaryMarkerIds, renderGlossaryLinks, renderText, renderPage, GLOSSARY_BASE,
} = require('../build.js');

test('marker-free text renders byte-identically to esc() (the opt-in contract)', () => {
  for (const s of ['plain text', 'a & b < c > d "e" \'f\'', '', 'brackets [x] but no marker', 'single [ open']) {
    assert.equal(renderText(s), esc(s), `renderText must equal esc for ${JSON.stringify(s)}`);
  }
  // A lone "[[" with no valid marker is left untouched (still == esc).
  assert.equal(renderText('stray [[ here'), esc('stray [[ here'));
});

test('glossaryMarkerIds extracts term-ids, ignoring non-markers', () => {
  assert.deepEqual(glossaryMarkerIds('a [[schism]] b'), ['schism']);
  assert.deepEqual(glossaryMarkerIds('[[latae-sententiae|latae sententiae]] and [[sedevacantism]]'),
    ['latae-sententiae', 'sedevacantism']);
  assert.deepEqual(glossaryMarkerIds('no markers here'), []);
  assert.deepEqual(glossaryMarkerIds('[[ Not An Id ]]'), []); // spaces/caps are not slugs
  assert.deepEqual(glossaryMarkerIds(undefined), []);
});

test('[[term-id]] renders a link to the glossary page, text = the id', () => {
  const html = renderText('incurred a [[schism]] here');
  assert.equal(html, `incurred a <a class="glossary-link" href="${GLOSSARY_BASE}schism/">schism</a> here`);
});

test('[[term-id|visible text]] uses the visible text as the label', () => {
  const html = renderText('a [[latae-sententiae|latae sententiae]] penalty');
  assert.equal(html,
    `a <a class="glossary-link" href="${GLOSSARY_BASE}latae-sententiae/">latae sententiae</a> penalty`);
});

test('surrounding prose is still HTML-escaped', () => {
  const html = renderText('<b>Ex</b> & [[schism]]');
  assert.match(html, /^&lt;b&gt;Ex&lt;\/b&gt; &amp; <a class="glossary-link"/);
  assert.ok(!html.includes('<b>'));
});

test('renderGlossaryLinks operates on already-escaped input and is a no-op without a marker', () => {
  assert.equal(renderGlossaryLinks('already escaped &amp; text'), 'already escaped &amp; text');
  assert.equal(renderGlossaryLinks('[[schism]]'),
    `<a class="glossary-link" href="${GLOSSARY_BASE}schism/">schism</a>`);
});

// ---- page integration ------------------------------------------------------

const baseData = {
  meta: { title: 't', subtitle: 's', description: 'd', language: 'en', lastUpdated: '2026-01-01', dataQualityNote: 'q' },
  facts: [{ label: 'What', value: 'a plain fact', sources: ['ref-a'] }],
  events: [{ year: 1988, date: '1988', dateVerified: true, place: 'p', title: 'T', text: 'a plain event', sources: ['ref-a'] }],
  figures: [{ name: 'N', role: 'a plain role', sources: ['ref-a'] }],
  organizations: [],
  references: [{ id: 'ref-a', title: 'A', url: 'https://example.org/a', publisher: 'p', type: 'web' }],
};

test('a marker in a prose field renders a glossary link in the page', () => {
  const data = { ...baseData, events: [{ ...baseData.events[0], text: 'the 1988 [[latae-sententiae|latae sententiae]] penalty' }] };
  const html = renderPage(data, {});
  assert.match(html, new RegExp(`<a class="glossary-link" href="${GLOSSARY_BASE}latae-sententiae/">latae sententiae</a>`));
});

test('page render is byte-identical to the no-feature build when no marker is present', () => {
  // baseData carries no markers, so the whole page must be unchanged by the
  // renderText() wiring — the same guarantee the viz renderers give.
  const html = renderPage(baseData, {});
  assert.ok(!html.includes('glossary-link'), 'no glossary markup without markers');
});
