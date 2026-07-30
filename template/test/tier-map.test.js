'use strict';
// The country tier map (`map` key, core#3 item 2): render contract + the
// validator rules, the latter exercised by running the REAL validator against
// fixture datasets in a scratch copy (same harness as threads.test.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { renderTierMap, renderPage, stripGlossaryMarkers, esc, siteBase, localizeData, loadDict } = require('../build.js');

const ROOT = path.join(__dirname, '..');
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'chronology.example.json'), 'utf8'));

const UI_STUB = { tierMapHeading: 'Map', tierMapHint: 'Hover or focus a country for details.', mapCredit: 'Basemap: Natural Earth (public domain).' };
const MAP = {
  note: 'Editorial framing sentence.',
  unlistedLabel: 'not yet documented here',
  tiers: [
    { id: 'core', label: 'major center' },
    { id: 'presence', label: 'documented presence' },
  ],
  countries: [
    { code: 'BR', name: 'Brazil', tier: 'core', note: 'why & how', sources: ['example-ref'] },
    { code: 'AR', name: 'Argentina', tier: 'presence', note: 'why', sources: ['example-ref'] },
  ],
};
const refNums = new Map([['example-ref', 1]]);

// ---- renderer contract ------------------------------------------------------

test('absent map renders nothing and leaves the page free of map markup', () => {
  assert.equal(renderTierMap(undefined, refNums, UI_STUB), '');
  assert.equal(renderTierMap({ countries: [] }, refNums, UI_STUB), '');
  const data = JSON.parse(JSON.stringify(base));
  delete data.map;
  const html = renderPage(localizeData(data, loadDict('en'), 'en'), {}, { lang: 'en', base: siteBase(data.meta), route: '' });
  assert.ok(!html.includes('latam-c'), 'no country paths without the key');
  assert.ok(!html.includes('id="map"'), 'no map section without the key');
});

test('declared countries get their tier class, tab stop and tooltip data', () => {
  const html = renderTierMap(MAP, refNums, UI_STUB);
  assert.match(html, /id="ne-BR" class="latam-c map-t0" tabindex="0" data-name="Brazil"/);
  assert.match(html, /id="ne-AR" class="latam-c map-t1" tabindex="0" data-name="Argentina"/);
  // Unlisted countries keep the bare class — the "unlisted" state is visual.
  assert.match(html, /id="ne-MX" class="latam-c"/);
});

test('the legend is generated from the declared tiers plus the unlisted label', () => {
  const html = renderTierMap(MAP, refNums, UI_STUB);
  assert.match(html, /map-t0"><\/span> major center/);
  assert.match(html, /map-t1"><\/span> documented presence/);
  assert.match(html, /atlas-swatch"><\/span> not yet documented here/);
});

test('country cards render prose through renderText with citations', () => {
  const withMarker = JSON.parse(JSON.stringify(MAP));
  withMarker.countries[0].note = 'incurred a [[schism]] here';
  const html = renderTierMap(withMarker, refNums, UI_STUB);
  // Card: real glossary link. Tooltip attribute: marker stripped to its text.
  assert.match(html, /class="glossary-link"[^>]*>schism<\/a>/);
  assert.match(html, /data-note="incurred a schism here"/);
  assert.match(html, /class="cite"|class="refs"|\[1\]/); // citation marker present in the card
});

test('the aria-live caption and the base-map credit are present', () => {
  const html = renderTierMap(MAP, refNums, UI_STUB);
  assert.match(html, /aria-live="polite">Hover or focus a country for details\./);
  assert.match(html, /Natural Earth \(public domain\)/);
});

test('stripGlossaryMarkers keeps plain text byte-identical', () => {
  for (const s of ['plain', 'a [x] b', 'stray [[ here']) assert.equal(stripGlossaryMarkers(s), s);
  assert.equal(stripGlossaryMarkers('a [[schism]] b'), 'a schism b');
  assert.equal(stripGlossaryMarkers('[[latae-sententiae|latae sententiae]]'), 'latae sententiae');
});

test('the page wires the section and its nav link only when the key exists', () => {
  const data = JSON.parse(JSON.stringify(base)); // example carries a map block
  const html = renderPage(localizeData(data, loadDict('en'), 'en'), {}, { lang: 'en', base: siteBase(data.meta), route: '' });
  assert.match(html, /<a href="#map">/);
  assert.match(html, /<section id="map" class="viz">/);
});

// ---- validator rules (real validator, scratch copy) -------------------------

function runValidator(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-map-test-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.copyFileSync(path.join(ROOT, 'build.js'), path.join(dir, 'build.js'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'validate-data.js'), path.join(dir, 'scripts', 'validate-data.js'));
  fs.copyFileSync(path.join(ROOT, 'data', 'glossary-terms.json'), path.join(dir, 'data', 'glossary-terms.json'));
  fs.copyFileSync(path.join(ROOT, 'src', 'latam.svg'), path.join(dir, 'src', 'latam.svg'));
  const d = JSON.parse(JSON.stringify(base));
  mutate(d);
  fs.writeFileSync(path.join(dir, 'data', 'chronology.json'), JSON.stringify(d));
  try {
    const out = execFileSync(process.execPath, [path.join(dir, 'scripts', 'validate-data.js')], { encoding: 'utf8' });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the example dataset (which carries a map) validates', () => {
  const r = runValidator(() => {});
  assert.ok(r.ok, r.out);
});

test('a dataset without the map key validates (opt-in contract)', () => {
  const r = runValidator((d) => { delete d.map; });
  assert.ok(r.ok, r.out);
});

test('an undeclared tier on a country fails', () => {
  const r = runValidator((d) => { d.map.countries[0].tier = 'mystery'; });
  assert.ok(!r.ok);
  assert.match(r.out, /unknown tier "mystery"/);
});

test('a country code with no path in the base map fails', () => {
  const r = runValidator((d) => { d.map.countries[0].code = 'ZZ'; });
  assert.ok(!r.ok);
  assert.match(r.out, /no path in src\/latam\.svg/);
});

test('a malformed code fails before the SVG lookup', () => {
  const r = runValidator((d) => { d.map.countries[0].code = 'Brasil'; });
  assert.ok(!r.ok);
  assert.match(r.out, /must be an ISO alpha-2 code/);
});

test('the unlisted-country label is required', () => {
  const r = runValidator((d) => { delete d.map.unlistedLabel; });
  assert.ok(!r.ok);
  assert.match(r.out, /unlistedLabel missing/);
});

test('more than four tiers fails', () => {
  const r = runValidator((d) => {
    d.map.tiers = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id }));
    d.map.countries.forEach((c) => { c.tier = 'a'; });
  });
  assert.ok(!r.ok);
  assert.match(r.out, /1–4 entries/);
});

test('uncited countries fail (every fact must be cited)', () => {
  const r = runValidator((d) => { d.map.countries[0].sources = []; });
  assert.ok(!r.ok);
  assert.match(r.out, /sources empty/);
});
