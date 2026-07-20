#!/usr/bin/env node
'use strict';
/**
 * check-links.js — reference link-health checker for data/chronology.json.
 *
 * Zero dependencies (Node 18+ global fetch). Reads every `references[].url`
 * and, for each, reports:
 *   - the HTTP status (HEAD, falling back to a ranged GET when HEAD is
 *     unsupported or blocked);
 *   - whether it redirected, the final URL, and a soft-404 heuristic: a
 *     redirect (or a 200) whose page <title> no longer matches the reference's
 *     declared title, or reads as a "not found"/error page, is flagged as
 *     SUSPECT (possibly-unrelated content) rather than silently trusted;
 *   - whether an Internet Archive (Wayback) snapshot exists
 *     (https://archive.org/wayback/available).
 *
 * A URL that FAILS (dead) or is SUSPECT *and* has no Wayback snapshot is marked
 * `priorityArchive: true` — top of the queue for scripts/archive-refs.js.
 *
 * This is an out-of-band / CI tool. It hits the live network, so it is NEVER
 * run as part of the (network-free) build — see .github/workflows/link-health.yml,
 * which runs it on GitHub-hosted runners and opens/updates a single "link
 * health" issue. It never edits data/chronology.json.
 *
 * Politeness / robustness (see also scripts/archive-refs.js):
 *   - >= 1 request/second (global throttle), identified by a User-Agent that
 *     names the project.
 *   - HTTP 403/429 (and 5xx) are treated as INCONCLUSIVE, never "dead" — many
 *     publishers block bots or HEAD; a bounded network error/timeout is
 *     inconclusive too. Only real 4xx (404/410/451…) count as dead.
 *   - Per-request timeout is bounded (LINK_CHECK_TIMEOUT_MS).
 *
 * Usage:  node scripts/check-links.js [--json report.json] [--md issue.md] [--project "<name>"]
 * Output: a Markdown summary on stdout; the machine-readable JSON report to the
 *         --json path (default: link-health-report.json); an optional Markdown
 *         issue body to the --md path.
 * Env:    LINK_CHECK_DELAY_MS    min ms between requests (default 1100, min 1000)
 *         LINK_CHECK_TIMEOUT_MS  per-request timeout (default 30000, bounded)
 *         LINK_CHECK_MAX_BYTES   bytes read from a GET body for the title (default 65536)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'chronology.json');

const DELAY_MS = Math.max(1000, clampInt(process.env.LINK_CHECK_DELAY_MS, 1100, 0, 600000));
const TIMEOUT_MS = clampInt(process.env.LINK_CHECK_TIMEOUT_MS, 30000, 1000, 120000);
const MAX_BYTES = clampInt(process.env.LINK_CHECK_MAX_BYTES, 65536, 1024, 5000000);

function clampInt(raw, dflt, min, max) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------------------------------------
 * Pure helpers (unit-tested offline in test/link-health.test.js).
 * ---------------------------------------------------------------------- */

/** A polite User-Agent that names the project (falls back to a generic id). */
function deriveUserAgent(projectName) {
  const name = (typeof projectName === 'string' && projectName.trim()) ? projectName.trim() : 'Cronologia project';
  return `cronologia-check-links/1.0 (${name}; +https://github.com/cronologia)`;
}

/** Extract the text of the first <title>…</title> from an HTML string, or ''. */
function extractTitle(html) {
  if (typeof html !== 'string') return '';
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  return decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
}

/** Decode the handful of HTML entities that show up in page titles. */
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#0*160;|&nbsp;/gi, ' ')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–');
}

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'de', 'la', 'el', 'le', 'du', 'des', 'y', 'do', 'da']);

/** Normalize a title into a set of meaningful lowercase tokens. */
function titleTokens(title) {
  const set = new Set();
  if (typeof title !== 'string') return set;
  for (const t of title.toLowerCase().replace(/[^a-z0-9À-ſ]+/gi, ' ').split(' ')) {
    if (t.length >= 3 && !STOPWORDS.has(t)) set.add(t);
  }
  return set;
}

/**
 * Jaccard-style overlap between the declared title and the live page title,
 * measured as the share of the *smaller* token set that is shared (so a long
 * generic page title can't dilute a short, specific reference title). Returns
 * null when either side has no usable tokens (can't judge).
 */
