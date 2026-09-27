'use strict';
/* Look and feel (core#118): the self-hosted text face and the palette derived
 * from one accent. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8');

test('every font file the stylesheet references ships in src/fonts, with its licence', () => {
  const urls = [...css.matchAll(/url\('fonts\/([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 6, 'regular, italic and semibold in two subsets');
  for (const f of urls) assert.ok(fs.existsSync(path.join(ROOT, 'src', 'fonts', f)), `src/fonts/${f} missing`);
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'fonts', 'OFL.txt')), 'the SIL OFL travels with the fonts');
});

test('fonts are self-hosted and never block rendering', () => {
  assert.doesNotMatch(css, /fonts\.googleapis|fonts\.gstatic|@import/, 'no third-party font CDN');
  const faces = css.match(/@font-face \{[^}]*\}/g) || [];
  assert.ok(faces.length && faces.every((f) => /font-display: swap/.test(f) && /unicode-range/.test(f)));
});

test('the dark shade and soft tint derive from --accent, with the declared values as fallback', () => {
  const block = css.slice(css.indexOf('Look and feel (core#118)'));
  assert.match(block, /@supports \(color: oklch\(from red l c h\)\) \{\s*:root \{\s*--accent-dark: oklch\(from var\(--accent\)/);
  assert.match(block, /--accent-soft: oklch\(from var\(--accent\) \.94/);
  // The site's own :root declarations remain above as the fallback.
  assert.ok(css.indexOf('--accent-dark:') < css.indexOf('Look and feel (core#118)'));
});

test('only running prose takes the serif; chrome stays in the system face', () => {
  assert.match(css, /body \{[^}]*font-family: -apple-system/);
  const rule = css.match(/\n([^{}]+)\{\s*font-family: var\(--font-text\)/);
  assert.ok(rule, 'a prose selector list sets the text face');
  for (const chrome of ['nav', 'h1', 'h2', 'h3', 'table', '.rv-year', '.ref-meta']) {
    assert.ok(!rule[1].split(',').map((s) => s.trim()).includes(chrome), `${chrome} must stay in the UI face`);
  }
});
