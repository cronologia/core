'use strict';
/* Ribbon key-event labels and the print block (core#3). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { layoutRiver, renderRiverRibbon, TRANSLATABLE_KEYS, UI } = require('../build.js');

const ROOT = path.join(__dirname, '..');
const evs = [1900, 1910, 1950, 1990, 2020].map((year, i) => ({ year, title: `E${i}`, dateVerified: true, sources: ['r'] }));

test('without highlights the ribbon has no label row', () => {
  const svg = renderRiverRibbon(layoutRiver(evs, undefined), UI.en);
  assert.doesNotMatch(svg, /rv-hl/);
  assert.match(svg, /<rect class="rv-row" x="0" y="2"/, 'lanes start at the top');
});

test('a highlighted event is named above the lanes, and marked through them', () => {
  const withHl = evs.map((e, i) => (i === 2 ? { ...e, highlight: 'Turning point' } : e));
  const svg = renderRiverRibbon(layoutRiver(withHl, undefined), UI.en);
  assert.match(svg, /<text class="rv-hl" x="[\d.]+" y="10" text-anchor="middle">Turning point<\/text>/);
  assert.match(svg, /<line class="rv-hl-tick" data-i="2"/);
  assert.match(svg, /<rect class="rv-row" x="0" y="15"/, 'the lanes move down to make room');
  assert.ok(TRANSLATABLE_KEYS.has('highlight'), 'the label is translated like other prose');
});

test('the validator keeps highlights few and short', () => {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'chronology.example.json'), 'utf8'));
  d.events[0].highlight = 'A label far too long for the ribbon row';
  while (d.events.length < 7) d.events.push({ ...d.events[1] });
  d.events.slice(1, 8).forEach((e, i) => { d.events[i + 1] = { ...e, highlight: `K${i}` }; });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-'));
  fs.mkdirSync(path.join(dir, 'scripts')); fs.mkdirSync(path.join(dir, 'data'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'validate-data.js'), path.join(dir, 'scripts', 'validate-data.js'));
  fs.copyFileSync(path.join(ROOT, 'build.js'), path.join(dir, 'build.js'));
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'data', 'glossary-terms.json'), path.join(dir, 'data', 'glossary-terms.json'));
  fs.writeFileSync(path.join(dir, 'data', 'chronology.json'), JSON.stringify(d));
  let out = '';
  try { execFileSync(process.execPath, ['scripts/validate-data.js'], { cwd: dir, stdio: 'pipe' }); } catch (e) { out = `${e.stdout}${e.stderr}`; }
  fs.rmSync(dir, { recursive: true, force: true });
  assert.match(out, /events\[0\]\.highlight must be a short label/);
  assert.match(out, /7 highlighted; the ribbon names at most 6/);
});

test('on paper, references print their addresses and headings never end a page', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8');
  const block = css.slice(css.indexOf('Print (core#3)'));
  assert.match(block, /ol\.references a\.archive-link::after \{\s*content: " <" attr\(href\) ">"/);
  assert.match(block, /h2, h3 \{ break-after: avoid/);
});
