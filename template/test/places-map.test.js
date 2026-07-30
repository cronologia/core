'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  placeIndex, resolvePlaceString, layoutPlacesMap, renderPlacesMap, renderPage, localizeData, UI,
} = require('../build.js');

const ev = (year, place, dateVerified) => ({
  year, date: String(year), dateVerified, place, title: 'T', text: 't', sources: [],
});

const GAZ = {
  places: [
    { id: 'topeka', name: 'Topeka, Kansas, USA', lat: 39.05, lon: -95.68, precision: 'settlement', source: 's', variants: ['Topeka'] },
    { id: 'los-angeles', name: 'Los Angeles, California, USA', lat: 34.05, lon: -118.24, precision: 'settlement', source: 's', variants: ['Los Angeles, USA'] },
    { id: 'rome', name: 'Rome', lat: 41.89, lon: 12.48, precision: 'settlement', source: 's', variants: ['Rome, Italy'] },
    { id: 'brazil', name: 'Brazil', lat: -10.33, lon: -53.2, precision: 'country-centroid', source: 's' },
    { id: 'worldwide', name: 'Worldwide', kind: 'non-geographic', source: 's' },
  ],
};

const WORLD = { viewBox: '0 0 360 180', d: 'M0 0 L1 1Z' };

/* -------------------------------------------------------------------------
 * The optional-feature contract: absent key must change nothing.
 * ---------------------------------------------------------------------- */

test('absent placesMap key renders nothing', () => {
  assert.strictEqual(renderPlacesMap(undefined, [ev(1901, 'Rome')], GAZ, WORLD, UI.en), '');
  assert.strictEqual(renderPlacesMap(null, [ev(1901, 'Rome')], GAZ, WORLD, UI.en), '');
});

test('present key but nothing mappable renders nothing', () => {
  assert.strictEqual(renderPlacesMap({}, [], GAZ, WORLD, UI.en), '');
  assert.strictEqual(renderPlacesMap({}, [ev(1901, 'Worldwide')], GAZ, WORLD, UI.en), '');
  assert.strictEqual(renderPlacesMap({}, [ev(1901, 'Rome')], null, WORLD, UI.en), '');
});

test('a page without the key is byte-identical to one built before the feature', () => {
  const base = {
    meta: { title: 'T', subtitle: 'S', description: 'D', lastUpdated: '2026-01-01', language: 'en', dataQualityNote: 'n' },
    facts: [], events: [ev(1901, 'Rome'), ev(1967, 'Topeka')], figures: [], organizations: [],
    disambiguation: { items: [] }, references: [],
  };
  const without = renderPage(base, {}, { lang: 'en', places: GAZ, world: WORLD });
  assert.ok(!without.includes('places-map'));
  const with_ = renderPage({ ...base, placesMap: {} }, {}, { lang: 'en', places: GAZ, world: WORLD });
  assert.ok(with_.includes('places-map'));
  const stripped = with_.replace(/    <section id="places-map"[\s\S]*?<\/section>\n\n/, '')
    .replace(/\n      <a href="#places-map">[^<]*<\/a>/, '');
  assert.strictEqual(stripped, without);
});

test('declared map with a missing basemap fails loudly, never silently', () => {
  assert.throws(() => renderPlacesMap({}, [ev(1901, 'Rome')], GAZ, null, UI.en), /world-land/);
  assert.throws(() => renderPlacesMap({}, [ev(1901, 'Rome')], GAZ, {}, UI.en), /world-land/);
});

/* -------------------------------------------------------------------------
 * Resolution: list-valued, compound-aware, variant-aware. The property that
 * stops "Topeka / Los Angeles, USA" from misplacing a movement's origin.
 * ---------------------------------------------------------------------- */

test('a compound place string resolves to every named place', () => {
  const idx = placeIndex(GAZ);
  assert.deepStrictEqual(resolvePlaceString('Topeka / Los Angeles, USA', idx).ids, ['topeka', 'los-angeles']);
  const layout = layoutPlacesMap({}, [ev(1901, 'Topeka / Los Angeles, USA')], GAZ);
  assert.strictEqual(layout.pins.length, 2);
  assert.strictEqual(layout.mappedEvents, 1);
});

