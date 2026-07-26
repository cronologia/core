'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  layoutChronologySpine, renderChronologySpine, renderPage, UI,
} = require('../build.js');

const ev = (year, dateVerified) => ({
  year, date: String(year), dateVerified, place: 'X', title: 'T', text: 't', sources: [],
});

/* -------------------------------------------------------------------------
 * The optional-feature contract: absent key must change nothing.
 * ---------------------------------------------------------------------- */

test('absent chronologySpine key renders nothing', () => {
  assert.strictEqual(renderChronologySpine(undefined, [ev(1970)], UI.en), '');
  assert.strictEqual(renderChronologySpine(null, [ev(1970)], UI.en), '');
});

test('present key but no events with a year renders nothing', () => {
  assert.strictEqual(renderChronologySpine({}, [], UI.en), '');
  assert.strictEqual(renderChronologySpine({}, [{ title: 'no year' }], UI.en), '');
});

test('a page without the key is byte-identical to one built before the feature', () => {
  const base = {
    meta: { title: 'T', subtitle: 'S', description: 'D', lastUpdated: '2026-01-01', language: 'en', dataQualityNote: 'n' },
    facts: [], events: [ev(1970), ev(1971)], figures: [], organizations: [],
    disambiguation: { items: [] }, references: [],
  };
  const without = renderPage(base, {}, { lang: 'en' });
  assert.ok(!without.includes('chronology-spine'));
  const with_ = renderPage({ ...base, chronologySpine: {} }, {}, { lang: 'en' });
  assert.ok(with_.includes('chronology-spine'));
  // Removing the section from the enabled build recovers the disabled build.
  const stripped = with_.replace(/    <section id="chronology-spine"[\s\S]*?<\/section>\n\n/, '')
    .replace(/\n      <a href="#chronology-spine">[^<]*<\/a>/, '');
  assert.strictEqual(stripped, without);
});

/* -------------------------------------------------------------------------
 * Bucketing and scale.
 * ---------------------------------------------------------------------- */

test('buckets by decade and scales bars against the busiest decade', () => {
  const l = layoutChronologySpine({}, [ev(1970), ev(1972), ev(1975), ev(1981)]);
  const cols = l.cells.filter((c) => c.type === 'decade');
  assert.strictEqual(cols.length, 2);
  assert.strictEqual(cols[0].decade, 1970);
  assert.strictEqual(cols[0].total, 3);
  assert.strictEqual(cols[0].pct, 100);          // busiest decade is full height
  assert.strictEqual(cols[1].total, 1);
  assert.ok(Math.abs(cols[1].pct - 33.3) < 0.1); // 1/3 of the max
  assert.strictEqual(l.totalEvents, 4);
  assert.strictEqual(l.span, '1970–1981');
});

/* -------------------------------------------------------------------------
 * Gaps: the property that stops a 380-year hole reading as ordinary spacing.
 * ---------------------------------------------------------------------- */

test("perennialism's 380-year gap collapses into ONE labelled break", () => {
  const l = layoutChronologySpine({}, [ev(1540), ev(1921), ev(1925), ev(1933)]);
  const breaks = l.cells.filter((c) => c.type === 'break');
  assert.strictEqual(breaks.length, 1);
  assert.strictEqual(breaks[0].count, 37);   // 1550s..1910s inclusive
  assert.strictEqual(breaks[0].from, 1550);
  assert.strictEqual(breaks[0].to, 1919);
  // and it did NOT emit 38 empty columns
  assert.strictEqual(l.cells.filter((c) => c.type === 'decade').length, 3);
});

test("fsspx's continuous span produces NO break", () => {
  const years = [1969, 1971, 1985, 1995, 2005, 2015, 2025];
  const l = layoutChronologySpine({}, years.map((y) => ev(y)));
  assert.strictEqual(l.breaks, 0);
});

test('a short gap keeps its true width instead of collapsing', () => {
  // one empty decade, threshold 2 -> drawn as a real empty column
  const l = layoutChronologySpine({}, [ev(1970), ev(1990)]);
  assert.strictEqual(l.breaks, 0);
  const empty = l.cells.filter((c) => c.type === 'decade' && c.total === 0);
  assert.strictEqual(empty.length, 1);
  assert.strictEqual(empty[0].decade, 1980);
});

test('collapseAfter is configurable', () => {
  const events = [ev(1900), ev(1940)]; // three empty decades between
  assert.strictEqual(layoutChronologySpine({ collapseAfter: 5 }, events).breaks, 0);
  assert.strictEqual(layoutChronologySpine({ collapseAfter: 2 }, events).breaks, 1);
});

test('the break label names both the count and the year range', () => {
  const html = renderChronologySpine({}, [ev(1540), ev(1921)], UI.en);
  assert.match(html, /37 decades with no recorded events \(1550–1919\)/);
});

/* -------------------------------------------------------------------------
 * Unverified dates stay visibly unverified.
 * ---------------------------------------------------------------------- */

