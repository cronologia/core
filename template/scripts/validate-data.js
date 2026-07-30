#!/usr/bin/env node
'use strict';
/**
 * validate-data.js — zero-dependency schema check for data/chronology.json.
 *
 * Validates required fields, types, and that every `sources` entry resolves to
 * a reference id (raw http(s) URLs are allowed as a migration path). Prints all
 * problems and exits non-zero if any are found, so CI can gate on it.
 *
 * Usage: node scripts/validate-data.js
 */

const fs = require('fs');
const path = require('path');
const { glossaryMarkerIds, placeIndex, resolvePlaceString } = require('../build.js');

const ROOT = path.join(__dirname, '..');
const FILE = 'data/chronology.json';
const GLOSSARY_TERMS_FILE = 'data/glossary-terms.json';
const PLACES_FILE = 'data/places.json';
const errors = [];

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isArr = (v) => Array.isArray(v);

function err(msg) {
  errors.push(`${FILE}: ${msg}`);
}

let d;
try {
  d = JSON.parse(fs.readFileSync(path.join(ROOT, FILE), 'utf8'));
} catch (e) {
  console.error(`${FILE}: invalid JSON — ${e.message}`);
  process.exit(1);
}

// ---- meta -----------------------------------------------------------------
if (!d.meta) err('meta missing');
else {
  for (const k of ['title', 'subtitle', 'description', 'language', 'lastUpdated', 'dataQualityNote']) {
    if (!isStr(d.meta[k])) err(`meta.${k} missing`);
  }
  if (d.meta.lastUpdated && !/^\d{4}-\d{2}-\d{2}$/.test(d.meta.lastUpdated)) {
    err(`meta.lastUpdated must be YYYY-MM-DD, got ${d.meta.lastUpdated}`);
  }
  // Optional header pill links to visual sections (viz-chips).
  if (d.meta.vizChips !== undefined) {
    if (!isArr(d.meta.vizChips)) err('meta.vizChips must be an array');
    else d.meta.vizChips.forEach((c, i) => {
      const at = `meta.vizChips[${i}]`;
      if (!isStr(c.href) || !c.href.startsWith('#')) err(`${at}.href must be a "#section" anchor`);
      if (!isStr(c.label)) err(`${at}.label missing`);
    });
  }
}

