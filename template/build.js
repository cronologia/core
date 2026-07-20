#!/usr/bin/env node
/**
 * Cronologia — static site generator.
 *
 * Zero dependencies. Reads data/chronology.json and compiles a self-contained
 * static website into docs/ (chosen so it can be served directly by GitHub
 * Pages from the `docs/` folder on the default branch).
 *
 * Same architecture as the sibling `cronologia/fsp` project (see its ADRs
 * 0001–0003): JSON is the single source of truth, the compiler is dependency-
 * free, and the compiled docs/ folder is committed.
 *
 * Usage: node build.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'chronology.json');
const ARCHIVES_FILE = path.join(ROOT, 'data', 'archives.json');
const SRC_DIR = path.join(ROOT, 'src');
const OUT_DIR = path.join(ROOT, 'docs');

// Google Analytics (gtag.js). Injected into the <head> of every generated page.
// The measurement ID is shared across the Cronologia projects and is a public
// identifier, not a secret.
const ANALYTICS = `  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-R9LV1QZHVE"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-R9LV1QZHVE');
  </script>`;

/** Minimal HTML escaper for text interpolated into the page. */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------------------------------------------------------------------------
 * Glossary cross-links (optional, off by default).
 *
 * A prose text field may embed an inline marker that the build turns into a
 * link to the shared Cronologia glossary's per-term page:
 *
 *     [[term-id]]                -> link, visible text = the term-id
 *     [[term-id|visible text]]   -> link, visible text = "visible text"
 *
 * rendered as
 *     <a class="glossary-link" href="https://cronologia.github.io/glossary/<term-id>/">…</a>
 *
 * `term-id` is a glossary slug ([a-z0-9] then [a-z0-9-]*, e.g. `latae-sententiae`).
 * The visible text may be any run of characters except `|` and `]`.
 *
 * The expansion runs AFTER esc(), on the already-escaped string, and only when
 * a `[[` is present — so a field with no marker renders as exactly esc(field)
 * and datasets that don't use the feature are byte-for-byte identical to a
 * build without it (the same optional-feature contract as the viz renderers).
 * The validator (scripts/validate-data.js) fails the build on any marker whose
 * id is not in the vendored data/glossary-terms.json list.
 * ------------------------------------------------------------------------- */

const GLOSSARY_BASE = 'https://cronologia.github.io/glossary/';
// Single source of the marker grammar, shared with the validator. Group 1 is
// the term-id, group 2 the optional visible text.
const GLOSSARY_MARKER = /\[\[([a-z0-9][a-z0-9-]*)(?:\|([^\]|]*))?\]\]/;

/** Extract the term-ids referenced by every [[…]] marker in a raw text field. */
function glossaryMarkerIds(text) {
  if (typeof text !== 'string' || text.indexOf('[[') === -1) return [];
  const re = new RegExp(GLOSSARY_MARKER.source, 'g');
  const ids = [];
  let m;
  while ((m = re.exec(text)) !== null) ids.push(m[1]);
  return ids;
}

/**
 * Expand glossary markers in an already-HTML-escaped string. No-op (returns the
 * input unchanged) when no marker is present, keeping output byte-identical for
 * marker-free text.
 */
function renderGlossaryLinks(escaped) {
  if (typeof escaped !== 'string' || escaped.indexOf('[[') === -1) return escaped;
  return escaped.replace(new RegExp(GLOSSARY_MARKER.source, 'g'), (_m, id, label) => {
    const text = label && label.trim() ? label : id;
    return `<a class="glossary-link" href="${GLOSSARY_BASE}${id}/">${text}</a>`;
  });
}

/** Render a prose text field: escape it, then expand any glossary markers. */
function renderText(value) {
  return renderGlossaryLinks(esc(value));
}

/** Format a 14-digit Wayback timestamp (YYYYMMDDhhmmss) as YYYY-MM-DD. */
function formatArchiveTs(ts) {
  if (!ts || ts.length < 8) return '';
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}