test('unverified events get their own hatched segment and are named', () => {
  const html = renderChronologySpine({}, [ev(1970), ev(1971, false), ev(1972, false)], UI.en);
  assert.match(html, /class="cs-unverified"/);
  assert.match(html, /2 with an unverified date/);
  assert.match(html, /2 with a date not yet verified against a primary source/);
});

test('no unverified events means no hatch and no unverified wording', () => {
  const html = renderChronologySpine({}, [ev(1970), ev(1971)], UI.en);
  assert.ok(!html.includes('cs-unverified'));
  assert.ok(!/unverified/.test(html));
});

test('the unverified segment is a share of its own bar, not of the chart', () => {
  // busiest decade = 4 events; the 1980s bar has 1 of 2 unverified -> 50% of ITS bar
  const l = layoutChronologySpine({}, [
    ev(1970), ev(1971), ev(1972), ev(1973), ev(1980), ev(1981, false),
  ]);
  const d80 = l.cells.find((c) => c.decade === 1980);
  assert.strictEqual(d80.total, 2);
  assert.strictEqual(d80.unverified, 1);
  const shareOfOwnBar = (d80.uPct / d80.pct) * 100;
  assert.ok(Math.abs(shareOfOwnBar - 50) < 0.01, `expected 50%, got ${shareOfOwnBar}`);
});

/* -------------------------------------------------------------------------
 * Accessibility and linking.
 * ---------------------------------------------------------------------- */

test('every bar is a link to its decade anchor, and the anchor exists', () => {
  const data = {
    meta: { title: 'T', subtitle: 'S', description: 'D', lastUpdated: '2026-01-01', language: 'en', dataQualityNote: 'n' },
    facts: [], events: [ev(1970), ev(1985)], figures: [], organizations: [],
    disambiguation: { items: [] }, references: [], chronologySpine: {},
  };
  const html = renderPage(data, {}, { lang: 'en' });
  for (const d of [1970, 1980]) {
    assert.ok(html.includes(`href="#decade-${d}"`), `missing link for ${d}`);
    assert.ok(html.includes(`id="decade-${d}"`), `missing anchor for ${d}`);
  }
});

test('counts are printed as text, so nothing depends on colour alone', () => {
  const html = renderChronologySpine({}, [ev(1970), ev(1971), ev(1980)], UI.en);
  assert.match(html, /<span class="cs-count">2<\/span>/);
  assert.match(html, /<span class="cs-count">1<\/span>/);
});

test('each column carries a text label for screen readers', () => {
  const html = renderChronologySpine({}, [ev(1970)], UI.en);
  assert.match(html, /class="visually-hidden">1970s: 1 event</);
});

test('singular and plural are both handled', () => {
  const html = renderChronologySpine({}, [ev(1970), ev(1980), ev(1981)], UI.en);
  assert.match(html, /1970s: 1 event[,<]/);
  assert.match(html, /1980s: 2 events/);
});

/* -------------------------------------------------------------------------
 * Placement and i18n.
 * ---------------------------------------------------------------------- */

test('the figure sits at the TOP of main, before the about section', () => {
  const data = {
    meta: { title: 'T', subtitle: 'S', description: 'D', lastUpdated: '2026-01-01', language: 'en', dataQualityNote: 'n' },
    facts: [], events: [ev(1970)], figures: [], organizations: [],
    disambiguation: { items: [] }, references: [], chronologySpine: {},
  };
  const html = renderPage(data, {}, { lang: 'en' });
  const spine = html.indexOf('id="chronology-spine"');
  const about = html.indexOf('id="about"');
  const chrono = html.indexOf('id="chronology"');
  assert.ok(spine > 0 && about > 0);
  assert.ok(spine < about, 'spine must come before #about');
  assert.ok(spine < chrono, 'spine must come before #chronology');
});

test('all three locales carry the spine strings', () => {
  for (const lang of ['en', 'es', 'pt']) {
    const t = UI[lang];
    assert.ok(t.spineHeading, `${lang} spineHeading`);
    assert.ok(t.spineNav, `${lang} spineNav`);
    assert.ok(t.spineIntro, `${lang} spineIntro`);
    assert.strictEqual(typeof t.spineBreakLabel, 'function', `${lang} spineBreakLabel`);
    assert.strictEqual(typeof t.spineColLabel, 'function', `${lang} spineColLabel`);
    assert.strictEqual(typeof t.spineCaption, 'function', `${lang} spineCaption`);
    const html = renderChronologySpine({}, [ev(1970), ev(1971, false)], t);
    assert.ok(html.includes(t.spineHeading), `${lang} heading not rendered`);
  }
});

test('heading, navLabel and note can be overridden per project', () => {
  const html = renderChronologySpine({ heading: 'Custom H', note: 'Custom note' }, [ev(1970)], UI.en);
  assert.match(html, /Custom H/);
  assert.match(html, /Custom note/);
  assert.ok(!html.includes(UI.en.spineHeading));
});

test('project-supplied strings are escaped', () => {
  const html = renderChronologySpine({ heading: '<script>x</script>' }, [ev(1970)], UI.en);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});