// ---- references (validated first so sources[] can be checked against ids) --
const refIds = new Set();
if (!isArr(d.references) || d.references.length === 0) {
  err('references[] missing or empty');
} else {
  d.references.forEach((r, i) => {
    const at = `references[${i}]`;
    if (!isStr(r.id)) err(`${at}.id missing`);
    else if (refIds.has(r.id)) err(`${at}.id duplicated: ${r.id}`);
    else refIds.add(r.id);
    if (!isStr(r.title)) err(`${at}.title missing`);
    if (!isStr(r.url) || !/^https?:\/\//.test(r.url)) err(`${at}.url must be an http(s) URL`);
    if (!isStr(r.publisher)) err(`${at}.publisher missing`);
    if (!isStr(r.type)) err(`${at}.type missing`);
  });
}

function checkSources(at, sources, required) {
  if (sources === undefined) {
    if (required) err(`${at}.sources missing (every fact must be cited)`);
    return;
  }
  if (!isArr(sources)) return err(`${at}.sources must be an array`);
  if (required && sources.length === 0) err(`${at}.sources empty (every fact must be cited)`);
  for (const s of sources) {
    if (!refIds.has(s) && !/^https?:\/\//.test(s)) {
      err(`${at}.sources: unknown reference id "${s}"`);
    }
  }
}

// ---- facts ----------------------------------------------------------------
if (!isArr(d.facts) || d.facts.length === 0) err('facts[] missing or empty');
else {
  d.facts.forEach((f, i) => {
    const at = `facts[${i}]`;
    if (!isStr(f.label)) err(`${at}.label missing`);
    if (!isStr(f.value)) err(`${at}.value missing`);
    checkSources(at, f.sources, true);
  });
}

// ---- events ---------------------------------------------------------------
if (!isArr(d.events) || d.events.length === 0) err('events[] missing or empty');
else {
  d.events.forEach((ev, i) => {
    const at = `events[${i}]`;
    if (!isNum(ev.year) || ev.year < 1500 || ev.year > 2100) err(`${at}.year must be a plausible number`);
    if (!isStr(ev.title)) err(`${at}.title missing`);
    if (ev.date !== undefined && !isStr(ev.date)) err(`${at}.date must be a string`);
    if (typeof ev.dateVerified !== 'boolean') err(`${at}.dateVerified must be boolean`);
    checkSources(at, ev.sources, true);
  });
}

// ---- threads (per-repo lane taxonomy — core#23) -----------------------------
// Events may carry an OPTIONAL `threads: string[]` naming the storyline(s)
// they belong to. The vocabulary is per-repo and editorial: it must be declared
// in meta.threads — with a visible editorial note and each lane's grounding —
// never invented in code or derived by clustering the text. An absent field is
// always valid (this rolls out with no flag day), and a dataset without the
// key must build byte-identically. See sourcing-rules ("Thread taxonomies are
// a reading") for the editorial rules the declaration encodes.
const laneIds = new Set();
if (d.meta && d.meta.threads !== undefined) {
  const t = d.meta.threads;
  const at = 'meta.threads';
  if (!isStr(t.note)) {
    err(`${at}.note missing — the visible statement that the lane taxonomy is an editorial reading, not a neutral fact (rendered wherever lanes render)`);
  }
  if (!isArr(t.lanes) || t.lanes.length === 0) {
    err(`${at}.lanes must be a non-empty array of { id, label, basis }`);
  } else {
    t.lanes.forEach((l, i) => {
      const lAt = `${at}.lanes[${i}]`;
      if (!isStr(l.id)) err(`${lAt}.id missing`);
      else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(l.id)) err(`${lAt}.id must be kebab-case, got "${l.id}"`);
      else if (laneIds.has(l.id)) err(`${lAt}.id duplicated: ${l.id}`);
      else laneIds.add(l.id);
      if (!isStr(l.label)) err(`${lAt}.label missing`);
      if (!isStr(l.basis)) err(`${lAt}.basis missing — name what grounds this lane, so the editorial decision is recorded in the data, not implied by it`);
      checkSources(lAt, l.sources, false);
    });
  }
}
if (isArr(d.events)) {
  d.events.forEach((ev, i) => {
    if (ev.threads === undefined) return;
    const at = `events[${i}]`;
    if (!isArr(ev.threads) || !ev.threads.every(isStr)) {
      return err(`${at}.threads must be an array of lane ids (an array even for one lane — cross-cutting events belong to more than one thread)`);
    }
    if (laneIds.size === 0) {
      return err(`${at}.threads used but meta.threads declares no lanes — declare the taxonomy (note + lanes with id/label/basis) before tagging events`);
    }
    for (const th of ev.threads) {
      if (!laneIds.has(th)) err(`${at}.threads: unknown lane id "${th}" (not declared in meta.threads.lanes)`);
    }
  });
}

// ---- figures --------------------------------------------------------------
if (!isArr(d.figures) || d.figures.length === 0) err('figures[] missing or empty');
else {
  d.figures.forEach((f, i) => {
    const at = `figures[${i}]`;
    if (!isStr(f.name)) err(`${at}.name missing`);
    if (!isStr(f.role)) err(`${at}.role missing`);
    checkSources(at, f.sources, true);
  });
}

// ---- organizations --------------------------------------------------------
if (d.organizations !== undefined) {
  if (!isArr(d.organizations)) err('organizations must be an array');
  else d.organizations.forEach((o, i) => {
    const at = `organizations[${i}]`;
    if (!isStr(o.name)) err(`${at}.name missing`);
    if (!isStr(o.relation)) err(`${at}.relation missing`);
    checkSources(at, o.sources, true);
  });
}

