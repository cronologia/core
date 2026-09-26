'use strict';
// Years before the common era (cronologia/cristo). A negative `year` is that
// many years BCE (-4 is 4 BCE) and there is no year 0, so the chronological
// sort stays numeric. These tests pin the display labels and run the REAL
// validator against a scratch copy, so what is tested is the gate CI relies on.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { yearLabel, decadeLabel, decadeOf, spanLabel, UI } = require('../build.js');

const ROOT = path.join(__dirname, '..');
const BASE_FILE = ['chronology.example.json', 'chronology.json']
  .map((f) => path.join(ROOT, 'data', f))
  .find((p) => fs.existsSync(p));
const base = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));

test('common-era years render exactly as before', () => {
  assert.equal(yearLabel(1989), '1989');
  assert.equal(yearLabel(30), '30');
  assert.equal(decadeLabel(1990), '1990s');
  assert.equal(decadeOf(1917), '1910s');
  assert.equal(spanLabel({ spanFrom: 1882, spanTo: 2024 }, UI.en), '1882–2024');
});

test('negative years render as BCE, localized', () => {
  assert.equal(yearLabel(-4), '4 BCE');
  assert.equal(yearLabel(-4, UI.es), '4 a. C.');
  assert.equal(yearLabel(-4, UI.pt), '4 a.C.');
  assert.equal(spanLabel({ spanFrom: -6, spanTo: 2026 }, UI.en), '6 BCE–2026');
});

test('a negative decade bucket names its BCE years', () => {
  // Bucket -10 holds the years -10..-1, i.e. 10 BCE to 1 BCE.
  assert.equal(decadeLabel(-10), '10–1 BCE');
  assert.equal(decadeOf(-4), '10–1 BCE');
  assert.equal(decadeOf(-4, UI.es), '10–1 a. C.');
});

test('every locale defines the BCE suffix', () => {
  for (const [loc, ui] of Object.entries(UI)) {
    assert.equal(typeof ui.bce, 'string', `UI.${loc}.bce missing`);
    assert.ok(ui.bce.length > 0, `UI.${loc}.bce empty`);
  }
});

function runValidator(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-test-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.copyFileSync(path.join(ROOT, 'build.js'), path.join(dir, 'build.js'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'validate-data.js'), path.join(dir, 'scripts', 'validate-data.js'));
  if (fs.existsSync(path.join(ROOT, 'data', 'glossary-terms.json'))) fs.copyFileSync(path.join(ROOT, 'data', 'glossary-terms.json'), path.join(dir, 'data', 'glossary-terms.json'));
  if (fs.existsSync(path.join(ROOT, 'src', 'latam.svg'))) fs.copyFileSync(path.join(ROOT, 'src', 'latam.svg'), path.join(dir, 'src', 'latam.svg'));
  const places = path.join(ROOT, 'data', 'places.json');
  if (fs.existsSync(places)) fs.copyFileSync(places, path.join(dir, 'data', 'places.json'));
  const d = JSON.parse(JSON.stringify(base));
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

test('the validator accepts BCE years', () => {
  const r = runValidator((d) => { d.events[0].year = -4; delete d.events[0].date; });
  assert.ok(r.ok, r.out);
});

test('the validator rejects year 0', () => {
  const r = runValidator((d) => { d.events[0].year = 0; delete d.events[0].date; });
  assert.equal(r.ok, false);
  assert.match(r.out, /there is no year 0/);
});

test('the validator still rejects implausible years', () => {
  assert.equal(runValidator((d) => { d.events[0].year = -500; }).ok, false);
  assert.equal(runValidator((d) => { d.events[0].year = 2200; }).ok, false);
});
