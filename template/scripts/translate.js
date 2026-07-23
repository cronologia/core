#!/usr/bin/env node
/**
 * Machine-translation cache generator.
 *
 * Reads data/chronology.json, collects every translatable content string, and
 * maintains one committed cache per target locale at data/i18n/<lang>.json:
 *
 *   { "_meta": { … }, "strings": { "<english source>": "<translation>" } }
 *
 * build.js consumes these caches (keyed by the English source string) and falls
 * back to English for anything missing. The caches are GENERATED — never
 * hand-edit them; re-run this tool. This mirrors the Wayback archives.json
 * discipline (a committed, generated cache) and keeps build.js zero-dependency.
 *
 * Machine translation itself needs a backend, configured by env so the repo
 * stays dependency- and secret-free:
 *
 *   TRANSLATE_ENDPOINT   POST {q,source,target} translate endpoint (e.g. a
 *                        LibreTranslate instance). TRANSLATE_API_KEY optional.
 *
 * Without a backend the tool runs offline: it reports coverage and normalizes
 * the cache (prunes stale keys, refreshes _meta) without inventing translations,
 * so `node scripts/translate.js` is always safe to run.
 *
 * Usage:
 *   node scripts/translate.js              # es + pt, fill missing (needs backend)
 *   node scripts/translate.js --stats      # coverage report only, no writes
 *   node scripts/translate.js es           # a single locale
 *
 * NOT translated: proper names, reference titles/publishers, URLs, dates, ids.
 * The translatable-key set mirrors build.js's TRANSLATABLE_KEYS.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'chronology.json');
const I18N_DIR = path.join(ROOT, 'data', 'i18n');
const DEFAULT_LOCALES = ['es', 'pt'];

const TRANSLATABLE_KEYS = new Set([
  'title', 'subtitle', 'description', 'dataQualityNote', 'label', 'value', 'text',
  'place', 'role', 'country', 'notes', 'note', 'heading', 'navLabel', 'summary',
  'detail', 'status', 'relation', 'unitNote', 'sourceLabel', 'display', 'unit', 'edgeLabel',
]);

/** Collect the unique translatable strings from the dataset, in a stable order. */
function collectStrings(data) {
  const out = [];
  const seen = new Set();
  const add = (s) => { if (typeof s === 'string' && s.trim() && !seen.has(s)) { seen.add(s); out.push(s); } };
  const walk = (val, key) => {
    if (key === 'references') return;               // bibliographic data, never translated
    if (Array.isArray(val)) { val.forEach((v) => walk(v, key)); return; }
    if (val && typeof val === 'object') { for (const k of Object.keys(val)) walk(val[k], k); return; }
    if (typeof val === 'string' && TRANSLATABLE_KEYS.has(key)) add(val);
  };
  walk(data, null);
  return out;
}

function loadCache(lang) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${lang}.json`), 'utf8'));
    return (parsed && parsed.strings) || {};
  } catch { return {}; }
}

function writeCache(lang, strings, sourceCount) {
  fs.mkdirSync(I18N_DIR, { recursive: true });
  const ordered = {};
  Object.keys(strings).sort().forEach((k) => { ordered[k] = strings[k]; });
  const payload = {
    _meta: {
      generatedBy: 'scripts/translate.js',
      note: 'GENERATED machine-translation cache — do not hand-edit. English is authoritative.',
      targetLang: lang,
      coverage: `${Object.keys(ordered).length}/${sourceCount}`,
    },
    strings: ordered,
  };
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
    if (missing.length === 0) { writeCache(lang, cache, sources.length); continue; }
    try {
      const BATCH = 20;
      for (let i = 0; i < missing.length; i += BATCH) {
        const chunk = missing.slice(i, i + BATCH);
        const translated = await machineTranslate(chunk, lang);
        chunk.forEach((src, j) => { if (translated[j]) cache[src] = translated[j]; });
      }
      writeCache(lang, cache, sources.length);
      console.log(`[${lang}] wrote cache (${Object.keys(cache).length}/${sources.length}).`);
    } catch (e) {
      if (e.code === 'NO_BACKEND') {
        console.log(`[${lang}] no translation backend configured — cache left as-is (${Object.keys(cache).length}/${sources.length}). ` +
          `Set TRANSLATE_ENDPOINT (+ TRANSLATE_API_KEY) to fill ${missing.length} missing string(s).`);
        writeCache(lang, cache, sources.length);
      } else {
        console.error(`[${lang}] translation failed:`, e.message);
        process.exitCode = 1;
      }
    }
  }
}

run();