/** Load the machine-generated Wayback snapshot cache (url -> snapshot), if any. */
function loadArchives() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ARCHIVES_FILE, 'utf8'));
    return (parsed && parsed.snapshots) || {};
  } catch {
    return {};
  }
}

/**
 * Render superscript citation markers ("[1] [2]") for a `sources` array of
 * reference ids, linking to the anchored References list. Raw URLs are allowed
 * as a migration path and render as [web].
 */
function renderCites(sources, refNumById) {
  if (!Array.isArray(sources) || sources.length === 0) return '';
  const marks = sources
    .map((s) => {
      if (refNumById.has(s)) {
        const n = refNumById.get(s);
        return `<a href="#ref-${n}" title="Reference ${n}">[${n}]</a>`;
      }
      if (/^https?:\/\//.test(s)) {
        return `<a href="${esc(s)}" rel="noopener noreferrer" target="_blank">[web]</a>`;
      }
      return '';
    })
    .filter(Boolean)
    .join(' ');
  return marks ? `<sup class="cite">${marks}</sup>` : '';
}

/**
 * Render the header viz-chips — pill links from the header to the site's
 * visual sections (pattern shipped in the fsp/fsspx sites). Driven by the
 * optional `meta.vizChips` array of { href, label } objects, e.g.
 * [{ "href": "#chronology", "label": "📜 Chronology" }]. Returns '' when the
 * project declares none, so the header stays unchanged by default.
 */
function renderVizChips(vizChips) {
  if (!Array.isArray(vizChips) || vizChips.length === 0) return '';
  const links = vizChips
    .map((c) => `        <a href="${esc(c.href)}">${esc(c.label)}</a>`)
    .join('\n');
  return `\n      <div class="viz-chips">\n${links}\n      </div>`;
}

/** Group events by decade for the chronology's section headers. */
function decadeOf(year) {
  return `${Math.floor(year / 10) * 10}s`;
}

/* ---------------------------------------------------------------------------
 * Genealogy / lineage-tree renderer (extracted from the fsspx site).
 *
 * Driven by the optional top-level `lineage` key (alias: `episcopalLineage`,
 * the original fsspx name) of data/chronology.json:
 *
 *   lineage: {
 *     heading?:  string          // default "Episcopal genealogy" (fsspx look)
 *     navLabel?: string          // default "Genealogy" (nav bar link text)
 *     note:      string          // section intro; attribute contested claims
 *     edgeLegend?: { direct, indirect }  // legend labels (defaults below)
 *     trees: [{
 *       title:    string
 *       summary?: string
 *       sources:  [refId]
 *       separate?: true          // visually separated branch (amber accent) —
 *                                // for lines that must NOT be read as
 *                                // connected to the main lineage
 *       root: node
 *     }]
 *   }
 *
 *   node: {
 *     name: string, detail?: string, status?: string, sources: [refId],
 *     edge?: "direct" | "indirect"   // edge TO THE PARENT. Default "direct"
 *                                    // (solid connector = consecration/
 *                                    // initiation). "indirect" renders a
 *                                    // DASHED connector = reference/
 *                                    // association, not lineage.
 *     edgeLabel?: string             // small badge naming the indirect link
 *     children?: [node]
 *   }
 *
 * When no node declares `edge`/`edgeLabel`, the markup is byte-identical to
 * the fsspx site's current genealogy section (no legend, no extra classes),
 * so existing sites can adopt this module without visual change. When the
 * key is absent entirely, renderLineageSection returns '' and the page is
 * byte-identical to a build without this feature.
 * ------------------------------------------------------------------------- */

