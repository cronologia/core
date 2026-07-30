#!/usr/bin/env node
'use strict';
/**
 * sync-places.js — refresh the vendored gazetteer.
 *
 * The places map (renderPlacesMap in build.js) needs coordinates for the
 * free-text `place` strings in data/chronology.json. The site build is
 * network-free by policy (core ADR-0004), so coordinates cannot be looked up
 * at build time; they live in a committed gazetteer, canonical at
 * cronologia/core → data/places.json and VENDORED here as data/places.json —
 * the same pinned-copy pattern as data/glossary-terms.json. One correction in
 * core then propagates by re-running this script, instead of being fixed once
 * per repo.
 *
 * The copy is verbatim: the gazetteer carries its own _meta (coordinate
 * source, precision semantics, curation notes) and inventing a wrapper here
 * would only make the vendored copy harder to compare against its source.
 * Re-run this script (and commit the diff) when the gazetteer changes.
 * `--check` exits 1 when the vendored copy no longer matches the source.
 *
 * Source resolution (first that works):
 *   1. an explicit path/URL argument:  node scripts/sync-places.js <src>
 *   2. env PLACES_SOURCE
 *   3. a sibling checkout ../core/data/places.json (or ../../core/…)
 *   4. the published raw JSON on GitHub (needs network)
 *
 * Usage:
 *   node scripts/sync-places.js
 *   node scripts/sync-places.js --check
 *   node scripts/sync-places.js ../core/data/places.json
 *   node scripts/sync-places.js https://raw.githubusercontent.com/cronologia/core/main/data/places.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'data', 'places.json');
const RAW_URL = 'https://raw.githubusercontent.com/cronologia/core/main/data/places.json';

function isUrl(s) {
  return /^https?:\/\//.test(s);
}

async function readSource(src) {
  if (isUrl(src)) {
    const res = await fetch(src, { headers: { 'user-agent': 'cronologia-sync-places' } });
    if (!res.ok) throw new Error(`fetch ${src} -> HTTP ${res.status}`);
    return { text: await res.text(), from: src };
  }
  return { text: fs.readFileSync(src, 'utf8'), from: path.resolve(src) };
}

/** Ordered list of candidate sources given an optional explicit argument. */
function candidateSources(arg) {
  if (arg) return [arg];
  const list = [];
  if (process.env.PLACES_SOURCE) list.push(process.env.PLACES_SOURCE);
  list.push(path.join(ROOT, '..', 'core', 'data', 'places.json'));
  list.push(path.join(ROOT, '..', '..', 'core', 'data', 'places.json'));
  list.push(RAW_URL);
  return list;
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const arg = args.find((a) => a !== '--check');
  const candidates = candidateSources(arg);

  let loaded = null;
  const tried = [];
  for (const src of candidates) {
    try {
      if (!isUrl(src) && !fs.existsSync(src)) { tried.push(`${src} (not found)`); continue; }
      loaded = await readSource(src);
      break;
    } catch (e) {
      tried.push(`${src} (${e.message})`);
    }
  }
  if (!loaded) {
    console.error('sync-places: no usable gazetteer source. Tried:\n  - ' + tried.join('\n  - '));
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(loaded.text);
  } catch (e) {
    console.error(`sync-places: ${loaded.from} is not valid JSON — ${e.message}`);
    process.exit(1);
  }
  const places = Array.isArray(parsed.places) ? parsed.places : [];
  if (places.length === 0) {
    console.error(`sync-places: ${loaded.from} yielded no places (expected a places[] with id/name fields).`);
    process.exit(1);
  }

  // Normalize formatting so the comparison (and the committed diff) is stable.
  const canonical = JSON.stringify(parsed, null, 2) + '\n';

  if (check) {
    let current = null;
    try {
      current = fs.readFileSync(OUT_FILE, 'utf8');
    } catch {
      console.error(`sync-places: ${path.relative(ROOT, OUT_FILE)} is missing; run scripts/sync-places.js`);
      process.exit(1);
    }
    if (current !== canonical) {
      console.error(`sync-places: ${path.relative(ROOT, OUT_FILE)} is stale against ${loaded.from}; run scripts/sync-places.js and commit the diff.`);
      process.exit(1);
    }
    console.log(`sync-places: ${path.relative(ROOT, OUT_FILE)} matches ${loaded.from} (${places.length} places).`);
    return;
  }

  fs.writeFileSync(OUT_FILE, canonical);
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE)} — ${places.length} places from ${loaded.from}.`);
}

main().catch((e) => {
  console.error(`sync-places: ${e.message}`);
  process.exit(1);
});