function titleSimilarity(expected, actual) {
  const a = titleTokens(expected);
  const b = titleTokens(actual);
  if (a.size === 0 || b.size === 0) return null;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / Math.min(a.size, b.size);
}

/** True when a page title reads like a generic not-found / error page. */
function looksLikeNotFound(title) {
  if (typeof title !== 'string' || !title) return false;
  return /\b(404|not found|page not found|no longer (?:available|exists)|error|forbidden|access denied|account suspended|domain (?:for sale|is for sale|parking)|this page (?:isn'?t|is not) available)\b/i.test(title);
}

/**
 * Soft-404 heuristic. `redirected` says the request landed somewhere other than
 * the requested URL. We flag SUSPECT when the live title reads as a not-found
 * page, or when the request redirected AND the title no longer overlaps the
 * declared reference title (below `threshold`). A same-URL 200 with a good
 * title is never flagged.
 */
function isSoftRedirect({ redirected, expectedTitle, actualTitle, threshold = 0.2 }) {
  if (looksLikeNotFound(actualTitle)) return true;
  if (!redirected) return false;
  const sim = titleSimilarity(expectedTitle, actualTitle);
  if (sim === null) return false; // no titles to compare — don't cry wolf
  return sim < threshold;
}

/**
 * Map an HTTP status to a link verdict.
 *   2xx            -> 'ok'
 *   403 / 429      -> 'inconclusive' (bot-blocked / rate-limited, per the ticket)
 *   408 / 5xx      -> 'inconclusive' (transient server-side)
 *   other 4xx      -> 'dead'
 *   0 / falsy      -> 'inconclusive' (never reached — network error/timeout)
 */
function classifyStatus(status) {
  if (!status) return 'inconclusive';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 403 || status === 429 || status === 408) return 'inconclusive';
  if (status >= 500) return 'inconclusive';
  if (status >= 400) return 'dead';
  if (status >= 300) return 'ok'; // a final 3xx (redirects are followed) — treat as reachable
  return 'inconclusive';
}

/** Parse the archive.org availability API body into {archiveUrl, timestamp} | null. */
function parseWaybackAvailable(body) {
  const closest = body && body.archived_snapshots && body.archived_snapshots.closest;
  if (closest && closest.available && closest.url) {
    return {
      archiveUrl: String(closest.url).replace(/^http:\/\/web\.archive\.org\//, 'https://web.archive.org/'),
      timestamp: closest.timestamp || '',
    };
  }
  return null;
}

/** Whether a checked reference is top-priority to archive: broken + no snapshot. */
function isPriorityArchive(verdict, hasSnapshot) {
  return (verdict === 'dead' || verdict === 'suspect') && !hasSnapshot;
}

/* -------------------------------------------------------------------------
 * Network (only reached when the script actually runs, never in tests).
 * ---------------------------------------------------------------------- */

let lastRequestAt = 0;
async function throttle() {
  const wait = DELAY_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/** Read at most maxBytes of a response body as UTF-8 text (bounds huge pages). */
async function readCapped(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    try { return (await res.text()).slice(0, maxBytes); } catch { return ''; }
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let out = '';
  let read = 0;
  try {
    while (read < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.length;
      out += decoder.decode(value, { stream: true });
    }
  } catch { /* partial body is fine for a title probe */ } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
  return out;
}

/** One HTTP request; returns a plain result object (never throws). */
async function httpRequest(url, { method, range, userAgent, wantBody }) {
  const headers = { 'User-Agent': userAgent, Accept: '*/*' };
  if (range) headers.Range = `bytes=0-${MAX_BYTES - 1}`;
  try {
    const res = await fetch(url, {
      method,
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let body = '';
    if (wantBody) body = await readCapped(res, MAX_BYTES);
    else if (res.body && typeof res.body.cancel === 'function') { try { await res.body.cancel(); } catch { /* ignore */ } }
    return { ok: true, status: res.status, finalUrl: res.url || url, redirected: !!res.redirected, body };
  } catch (e) {
    return { ok: false, status: 0, finalUrl: url, redirected: false, body: '', error: e && e.name === 'TimeoutError' ? 'timeout' : (e && e.message) || 'network error' };
  }
}

/** Check one reference URL end-to-end. */
async function checkReference(ref, userAgent) {
  const url = ref.url;
  const result = {
    id: ref.id || null,
    url,
    title: ref.title || null,
    method: 'HEAD',
    status: 0,
    finalUrl: url,
    redirected: false,
    pageTitle: null,
    verdict: 'inconclusive',
    soft404: false,
    snapshot: { exists: false, archiveUrl: null, timestamp: null },
    priorityArchive: false,
    note: '',
  };

  // 1) HEAD probe.
  await throttle();
  let r = await httpRequest(url, { method: 'HEAD', userAgent, wantBody: false });

  // Fall back to a ranged GET when HEAD is unsupported/blocked or errored.
  const headBlocked = !r.ok || [403, 405, 429, 501].includes(r.status);
  if (headBlocked) {
    await throttle();
    const g = await httpRequest(url, { method: 'GET', range: true, userAgent, wantBody: true });
    if (g.ok) { result.method = 'GET'; r = g; }
    else if (!r.ok) { result.method = 'GET'; r = g; } // both failed — report the GET error
  }

  result.status = r.status;
  result.finalUrl = r.finalUrl;
  result.redirected = r.redirected;
  if (!r.ok && r.error) result.note = r.error;

  let verdict = classifyStatus(r.status);

  // 2) Soft-404 probe: when reachable but redirected (or we only have a HEAD),
  // fetch a bounded slice of the body to read the <title> and compare it to the
  // reference's declared title.
  if (verdict === 'ok') {
    if (!result.pageTitle && (result.method !== 'GET') && r.redirected) {
      await throttle();
      const g = await httpRequest(url, { method: 'GET', range: true, userAgent, wantBody: true });
      if (g.ok) { result.status = g.status; result.finalUrl = g.finalUrl; result.redirected = g.redirected; r = g; verdict = classifyStatus(g.status); }
    }
    if (r.body) result.pageTitle = extractTitle(r.body);
    if (verdict === 'ok' && isSoftRedirect({ redirected: result.redirected, expectedTitle: ref.title, actualTitle: result.pageTitle })) {
      verdict = 'suspect';
      result.soft404 = true;
      result.note = result.note || 'redirected/served content whose title no longer matches the reference (possible soft-404)';
    }
  }

  // 3) Wayback snapshot lookup (also throttled and treated as inconclusive on
  // rate-limit — a missing lookup never turns a live link "dead").
  const snap = await lookupSnapshot(url, userAgent);
  if (snap && snap !== 'inconclusive') {
    result.snapshot = { exists: true, archiveUrl: snap.archiveUrl, timestamp: snap.timestamp || null };
  }

  result.verdict = verdict;
  result.priorityArchive = isPriorityArchive(verdict, result.snapshot.exists);
  return result;
}

/** Query the availability API. Returns {archiveUrl,timestamp} | null | 'inconclusive'. */
async function lookupSnapshot(url, userAgent) {
  await throttle();
  const api = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
  const r = await httpRequest(api, { method: 'GET', userAgent, wantBody: true });
  if (!r.ok || r.status === 429 || r.status === 403 || !(r.status >= 200 && r.status < 300)) return 'inconclusive';
  try {
    return parseWaybackAvailable(JSON.parse(r.body));
  } catch {
    return 'inconclusive';
  }
}

/* -------------------------------------------------------------------------
 * Report assembly.
 * ---------------------------------------------------------------------- */

function summarize(results) {
  const s = { total: results.length, ok: 0, dead: 0, suspect: 0, inconclusive: 0, priorityArchive: 0 };
  for (const r of results) {
    s[r.verdict] = (s[r.verdict] || 0) + 1;
    if (r.priorityArchive) s.priorityArchive++;
  }
  s.flagged = s.dead + s.suspect + s.inconclusive;
  return s;
}

function toMarkdown(report) {
  const s = report.summary;
  const lines = [];
  lines.push(`# 🔗 Link health — ${report.project}`);
  lines.push('');
  lines.push(`Checked ${s.total} reference URL(s) on ${report.checkedAt}.`);
  lines.push('');
  lines.push(`- ✅ OK: **${s.ok}**`);
  lines.push(`- ❌ Dead (4xx): **${s.dead}**`);
  lines.push(`- ⚠️ Suspect (soft-404 / unrelated redirect): **${s.suspect}**`);
  lines.push(`- ❔ Inconclusive (403/429/5xx/timeout — bot-blocked or transient, NOT dead): **${s.inconclusive}**`);
  lines.push(`- 🗄️ Top-priority to archive (broken **and** no Wayback snapshot): **${s.priorityArchive}**`);
  lines.push('');

  const section = (title, rows) => {
    if (!rows.length) return;
    lines.push(`## ${title}`);
    lines.push('');
    for (const r of rows) {
      const arch = r.snapshot.exists ? `[snapshot](${r.snapshot.archiveUrl})` : 'no snapshot';
      const via = r.redirected && r.finalUrl !== r.url ? ` → ${r.finalUrl}` : '';
      const extra = r.note ? ` — ${r.note}` : '';
      lines.push(`- **${r.verdict.toUpperCase()}** \`${r.status || '—'}\` [${r.id || r.url}](${r.url})${via} · ${arch}${r.priorityArchive ? ' · **ARCHIVE NOW**' : ''}${extra}`);
    }
    lines.push('');
  };

  section('🗄️ Archive now (broken, no snapshot)', report.results.filter((r) => r.priorityArchive));
  section('❌ Dead', report.results.filter((r) => r.verdict === 'dead' && !r.priorityArchive));
  section('⚠️ Suspect (soft-404)', report.results.filter((r) => r.verdict === 'suspect' && !r.priorityArchive));
  section('❔ Inconclusive', report.results.filter((r) => r.verdict === 'inconclusive'));

  if (s.flagged === 0) {
    lines.push('All reference links resolved cleanly. 🎉');
    lines.push('');
  }
  lines.push('<!-- link-health-report -->');
  lines.push('');
  lines.push('_Generated by `scripts/check-links.js`. This report never edits `data/chronology.json`; it flags URLs for manual review and for `scripts/archive-refs.js`._');
  return lines.join('\n') + '\n';
}

function parseArgs(argv) {
  const args = { json: 'link-health-report.json', md: null, project: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = argv[++i];
    else if (a === '--md') args.md = argv[++i];
    else if (a === '--project') args.project = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error(`check-links: cannot read ${DATA_FILE} — ${e.message}`);
    process.exit(1);
  }
  const references = (Array.isArray(data.references) ? data.references : []).filter((r) => r && typeof r.url === 'string' && /^https?:\/\//.test(r.url));
  const project = args.project || (data.meta && data.meta.title) || 'Cronologia project';
  const userAgent = deriveUserAgent(project);

  const results = [];
  for (const ref of references) {
    process.stderr.write(`checking ${ref.id || ref.url} …\n`);
    /* eslint-disable no-await-in-loop */
    results.push(await checkReference(ref, userAgent));
    /* eslint-enable no-await-in-loop */
  }

  const report = {
    generatedBy: 'scripts/check-links.js',
    project,
    checkedAt: new Date().toISOString(),
    userAgent,
    summary: summarize(results),
    results,
  };

  if (args.json) fs.writeFileSync(args.json, JSON.stringify(report, null, 2) + '\n');
  const md = toMarkdown(report);
  if (args.md) fs.writeFileSync(args.md, md);
  process.stdout.write(md);

  const s = report.summary;
  process.stderr.write(
    `\nDone: ${s.total} checked — ${s.ok} ok, ${s.dead} dead, ${s.suspect} suspect, ` +
    `${s.inconclusive} inconclusive, ${s.priorityArchive} to archive.\n`
  );
  // Exit 0 even when links are flagged: the scheduled workflow decides what to
  // do with the report (open/update an issue). Only a hard error above exits 1.
}

// Run only when invoked directly; when required (tests) expose the pure helpers.
if (require.main === module) {
  main().catch((e) => {
    console.error(`check-links: ${e.message}`);
    process.exit(1);
  });
}

module.exports = {
  deriveUserAgent, extractTitle, decodeEntities, titleTokens, titleSimilarity,
  looksLikeNotFound, isSoftRedirect, classifyStatus, parseWaybackAvailable,
  isPriorityArchive, summarize, toMarkdown, parseArgs,
};
