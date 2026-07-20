'use strict';
// Unit tests for the offline helpers of scripts/check-links.js: title parsing,
// the soft-404 heuristic, status classification, the Wayback-availability
// parser, and the archive-priority rule. No network is touched.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  deriveUserAgent, extractTitle, decodeEntities, titleTokens, titleSimilarity,
  looksLikeNotFound, isSoftRedirect, classifyStatus, parseWaybackAvailable,
  isPriorityArchive, summarize, toMarkdown,
} = require('../scripts/check-links.js');

// ---- User-Agent ------------------------------------------------------------

test('deriveUserAgent names the project and has a contact URL', () => {
  assert.match(deriveUserAgent('RCC Brasil'), /^cronologia-check-links\/1\.0 \(RCC Brasil; \+https:\/\/github\.com\/cronologia\)$/);
  assert.match(deriveUserAgent(''), /Cronologia project/);
  assert.match(deriveUserAgent(undefined), /Cronologia project/);
});

// ---- title parsing ---------------------------------------------------------

test('extractTitle pulls and normalizes the first <title>', () => {
  assert.equal(extractTitle('<html><head><title>  Hello\n  World </title></head>'), 'Hello World');
  assert.equal(extractTitle('<TITLE>Case &amp; Entities &#39;ok&#39;</TITLE>'), "Case & Entities 'ok'");
  assert.equal(extractTitle('<title data-x="1">Attr title</title>'), 'Attr title');
  assert.equal(extractTitle('<p>no title here</p>'), '');
  assert.equal(extractTitle(null), '');
});

test('decodeEntities handles the common title entities', () => {
  assert.equal(decodeEntities('a &amp; b &mdash; c &nbsp;d'), 'a & b — c  d');
});

// ---- similarity ------------------------------------------------------------

test('titleTokens drops short words and stopwords', () => {
  assert.deepEqual([...titleTokens('The History of the Renewal')].sort(), ['history', 'renewal']);
});

test('titleSimilarity measures shared tokens against the smaller set', () => {
  assert.equal(titleSimilarity('History of the Renewal', 'The Renewal History — Home'), 1);
  assert.equal(titleSimilarity('Charismatic Renewal Brazil', 'Buy cheap domains now'), 0);
  assert.equal(titleSimilarity('', 'anything'), null, 'no usable tokens => null');
  assert.equal(titleSimilarity('Renewal', ''), null);
});

// ---- not-found / soft-404 --------------------------------------------------

test('looksLikeNotFound spots generic error/parking pages', () => {
  assert.equal(looksLikeNotFound('404 Not Found'), true);
  assert.equal(looksLikeNotFound('Page not found'), true);
  assert.equal(looksLikeNotFound('This domain is for sale'), true);
  assert.equal(looksLikeNotFound('Access Denied'), true);
  assert.equal(looksLikeNotFound('History of the Charismatic Renewal'), false);
  assert.equal(looksLikeNotFound(''), false);
});

test('isSoftRedirect flags redirects to unrelated content but not clean same-URL pages', () => {
  // Redirect to a page whose title no longer matches -> suspect.
  assert.equal(isSoftRedirect({ redirected: true, expectedTitle: 'Grupo de Puebla — Declaración', actualTitle: 'Inicio | Portal' }), true);
  // Redirect to a matching title -> fine.
  assert.equal(isSoftRedirect({ redirected: true, expectedTitle: 'Grupo de Puebla Declaración', actualTitle: 'Declaración del Grupo de Puebla' }), false);
  // Not-found title even without a redirect -> suspect.
  assert.equal(isSoftRedirect({ redirected: false, expectedTitle: 'X', actualTitle: '404 Not Found' }), true);
  // Same URL, no title to compare -> never cry wolf.
  assert.equal(isSoftRedirect({ redirected: true, expectedTitle: 'X', actualTitle: '' }), false);
  assert.equal(isSoftRedirect({ redirected: false, expectedTitle: 'X', actualTitle: 'Y' }), false);
});