// ---- lineage (genealogy trees; alias episcopalLineage) --------------------
function checkLineageNode(node, at) {
  if (!node || !isStr(node.name)) return err(`${at}.name missing`);
  checkSources(at, node.sources, true);
  if (node.edge !== undefined && node.edge !== 'direct' && node.edge !== 'indirect') {
    err(`${at}.edge must be "direct" or "indirect", got "${node.edge}"`);
  }
  if (node.edgeLabel !== undefined && !isStr(node.edgeLabel)) err(`${at}.edgeLabel must be a string`);
  if (node.children !== undefined) {
    if (!isArr(node.children)) return err(`${at}.children must be an array`);
    node.children.forEach((c, i) => checkLineageNode(c, `${at}.children[${i}]`));
  }
}
if (d.lineage !== undefined && d.episcopalLineage !== undefined) {
  err('declare either lineage or episcopalLineage (alias), not both');
}
const lineage = d.lineage !== undefined ? d.lineage : d.episcopalLineage;
const lineageKey = d.lineage !== undefined ? 'lineage' : 'episcopalLineage';
if (lineage !== undefined) {
  if (!isStr(lineage.note)) err(`${lineageKey}.note missing`);
  for (const k of ['heading', 'navLabel']) {
    if (lineage[k] !== undefined && !isStr(lineage[k])) err(`${lineageKey}.${k} must be a string`);
  }
  if (!isArr(lineage.trees) || lineage.trees.length === 0) {
    err(`${lineageKey}.trees must be a non-empty array`);
  } else {
    lineage.trees.forEach((t, i) => {
      const at = `${lineageKey}.trees[${i}]`;
      if (!isStr(t.title)) err(`${at}.title missing`);
      if (t.separate !== undefined && typeof t.separate !== 'boolean') err(`${at}.separate must be boolean`);
      checkSources(at, t.sources, true);
      checkLineageNode(t.root, `${at}.root`);
    });
  }
}

// ---- branchTimeline ("subway diagram") ------------------------------------
if (d.branchTimeline !== undefined) {
  const bt = d.branchTimeline;
  const at = 'branchTimeline';
  for (const k of ['heading', 'navLabel', 'note']) {
    if (bt[k] !== undefined && !isStr(bt[k])) err(`${at}.${k} must be a string`);
  }
  if (bt.pxPerYear !== undefined && (!isNum(bt.pxPerYear) || bt.pxPerYear <= 0)) {
    err(`${at}.pxPerYear must be a positive number`);
  }
  if (!bt.trunk) err(`${at}.trunk missing`);
  else {
    if (!isStr(bt.trunk.label)) err(`${at}.trunk.label missing`);
    if (!isNum(bt.trunk.start)) err(`${at}.trunk.start must be a year (number)`);
    checkSources(`${at}.trunk`, bt.trunk.sources, true);
  }
  const startYear = isNum(bt.start) ? bt.start : bt.trunk && bt.trunk.start;
  if (!isNum(bt.end)) err(`${at}.end missing (the year the diagram runs to)`);
  else if (isNum(startYear) && bt.end <= startYear) err(`${at}.end must be after the start year`);
  if (!isArr(bt.branches) || bt.branches.length === 0) {
    err(`${at}.branches must be a non-empty array`);
  } else {
    // `from` must resolve to the trunk or an EARLIER branch (lanes are
    // assigned in listing order, so forks always point upward).
    const ids = new Set([(bt.trunk && bt.trunk.id) || 'trunk']);
    bt.branches.forEach((b, i) => {
      const bAt = `${at}.branches[${i}]`;
      if (!isStr(b.label)) err(`${bAt}.label missing`);
      if (!isNum(b.year)) err(`${bAt}.year must be a number`);
      else {
        if (isNum(startYear) && b.year < startYear) err(`${bAt}.year ${b.year} is before the timeline start ${startYear}`);
        if (isNum(bt.end) && b.year > bt.end) err(`${bAt}.year ${b.year} is after branchTimeline.end ${bt.end}`);
      }
      if (b.end !== undefined) {
        if (!isNum(b.end)) err(`${bAt}.end must be a number`);
        else {
          if (isNum(b.year) && b.end < b.year) err(`${bAt}.end ${b.end} is before its fork year ${b.year}`);
          if (isNum(bt.end) && b.end > bt.end) err(`${bAt}.end ${b.end} is after branchTimeline.end ${bt.end}`);
        }
      }
      if (b.from !== undefined && !ids.has(b.from)) err(`${bAt}.from: unknown id "${b.from}" (must be the trunk or an earlier branch)`);
      if (b.id !== undefined) {
        if (!isStr(b.id)) err(`${bAt}.id must be a string`);
        else if (ids.has(b.id)) err(`${bAt}.id duplicated: ${b.id}`);
        else ids.add(b.id);
      }
      checkSources(bAt, b.sources, true);
    });
  }
}