/** Recursively render one node of a lineage tree. */
function renderLineageNode(node, refNumById) {
  const cls = node.edge === 'indirect' ? ' class="tree-edge-indirect"' : '';
  const edgeLabel = node.edgeLabel ? `<span class="tree-edge-label">${esc(node.edgeLabel)}</span> ` : '';
  const detail = node.detail ? ` <span class="tree-detail">${esc(node.detail)}</span>` : '';
  const status = node.status ? `<div class="tree-status">${esc(node.status)}</div>` : '';
  const kids = Array.isArray(node.children) && node.children.length
    ? `\n<ul>\n${node.children.map((c) => renderLineageNode(c, refNumById)).join('\n')}\n</ul>`
    : '';
  return `<li${cls}>${edgeLabel}<span class="tree-node"><strong>${esc(node.name)}</strong>${detail}${renderCites(node.sources, refNumById)}</span>${status}${kids}</li>`;
}

/** True when any node in any tree declares an indirect (dashed) edge. */
function lineageHasIndirectEdges(lineage) {
  const walk = (node) => !!node && (node.edge === 'indirect'
    || (Array.isArray(node.children) && node.children.some(walk)));
  return !!lineage && Array.isArray(lineage.trees) && lineage.trees.some((t) => walk(t.root));
}

/**
 * Edge-type legend (solid vs dashed). Rendered only when the data actually
 * uses an indirect edge, so edge-free datasets keep today's fsspx look.
 */
function renderLineageLegend(lineage) {
  if (!lineageHasIndirectEdges(lineage)) return '';
  const labels = Object.assign(
    { direct: 'Direct consecration/initiation', indirect: 'Indirect reference/association' },
    lineage.edgeLegend
  );
  return `
      <div class="lineage-legend">
        <span class="legend-item"><span class="legend-swatch legend-direct"></span>${esc(labels.direct)}</span>
        <span class="legend-item"><span class="legend-swatch legend-indirect"></span>${esc(labels.indirect)}</span>
      </div>`;
}

/**
 * Render the lineage section: one tree per branch, `separate: true` branches
 * visually set apart (the fsspx pattern for the Thục/Palmar line, which is
 * NOT SSPX lineage). Returns '' when the data declares no lineage.
 */
function renderLineageSection(lineage, refNumById) {
  if (!lineage || !Array.isArray(lineage.trees) || lineage.trees.length === 0) return '';
  const branches = lineage.trees
    .map((t) => `      <div class="lineage-branch${t.separate ? ' lineage-separate' : ''}">
        <h3>${esc(t.title)}</h3>
        ${t.summary ? `<p class="related-meta">${esc(t.summary)}${renderCites(t.sources, refNumById)}</p>` : ''}
        <ul class="tree">
${renderLineageNode(t.root, refNumById)}
        </ul>
      </div>`)
    .join('\n');
  return `    <section id="lineage">
      <h2>${esc(lineage.heading || 'Episcopal genealogy')}</h2>
      <p class="section-intro">${esc(lineage.note)}</p>${renderLineageLegend(lineage)}
${branches}
    </section>

`;
}

/* ---------------------------------------------------------------------------
 * Branch-timeline ("subway diagram") renderer — NEW.
 *
 * A horizontal timeline where an organization's divisions fork off as labeled
 * branches (e.g. SSPX → SSPV 1983 → Campos → Resistance 2012 → 2026). Static
 * inline SVG: print-friendly (viewBox scales to a book page), mobile-safe
 * (horizontal scroll contained in its own .viz-scroll container).
 *
 * Driven by the optional top-level `branchTimeline` key:
 *
 *   branchTimeline: {
 *     heading?:  string       // default "Divisions timeline"
 *     navLabel?: string       // default "Divisions" (nav bar link text)
 *     note?:     string       // section intro; attribute contested labels
 *     start?:    number       // left edge year (default: trunk.start)
 *     end:       number       // right edge year (the "→ 2026" endpoint)
 *     pxPerYear?: number      // horizontal scale (default 13)
 *     trunk: { id?, label, start, note?, sources }
 *     branches: [{
 *       id?:    string        // needed only if another branch forks off it
 *       label:  string
 *       year:   number        // fork year
 *       end?:   number        // terminal year (branch ended/merged) — draws
 *                             // an end dot; omitted = runs to the right edge
 *       from?:  string        // id of trunk/branch it forks from (default trunk)
 *       note?:  string
 *       sources: [refId]
 *     }]
 *   }
 *
 * Lanes are assigned in listing order (trunk on top, each branch one lane
 * below), so the data order controls the vertical layout. Every branch is
 * also listed in a <figcaption> with its note and citations — the SVG never
 * carries an uncited claim on its own. Absent key = '' = byte-identical page.
 * ------------------------------------------------------------------------- */

