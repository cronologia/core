'use strict';
// Unit tests for the optional visualization renderers: the genealogy/lineage
// tree (with typed edges) and the branch timeline ("subway diagram").
// Zero-dependency (node:test / node:assert).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  renderLineageNode, lineageHasIndirectEdges, renderLineageLegend, renderLineageSection,
  layoutBranchTimeline, renderBranchTimeline, BT_GEOM, renderPage,
} = require('../build.js');

const refs = new Map([['ref-a', 1], ['ref-b', 2]]);

// ---- lineage tree ----------------------------------------------------------

const plainTree = {
  title: 'Main line',
  summary: 'From the founder.',
  sources: ['ref-a'],
  root: {
    name: 'Founder',
    detail: 'consecrated 1947',
    sources: ['ref-a'],
    children: [
      { name: 'Successor', detail: 'Écône, 1988', status: 'status 1988, attributed', sources: ['ref-b'] },
    ],
  },
};

test('renderLineageSection returns "" when the data declares no lineage', () => {
  assert.equal(renderLineageSection(undefined, refs), '');
  assert.equal(renderLineageSection({ trees: [] }, refs), '');
});

test('renderLineageNode matches the fsspx markup exactly when no edge is typed', () => {
  // Byte-for-byte the markup the fsspx site renders today — the typed-edge
  // upgrade must be a pure superset.
  assert.equal(
    renderLineageNode({ name: 'X', detail: 'd', status: 's', sources: ['ref-a'] }, refs),
    '<li><span class="tree-node"><strong>X</strong> <span class="tree-detail">d</span>' +
    '<sup class="cite"><a href="#ref-1" title="Reference 1">[1]</a></sup></span>' +
    '<div class="tree-status">s</div></li>'
  );
  assert.equal(renderLineageNode({ name: 'Y' }, refs), '<li><span class="tree-node"><strong>Y</strong></span></li>');
});

test('lineage section renders trees, separate branches, and no legend without typed edges', () => {
  const html = renderLineageSection({
    note: 'Who consecrated whom.',
    trees: [plainTree, { title: 'Separate line', separate: true, sources: ['ref-b'], root: { name: 'Other', sources: ['ref-b'] } }],
  }, refs);
  assert.match(html, /<section id="lineage">/);
  assert.match(html, /<h2>Episcopal genealogy<\/h2>/); // fsspx default heading
  assert.match(html, /class="lineage-branch lineage-separate"/);
  assert.match(html, /<strong>Successor<\/strong>/);
  assert.ok(!html.includes('lineage-legend'), 'no legend when no indirect edges');
  assert.ok(!html.includes('tree-edge'), 'no edge classes when no typed edges');
});

test('lineage heading is configurable for non-episcopal subjects', () => {
  const html = renderLineageSection({ heading: 'Silsila', note: 'n', trees: [plainTree] }, refs);
  assert.match(html, /<h2>Silsila<\/h2>/);
});

test('indirect edges render a dashed-edge class, an edge label, and the legend', () => {
  const lineage = {
    note: 'n',
    trees: [{
      title: 't',
      sources: ['ref-a'],
      root: {
        name: 'Root',
        sources: ['ref-a'],
        children: [
          { name: 'Direct kid', sources: ['ref-a'] },
          { name: 'Associate', edge: 'indirect', edgeLabel: 'association, not consecration', sources: ['ref-b'] },
        ],
      },
    }],
  };
  assert.equal(lineageHasIndirectEdges(lineage), true);
  assert.equal(lineageHasIndirectEdges({ note: 'n', trees: [plainTree] }), false);

  const html = renderLineageSection(lineage, refs);
  assert.match(html, /<li class="tree-edge-indirect"><span class="tree-edge-label">association, not consecration<\/span> /);
  assert.match(html, /class="lineage-legend"/);
  assert.match(html, /Direct consecration\/initiation/);
  assert.match(html, /Indirect reference\/association/);
  // The direct sibling keeps the plain markup.
  assert.match(html, /<li><span class="tree-node"><strong>Direct kid<\/strong>/);
});

test('legend labels are overridable via edgeLegend', () => {
  const lineage = {
    note: 'n',
    edgeLegend: { direct: 'Initiation', indirect: 'Cited influence' },
    trees: [{ title: 't', sources: ['ref-a'], root: { name: 'R', sources: ['ref-a'], children: [{ name: 'K', edge: 'indirect', sources: ['ref-a'] }] } }],
  };
  const html = renderLineageLegend(lineage);
  assert.match(html, /Initiation/);
  assert.match(html, /Cited influence/);
  assert.equal(renderLineageLegend({ note: 'n', trees: [plainTree] }), '');
});

// ---- branch timeline -------------------------------------------------------

const bt = {
  note: 'How the divisions forked.',
  end: 2026,
  trunk: { id: 'main', label: 'Org', start: 1970, note: 'Founded 1970.', sources: ['ref-a'] },
  branches: [
    { id: 'a', label: 'Split A', year: 1983, note: 'First split.', sources: ['ref-a'] },
    { id: 'b', label: 'Split B', year: 1988, end: 2002, note: 'Ended 2002.', sources: ['ref-b'] },
    { id: 'c', label: 'Split C', year: 2012, from: 'a', note: 'Forked off A.', sources: ['ref-b'] },
  ],
};