// ---- numbersChart (contested-numbers chart) -------------------------------
// Design principle: contested numbers are never silently unified. Each series
// carries its OWN unit and its OWN source label and its OWN citation; the chart
// as a whole carries an explicit "not directly comparable" banner (unitNote).
if (d.numbersChart !== undefined) {
  const nc = d.numbersChart;
  const at = 'numbersChart';
  for (const k of ['heading', 'navLabel', 'note']) {
    if (nc[k] !== undefined && !isStr(nc[k])) err(`${at}.${k} must be a string`);
  }
  // The "not directly comparable" banner is mandatory — it is the honesty flag
  // that keeps incomparable series from reading as one comparable measurement.
  if (!isStr(nc.unitNote)) err(`${at}.unitNote missing (the explicit "not directly comparable" banner is required)`);
  if (!isArr(nc.series) || nc.series.length === 0) {
    err(`${at}.series must be a non-empty array`);
  } else {
    nc.series.forEach((s, i) => {
      const sAt = `${at}.series[${i}]`;
      if (!isStr(s.label)) err(`${sAt}.label missing`);
      // Per-series source label (WHO reported it) and unit — the series are
      // never merged onto one scale, so each declares its own.
      if (!isStr(s.sourceLabel)) err(`${sAt}.sourceLabel missing (name who reported this series)`);
      if (!isStr(s.unit)) err(`${sAt}.unit missing (each series keeps its own unit)`);
      if (s.axisMax !== undefined && (!isNum(s.axisMax) || s.axisMax <= 0)) {
        err(`${sAt}.axisMax must be a positive number`);
      }
      // Every series must be cited — the bars never assert an uncited number.
      checkSources(sAt, s.sources, true);
      if (!isArr(s.points) || s.points.length === 0) {
        err(`${sAt}.points must be a non-empty array`);
      } else {
        s.points.forEach((p, j) => {
          const pAt = `${sAt}.points[${j}]`;
          if (!isNum(p.value)) err(`${pAt}.value must be a number`);
          if (!isStr(p.display)) err(`${pAt}.display missing (the human-readable, attributed value)`);
          if (p.year !== undefined && !isNum(p.year) && !isStr(p.year)) {
            err(`${pAt}.year must be a number or string`);
          }
        });
      }
    });
  }
}

