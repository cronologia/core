#!/usr/bin/env node
'use strict';
/**
 * archive-refs.js — Wayback Machine preservation for reference URLs.
 *
 * Zero dependencies. Reads the `references[]` array of data/chronology.json,
 * asks the Internet Archive's availability API for an existing snapshot of
 * each URL, and triggers a Save Page Now capture for URLs that have none
 * (plus a fresh re-capture for references marked `"official": true` whose
 * latest snapshot is older than the refresh window). Results are written to
 * data/archives.json, which build.js reads to render "archived" fallback
 * links next to each reference.
 *
 * Politeness / robustness:
 *   - >= 10s between save requests (availability lookups are throttled more
 *     lightly), identified with a User-Agent naming the Cronologia project.
 *   - HTTP 429/403 from archive.org is treated as *inconclusive* — nothing is
 *     recorded, so the next run simply retries. Only hard errors are logged.
 *   - Idempotent and resumable: URLs already present in data/archives.json
 *     with a snapshot are skipped on re-runs (official refs are re-captured
 *     only once their snapshot ages past the refresh window).
 *   - Saves per run are capped so scheduled CI runs stay bounded.
 *
 * Usage: node scripts/archive-refs.js
 * Env:   ARCHIVE_MAX_SAVES      max Save Page Now requests per run (default 25)
 *        ARCHIVE_SAVE_DELAY_MS  pause between save requests (default 12000, min 10000)
 *        ARCHIVE_REFRESH_DAYS   re-capture window for official refs (default 7)
 *
 * data/archives.json format (consumed by build.js and the drift-check test):
 *   { "snapshots": { "<url>": { "archiveUrl": "...", "timestamp": "YYYYMMDDhhmmss", ... } } }
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'chronology.json');
const ARCHIVES_FILE = path.join(ROOT, 'data', 'archives.json');

const MAX_SAVES = clampInt(process.env.ARCHIVE_MAX_SAVES, 25, 0, 500);
const SAVE_DELAY_MS = Math.max(10000, clampInt(process.env.ARCHIVE_SAVE_DELAY_MS, 12000, 0, 600000));
const REFRESH_DAYS = clampInt(process.env.ARCHIVE_REFRESH_DAYS, 7, 0, 3650);
const LOOKUP_DELAY_MS = 1500;

const USER_AGENT =
  'cronologia-archive-refs/1.0 (Cronologia chronology project; +https://github.com/cronologia/core)';

function clampInt(raw, dflt, min, max) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Prefer https for web.archive.org links regardless of what the API returns. */
function normalizeArchiveUrl(url) {
  return String(url).replace(/^http:\/\/web\.archive\.org\//, 'https://web.archive.org/');
}

/** Age of a 14-digit Wayback timestamp in whole days (Infinity if unparsable). */
function snapshotAgeDays(ts) {
  if (!/^\d{14}$/.test(String(ts))) return Infinity;
  const iso = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`;
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) ? ms / 86400000 : Infinity;
}

async function request(url, { headOnly = false } = {}) {
  const res = await fetch(url, {
    method: headOnly ? 'HEAD' : 'GET',
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(120000),
  });
  return res;
}

/** Query the availability API. Returns {archiveUrl, timestamp} | null | 'inconclusive'. */
async function lookupSnapshot(url) {
  const api = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
  let res;
  try {
    res = await request(api);
  } catch (e) {
    console.warn(`  lookup error (${e.message}) — will retry next run`);
    return 'inconclusive';
  }
  if (res.status === 429 || res.status === 403) {
    console.warn(`  lookup rate-limited (HTTP ${res.status}) — will retry next run`);
    return 'inconclusive';
  }
  if (!res.ok) {
    console.warn(`  lookup failed (HTTP ${res.status}) — will retry next run`);
    return 'inconclusive';
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return 'inconclusive';
  }
  const closest = body && body.archived_snapshots && body.archived_snapshots.closest;
  if (closest && closest.available && closest.url) {
    return { archiveUrl: normalizeArchiveUrl(closest.url), timestamp: closest.timestamp || '' };
  }
  return null;
}

/** Trigger Save Page Now. Returns {archiveUrl, timestamp} | 'inconclusive' | null. */
async function savePage(url) {
  const saveUrl = `https://web.archive.org/save/${url}`;
  let res;
  try {
    res = await request(saveUrl);
  } catch (e) {
    console.warn(`  save error (${e.message}) — will retry next run`);
    return 'inconclusive';
  }
  if (res.status === 429 || res.status === 403) {
    console.warn(`  save rate-limited (HTTP ${res.status}) — inconclusive, retry later`);
    return 'inconclusive';
  }
  if (!res.ok) {
    console.warn(`  save failed (HTTP ${res.status})`);
    return null;
  }
  // A successful save usually lands on (or advertises) /web/<ts>/<url>.
  const hint = res.headers.get('content-location') || res.url || '';
  const m = String(hint).match(/\/web\/(\d{14})/);
  if (m) {
    const rest = String(hint).replace(/^https?:\/\/web\.archive\.org/, '');
    return {
      archiveUrl: normalizeArchiveUrl(rest.startsWith('/') ? `https://web.archive.org${rest}` : hint),
      timestamp: m[1],
    };
  }
  // Capture accepted but no timestamp surfaced: confirm via the availability API.
  await sleep(LOOKUP_DELAY_MS);
  const found = await lookupSnapshot(url);
  return found === 'inconclusive' ? 'inconclusive' : found;
}

function loadArchives() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ARCHIVES_FILE, 'utf8'));
    return parsed && typeof parsed.snapshots === 'object' && parsed.snapshots ? parsed : { snapshots: {} };
  } catch {
    return { snapshots: {} };
  }
}

