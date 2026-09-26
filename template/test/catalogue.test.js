'use strict';
// The object catalogue (renderCatalogue; first used by cronologia/cristo for
// the relics and where they are kept). These tests pin the layout (pins at the
// building, clustering of near neighbours), the rendered record (image with
// its attribution and licence link, the exact-location link, the honest
// "no free image" fallback), absence = byte-identical (ADR-0001), and run the
// REAL validator on scratch fixtures for the licence and file guards.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { layoutCatalogue, renderCatalogue, osmLink, UI } = require('../build.js');

const ROOT = path.join(__dirname, '..');
const BASE_FILE = ['chronology.example.json', 'chronology.json']
  .map((f) => path.join(ROOT, 'data', f))
  .find((p) => fs.existsSync(p));
const base = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));

const PLACES = {
  places: [
    { id: 'croce', name: 'Santa Croce in Gerusalemme, Rome', kind: 'site', lat: 41.8878, lon: 12.5160, precision: 'settlement', source: 'fixture' },
    { id: 'peter', name: "St Peter's Basilica, Vatican City", kind: 'site', lat: 41.9022, lon: 12.4539, precision: 'settlement', source: 'fixture' },
    { id: 'notre', name: 'Notre-Dame de Paris, Paris', kind: 'site', lat: 48.8530, lon: 2.3499, precision: 'settlement', source: 'fixture' },
    { id: 'nowhere', name: 'Lost', kind: 'non-geographic', precision: 'none' },
  ],
};
const WORLD = { d: 'M0 0 L1 1 Z' };
const IMG = {
  file: 'a.jpg', width: 800, height: 600, alt: 'An object', caption: 'The object, photographed in 2002.',
  credit: 'A. Photographer', license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg',
};
const CAT = {
  heading: 'Relics',
  items: [
    { id: 'cross', name: 'True Cross', site: 'Santa Croce in Gerusalemme, Rome', where: 'Chapel of the Relics, Rome', object: 'Wood fragments.', image: IMG, sources: ['r1'] },
    { id: 'lance', name: 'Holy Lance', site: "St Peter's Basilica, Vatican City", where: "St Peter's", sources: ['r1'] },
    { id: 'crown', name: 'Crown of Thorns', site: 'Notre-Dame de Paris, Paris', where: 'Notre-Dame', sources: ['r1'] },
    { id: 'lost', name: 'A lost relic', site: 'Lost', where: 'Unknown', sources: ['r1'] },
  ],
};
const REFS = new Map([['r1', 1]]);

test('absent catalogue renders nothing', () => {
  assert.equal(renderCatalogue(undefined, PLACES, WORLD, REFS, UI.en), '');
  assert.equal(layoutCatalogue({ items: [] }, PLACES), null);
});

test('objects kept close together share one marker; distant ones do not', () => {
  const l = layoutCatalogue(CAT, PLACES);
  assert.equal(l.pins.length, 2, 'Rome (two churches ~5 km apart) and Paris');
  const rome = l.pins.find((p) => p.members.length === 2);
  assert.deepEqual(rome.members.map((m) => m.n), [1, 2]);
  assert.equal(l.nonGeo, 1, 'a non-geographic site is counted, not mapped');
});

test('different cities never share a marker, however wide the map', () => {
  const places = { places: PLACES.places.concat([
    { id: 'turin', name: 'Turin Cathedral', kind: 'site', lat: 45.0733, lon: 7.6854, precision: 'building', source: 'fixture' },
    { id: 'genoa', name: 'Genoa Cathedral', kind: 'site', lat: 44.4076, lon: 8.9314, precision: 'building', source: 'fixture' },
    { id: 'yerevan', name: 'Etchmiadzin', kind: 'site', lat: 40.1613, lon: 44.2885, precision: 'building', source: 'fixture' },
  ]) };
  const cat = { items: [
    { id: 'a', name: 'A', site: 'Turin Cathedral', sources: ['r1'] },
    { id: 'b', name: 'B', site: 'Genoa Cathedral', sources: ['r1'] },
    { id: 'c', name: 'C', site: 'Etchmiadzin', sources: ['r1'] },
  ] };
  const l = layoutCatalogue(cat, places);
  assert.equal(l.pins.length, 3, 'Turin and Genoa are ~120 km apart: two markers, even at a Europe-to-Armenia extent');
});

