'use strict';
/* Citation previews (core#119): the page loads src/cite.js with localized
 * labels whenever it has references, the build ships the script, and the
 * stylesheet carries the block. The popover's behaviour (open, place inside
 * the viewport, Esc and focus return, modified clicks untouched) was checked
 * in Chromium for core#119; these pin the static contract. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderPage, renderReference, UI } = require('../build.js');

const ROOT = path.join(__dirname, '..');
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'chronology.example.json'), 'utf8'));

test('a page with references loads cite.js with its localized labels', () => {
  for (const [lang, label, all] of [['en', 'Reference', 'All references'], ['es', 'Referencia', 'Todas las referencias'], ['pt', 'Referência', 'Todas as referências']]) {
    const html = renderPage(base, {}, { lang });
    assert.match(html, new RegExp(`<script src="\\.\\./cite\\.js" defer data-label="${label}" data-all="${all}"></script>`), lang);
  }
});

test('a page without references does not load it', () => {
  // renderPage needs a references array; an empty one is the no-citation case.
  const html = renderPage({ ...base, references: [], events: base.events.map((e) => ({ ...e, sources: [] })), facts: [], figures: [], organizations: [] }, {}, { lang: 'en' });
  assert.doesNotMatch(html, /cite\.js/);
});

test('the archive-copy label is localized, not hardcoded English', () => {
  const ref = { id: 'x', title: 'T', url: 'https://e.org', publisher: 'P', type: 'web' };
  const archives = { 'https://e.org': { archiveUrl: 'https://web.archive.org/web/2026/https://e.org', timestamp: '20260101000000' } };
  assert.match(renderReference(ref, 1, archives, UI.es), /🗄 archivado/);
  assert.match(renderReference(ref, 1, archives, UI.pt), /🗄 arquivado/);
  assert.match(renderReference(ref, 1, archives, UI.en), /🗄 archived/);
});

test('cite.js and its stylesheet block ship with the template', () => {
  const js = fs.readFileSync(path.join(ROOT, 'src', 'cite.js'), 'utf8');
  assert.match(js, /togglePopover/, 'feature-detects the Popover API');
  assert.match(js, /metaKey \|\| e\.ctrlKey/, 'leaves modified clicks to the link');
  const css = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8');
  assert.match(css, /Citation previews \(core#119\)/);
  assert.match(css, /@media print \{ \.cite-pop \{ display: none/);
});