// ---- status classification -------------------------------------------------

test('classifyStatus treats 403/429/5xx as inconclusive, real 4xx as dead', () => {
  assert.equal(classifyStatus(200), 'ok');
  assert.equal(classifyStatus(204), 'ok');
  assert.equal(classifyStatus(301), 'ok'); // final 3xx (redirects are followed)
  assert.equal(classifyStatus(403), 'inconclusive');
  assert.equal(classifyStatus(429), 'inconclusive');
  assert.equal(classifyStatus(408), 'inconclusive');
  assert.equal(classifyStatus(500), 'inconclusive');
  assert.equal(classifyStatus(503), 'inconclusive');
  assert.equal(classifyStatus(404), 'dead');
  assert.equal(classifyStatus(410), 'dead');
  assert.equal(classifyStatus(0), 'inconclusive'); // network error / timeout
});

// ---- Wayback availability parsing ------------------------------------------

test('parseWaybackAvailable reads a snapshot and forces https', () => {
  const snap = parseWaybackAvailable({ archived_snapshots: { closest: { available: true, url: 'http://web.archive.org/web/2020/https://x.org', timestamp: '20200101000000' } } });
  assert.deepEqual(snap, { archiveUrl: 'https://web.archive.org/web/2020/https://x.org', timestamp: '20200101000000' });
  assert.equal(parseWaybackAvailable({ archived_snapshots: {} }), null);
  assert.equal(parseWaybackAvailable({ archived_snapshots: { closest: { available: false } } }), null);
  assert.equal(parseWaybackAvailable({}), null);
});

// ---- archive priority ------------------------------------------------------

test('isPriorityArchive = broken AND no snapshot', () => {
  assert.equal(isPriorityArchive('dead', false), true);
  assert.equal(isPriorityArchive('suspect', false), true);
  assert.equal(isPriorityArchive('dead', true), false, 'has a snapshot — not top priority');
  assert.equal(isPriorityArchive('ok', false), false);
  assert.equal(isPriorityArchive('inconclusive', false), false, 'inconclusive is never flagged dead');
});

// ---- report assembly -------------------------------------------------------

const sampleResults = [
  { id: 'a', url: 'https://ok.org', status: 200, verdict: 'ok', redirected: false, finalUrl: 'https://ok.org', note: '', snapshot: { exists: true, archiveUrl: 'https://web.archive.org/x' }, priorityArchive: false },
  { id: 'b', url: 'https://dead.org', status: 404, verdict: 'dead', redirected: false, finalUrl: 'https://dead.org', note: '', snapshot: { exists: false, archiveUrl: null }, priorityArchive: true },
  { id: 'c', url: 'https://blocked.org', status: 403, verdict: 'inconclusive', redirected: false, finalUrl: 'https://blocked.org', note: '', snapshot: { exists: true, archiveUrl: 'https://web.archive.org/y' }, priorityArchive: false },
];

test('summarize counts every verdict and the archive-priority total', () => {
  const s = summarize(sampleResults);
  assert.equal(s.total, 3);
  assert.equal(s.ok, 1);
  assert.equal(s.dead, 1);
  assert.equal(s.inconclusive, 1);
  assert.equal(s.priorityArchive, 1);
  assert.equal(s.flagged, 2, 'dead + suspect + inconclusive');
});

test('toMarkdown renders counts, the priority section, and a stable marker', () => {
  const md = toMarkdown({ project: 'Test', checkedAt: '2026-07-20T00:00:00Z', summary: summarize(sampleResults), results: sampleResults });
  assert.match(md, /# 🔗 Link health — Test/);
  assert.match(md, /Archive now \(broken, no snapshot\)/);
  assert.match(md, /https:\/\/dead\.org/);
  assert.match(md, /ARCHIVE NOW/);
  assert.match(md, /<!-- link-health-report -->/, 'stable marker for the upsert step');
});
