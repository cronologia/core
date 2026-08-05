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
    // The provenance prose these repos actually write NAMES the script in order
    // to deny it. A substring match reports the exact opposite of the sentence.
    { generatedBy: 'hand-authored by the assistant (Claude) during the 2026-08-05 bootstrap — NOT produced by scripts/translate.js' },
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

/* The approval ladder — how far a reported apparition got through Church judgment.
 *
 * The rules under test are the ones that keep the chart from laundering
 * uncertainty: an unknown status is a build failure, an uncited rung is a build
 * failure, and the three kinds of "nothing here" stay apart. See the renderer's
 * header for why each matters. */
const { renderApprovalLadder, ladderRungs, STATUS_GLYPH } = require('../build.js');

const NUMS = new Map([['decree', 1], ['news', 2]]);
const rung = (o) => Object.assign({ label: 'Diocesan inquiry', status: 'favourable', sources: ['decree'] }, o);
const ladder = (...stages) => ({ stages });

test('approval ladder: absent, empty or stage-less data renders nothing', () => {
  assert.equal(renderApprovalLadder(undefined, NUMS, UI.en), '');
  assert.equal(renderApprovalLadder({}, NUMS, UI.en), '');
  assert.equal(renderApprovalLadder({ stages: [] }, NUMS, UI.en), '');
});

test('approval ladder: an unknown status fails the build, and names the legal set', () => {
  assert.throws(
    () => ladderRungs(ladder(rung({ status: 'approved' }))),
    /unknown status "approved".*favourable/s);
  // A missing status is just as wrong as a wrong one.
  assert.throws(() => ladderRungs(ladder(rung({ status: undefined }))), /unknown status/);
  assert.throws(() => ladderRungs(ladder({ status: 'favourable' })), /needs a label/);
});

test('approval ladder: a rung with an outcome but no citation fails the build', () => {
  for (const status of ['favourable', 'negative', 'inconclusive', 'reported-undocumented', 'pending']) {
    assert.throws(
      () => ladderRungs(ladder({ label: 'Rome', status })),
      /no sources and no.*noDocument/s, `status ${status} must require evidence`);
    // Either a citation OR an explicit "what was searched" note satisfies it.
    assert.ok(ladderRungs(ladder({ label: 'Rome', status, sources: ['decree'] })));
    assert.ok(ladderRungs(ladder({ label: 'Rome', status, noDocument: 'Searched the AAS index; nothing.' })));
  }
});

test('approval ladder: the two "nothing here" statuses must say what was searched', () => {
  for (const status of ['not-found', 'not-reached']) {
    // Citations alone do NOT excuse them — a bare absence is the claim at issue.
    assert.throws(
      () => ladderRungs(ladder({ label: 'Rome', status, sources: ['decree'] })),
      /must carry a noDocument note/);
    assert.ok(ladderRungs(ladder({ label: 'Rome', status, noDocument: 'Searched the AAS 1930–1950.' })));
  }
});

test('approval ladder: "not found" and "not reached" stay distinguishable in the output', () => {
  // Same glyph is fine; the same RENDERED CLAIM is not. One is about our
  // evidence, the other about the case, and a reader must be able to tell.
  const notFound = renderApprovalLadder(
    ladder({ label: 'Rome', status: 'not-found', noDocument: 'x' }), NUMS, UI.en);
  const notReached = renderApprovalLadder(
    ladder({ label: 'Rome', status: 'not-reached', noDocument: 'x' }), NUMS, UI.en);
  assert.match(notFound, /al-not-found/);
  assert.match(notReached, /al-not-reached/);
  assert.notEqual(
    UI.en.ladderStatus['not-found'], UI.en.ladderStatus['not-reached']);
  for (const lang of ['es', 'pt']) {
    assert.notEqual(UI[lang].ladderStatus['not-found'], UI[lang].ladderStatus['not-reached'],
      `${lang} must not collapse the two absences`);
  }
});

test('approval ladder: never emits an overall verdict for the case', () => {
  // La Salette: apparition approved 1851, expanded secrets condemned 1915.
  // Any single summary badge would have to misreport one of them.
  const html = renderApprovalLadder(ladder(
    rung({ label: 'Bishop of Grenoble', status: 'favourable', when: '1851' }),
    rung({ label: 'Holy Office (the secrets)', status: 'negative', when: '1915', sources: ['decree'] }),
  ), NUMS, UI.en);
  assert.match(html, /al-favourable/);
  assert.match(html, /al-negative/);
  // Two rungs, two verdicts, no roll-up element.
  assert.equal((html.match(/al-rung/g) || []).length, 2);
  assert.doesNotMatch(html, /al-verdict|al-overall|al-summary/);
});

test('approval ladder: status is carried as text, never by colour alone', () => {
  const html = renderApprovalLadder(ladder(rung({ status: 'negative', sources: ['decree'] })), NUMS, UI.en);
  assert.match(html, /Investigated — concluded against/);
  assert.match(html, /al-glyph[^>]*>✗/);
  assert.match(html, /#ref-1/);           // the act is linked, not just asserted
});

test('approval ladder: every status has a glyph and a label in all three locales', () => {
  for (const status of Object.keys(STATUS_GLYPH)) {
    assert.ok(STATUS_GLYPH[status], `${status} has no glyph`);
    for (const lang of ['en', 'es', 'pt']) {
      assert.ok(UI[lang].ladderStatus[status], `${lang} has no label for ${status}`);
    }
  }
});

test('approval ladder: localization translates the prose and leaves the enum alone', () => {
  // `status` is in TRANSLATABLE_KEYS for other datasets. Without the subtree
  // allowlist the walk translates 'favourable' into the dictionary's value and
  // the localized build then dies on "unknown status" — a bug that would only
  // ever have appeared on the es/pt pages, never on the English one.
  const data = {
    approvalLadder: {
      stages: [{ label: 'Diocesan inquiry', status: 'favourable', who: 'The bishop', outcome: 'Approved.', sources: ['d'] }],
    },
  };
  const dict = {
    'Diocesan inquiry': 'Investigación diocesana',
    'The bishop': 'El obispo',
    'Approved.': 'Aprobada.',
    favourable: 'NO — this must never be applied',
  };
  const out = localizeData(data, dict, 'es');
  const rung = out.approvalLadder.stages[0];
  assert.equal(rung.status, 'favourable', 'the enum must survive localization verbatim');
  assert.equal(rung.label, 'Investigación diocesana');
  assert.equal(rung.who, 'El obispo');
  assert.equal(rung.outcome, 'Aprobada.');
  // And the localized data must still render, which is the failure this guards.
  assert.ok(renderApprovalLadder(out.approvalLadder, new Map([['d', 1]]), UI.es));
});