test('layoutBranchTimeline computes scale, lanes, forks, and ticks', () => {
  const l = layoutBranchTimeline(bt);
  const x = (year) => BT_GEOM.padLeft + (year - 1970) * BT_GEOM.pxPerYear;
  const laneY = (i) => BT_GEOM.padTop + i * BT_GEOM.laneHeight;

  assert.equal(l.minYear, 1970);
  assert.equal(l.maxYear, 2026);
  assert.equal(l.trunk.x1, x(1970));
  assert.equal(l.trunk.x2, x(2026));
  assert.equal(l.trunk.y, laneY(0));
  assert.equal(l.width, x(2026) + BT_GEOM.padRight);
  assert.equal(l.height, laneY(3) + BT_GEOM.padBottom);

  const [a, b, c] = l.branches;
  assert.equal(a.xFork, x(1983));
  assert.equal(a.y, laneY(1));
  assert.equal(a.yFrom, laneY(0), 'default fork parent is the trunk');
  assert.equal(a.xEnd, x(2026), 'open branch runs to the right edge');
  assert.equal(a.terminal, false);

  assert.equal(b.xEnd, x(2002), 'branch with end stops at its end year');
  assert.equal(b.terminal, true);

  assert.equal(c.yFrom, laneY(1), 'from: "a" forks off branch a\'s lane');
  assert.equal(c.y, laneY(3));

  assert.deepEqual(l.ticks.map((t) => t.year), [1970, 1980, 1990, 2000, 2010, 2020, 2026]);
});

test('layoutBranchTimeline returns null for absent/degenerate data', () => {
  assert.equal(layoutBranchTimeline(undefined), null);
  assert.equal(layoutBranchTimeline({ trunk: { label: 'x', start: 1970 }, end: 2026, branches: [] }), null);
  assert.equal(layoutBranchTimeline({ trunk: { label: 'x', start: 2026 }, end: 2026, branches: [{ label: 'y', year: 2026 }] }), null);
});

test('renderBranchTimeline renders a static SVG with labels and a cited caption', () => {
  const html = renderBranchTimeline(bt, refs);
  assert.match(html, /<section id="branch-timeline">/);
  assert.match(html, /<h2>Divisions timeline<\/h2>/); // default heading
  assert.match(html, /viewBox="0 0 \d+ \d+"/);
  assert.match(html, /class="viz-scroll"/, 'mobile scroll containment');
  assert.match(html, /Org · 1970/);
  assert.match(html, /Split A · 1983/);
  assert.match(html, /Split B · 1988–2002/, 'terminal branch shows its year range');
  assert.match(html, /<figcaption>/);
  assert.match(html, /<strong>Split C \(2012\)<\/strong> — Forked off A\.<sup class="cite"><a href="#ref-2"/);
  assert.equal(renderBranchTimeline(undefined, refs), '');
});

test('renderBranchTimeline escapes labels and headings', () => {
  const html = renderBranchTimeline({
    heading: '<Divisions> & forks',
    end: 2000,
    trunk: { label: 'A & B', start: 1970, sources: ['ref-a'] },
    branches: [{ label: '<Split>', year: 1980, sources: ['ref-a'] }],
  }, refs);
  assert.match(html, /&lt;Divisions&gt; &amp; forks/);
  assert.match(html, /A &amp; B · 1970/);
  assert.match(html, /&lt;Split&gt; · 1980/);
  assert.ok(!html.includes('<Split>'));
});

// ---- page integration ------------------------------------------------------

const baseData = {
  meta: { title: 't', subtitle: 's', description: 'd', language: 'en', lastUpdated: '2026-01-01', dataQualityNote: 'q' },
  facts: [], events: [], figures: [], organizations: [],
  references: [{ id: 'ref-a', title: 'A', url: 'https://example.org/a', publisher: 'p', type: 'web' }],
};

test('renderPage without viz keys emits no lineage/branch-timeline markup', () => {
  const html = renderPage(baseData, {});
  assert.ok(!html.includes('id="lineage"'));
  assert.ok(!html.includes('branch-timeline'));
  assert.match(html, /<a href="#chronology">Chronology<\/a>\n {6}<a href="#figures">/, 'nav unchanged');
});

test('renderPage with viz keys renders both sections and their nav links', () => {
  const data = {
    ...baseData,
    lineage: { navLabel: 'Genealogy', note: 'n', trees: [plainTree] },
    branchTimeline: bt,
  };
  const html = renderPage(data, {});
  assert.match(html, /<a href="#lineage">Genealogy<\/a>/);
  assert.match(html, /<a href="#branch-timeline">Divisions<\/a>/);
  assert.match(html, /<section id="lineage">/);
  assert.match(html, /<section id="branch-timeline">/);
  // Section order: chronology, lineage, branch timeline, figures.
  const order = ['id="chronology"', 'id="lineage"', 'id="branch-timeline"', 'id="figures"'].map((s) => html.indexOf(s));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
});

test('renderPage accepts the original fsspx key episcopalLineage as an alias', () => {
  const html = renderPage({ ...baseData, episcopalLineage: { note: 'n', trees: [plainTree] } }, {});
  assert.match(html, /<section id="lineage">/);
  assert.match(html, /<h2>Episcopal genealogy<\/h2>/);
});
