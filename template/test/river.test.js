'use strict';
// The time river (core#108): the chronology section as lane tracks, opt-in
// with meta.layout "river". These tests pin the contract: absence (or "table")
// is byte-identical (ADR-0001); the river carries every event with the same
// caveats as the table (flag, dateNote, citations); it keeps every
// decade-NNNN anchor the other figures link to; its gaps are the spine's and
// the swimlanes' gaps (decadeColumns); lane labels render verbatim; and the
// real validator rejects an unknown layout.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { renderPage, renderRiver, layoutRiver, yearLabel, UI } = require('../build.js');

const ROOT = path.join(__dirname, '..');
const BASE_FILE = ['chronology.example.json', 'chronology.json']
  .map((f) => path.join(ROOT, 'data', f))
  .find((p) => fs.existsSync(p));
const base = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));
const REF = base.references[0].id;

const THREADS = {
  note: 'An editorial reading.',
  lanes: [
    { id: 'a', label: 'Lane A (attributed, not adopted)', basis: 'Why A.' },
    { id: 'b', label: 'Lane B', basis: 'Why B.' },
  ],
};
const EVENTS = [
  { year: -4, title: 'Early', text: 'Before the era.', place: 'P1', threads: ['a'], dateVerified: false, dateNote: 'Sources disagree.', sources: [REF] },
  { year: 30, title: 'Second', text: 'Thirty.', threads: ['a', 'b'], sources: [REF] },
  { year: 33, date: '0033-04-03', title: 'Third', text: 'Same decade.', threads: ['b'], sources: [REF] },
  { year: 400, title: 'Late', text: 'After a long gap.', threads: ['b'], sources: [REF] },
];

function page(meta, extra = {}) {
  return renderPage({ ...base, ...extra, meta: { ...base.meta, ...meta } }, {}, { lang: 'en' });
}

test('no layout, or "table", is byte-identical to today', () => {
  const without = page({ layout: undefined });
  assert.equal(page({ layout: 'table' }), without);
  assert.match(without, /<table class="meetings">/);
  assert.doesNotMatch(without, /class="rv-|river\.js/);
});

test('the river replaces the table and loads its script', () => {
  const html = page({ layout: 'river', threads: THREADS }, { events: EVENTS });
  assert.doesNotMatch(html, /<table class="meetings">/);
  assert.match(html, /<section id="chronology" class="river rv-lanes">/);
  assert.match(html, /<script src="\.\.\/river\.js" defer><\/script>/);
  for (const ev of EVENTS) assert.equal(html.split(`<h3>${ev.title}</h3>`).length - 1, 1, `${ev.title} renders once`);
});

test('every decade anchor the table had, the river has', () => {
  const ids = (html) => [...html.matchAll(/id="(decade-[-\d]+)"/g)].map((m) => m[1]).sort();
  const table = page({ layout: undefined, threads: THREADS }, { events: EVENTS });
  const river = page({ layout: 'river', threads: THREADS }, { events: EVENTS });
  assert.deepEqual(ids(river), ids(table));
});

test('caveats render as in the table: flag, dateNote, citations', () => {
  const html = renderRiver(EVENTS, THREADS, new Map([[REF, 1]]), UI.en);
  assert.match(html, /<li class="rv-e rv-u" id="decade--10"/);
  assert.match(html, /4 BCE <span class="flag" title="Date not yet verified against a primary source">\?<\/span>/);
  assert.match(html, /<p class="date-note">Sources disagree\.<\/p>/);
  assert.match(html, /\[1\]/);
});

test('an event sits on every lane it belongs to; labels are verbatim', () => {
  const html = renderRiver(EVENTS, THREADS, new Map([[REF, 1]]), UI.en);
  assert.match(html, /data-lanes="a b"[\s\S]*?<i class="rv-l0" style="--k:0"><\/i><i class="rv-l1" style="--k:1"><\/i>/);
  assert.match(html, />Lane A \(attributed, not adopted\)<\/label>/);
  assert.equal((html.match(/class="rv-tick /g) || []).length, 5, 'one tick per event per lane');
});

test('gaps are the shared decadeColumns breaks, with the same label', () => {
  const layout = layoutRiver(EVENTS, THREADS);
  const breaks = layout.columns.filter((c) => c.type === 'break');
  assert.equal(breaks.length, 2, '0s-20s and 40s-390s');
  const html = renderRiver(EVENTS, THREADS, new Map([[REF, 1]]), UI.en);
  assert.equal((html.match(/<li class="rv-gap">/g) || []).length, 2);
  for (const b of breaks) {
    const label = UI.en.spineBreakLabel(b.count, yearLabel(b.from, UI.en), yearLabel(b.to, UI.en));
    assert.ok(html.includes(`<li class="rv-gap"><span>${label}</span></li>`), label);
  }
});

test('without a lane taxonomy: one track, no lane chips, still filterable by date', () => {
  const plain = EVENTS.map(({ threads, ...e }) => e);
  const html = renderRiver(plain, undefined, new Map([[REF, 1]]), UI.en);
  assert.doesNotMatch(html, /data-lane="/);
  assert.match(html, /data-firm/);
  assert.match(html, /style="--lanes:1"/);
});

test('the controls are hidden until the script reveals them, and localized', () => {
  const html = renderRiver(EVENTS, THREADS, new Map([[REF, 1]]), UI.pt);
  assert.match(html, /<div class="rv-controls" role="group" aria-label="Filtrar a cronologia" hidden>/);
  assert.match(html, /Apenas datas firmes/);
});

function runValidator(layout) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'river-test-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.copyFileSync(path.join(ROOT, 'build.js'), path.join(dir, 'build.js'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'validate-data.js'), path.join(dir, 'scripts', 'validate-data.js'));
  if (fs.existsSync(path.join(ROOT, 'data', 'glossary-terms.json'))) fs.copyFileSync(path.join(ROOT, 'data', 'glossary-terms.json'), path.join(dir, 'data', 'glossary-terms.json'));
  if (fs.existsSync(path.join(ROOT, 'src', 'latam.svg'))) fs.copyFileSync(path.join(ROOT, 'src', 'latam.svg'), path.join(dir, 'src', 'latam.svg'));
  const places = path.join(ROOT, 'data', 'places.json');
  if (fs.existsSync(places)) fs.copyFileSync(places, path.join(dir, 'data', 'places.json'));
  fs.writeFileSync(path.join(dir, 'data', 'chronology.json'), JSON.stringify({ ...base, meta: { ...base.meta, layout } }));
  try {
    return { ok: true, out: execFileSync(process.execPath, [path.join(dir, 'scripts', 'validate-data.js')], { encoding: 'utf8' }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the validator accepts "river" and rejects an unknown layout', () => {
  assert.ok(runValidator('river').ok);
  const r = runValidator('grid');
  assert.equal(r.ok, false);
  assert.match(r.out, /meta\.layout must be one of "table", "river", got "grid"/);
});

test('a date that only repeats the year is not printed twice', () => {
  const evs = [{ year: 1921, date: '1921', title: 'Y', sources: [REF] }, { year: 1922, date: '1922-05-01', title: 'D', sources: [REF] }];
  const html = renderRiver(evs, undefined, new Map([[REF, 1]]), UI.en);
  assert.match(html, /<div class="rv-year">1921<\/div>/);
  assert.match(html, /<div class="rv-year">1922<small>1922-05-01<\/small><\/div>/);
});
