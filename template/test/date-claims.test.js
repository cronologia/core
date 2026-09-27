'use strict';
/* Disputed dates (core#120): attributed date claims on an event. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { renderDateClaims, TRANSLATABLE_KEYS, UI } = require('../build.js');

const ROOT = path.join(__dirname, '..');
const refs = new Map([['a', 1], ['b', 2]]);
const EV = {
  year: 30,
  dateClaims: [
    { year: 33, by: 'Humphreys and Waddington favour 33', sources: ['a'] },
    { year: 29, to: 30, by: 'A patristic tradition', sources: ['b'] },
  ],
};

test('no claims, or a single one, renders nothing', () => {
  assert.equal(renderDateClaims({ year: 30 }, refs, UI.en), '');
  assert.equal(renderDateClaims({ year: 30, dateClaims: [EV.dateClaims[0]] }, refs, UI.en), '');
});

test('claims render in date order, attributed and cited, with the span and the event marked', () => {
  const html = renderDateClaims(EV, refs, UI.es);
  assert.match(html, /Fechas en disputa <span>29–33<\/span>/);
  const order = [...html.matchAll(/<span class="rv-cyr">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(order, ['29–30', '33'], 'date order, ranges as ranges');
  assert.match(html, /A patristic tradition<sup class="cite"><a href="#ref-2"/);
  assert.match(html, /<i class="rv-cr" style="left:0%;width:25%"><\/i>/, 'the range 29-30 spans a quarter of 29-33');
  assert.match(html, /<i class="rv-ct" style="left:100%"><\/i>/);
  assert.match(html, /<b style="left:25%"><\/b>/, "the event's own year is marked");
});

test('`by` is translated like any other rendered prose', () => {
  assert.ok(TRANSLATABLE_KEYS.has('by'));
});

function validate(mutate) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'chronology.example.json'), 'utf8'));
  mutate(d);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-'));
  fs.mkdirSync(path.join(dir, 'scripts')); fs.mkdirSync(path.join(dir, 'data'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'validate-data.js'), path.join(dir, 'scripts', 'validate-data.js'));
  fs.copyFileSync(path.join(ROOT, 'build.js'), path.join(dir, 'build.js'));
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'data', 'glossary-terms.json'), path.join(dir, 'data', 'glossary-terms.json'));
  fs.writeFileSync(path.join(dir, 'data', 'chronology.json'), JSON.stringify(d));
  try { execFileSync(process.execPath, ['scripts/validate-data.js'], { cwd: dir, stdio: 'pipe' }); return ''; }
  catch (e) { return `${e.stdout}${e.stderr}`; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('the validator accepts well-formed claims around the event year', () => {
  assert.equal(validate((d) => {
    const ev = d.events[0]; const src = d.references[0].id;
    ev.dateClaims = [{ year: ev.year - 1, by: 'X', sources: [src] }, { year: ev.year + 1, by: 'Y', sources: [src] }];
  }), '');
});

test('the validator rejects a lone claim, an unattributed or unsourced one, and a year outside the claims', () => {
  const out = validate((d) => {
    const [a, b] = d.events; const src = d.references[0].id;
    a.dateClaims = [{ year: a.year, by: 'X', sources: [src] }];
    b.dateClaims = [{ year: b.year + 5, by: '', sources: [] }, { year: b.year + 9, to: b.year + 7, by: 'Y', sources: ['nope'] }];
  });
  assert.match(out, /events\[0\]\.dateClaims must list at least two claims/);
  assert.match(out, /events\[1\]\.dateClaims\[0\]\.by missing/);
  assert.match(out, /events\[1\]\.dateClaims\[0\]\.sources empty/);
  assert.match(out, /events\[1\]\.dateClaims\[1\]\.to must be/);
  assert.match(out, /events\[1\]\.dateClaims\[1\]\.sources: unknown reference id "nope"/);
  assert.match(out, /events\[1\]\.year \d+ lies outside its dateClaims/);
});
