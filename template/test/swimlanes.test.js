'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  layoutSwimlanes, renderSwimlanes, layoutChronologySpine, decadeColumns,
  renderPage, localizeData, UI,
} = require('../build.js');

const ev = (year, threads, dateVerified) => ({
  year, date: String(year), dateVerified, place: 'X', title: 'T', text: 't', sources: [], threads,
});

const THREADS = {
  note: 'These lanes are an editorial reading, not a neutral index.',
  lanes: [
    { id: 'alpha', label: 'Alpha lane', basis: 'Grounded in the actor’s own periodization.', sources: ['r1'] },
    { id: 'beta', label: 'Beta lane (attributed, not adopted)', basis: 'Grounded in what critics assert.' },
  ],
};

/* -------------------------------------------------------------------------
 * The optional-feature contract.
 * ---------------------------------------------------------------------- */

test('no taxonomy renders nothing', () => {
  assert.strictEqual(renderSwimlanes(undefined, [ev(1970, ['alpha'])], new Map(), UI.en), '');
  assert.strictEqual(renderSwimlanes({ note: 'n', lanes: [] }, [ev(1970, ['alpha'])], new Map(), UI.en), '');
});

test('a taxonomy with no tagged events renders nothing', () => {
  assert.strictEqual(renderSwimlanes(THREADS, [], new Map(), UI.en), '');
  assert.strictEqual(renderSwimlanes(THREADS, [ev(1970, undefined)], new Map(), UI.en), '');
  assert.strictEqual(renderSwimlanes(THREADS, [ev(1970, [])], new Map(), UI.en), '');
});

test('a page without meta.threads is byte-identical to one built before the feature', () => {
  const base = {
    meta: { title: 'T', subtitle: 'S', description: 'D', lastUpdated: '2026-01-01', language: 'en', dataQualityNote: 'n' },
    facts: [], events: [ev(1970, ['alpha']), ev(1981, ['beta'])], figures: [], organizations: [],
    disambiguation: { items: [] }, references: [],
  };
  const without = renderPage(base, {}, { lang: 'en' });
  assert.ok(!without.includes('id="threads"'));
  const with_ = renderPage({ ...base, meta: { ...base.meta, threads: THREADS } }, {}, { lang: 'en' });
  assert.ok(with_.includes('id="threads"'));
  const stripped = with_.replace(/    <section id="threads"[\s\S]*?<\/section>\n\n/, '')
    .replace(/\n      <a href="#threads">[^<]*<\/a>/, '');
  assert.strictEqual(stripped, without);
});

/* -------------------------------------------------------------------------
 * The five load-bearing properties.
 * ---------------------------------------------------------------------- */

test('the editorial note always renders with the figure', () => {
  const html = renderSwimlanes(THREADS, [ev(1970, ['alpha'])], new Map(), UI.en);
  assert.ok(html.includes(THREADS.note), 'the note that says this is a reading must be on the page');
  assert.ok(/notice-attribution/.test(html));
});

test('every lane basis renders, with its citations', () => {
  const refNum = new Map([['r1', 7]]);
  const html = renderSwimlanes(THREADS, [ev(1970, ['alpha']), ev(1980, ['beta'])], refNum, UI.en);
  assert.ok(html.includes('Grounded in the actor’s own periodization.'));
  assert.ok(html.includes('Grounded in what critics assert.'));
  assert.ok(html.includes('#ref-7'), 'a lane citing a source must render the citation');
});

test('lane labels render verbatim, including a load-bearing attribution', () => {
  const html = renderSwimlanes(THREADS, [ev(1970, ['beta'])], new Map(), UI.en);
  assert.ok(html.includes('Beta lane (attributed, not adopted)'),
    'a hedge in the label must not be truncated or prettified');
});

test('gaps collapse exactly as the spine collapses them', () => {
  const events = [ev(1900, ['alpha']), ev(1960, ['alpha'])];
  const sw = layoutSwimlanes(THREADS, events);
  const spine = layoutChronologySpine({}, events);
  const shape = (cells) => cells.map((c) => (c.type === 'break' ? `break:${c.count}:${c.from}-${c.to}` : `d:${c.decade}`));
  assert.deepStrictEqual(shape(sw.columns), shape(spine.cells),
    'two figures on one page must not disagree about the same gap');
  assert.ok(sw.columns.some((c) => c.type === 'break'));
});

test('unverified dates are counted per cell and marked', () => {
  const html = renderSwimlanes(THREADS, [ev(1970, ['alpha'], false), ev(1971, ['alpha'])], new Map(), UI.en);
  assert.ok(/sw-has-unverified/.test(html));
  assert.ok(html.includes('1 with a date not yet verified against a primary source'));
  const clean = renderSwimlanes(THREADS, [ev(1970, ['alpha'])], new Map(), UI.en);
  assert.ok(!/sw-has-unverified/.test(clean));
});