function writeArchives(archives) {
  const sorted = {};
  for (const url of Object.keys(archives.snapshots).sort()) sorted[url] = archives.snapshots[url];
  const out = {
    generatedBy: 'scripts/archive-refs.js',
    updatedAt: new Date().toISOString().slice(0, 10),
    snapshots: sorted,
  };
  fs.writeFileSync(ARCHIVES_FILE, JSON.stringify(out, null, 2) + '\n');
}

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const references = Array.isArray(data.references) ? data.references : [];
  const archives = loadArchives();

  let saves = 0;
  let looked = 0;
  let skipped = 0;
  let pending = 0;
  let firstNetworkCall = true;

  const politePause = async (ms) => {
    if (!firstNetworkCall) await sleep(ms);
    firstNetworkCall = false;
  };

  for (const ref of references) {
    const url = ref.url;
    if (!url) continue;
    const existing = archives.snapshots[url];
    const isOfficial = ref.official === true;
    const label = `${ref.id || '?'} ${url}`;

    // Idempotence: skip what archives.json already has, unless this is an
    // official reference whose snapshot has aged past the refresh window.
    if (existing && existing.archiveUrl) {
      const stale = isOfficial && snapshotAgeDays(existing.timestamp) > REFRESH_DAYS;
      if (!stale) {
        skipped++;
        continue;
      }
      if (saves >= MAX_SAVES) {
        console.log(`refresh deferred (save cap ${MAX_SAVES} reached): ${label}`);
        pending++;
        continue;
      }
      console.log(`re-capturing official ref: ${label}`);
      await politePause(SAVE_DELAY_MS);
      const saved = await savePage(url);
      saves++;
      if (saved && saved !== 'inconclusive') {
        archives.snapshots[url] = { refId: ref.id, ...saved, checkedAt: new Date().toISOString().slice(0, 10) };
        console.log(`  re-captured ${saved.timestamp}`);
      } else {
        pending++; // keep the previous snapshot; retry the refresh next run
      }
      continue;
    }

    // No entry yet: look up an existing snapshot first (cheap).
    console.log(`checking: ${label}`);
    await politePause(LOOKUP_DELAY_MS);
    const found = await lookupSnapshot(url);
    looked++;
    if (found === 'inconclusive') {
      pending++;
      continue;
    }
    if (found) {
      archives.snapshots[url] = { refId: ref.id, ...found, checkedAt: new Date().toISOString().slice(0, 10) };
      console.log(`  snapshot exists (${found.timestamp})`);
      continue;
    }

    // Nothing archived: trigger a capture (bounded per run).
    if (saves >= MAX_SAVES) {
      console.log(`  no snapshot; save cap ${MAX_SAVES} reached — deferred to next run`);
      pending++;
      continue;
    }
    console.log('  no snapshot — requesting capture');
    await politePause(SAVE_DELAY_MS);
    const saved = await savePage(url);
    saves++;
    if (saved && saved !== 'inconclusive') {
      archives.snapshots[url] = { refId: ref.id, ...saved, checkedAt: new Date().toISOString().slice(0, 10) };
      console.log(`  captured ${saved.timestamp}`);
    } else {
      pending++;
    }
  }

  writeArchives(archives);
  const total = references.length;
  const have = references.filter((r) => r.url && archives.snapshots[r.url] && archives.snapshots[r.url].archiveUrl).length;
  console.log(
    `\nDone: ${total} references, ${have} with a snapshot in data/archives.json ` +
    `(${skipped} already recorded, ${looked} looked up, ${saves} save requests, ${pending} pending retry).`
  );
}

main().catch((e) => {
  console.error(`archive-refs: ${e.message}`);
  process.exit(1);
});