test('a shared marker names each object with its own building', () => {
  const html = renderCatalogue(CAT, PLACES, WORLD, REFS, UI.en);
  assert.match(html, /1\. True Cross \(Santa Croce in Gerusalemme, Rome\); 2\. Holy Lance \(St Peter&#39;s Basilica, Vatican City\)/);
});

test('every marker is spelled out in a list linking each object', () => {
  const html = renderCatalogue(CAT, PLACES, WORLD, REFS, UI.en);
  assert.match(html, /<summary>Where each object is kept<\/summary>/);
  assert.match(html, /<li>Santa Croce in Gerusalemme, Rome · St Peter&#39;s Basilica, Vatican City: <a href="#item-cross">1\. True Cross<\/a>, <a href="#item-lance">2\. Holy Lance<\/a><\/li>/);
  assert.match(html, />×2<\/text>/, 'a cluster shows its count');
});

test('a neighbouring town ~10 km away keeps its own marker', () => {
  const places = { places: PLACES.places.concat([
    { id: 'arg', name: 'Argenteuil basilica', kind: 'site', lat: 48.9424, lon: 2.2465, precision: 'building', source: 'fixture' },
  ]) };
  const cat = { items: [
    { id: 'a', name: 'A', site: 'Notre-Dame de Paris, Paris', sources: ['r1'] },
    { id: 'b', name: 'B', site: 'Argenteuil basilica', sources: ['r1'] },
  ] };
  assert.equal(layoutCatalogue(cat, places).pins.length, 2);
});

test('each card carries its record, image attribution and exact location', () => {
  const html = renderCatalogue(CAT, PLACES, WORLD, REFS, UI.en);
  assert.match(html, /<section id="catalogue"/);
  assert.match(html, /id="item-cross"/);
  assert.match(html, /<img src="\.\.\/img\/a\.jpg" alt="An object" width="800" height="600"/);
  assert.match(html, /href="https:\/\/commons\.wikimedia\.org\/wiki\/File:A\.jpg"[^>]*>A\. Photographer<\/a>/);
  assert.match(html, /rel="license noopener">CC BY-SA 4\.0<\/a>/);
  assert.ok(html.includes(osmLink(PLACES.places[0]).replace(/&/g, '&amp;')), 'links the building on OpenStreetMap (HTML-escaped)');
  assert.match(html, /No freely licensed image of this object was located\./, 'honest fallback when there is no image');
  assert.match(html, /<dt>The object<\/dt><dd>Wood fragments\.<\/dd>/);
});

test('the catalogue speaks the page language', () => {
  const html = renderCatalogue(CAT, PLACES, WORLD, REFS, UI.pt);
  assert.match(html, /Conservado em/);
  assert.match(html, /Imagem: <a/);
});

function runValidator(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-test-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.mkdirSync(path.join(dir, 'src', 'img'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'build.js'), path.join(dir, 'build.js'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'validate-data.js'), path.join(dir, 'scripts', 'validate-data.js'));
  if (fs.existsSync(path.join(ROOT, 'data', 'glossary-terms.json'))) fs.copyFileSync(path.join(ROOT, 'data', 'glossary-terms.json'), path.join(dir, 'data', 'glossary-terms.json'));
  if (fs.existsSync(path.join(ROOT, 'src', 'latam.svg'))) fs.copyFileSync(path.join(ROOT, 'src', 'latam.svg'), path.join(dir, 'src', 'latam.svg'));
  fs.writeFileSync(path.join(dir, 'data', 'places.json'), JSON.stringify(PLACES));
  fs.writeFileSync(path.join(dir, 'src', 'img', 'a.jpg'), 'fixture');
  const d = JSON.parse(JSON.stringify(base));
  const ref = d.references[0].id;
  d.catalogue = JSON.parse(JSON.stringify(CAT));
  for (const it of d.catalogue.items) it.sources = [ref];
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

test('the validator accepts a well-formed catalogue', () => {
  const r = runValidator(() => {});
  assert.ok(r.ok, r.out);
});

test('the validator rejects a licence this site may not publish', () => {
  const r = runValidator((d) => { d.catalogue.items[0].image.license = 'CC BY-NC-SA 4.0'; });
  assert.equal(r.ok, false);
  assert.match(r.out, /not a free licence/);
});

test('the validator rejects a missing image file and missing attribution', () => {
  const r = runValidator((d) => { d.catalogue.items[0].image.file = 'missing.jpg'; delete d.catalogue.items[0].image.credit; });
  assert.equal(r.ok, false);
  assert.match(r.out, /src\/img\/missing\.jpg does not exist/);
  assert.match(r.out, /credit missing/);
});

test('the validator rejects a site that is not in the gazetteer', () => {
  const r = runValidator((d) => { d.catalogue.items[1].site = 'Somewhere Else'; });
  assert.equal(r.ok, false);
  assert.match(r.out, /is not in data\/places\.json/);
});
