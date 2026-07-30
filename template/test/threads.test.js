'use strict';
// The thread-lane taxonomy (core#23): declared per-repo in meta.threads,
// used per-event as `threads: string[]`, validated by scripts/validate-data.js.
// These tests run the REAL validator against fixture datasets in a scratch
// copy, so what is tested is the gate CI relies on.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
// The template ships a fixture; an adopting repo has only its real dataset.
// Take whichever exists so this test is portable to both (adopt-template #6).
const BASE_FILE = ['chronology.example.json', 'chronology.json']
  .map((f) => path.join(ROOT, 'data', f))
  .find((p) => fs.existsSync(p));
const base = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));

const TAXONOMY = {
  note: 'These lanes are an editorial reading of the chronology, not a neutral fact; events may sit in more than one lane, and absence from a lane is not a claim of irrelevance.',
  lanes: [
    { id: 'lane-a', label: 'Lane A', basis: 'Example basis: the actor own periodization.' },
    { id: 'lane-b', label: 'Lane B', basis: 'Example basis: the counterpart record.' },
  ],
};

function runValidator(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.copyFileSync(path.join(ROOT, 'build.js'), path.join(dir, 'build.js'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'validate-data.js'), path.join(dir, 'scripts', 'validate-data.js'));
  fs.copyFileSync(path.join(ROOT, 'data', 'glossary-terms.json'), path.join(dir, 'data', 'glossary-terms.json'));
  // The example dataset now carries a `map` block, whose validation reads the
  // vendored base map — copy it so the scratch validates the real fixture.
  fs.mkdirSync(path.join(dir, 'src'));
  fs.copyFileSync(path.join(ROOT, 'src', 'latam.svg'), path.join(dir, 'src', 'latam.svg'));
  // A base dataset that declares placesMap needs the gazetteer beside it, or
  // the validator fails on the map rather than on the threads under test.
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

test('a dataset without threads anywhere is valid (no flag day)', () => {
  const r = runValidator(() => {});
  assert.ok(r.ok, r.out);
});

test('declared taxonomy + events tagged with known lanes validates', () => {
  const r = runValidator((d) => {
    d.meta.threads = TAXONOMY;
    d.events[0].threads = ['lane-a', 'lane-b']; // cross-cutting: more than one lane
  });
  assert.ok(r.ok, r.out);
});

test('a declared taxonomy with no tagged events yet is valid (rollout order)', () => {
  const r = runValidator((d) => { d.meta.threads = TAXONOMY; });
  assert.ok(r.ok, r.out);
});

test('unknown lane id on an event fails the build', () => {
  const r = runValidator((d) => {
    d.meta.threads = TAXONOMY;
    d.events[0].threads = ['lane-a', 'lane-typo'];
  });
  assert.ok(!r.ok);
  assert.match(r.out, /unknown lane id "lane-typo"/);
});

test('tagging events without declaring meta.threads fails the build', () => {
  const r = runValidator((d) => { d.events[0].threads = ['lane-a']; });
  assert.ok(!r.ok);
  assert.match(r.out, /declares no lanes/);
});

test('threads must be an array, never a scalar', () => {
  const r = runValidator((d) => {
    d.meta.threads = TAXONOMY;
    d.events[0].threads = 'lane-a';
  });
  assert.ok(!r.ok);
  assert.match(r.out, /must be an array of lane ids/);
});

test('the editorial note on the taxonomy is required', () => {
  const r = runValidator((d) => {
    d.meta.threads = { lanes: TAXONOMY.lanes };
  });
  assert.ok(!r.ok);
  assert.match(r.out, /meta\.threads\.note missing/);
});

test('every lane must name its basis', () => {
  const r = runValidator((d) => {
    d.meta.threads = { note: TAXONOMY.note, lanes: [{ id: 'lane-a', label: 'Lane A' }] };
  });
  assert.ok(!r.ok);
  assert.match(r.out, /basis missing/);
});

test('lane ids are kebab-case and unique', () => {
  const r = runValidator((d) => {
    d.meta.threads = {
      note: TAXONOMY.note,
      lanes: [
        { id: 'Lane_A', label: 'A', basis: 'x' },
        { id: 'lane-b', label: 'B', basis: 'x' },
        { id: 'lane-b', label: 'B2', basis: 'x' },
      ],
    };
  });
  assert.ok(!r.ok);
  assert.match(r.out, /must be kebab-case/);
  assert.match(r.out, /id duplicated: lane-b/);
});

test('lane sources, when given, must resolve to reference ids', () => {
  const r = runValidator((d) => {
    d.meta.threads = {
      note: TAXONOMY.note,
      lanes: [{ id: 'lane-a', label: 'A', basis: 'x', sources: ['no-such-ref'] }],
    };
  });
  assert.ok(!r.ok);
  assert.match(r.out, /unknown reference id "no-such-ref"/);
});