test('name variants unify onto one marker, commas never split', () => {
  const idx = placeIndex(GAZ);
  assert.deepStrictEqual(resolvePlaceString('Rome, Italy', idx).ids, ['rome']);
  const layout = layoutPlacesMap({}, [ev(1901, 'Rome'), ev(1902, 'Rome, Italy')], GAZ);
  assert.strictEqual(layout.pins.length, 1);
  assert.strictEqual(layout.pins[0].count, 2);
  assert.strictEqual(layout.pins[0].firstYear, 1901);
});

test('unresolved place strings are counted, not dropped silently and not fatal', () => {
  const layout = layoutPlacesMap({}, [ev(1901, 'Rome'), ev(1902, 'Atlantis')], GAZ);
  assert.strictEqual(layout.pins.length, 1);
  assert.strictEqual(layout.unresolvedEvents, 1);
  assert.deepStrictEqual(layout.unresolvedStrings, ['Atlantis']);
  const html = renderPlacesMap({}, [ev(1901, 'Rome'), ev(1902, 'Atlantis')], GAZ, WORLD, UI.en);
  assert.ok(html.includes(UI.en.mapUnresolvedNote(1)));
});

/* -------------------------------------------------------------------------
 * Honest omissions and precision marks.
 * ---------------------------------------------------------------------- */

test('non-geographic scopes are not mapped and the caption says so', () => {
  const layout = layoutPlacesMap({}, [ev(1901, 'Rome'), ev(1902, 'Worldwide')], GAZ);
  assert.strictEqual(layout.pins.length, 1);
  assert.strictEqual(layout.nonGeoEvents, 1);
  const html = renderPlacesMap({}, [ev(1901, 'Rome'), ev(1902, 'Worldwide')], GAZ, WORLD, UI.en);
  assert.ok(html.includes(UI.en.mapNonGeoNote(1)));
});

test('country-centroid places render hollow (pm-approx), settlements do not', () => {
  const html = renderPlacesMap({}, [ev(1901, 'Rome'), ev(1969, 'Brazil')], GAZ, WORLD, UI.en);
  assert.ok(/pm-pin pm-approx/.test(html));
  assert.ok(html.includes(UI.en.mapLegendApprox));
  const romeOnly = renderPlacesMap({}, [ev(1901, 'Rome')], GAZ, WORLD, UI.en);
  assert.ok(!romeOnly.includes('pm-approx'));
});

test('an unverified first date renders dashed and is named in the label', () => {
  const html = renderPlacesMap({}, [ev(1969, 'Brazil', false), ev(1970, 'Brazil')], GAZ, WORLD, UI.en);
  assert.ok(/pm-unverified/.test(html));
  assert.ok(html.includes(UI.en.mapLegendUnverified));
  assert.ok(html.includes('(date not yet verified)'));
  // A later unverified event must NOT flag a place whose first date is solid.
  const solid = renderPlacesMap({}, [ev(1969, 'Brazil'), ev(1970, 'Brazil', false)], GAZ, WORLD, UI.en);
  assert.ok(!solid.includes('pm-unverified'));
});

/* -------------------------------------------------------------------------
 * Geometry and the year control.
 * ---------------------------------------------------------------------- */

test('the viewBox crops to the used places instead of showing the whole world', () => {
  const layout = layoutPlacesMap({}, [ev(1901, 'Rome')], GAZ);
  assert.notStrictEqual(layout.viewBox, '0 0 360 180');
  const [x, y, w, h] = layout.viewBox.split(' ').map(Number);
  // Rome at x = 192.48, y = 48.11 must sit inside the crop.
  assert.ok(x < 192.48 && 192.48 < x + w);
  assert.ok(y < 48.11 && 48.11 < y + h);
});