const BT_GEOM = { padLeft: 20, padRight: 80, padTop: 36, padBottom: 42, laneHeight: 46, pxPerYear: 13, curve: 14 };

/**
 * Pure geometry for the branch timeline: year→x scale, lane assignment,
 * fork/end coordinates, decade ticks. Returns null when the data is absent
 * or has no branches (renderBranchTimeline then renders nothing).
 */
function layoutBranchTimeline(bt) {
  if (!bt || !bt.trunk || !Array.isArray(bt.branches) || bt.branches.length === 0) return null;
  const minYear = Number.isFinite(bt.start) ? bt.start : bt.trunk.start;
  const maxYear = bt.end;
  if (!Number.isFinite(minYear) || !Number.isFinite(maxYear) || maxYear <= minYear) return null;
  const scale = Number.isFinite(bt.pxPerYear) && bt.pxPerYear > 0 ? bt.pxPerYear : BT_GEOM.pxPerYear;
  const x = (year) => BT_GEOM.padLeft + (year - minYear) * scale;
  const laneY = (i) => BT_GEOM.padTop + i * BT_GEOM.laneHeight;

  const laneById = new Map([[bt.trunk.id || 'trunk', 0]]);
  bt.branches.forEach((b, i) => { if (b.id) laneById.set(b.id, i + 1); });

  const trunkStart = Number.isFinite(bt.trunk.start) ? bt.trunk.start : minYear;
  const trunk = { label: bt.trunk.label, start: trunkStart, x1: x(trunkStart), x2: x(maxYear), y: laneY(0) };

  const branches = bt.branches.map((b, i) => {
    const lane = i + 1;
    const fromLane = laneById.has(b.from) ? laneById.get(b.from) : 0;
    const terminal = Number.isFinite(b.end);
    return {
      label: b.label, year: b.year, end: terminal ? b.end : undefined,
      lane, colorIndex: (lane - 1) % 6, terminal,
      xFork: x(b.year), xEnd: x(terminal ? b.end : maxYear),
      y: laneY(lane), yFrom: laneY(fromLane),
    };
  });

  const ticks = [];
  for (let year = Math.ceil(minYear / 10) * 10; year <= maxYear; year += 10) ticks.push(year);
  if (ticks[ticks.length - 1] !== maxYear) ticks.push(maxYear);

  return {
    minYear, maxYear, scale,
    width: x(maxYear) + BT_GEOM.padRight,
    height: laneY(bt.branches.length) + BT_GEOM.padBottom,
    ticks: ticks.map((year) => ({ year, x: x(year) })),
    trunk, branches,
  };
}