// ---- placesMap (gazetteer-driven map) --------------------------------------
// Design principles (core#24): a place string resolves to a LIST of gazetteer
// ids (compound " / " strings are one event in several places); an unresolved
// place string is a WARNING, never a hard error — the dataset must stay
// editable without a coordinate lookup blocking a commit. The vendored
// gazetteer itself, however, must be well-formed when the map is declared.
if (d.placesMap !== undefined) {
  const pm = d.placesMap;
  const at = 'placesMap';
  if (pm === null || typeof pm !== 'object' || Array.isArray(pm)) {
    err(`${at} must be an object`);
  } else {
    for (const k of ['heading', 'navLabel', 'note']) {
      if (pm[k] !== undefined && !isStr(pm[k])) err(`${at}.${k} must be a string`);
    }
  }

  let gaz = null;
  try {
    gaz = JSON.parse(fs.readFileSync(path.join(ROOT, PLACES_FILE), 'utf8'));
  } catch (e) {
    err(`${at} is declared but ${PLACES_FILE} is missing or unreadable (${e.message}). Run: node scripts/sync-places.js`);
  }
  if (gaz) {
    if (!isArr(gaz.places) || gaz.places.length === 0) {
      err(`${PLACES_FILE}: places must be a non-empty array`);
    } else {
      const seen = new Set();
      gaz.places.forEach((p, i) => {
        const pAt = `${PLACES_FILE}: places[${i}]`;
        if (!isStr(p.id)) err(`${pAt}.id missing`);
        else if (seen.has(p.id)) err(`${pAt}.id "${p.id}" duplicated`);
        else seen.add(p.id);
        if (!isStr(p.name)) err(`${pAt}.name missing`);
        if (p.kind === 'non-geographic') {
          // Scopes ("Worldwide") deliberately carry no coordinates — and so
          // have no coordinate source to cite.
          if (p.lat !== undefined || p.lon !== undefined) err(`${pAt}: non-geographic entries must not carry lat/lon`);
        } else {
          // Coordinates are cited like everything else in this family.
          if (!isStr(p.source)) err(`${pAt}.source missing (coordinates are cited like any other fact)`);
          if (!isNum(p.lat) || p.lat < -90 || p.lat > 90) err(`${pAt}.lat must be a number in [-90, 90]`);
          if (!isNum(p.lon) || p.lon < -180 || p.lon > 180) err(`${pAt}.lon must be a number in [-180, 180]`);
        }
        if (p.variants !== undefined && (!isArr(p.variants) || p.variants.some((v) => !isStr(v)))) {
          err(`${pAt}.variants must be an array of strings`);
        }
      });
    }

    // Unresolved place strings: warn, never fail (core#24).
    const index = placeIndex(gaz);
    const unresolved = new Map(); // string -> event count
    for (const ev of d.events || []) {
      if (!ev.place) continue;
      const { missing } = resolvePlaceString(ev.place, index);
      for (const m of missing) unresolved.set(m, (unresolved.get(m) || 0) + 1);
    }
    if (unresolved.size) {
      console.warn(
        `⚠ ${unresolved.size} place string(s) not in the gazetteer (events stay valid; they will not be mapped):\n`
        + [...unresolved.entries()].map(([s, n]) => `  - "${s}" (${n} event${n === 1 ? '' : 's'})`).join('\n')
        + '\n  Add them to cronologia/core data/places.json and re-run scripts/sync-places.js.'
      );
    }
  }
}

