#!/usr/bin/env node
/**
 * Translation-cache manager (no runtime/hosting dependency).
 *
 * The sites are static HTML on GitHub Pages; NOTHING translates at runtime. The
 * es/pt content is committed, pre-authored data at data/i18n/<lang>.json:
 *
 *   { "_meta": { … }, "strings": { "<english source>": "<translation>" } }
 *
 * build.js bakes these caches (keyed by the English source string) into the
 * static /es/ and /pt/ pages, falling back to English for anything missing.
 *
 * Filling the caches — TWO ways, NO backend required for either the build or
 * the published site:
 *   1. AUTHORED (primary). A human or the assistant writes the translations
 *      straight into data/i18n/<lang>.json. Run this tool with `--stats` to see
 *      which strings still need one. This is how the cronologia sites are
 *      translated — pre-authored, committed, served as plain HTML.
 *   2. AUTOMATED (optional). If you happen to have a translation service, set
 *      TRANSLATE_ENDPOINT (+ optional TRANSLATE_API_KEY) and this tool will call
 *      it to fill the missing strings. Purely a convenience; not needed.
 *
 * With no backend the tool is a safe no-op: it reports coverage and normalizes
 * the cache (prunes stale keys, refreshes _meta) without inventing translations.
 * Treat the caches as generated data — regenerate/re-author when content changes;
 * don't leave them stale.
 *
 * Usage:
 *   node scripts/translate.js --stats      # coverage: which strings still need a translation
 *   node scripts/translate.js              # es + pt (fills via backend only if one is set)
 *   node scripts/translate.js es           # a single locale
 *
 * NOT translated: proper names, reference titles/publishers, URLs, dates, ids.
 * The translatable set is build.js's — imported, not mirrored; see below.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
// >>> ADOPT: dataset
// A repo points this at its own source of truth (chronology.json, glossary.json).
const DATA_FILE = path.join(ROOT, 'data', 'chronology.json');
// <<< ADOPT
const I18N_DIR = path.join(ROOT, 'data', 'i18n');
const DEFAULT_LOCALES = ['es', 'pt'];

/**
 * The one walk, imported from the renderer.
 *
 * This file used to keep its own copy of TRANSLATABLE_KEYS and its own walk,
 * under a comment saying the copy "MUST mirror build.js's set". It did not.
 * The copy skipped `references` wholesale, so the coverage number omitted every
 * `publisherNote` the localized pages actually render; and it knew nothing of
 * SUBTREE_TRANSLATABLE, so it counted `approvalLadder[].status` — a closed enum
 * — and told the operator to go translate `not-found`, which would fail the
 * localized build with "unknown status". A coverage report that measures a
 * different set than the renderer is worse than no report: it is a number that
 * looks like an answer. Requiring build.js is safe — it runs main() only under
 * `require.main === module`.
 */
const { collectTranslatable: collectStrings } = require(path.join(ROOT, 'build.js'));

function loadCache(lang) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${lang}.json`), 'utf8'));
    return (parsed && parsed.strings) || {};
  } catch { return {}; }
}

/** Read an existing cache's _meta so a normalize-only run does not rewrite provenance. */
function loadMeta(lang) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${lang}.json`), 'utf8'));
    return (parsed && parsed._meta) || {};
  } catch { return {}; }
}

/**
 * Write the cache.
 *
 * `authored` MUST be true only when THIS run actually produced translations via
 * TRANSLATE_ENDPOINT. A normalize-only run (pruning stale keys, refreshing
 * coverage) preserves whatever provenance the cache already carries — these
 * caches may have been authored by something other than this script (e.g. an
 * LLM, when no backend is configured), and silently reattributing them to
 * scripts/translate.js would be a false provenance claim in a dataset whose
 * value depends on knowing where every string came from.
 */
function writeCache(lang, strings, sourceCount, authored) {
  fs.mkdirSync(I18N_DIR, { recursive: true });
  const ordered = {};
  Object.keys(strings).sort().forEach((k) => { ordered[k] = strings[k]; });
  const prev = loadMeta(lang);
  const meta = Object.assign({}, prev, {
    targetLang: lang,
    coverage: `${Object.keys(ordered).length}/${sourceCount}`,
  });
  if (authored) {
    meta.generatedBy = 'scripts/translate.js via TRANSLATE_ENDPOINT';
    meta.note = 'GENERATED machine-translation cache — do not hand-edit. English is authoritative.';
  } else if (!meta.generatedBy) {
    meta.generatedBy = 'unknown — this cache was not authored by scripts/translate.js; record its real origin here';
  }
  const payload = { _meta: meta, strings: ordered };
  fs.writeFileSync(path.join(I18N_DIR, `${lang}.json`), JSON.stringify(payload, null, 2) + '\n');
}

/** Pluggable backend. Returns translations[] aligned with texts[], or throws. */
function machineTranslate(texts, target) {
  const endpoint = process.env.TRANSLATE_ENDPOINT;
  if (!endpoint) { const e = new Error('no TRANSLATE_ENDPOINT configured'); e.code = 'NO_BACKEND'; throw e; }
  const body = JSON.stringify({ q: texts, source: 'en', target, format: 'text' });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  if (process.env.TRANSLATE_API_KEY) headers.Authorization = `Bearer ${process.env.TRANSLATE_API_KEY}`;
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(endpoint), { method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { const p = JSON.parse(data); const a = p.translatedText || p.translations || p; resolve(Array.isArray(a) ? a : [a]); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function run() {
  const args = process.argv.slice(2);
  const statsOnly = args.includes('--stats');
  const langs = args.filter((a) => !a.startsWith('--'));
  const targets = langs.length ? langs : DEFAULT_LOCALES;

  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const sources = collectStrings(data);
  const sourceSet = new Set(sources);

  for (const lang of targets) {
    const cache = loadCache(lang);
    for (const k of Object.keys(cache)) if (!sourceSet.has(k)) delete cache[k]; // prune stale
    const missing = sources.filter((s) => !(s in cache));
    console.log(`[${lang}] coverage ${sources.length - missing.length}/${sources.length}` + (missing.length ? `, ${missing.length} missing` : ' (complete)'));
    if (statsOnly) continue;
    if (missing.length === 0) { writeCache(lang, cache, sources.length, false); continue; }
    try {
      const BATCH = 20;
      for (let i = 0; i < missing.length; i += BATCH) {
        const chunk = missing.slice(i, i + BATCH);
        const translated = await machineTranslate(chunk, lang);
        chunk.forEach((src, j) => { if (translated[j]) cache[src] = translated[j]; });
      }
      writeCache(lang, cache, sources.length, true);
      console.log(`[${lang}] wrote cache (${Object.keys(cache).length}/${sources.length}).`);
    } catch (e) {
      if (e.code === 'NO_BACKEND') {
        console.log(`[${lang}] no translation backend configured — cache left as-is (${Object.keys(cache).length}/${sources.length}). ` +
          `Set TRANSLATE_ENDPOINT (+ TRANSLATE_API_KEY) to fill ${missing.length} missing string(s).`);
        writeCache(lang, cache, sources.length, false);
      } else {
        console.error(`[${lang}] translation failed:`, e.message);
        process.exitCode = 1;
      }
    }
  }
}

run();