/** Render the branch-timeline section (static SVG + cited caption), or ''. */
function renderBranchTimeline(bt, refNumById) {
  const layout = layoutBranchTimeline(bt);
  if (!layout) return '';
  const { width, height, trunk, branches, ticks } = layout;
  const axisTop = BT_GEOM.padTop - 18;
  const axisBottom = height - BT_GEOM.padBottom + 16;

  const tickMarks = ticks
    .map((t) => `          <g class="bt-tick"><line x1="${t.x}" y1="${axisTop}" x2="${t.x}" y2="${axisBottom}"></line><text x="${t.x}" y="${height - 10}">${esc(t.year)}</text></g>`)
    .join('\n');

  const trunkMark = `          <g class="bt-line bt-trunk"><line x1="${trunk.x1}" y1="${trunk.y}" x2="${trunk.x2}" y2="${trunk.y}"></line><circle cx="${trunk.x1}" cy="${trunk.y}" r="5"></circle><text class="bt-label" x="${trunk.x1}" y="${trunk.y - 10}">${esc(trunk.label)} · ${esc(trunk.start)}</text></g>`;

  const branchMarks = branches
    .map((b) => {
      const midY = (b.yFrom + b.y) / 2;
      const path = `M ${b.xFork} ${b.yFrom} C ${b.xFork} ${midY} ${b.xFork} ${b.y} ${b.xFork + BT_GEOM.curve} ${b.y} L ${b.xEnd} ${b.y}`;
      const endDot = b.terminal ? `<circle cx="${b.xEnd}" cy="${b.y}" r="5"></circle>` : '';
      const years = b.terminal ? `${b.year}–${b.end}` : b.year;
      return `          <g class="bt-line bt-c${b.colorIndex}"><circle class="bt-fork" cx="${b.xFork}" cy="${b.yFrom}" r="4"></circle><path d="${path}"></path>${endDot}<text class="bt-label" x="${b.xFork + BT_GEOM.curve + 4}" y="${b.y - 10}">${esc(b.label)} · ${esc(years)}</text></g>`;
    })
    .join('\n');

  const captionItems = [
    `            <li><strong>${esc(bt.trunk.label)} (${esc(trunk.start)})</strong>${bt.trunk.note ? ` — ${esc(bt.trunk.note)}` : ''}${renderCites(bt.trunk.sources, refNumById)}</li>`,
    ...bt.branches.map((b) => {
      const years = Number.isFinite(b.end) ? `${b.year}–${b.end}` : b.year;
      return `            <li><strong>${esc(b.label)} (${esc(years)})</strong>${b.note ? ` — ${esc(b.note)}` : ''}${renderCites(b.sources, refNumById)}</li>`;
    }),
  ].join('\n');

  const heading = bt.heading || 'Divisions timeline';
  return `    <section id="branch-timeline">
      <h2>${esc(heading)}</h2>
      ${bt.note ? `<p class="section-intro">${esc(bt.note)}</p>` : ''}
      <figure class="branch-timeline">
        <div class="viz-scroll">
        <svg class="branch-timeline-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(heading)}">
${tickMarks}
${trunkMark}
${branchMarks}
        </svg>
        </div>
        <figcaption>
          <ol class="branch-notes">
${captionItems}
          </ol>
        </figcaption>
      </figure>
    </section>

`;
}

function renderEventRow(ev, refNumById) {
  const flag = ev.dateVerified === false
    ? ' <span class="flag" title="Date not yet verified against a primary source">?</span>'
    : '';
  const text = ev.text ? ` <span class="muted">— ${renderText(ev.text)}</span>` : '';
  return `        <tr>
          <td class="year">${esc(ev.year)}</td>
          <td>${esc(ev.date || '')}${flag}</td>
          <td>${esc(ev.place || '')}</td>
          <td><strong>${esc(ev.title)}</strong>${text}${renderCites(ev.sources, refNumById)}</td>
        </tr>`;
}

function renderFigureCard(fig, refNumById) {
  const meta = [fig.dates, fig.country].filter(Boolean).map(esc).join(' · ');
  return `      <div class="party-card">
        <h3>${esc(fig.name)}</h3>
        ${meta ? `<p class="country">${meta}</p>` : ''}
        <p class="figures">${renderText(fig.role)}${renderCites(fig.sources, refNumById)}</p>
        ${fig.notes ? `<p class="party-notes">${renderText(fig.notes)}</p>` : ''}
      </div>`;
}