test('markers grow with event count (area, via radius)', () => {
  const layout = layoutPlacesMap({}, [ev(1901, 'Rome'), ev(1902, 'Rome'), ev(1903, 'Rome'), ev(1969, 'Topeka')], GAZ);
  const rome = layout.pins.find((p) => p.id === 'rome');
  const topeka = layout.pins.find((p) => p.id === 'topeka');
  assert.ok(rome.r > topeka.r);
});

test('the year control ships only when there is more than one first-year', () => {
  const multi = renderPlacesMap({}, [ev(1901, 'Rome'), ev(1969, 'Topeka')], GAZ, WORLD, UI.en);
  assert.ok(multi.includes('pm-controls'));
  assert.ok(multi.includes('<script>'));
  assert.ok(multi.includes(' hidden'), 'controls must be hidden until the script enables them');
  const single = renderPlacesMap({}, [ev(1901, 'Rome'), ev(1901, 'Topeka')], GAZ, WORLD, UI.en);
  assert.ok(!single.includes('pm-controls'));
  assert.ok(!single.includes('<script>'));
});

test('markers link to the first decade in the chronology', () => {
  const html = renderPlacesMap({}, [ev(1967, 'Topeka')], GAZ, WORLD, UI.en);
  assert.ok(html.includes('href="#decade-1960"'));
});

/* -------------------------------------------------------------------------
 * i18n: the section renders from the locale table.
 * ---------------------------------------------------------------------- */

test('pt/es locales render localized strings', () => {
  for (const lang of ['pt', 'es']) {
    const html = renderPlacesMap({}, [ev(1901, 'Rome'), ev(1969, 'Topeka')], GAZ, WORLD, UI[lang]);
    assert.ok(html.includes(UI[lang].mapHeading));
    assert.ok(html.includes(UI[lang].mapListHeading));
  }
});

/* -------------------------------------------------------------------------
 * i18n: the map must resolve identically in every locale.
 *
 * `place` is a translated field but the gazetteer is keyed on the canonical
 * English strings, so a localized build resolved on the DISPLAY string loses
 * markers — and its caption then reports the events as missing from the
 * gazetteer, which is false. Worse, a compound string keeps whichever half
 * survived translation, silently dropping the other pin. localizeData carries
 * the source string as `placeKey` for exactly this; these tests pin it.
 * ---------------------------------------------------------------------- */

test('localizeData keeps the canonical place string as placeKey', () => {
  const data = { meta: { language: 'en' }, events: [ev(1901, 'Rome'), ev(1902, 'Topeka / Los Angeles, USA')] };
  const dict = { Rome: 'Roma', 'Topeka / Los Angeles, USA': 'Topeka / Los Angeles, EUA' };
  const localized = localizeData(data, dict, 'pt');
  assert.strictEqual(localized.events[0].place, 'Roma');          // display is translated
  assert.strictEqual(localized.events[0].placeKey, 'Rome');       // lookup key is not
  assert.strictEqual(localized.events[1].placeKey, 'Topeka / Los Angeles, USA');
});

test('a translated place still maps, and the compound keeps BOTH pins', () => {
  const data = {
    meta: { language: 'en' }, placesMap: {},
    events: [ev(1901, 'Rome'), ev(1902, 'Topeka / Los Angeles, USA'), ev(1969, 'Brazil')],
  };
  const dict = {
    Rome: 'Roma', 'Topeka / Los Angeles, USA': 'Topeka / Los Angeles, EUA', Brazil: 'Brasil',
  };
  const en = layoutPlacesMap(data.placesMap, data.events, GAZ);
  const pt = layoutPlacesMap(data.placesMap, localizeData(data, dict, 'pt').events, GAZ);

  assert.deepStrictEqual(
    pt.pins.map((p) => p.id).sort(),
    en.pins.map((p) => p.id).sort(),
    'localized build must map the same places as English',
  );
  assert.ok(pt.pins.some((p) => p.id === 'los-angeles'), 'compound string lost its second pin when translated');
  assert.strictEqual(pt.unresolvedEvents, 0, 'translated places must not be reported as missing from the gazetteer');
  assert.strictEqual(pt.mappedEvents, en.mappedEvents);
});
