'use strict';
// Invariants over the committed data + a smoke test of the full multi-locale
// render. Zero-dependency (node:test / node:assert). Falls back to the shipped
// example dataset so the template is self-testing before a project fills in its
// own data/chronology.json.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  renderPage, renderRootStub, renderSitemap, renderRobots,
  siteBase, localizeData, loadDict, LOCALES, ROUTES,
} = require('../build.js');

const ROOT = path.join(__dirname, '..');
function loadData() {
  for (const f of ['chronology.json', 'chronology.example.json']) {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8')); } catch { /* next */ }
  }
  throw new Error('no data/chronology.json or chronology.example.json');
}
const data = loadData();
function archives() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'archives.json'), 'utf8')).snapshots || {}; }
  catch { return {}; }
}

test('every sources[] entry resolves to a reference id or a URL', () => {
  const ids = new Set(data.references.map((r) => r.id));
  const check = (sources, at) => {
    for (const s of sources || []) assert.ok(ids.has(s) || /^https?:\/\//.test(s), `${at}: unknown source "${s}"`);
  };
  (data.facts || []).forEach((f, i) => check(f.sources, `facts[${i}]`));
  data.events.forEach((e, i) => check(e.sources, `events[${i}]`));
  data.figures.forEach((f, i) => check(f.sources, `figures[${i}]`));
  (data.organizations || []).forEach((o, i) => check(o.sources, `organizations[${i}]`));
});

test('reference ids are unique', () => {
  const seen = new Set();
  for (const r of data.references) { assert.ok(!seen.has(r.id), `duplicate reference id ${r.id}`); seen.add(r.id); }
});

test('events are dated plausibly and titled', () => {
  for (const e of data.events) {
    assert.ok(Number.isFinite(e.year) && e.year > 1500 && e.year < 2100, `bad year ${e.year}`);
    assert.ok(e.title && e.title.length > 3, `event ${e.year} missing title`);
    assert.equal(typeof e.dateVerified, 'boolean', `event "${e.title}" missing dateVerified`);
  }
});

test('every locale renders a full page with the right lang, SEO and disclaimer', () => {
  const base = siteBase(data.meta);
  for (const lang of LOCALES) {
    const localized = localizeData(data, loadDict(lang), lang);
    const html = renderPage(localized, archives(), { lang, base, route: '' });
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /G-R9LV1QZHVE/, `${lang}: analytics tag missing`);
    assert.match(html, new RegExp(`<html lang="${lang}"`), `${lang}: wrong <html lang>`);
    assert.match(html, /id="chronology"/);
    assert.match(html, /id="references"/);
    assert.ok(html.includes(`<link rel="canonical" href="${base}${lang}/">`), `${lang}: canonical missing`);
    for (const l of LOCALES) assert.ok(html.includes(`hreflang="${l}"`), `${lang}: hreflang ${l} missing`);
    assert.ok(html.includes('hreflang="x-default"'), `${lang}: x-default missing`);
    assert.ok(html.includes('application/ld+json'), `${lang}: JSON-LD missing`);
    assert.ok(html.includes('href="../styles.css"'), `${lang}: stylesheet path not locale-relative`);
    if (lang === 'en') assert.ok(!html.includes('i18n-disclaimer'), 'English page must not carry the disclaimer');
    else assert.match(html, /class="i18n-disclaimer"/, `${lang}: disclaimer missing`);
    for (const r of data.references) assert.ok(html.includes(r.url.replace(/&/g, '&amp;')), `${lang}: reference ${r.id} not rendered`);
  }
});

test('English render is the identity localization (chrome localized, content unchanged)', () => {
  // localizeData with the English (empty) dict must not alter any content value.
  const en = localizeData(data, loadDict('en'), 'en');
  assert.equal(JSON.stringify(en.events), JSON.stringify(data.events));
  assert.equal(JSON.stringify(en.references), JSON.stringify(data.references));
});

test('translation cache is applied where present', () => {
  const es = loadDict('es');
  const keys = Object.keys(es);
  if (keys.length === 0) return;
  const html = renderPage(localizeData(data, es, 'es'), {}, { lang: 'es', base: siteBase(data.meta), route: '' });
  const hit = keys.find((k) => JSON.stringify(data).includes(k));
  if (hit) assert.ok(html.includes(es[hit]), 'expected a Spanish translation to appear in the es page');
});

test('sitemap lists every route × locale with alternates; robots points to it', () => {
  const base = siteBase(data.meta);
  const sitemap = renderSitemap(base, ROUTES);
  assert.match(sitemap, /<\?xml/);
  assert.match(sitemap, /xmlns:xhtml=/);
  for (const route of ROUTES) for (const lang of LOCALES) {
    assert.ok(sitemap.includes(`<loc>${base}${lang}/${route}</loc>`), `sitemap missing ${lang}/${route}`);
  }
  assert.ok(renderRobots(base).includes(`Sitemap: ${base}sitemap.xml`));
});

test('root stub redirects and declares alternates (no page content)', () => {
  const stub = renderRootStub(siteBase(data.meta));
  assert.match(stub, /location\.replace/);
  assert.match(stub, /hreflang="x-default"/);
  assert.ok(!stub.includes('id="chronology"'), 'root stub should not contain page content');
});

// Drift: only when a project commits docs/ (the template ships source only).
test('committed docs/ is the current render (no drift)', () => {
  const docs = path.join(ROOT, 'docs');
  if (!fs.existsSync(path.join(docs, 'index.html'))) return;
  const base = siteBase(data.meta);
  assert.equal(fs.readFileSync(path.join(docs, 'index.html'), 'utf8'), renderRootStub(base), 'root stub drift — run node build.js');
  assert.equal(fs.readFileSync(path.join(docs, 'sitemap.xml'), 'utf8'), renderSitemap(base, ROUTES), 'sitemap drift — run node build.js');
  assert.equal(fs.readFileSync(path.join(docs, 'robots.txt'), 'utf8'), renderRobots(base), 'robots drift — run node build.js');
  for (const lang of LOCALES) {
    const f = path.join(docs, lang, 'index.html');
    assert.equal(fs.readFileSync(f, 'utf8'), renderPage(localizeData(data, loadDict(lang), lang), archives(), { lang, base, route: '' }), `docs/${lang}/ drift — run node build.js`);
  }
});