function renderOrgCard(org, refNumById) {
  const meta = [org.founded ? `Founded ${org.founded}` : null, org.place].filter(Boolean).map(esc).join(' · ');
  return `      <div class="related-card">
        <h3>${esc(org.name)}</h3>
        ${meta ? `<p class="related-meta">${meta}</p>` : ''}
        <p>${renderText(org.relation)}${renderCites(org.sources, refNumById)}</p>
        ${org.notes ? `<p class="related-meta">${renderText(org.notes)}</p>` : ''}
        ${org.url ? `<p class="related-link"><a href="${esc(org.url)}" rel="noopener noreferrer" target="_blank">${esc(org.url)}</a></p>` : ''}
      </div>`;
}

function renderReference(r, n, archives) {
  const snap = archives[r.url];
  const archived = snap && snap.archiveUrl
    ? ` · <a class="archive-link" href="${esc(snap.archiveUrl)}" rel="noopener noreferrer" target="_blank">🗄 archived${snap.timestamp ? ` ${esc(formatArchiveTs(snap.timestamp))}` : ''}</a>`
    : '';
  return `        <li id="ref-${n}">
          <a href="${esc(r.url)}" rel="noopener noreferrer" target="_blank">${esc(r.title)}</a>${archived}
          <span class="ref-meta">${esc(r.publisher)} · ${esc(r.type)}</span>
        </li>`;
}

