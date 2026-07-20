#!/usr/bin/env node
'use strict';
/**
 * sync-glossary-terms.js — refresh the vendored glossary term-id list.
 *
 * The build's glossary cross-links ([[term-id]] markers, see build.js) are
 * validated against a PINNED copy of the cronologia/glossary term ids, stored
 * in data/glossary-terms.json. We vendor the list rather than fetch it during
 * the build on purpose: the compiler and its CI gate (validate + test + build)
 * run with NO network, exactly like the rest of this template — the only jobs
 * that touch the network are out-of-band maintenance scripts (this one and
 * scripts/archive-refs.js), run by hand or in a separate scheduled workflow,
 * never inside `node build.js`. A pinned list keeps the build deterministic and
 * offline; re-run this script (and commit the diff) when the glossary changes.
 *
 * Source resolution (first that works):
 *   1. an explicit path/URL argument:  node scripts/sync-glossary-terms.js <src>
 *   2. env GLOSSARY_SOURCE
 *   3. a sibling checkout ../glossary/data/glossary.json (or ../../glossary/…)
 *   4. the published raw JSON on GitHub (needs network)
 *
 * <src> may be a local file path or an http(s) URL to a glossary.json shaped
 * like cronologia/glossary (a top-level `terms[]` of objects with `id`).
 *
 * Usage:
 *   node scripts/sync-glossary-terms.js
 *   node scripts/sync-glossary-terms.js ../glossary/data/glossary.json
 *   node scripts/sync-glossary-terms.js https://raw.githubusercontent.com/cronologia/glossary/main/data/glossary.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'data', 'glossary-terms.json');
const RAW_URL = 'https://raw.githubusercontent.com/cronologia/glossary/main/data/glossary.json';
const GLOSSARY_BASE = 'https://cronologia.github.io/glossary/';

function isUrl(s) {
  return /^https?:\/\//.test(s);
}

async function readSource(src) {
  if (isUrl(src)) {
    const res = await fetch(src, { headers: { 'user-agent': 'cronologia-sync-glossary-terms' } });
    if (!res.ok) throw new Error(`fetch ${src} -> HTTP ${res.status}`);
    return { text: await res.text(), from: src };
  }
  return { text: fs.readFileSync(src, 'utf8'), from: path.resolve(src) };
}

/** Ordered list of candidate sources given an optional explicit argument. */
function candidateSources(arg) {
  if (arg) return [arg];
  const list = [];
  if (process.env.GLOSSARY_SOURCE) list.push(process.env.GLOSSARY_SOURCE);
  list.push(path.join(ROOT, '..', 'glossary', 'data', 'glossary.json'));
  list.push(path.join(ROOT, '..', '..', 'glossary', 'data', 'glossary.json'));
  list.push(RAW_URL);
  return list;
}

async function main() {
  const arg = process.argv[2];
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
    console.error('sync-glossary-terms: no usable glossary source. Tried:\n  - ' + tried.join('\n  - '));
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(loaded.text);
  } catch (e) {
    console.error(`sync-glossary-terms: ${loaded.from} is not valid JSON — ${e.message}`);
    process.exit(1);
  }

  const terms = Array.isArray(parsed.terms) ? parsed.terms : [];
  const ids = [...new Set(terms.map((t) => t && t.id).filter((id) => typeof id === 'string' && id.length))]
    .sort((a, b) => a.localeCompare(b, 'en'));
  if (ids.length === 0) {
    console.error(`sync-glossary-terms: ${loaded.from} yielded no term ids (expected a terms[] with id fields).`);
    process.exit(1);
  }

  const out = {
    _comment: 'PINNED copy of the cronologia/glossary term ids, vendored so the '
      + 'build can validate [[term-id]] cross-links offline. Regenerate with '
      + 'scripts/sync-glossary-terms.js and commit the diff; do not hand-edit.',
    baseUrl: GLOSSARY_BASE,
    syncedFrom: isUrl(loaded.from) ? loaded.from : 'cronologia/glossary data/glossary.json',
    syncedAt: new Date().toISOString().slice(0, 10),
    terms: ids,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE)} — ${ids.length} term ids from ${loaded.from}.`);
}

main().catch((e) => {
  console.error(`sync-glossary-terms: ${e.message}`);
  process.exit(1);
});