// ---- map (country tier map — core#3) ---------------------------------------
if (d.map !== undefined) {
  const m = d.map;
  const at = 'map';
  for (const k of ['heading', 'navLabel']) {
    if (m[k] !== undefined && !isStr(m[k])) err(`${at}.${k} must be a string`);
  }
  if (!isStr(m.note)) err(`${at}.note missing (the section's editorial framing)`);
  if (!isStr(m.unlistedLabel)) err(`${at}.unlistedLabel missing — say what an UNFILLED country means here; on a contested subject, absence is a statement too`);
  let svgIds = null;
  try {
    const svg = fs.readFileSync(path.join(ROOT, 'src', 'latam.svg'), 'utf8');
    svgIds = new Set([...svg.matchAll(/id="ne-([A-Z]{2})"/g)].map((x) => x[1]));
  } catch {
    err(`${at}: src/latam.svg missing — the map cannot render without the vendored base map (copy it from core/template)`);
  }
  const tierIds = new Set();
  if (!isArr(m.tiers) || m.tiers.length === 0 || m.tiers.length > 4) {
    err(`${at}.tiers must be 1–4 entries of { id, label } (listing order = visual rank, strongest first; four steps keep the scale readable)`);
  } else {
    m.tiers.forEach((t, i) => {
      const tAt = `${at}.tiers[${i}]`;
      if (!isStr(t.id)) err(`${tAt}.id missing`);
      else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.id)) err(`${tAt}.id must be kebab-case, got "${t.id}"`);
      else if (tierIds.has(t.id)) err(`${tAt}.id duplicated: ${t.id}`);
      else tierIds.add(t.id);
      if (!isStr(t.label)) err(`${tAt}.label missing (the legend renders it — a tier is an editorial claim, so it must say what it claims)`);
    });
  }
  if (!isArr(m.countries) || m.countries.length === 0) {
    err(`${at}.countries must be a non-empty array`);
  } else {
    const seen = new Set();
    m.countries.forEach((c, i) => {
      const cAt = `${at}.countries[${i}]`;
      if (!isStr(c.code) || !/^[A-Z]{2}$/.test(c.code)) err(`${cAt}.code must be an ISO alpha-2 code, got "${c.code}"`);
      else if (seen.has(c.code)) err(`${cAt}.code duplicated: ${c.code}`);
      else {
        seen.add(c.code);
        if (svgIds && !svgIds.has(c.code)) err(`${cAt}.code "${c.code}" has no path in src/latam.svg (regenerate with scripts/gen-latam-svg.js if the country should be added)`);
      }
      if (!isStr(c.name)) err(`${cAt}.name missing`);
      if (!isStr(c.tier) || !tierIds.has(c.tier)) err(`${cAt}.tier: unknown tier "${c.tier}" (not declared in map.tiers)`);
      if (!isStr(c.note)) err(`${cAt}.note missing`);
      checkSources(cAt, c.sources, true);
    });
  }
}

// ---- disambiguation -------------------------------------------------------
if (d.disambiguation !== undefined) {
  const items = d.disambiguation.items;
  if (!isArr(items)) err('disambiguation.items must be an array');
  else items.forEach((it, i) => {
    const at = `disambiguation.items[${i}]`;
    if (!isStr(it.title)) err(`${at}.title missing`);
    if (!isStr(it.text)) err(`${at}.text missing`);
    checkSources(at, it.sources, false);
  });
}

// ---- glossary cross-links -------------------------------------------------
// Every [[term-id]] marker (see build.js) must resolve to a known glossary
// term. The known ids are read from the vendored, pinned list in
// data/glossary-terms.json (refresh with scripts/sync-glossary-terms.js) — a
// deterministic, offline check, consistent with this repo's no-network build.
// A dataset with no markers is unaffected: the vendored list is consulted only
// when a marker is actually present, so the feature stays fully opt-in.
(function checkGlossaryLinks() {
  // Collect every [[…]] marker across all string fields, remembering where.
  const found = []; // { id, at }
  const walk = (node, at) => {
    if (typeof node === 'string') {
      for (const id of glossaryMarkerIds(node)) found.push({ id, at });
    } else if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${at}[${i}]`));
    } else if (node && typeof node === 'object') {
      for (const k of Object.keys(node)) walk(node[k], at ? `${at}.${k}` : k);
    }
  };
  walk(d, '');
  if (found.length === 0) return; // feature unused — nothing to validate

  let known;
  try {
    const g = JSON.parse(fs.readFileSync(path.join(ROOT, GLOSSARY_TERMS_FILE), 'utf8'));
    known = new Set(g.terms || []);
  } catch (e) {
    err(`${found.length} glossary [[…]] marker(s) present but ${GLOSSARY_TERMS_FILE} is missing or unreadable (${e.message}). Run: node scripts/sync-glossary-terms.js`);
    return;
  }
  const unknown = new Map(); // id -> first location
  for (const { id, at } of found) {
    if (!known.has(id) && !unknown.has(id)) unknown.set(id, at);
  }
  for (const [id, at] of unknown) {
    err(`${at}: unknown glossary term id "${id}" — not in ${GLOSSARY_TERMS_FILE} (re-run scripts/sync-glossary-terms.js if the glossary added it)`);
  }
})();

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s):\n` + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}
console.log(`✓ ${FILE} is valid (${d.events.length} events, ${d.figures.length} figures, ${d.references.length} references).`);