function renderPage(data, archives) {
  const { meta, facts, events, figures, organizations, disambiguation, references } = data;
  // `episcopalLineage` is the original fsspx key, kept as an alias.
  const lineage = data.lineage || data.episcopalLineage;
  const branchTimeline = data.branchTimeline;

  // Stable citation numbering: references keep their file order.
  const refNumById = new Map(references.map((r, i) => [r.id, i + 1]));

  // Optional visual sections ('' when the data declares none — the page is
  // then byte-identical to a build without these features).
  const lineageHtml = renderLineageSection(lineage, refNumById);
  const branchTimelineHtml = renderBranchTimeline(branchTimeline, refNumById);

  const sortedEvents = [...events].sort((a, b) => a.year - b.year || String(a.date || '').localeCompare(String(b.date || '')));

  // Chronology rows with a decade header row whenever the decade changes.
  let lastDecade = null;
  const eventRows = sortedEvents
    .map((ev) => {
      const d = decadeOf(ev.year);
      const header = d !== lastDecade
        ? `        <tr class="decade-row"><th colspan="4">${esc(d)}</th></tr>\n`
        : '';
      lastDecade = d;
      return header + renderEventRow(ev, refNumById);
    })
    .join('\n');

  const factRows = (facts || [])
    .map((f) => {
      const flag = f.verified === false ? ' <span class="flag" title="Not yet verified against a primary source">?</span>' : '';
      return `        <dt>${esc(f.label)}</dt>\n        <dd>${renderText(f.value)}${flag}${renderCites(f.sources, refNumById)}</dd>`;
    })
    .join('\n');

  const disambigCards = ((disambiguation && disambiguation.items) || [])
    .map((it) => `      <div class="cp-card">
        <h3>${esc(it.title)}</h3>
        <p>${renderText(it.text)}${renderCites(it.sources, refNumById)}</p>
      </div>`)
    .join('\n');

  const archivedRefs = references.filter((r) => archives[r.url] && archives[r.url].archiveUrl).length;

  return `<!DOCTYPE html>
<html lang="${esc(meta.language || 'en')}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(meta.title)}</title>
  <meta name="description" content="${esc(meta.description)}">
${ANALYTICS}
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="site-header">
    <div class="wrap">
      <h1>${esc(meta.title)}</h1>
      <p class="subtitle">${esc(meta.subtitle)}</p>
      <p class="lead">${esc(meta.description)}</p>
      <p class="updated">Last updated: ${esc(meta.lastUpdated)}</p>${renderVizChips(meta.vizChips)}
    </div>
  </header>

  <nav class="site-nav">
    <div class="wrap">
      <a href="#about">About</a>
      <a href="#chronology">Chronology</a>${lineageHtml ? `\n      <a href="#lineage">${esc(lineage.navLabel || 'Genealogy')}</a>` : ''}${branchTimelineHtml ? `\n      <a href="#branch-timeline">${esc(branchTimeline.navLabel || 'Divisions')}</a>` : ''}
      <a href="#figures">Key figures</a>
      <a href="#organizations">Organizations</a>
      ${disambigCards ? '<a href="#disambiguation">Disambiguation</a>' : ''}
      <a href="#references">References</a>
    </div>
  </nav>

  <main class="wrap">
    <section id="about">
      <h2>About</h2>
      <p class="notice">${esc(meta.dataQualityNote)}</p>
      <dl class="facts">
${factRows}
      </dl>
    </section>

    <section id="chronology">
      <h2>Chronology</h2>
      <p class="section-intro">Key events in chronological order. A <span class="flag">?</span> flag marks
      dates not yet verified against a primary source.</p>
      <div class="table-scroll">
      <table class="meetings">
        <thead>
          <tr><th>Year</th><th>Date</th><th>Place</th><th>Event</th></tr>
        </thead>
        <tbody>
${eventRows}
        </tbody>
      </table>
      </div>
    </section>

${lineageHtml}${branchTimelineHtml}    <section id="figures">
      <h2>Key figures</h2>
      <div class="party-grid">
${figures.map((f) => renderFigureCard(f, refNumById)).join('\n')}
      </div>
    </section>

    <section id="organizations">
      <h2>Related organizations</h2>
      <div class="party-grid">
${(organizations || []).map((o) => renderOrgCard(o, refNumById)).join('\n')}
      </div>
    </section>

${disambigCards ? `    <section id="disambiguation">
      <h2>Disambiguation &amp; nuance</h2>
      ${disambiguation.note ? `<p class="notice notice-attribution">${esc(disambiguation.note)}</p>` : ''}
      <div class="party-grid">
${disambigCards}
      </div>
    </section>
` : ''}
    <section id="references">
      <h2>References</h2>
      <p class="section-intro">${references.length} sources${archivedRefs ? ` · ${archivedRefs} with an Internet Archive fallback` : ''}. Sources span the
      spectrum of perspectives by design; contested claims are attributed to their authors.</p>
      <ol class="references">
${references.map((r, i) => renderReference(r, i + 1, archives)).join('\n')}
      </ol>
    </section>
  </main>

  <footer class="site-footer">
    <div class="wrap">
      <p>Compiled static site generated from <code>data/chronology.json</code> by <code>build.js</code>. Open data — corrections welcome via pull request.
      Part of the Cronologia project family.</p>
    </div>
  </footer>
</body>
</html>
`;
}

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const archives = loadArchives();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), renderPage(data, archives));
  fs.copyFileSync(path.join(SRC_DIR, 'styles.css'), path.join(OUT_DIR, 'styles.css'));
  // Disable Jekyll processing on GitHub Pages.
  fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '');

  const archivedRefs = data.references.filter((r) => archives[r.url] && archives[r.url].archiveUrl).length;
  console.log(
    `Built docs/index.html (${data.events.length} events, ${data.figures.length} figures, ` +
    `${data.references.length} references, ${archivedRefs} with archive fallback).`
  );
}

// Run the build only when invoked directly; when required (tests) just expose
// the pure helpers so they can be unit-tested without generating docs/.
if (require.main === module) main();

module.exports = {
  esc, formatArchiveTs, renderCites, renderVizChips, decadeOf,
  GLOSSARY_BASE, GLOSSARY_MARKER, glossaryMarkerIds, renderGlossaryLinks, renderText,
  renderLineageNode, lineageHasIndirectEdges, renderLineageLegend, renderLineageSection,
  layoutBranchTimeline, renderBranchTimeline, BT_GEOM,
  renderPage,
};