/* -------------------------------------------------------------------------
 * Counting: cross-cutting events, totals, and honest omissions.
 * ---------------------------------------------------------------------- */

test('a cross-cutting event is counted in every lane it belongs to', () => {
  const l = layoutSwimlanes(THREADS, [ev(1970, ['alpha', 'beta'])]);
  assert.strictEqual(l.taggedEvents, 1);
  assert.strictEqual(l.laneAssignments, 2);
  assert.strictEqual(l.lanes.find((x) => x.id === 'alpha').total, 1);
  assert.strictEqual(l.lanes.find((x) => x.id === 'beta').total, 1);
  const html = renderSwimlanes(THREADS, [ev(1970, ['alpha', 'beta'])], new Map(), UI.en);
  assert.ok(html.includes('2 lane assignments'), 'the caption must explain why rows outsum events');
});

test('dated events with no lane are reported, not silently dropped', () => {
  const l = layoutSwimlanes(THREADS, [ev(1970, ['alpha']), ev(1971, [])]);
  assert.strictEqual(l.untagged, 1);
  const html = renderSwimlanes(THREADS, [ev(1970, ['alpha']), ev(1971, [])], new Map(), UI.en);
  assert.ok(html.includes(UI.en.swUntaggedNote(1)));
});

test('a lane with no events still renders its row, with a zero', () => {
  const l = layoutSwimlanes(THREADS, [ev(1970, ['alpha'])]);
  const beta = l.lanes.find((x) => x.id === 'beta');
  assert.strictEqual(beta.total, 0);
  const html = renderSwimlanes(THREADS, [ev(1970, ['alpha'])], new Map(), UI.en);
  assert.ok(html.includes('Beta lane'), 'omitting an empty lane would hide that it is empty');
  assert.ok(/sw-zero/.test(html));
});

test('lanes keep their declared order, never a sorted-by-size order', () => {
  const l = layoutSwimlanes(THREADS, [ev(1970, ['beta']), ev(1971, ['beta']), ev(1972, ['alpha'])]);
  assert.deepStrictEqual(l.lanes.map((x) => x.id), ['alpha', 'beta']);
});

test('cells link into the chronology by decade', () => {
  const html = renderSwimlanes(THREADS, [ev(1967, ['alpha'])], new Map(), UI.en);
  assert.ok(html.includes('href="#decade-1960"'));
});

/* -------------------------------------------------------------------------
 * i18n — including the field that was English-only before this renderer.
 * ---------------------------------------------------------------------- */

test('pt/es render localized chrome', () => {
  for (const lang of ['pt', 'es']) {
    const html = renderSwimlanes(THREADS, [ev(1970, ['alpha'])], new Map(), UI[lang]);
    assert.ok(html.includes(UI[lang].swHeading));
    assert.ok(html.includes(UI[lang].swBasesHeading));
  }
});

test('lane basis is translatable data, so localized pages do not show English prose', () => {
  const data = { meta: { language: 'en', threads: THREADS }, events: [ev(1970, ['alpha'])] };
  const dict = {
    'Grounded in the actor’s own periodization.': 'Fundamentada na periodização do próprio ator.',
    'Alpha lane': 'Faixa Alfa',
  };
  const localized = localizeData(data, dict, 'pt');
  assert.strictEqual(localized.meta.threads.lanes[0].basis, 'Fundamentada na periodização do próprio ator.');
  assert.strictEqual(localized.meta.threads.lanes[0].label, 'Faixa Alfa');
  const html = renderSwimlanes(localized.meta.threads, localized.events, new Map(), UI.pt);
  assert.ok(html.includes('Fundamentada na periodização do próprio ator.'));
});

/* -------------------------------------------------------------------------
 * The extracted column model, shared with the spine.
 * ---------------------------------------------------------------------- */

test('decadeColumns collapses only runs at or above the threshold', () => {
  assert.deepStrictEqual(
    decadeColumns(new Set([1900, 1910]), 2).map((c) => c.type), ['decade', 'decade'],
  );
  // One empty decade, threshold 2 -> drawn as a real empty column.
  assert.deepStrictEqual(
    decadeColumns(new Set([1900, 1920]), 2).map((c) => c.type), ['decade', 'decade', 'decade'],
  );
  // Two empty decades -> one labelled break.
  const c = decadeColumns(new Set([1900, 1930]), 2);
  assert.deepStrictEqual(c.map((x) => x.type), ['decade', 'break', 'decade']);
  assert.strictEqual(c[1].count, 2);
  assert.strictEqual(c[1].from, 1910);
  assert.strictEqual(c[1].to, 1929);
});
