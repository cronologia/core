'use strict';
// Unit tests for the optional visualization renderers: the genealogy/lineage
// tree (with typed edges) and the branch timeline ("subway diagram").
// Zero-dependency (node:test / node:assert).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  renderLineageNode, lineageHasIndirectEdges, renderLineageLegend, renderLineageSection,
  layoutBranchTimeline, renderBranchTimeline, BT_GEOM,
  layoutNumbersChart, renderNumbersChart, renderPage,
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

// ---- contested-numbers chart -----------------------------------------------

const nc = {
  heading: 'How big is it?',
  navLabel: 'Numbers',
  note: 'Two different questions, two different methods.',
  unitNote: 'Different units and methods — not directly comparable.',
  series: [
    {
      label: 'Movement self-report',
      sourceLabel: 'The movement — self-report',
      unit: 'million participants',
      axisMax: 4,
      sources: ['ref-a'],
      points: [{ year: 1994, value: 3.8, display: '≈ 3.8 million (self-reported)' }],
    },
    {
      label: 'External survey',
      sourceLabel: 'A survey — external',
      unit: '% share',
      axisMax: 100,
      sources: ['ref-b'],
      points: [
        { year: 2006, value: 50, display: '≈ half the population' },
        { year: 2010, value: 60, display: '≈ 60% by a later wave' },
      ],
    },
  ],
};

test('layoutNumbersChart keeps each series on its OWN axis and clamps bars', () => {
  const l = layoutNumbersChart(nc);
  assert.equal(l.series.length, 2);
  const [a, b] = l.series;
  assert.equal(a.axisMax, 4, 'series A keeps its own axis max');
  assert.equal(b.axisMax, 100, 'series B keeps its own, different axis max');
  assert.equal(a.points[0].pct, 95, '3.8 of 4 => 95%');
  assert.equal(b.points[0].pct, 50, '50 of 100 => 50%');
  assert.equal(b.points[1].pct, 60);
  assert.deepEqual(a.ticks, [0, 2, 4]);
  assert.notEqual(a.axisMax, b.axisMax, 'series are never merged onto one scale');
});

test('layoutNumbersChart clamps out-of-range values and defaults axisMax to the max point', () => {
  const l = layoutNumbersChart({
    unitNote: 'n',
    series: [{ label: 'L', sourceLabel: 'S', unit: 'u', sources: ['ref-a'], points: [{ value: 10, display: 'ten' }, { value: 20, display: 'twenty' }] }],
  });
  assert.equal(l.series[0].axisMax, 20, 'axisMax defaults to the largest point');
  assert.equal(l.series[0].points[0].pct, 50);
  assert.equal(l.series[0].points[1].pct, 100);
});

test('layoutNumbersChart returns null for absent/degenerate data', () => {
  assert.equal(layoutNumbersChart(undefined), null);
  assert.equal(layoutNumbersChart({ unitNote: 'n', series: [] }), null);
  assert.equal(layoutNumbersChart({ unitNote: 'n', series: [{ label: 'x', points: [] }] }), null);
});

test('renderNumbersChart renders per-series panels, source badges, the banner, and a cited caption', () => {
  const html = renderNumbersChart(nc, refs);
  assert.match(html, /<section id="numbers-chart">/);
  assert.match(html, /<h2>How big is it\?<\/h2>/);
  assert.match(html, /class="viz-scroll"/, 'mobile scroll containment');
  assert.match(html, /class="notice notice-attribution">Different units and methods — not directly comparable\./, 'the not-comparable banner');
  assert.match(html, /nc-source-badge">The movement — self-report</, 'per-series source label');
  assert.match(html, /nc-source-badge">A survey — external</);
  assert.match(html, /axis: 0–4 million participants/, 'series A axis');
  assert.match(html, /axis: 0–100 % share/, 'series B axis — its own unit');
  assert.match(html, /style="width:95%"/);
  assert.match(html, /style="width:50%"/);
  assert.match(html, /<figcaption>/);
  assert.match(html, /<strong>Movement self-report<\/strong> — reported by The movement — self-report, in million participants<sup class="cite"><a href="#ref-1"/);
  assert.match(html, /reported by A survey — external, in % share<sup class="cite"><a href="#ref-2"/);
  assert.equal(renderNumbersChart(undefined, refs), '');
});

test('renderNumbersChart escapes labels, units, and the banner', () => {
  const html = renderNumbersChart({
    heading: '<Numbers> & counts',
    unitNote: 'A & B <not> comparable',
    series: [{ label: '<L>', sourceLabel: 'S & co', unit: '% <share>', axisMax: 10, sources: ['ref-a'], points: [{ value: 5, display: '<five>' }] }],
  }, refs);
  assert.match(html, /&lt;Numbers&gt; &amp; counts/);
  assert.match(html, /A &amp; B &lt;not&gt; comparable/);
  assert.match(html, /S &amp; co/);
  assert.match(html, /&lt;five&gt;/);
  assert.ok(!html.includes('<five>'));
});

// ---- page integration ------------------------------------------------------

const baseData = {
  meta: { title: 't', subtitle: 's', description: 'd', language: 'en', lastUpdated: '2026-01-01', dataQualityNote: 'q' },
  facts: [], events: [], figures: [], organizations: [],
  references: [{ id: 'ref-a', title: 'A', url: 'https://example.org/a', publisher: 'p', type: 'web' }],
};

test('renderPage without viz keys emits no lineage/branch-timeline/numbers markup', () => {
  const html = renderPage(baseData, {});
  assert.ok(!html.includes('id="lineage"'));
  assert.ok(!html.includes('branch-timeline'));
  assert.ok(!html.includes('numbers-chart'));
  assert.match(html, /<a href="#chronology">Chronology<\/a>\n {6}<a href="#figures">/, 'nav unchanged');
});

test('an absent numbersChart key leaves renderPage output byte-identical', () => {
  // The additive numbers renderer must not touch the page when the key is
  // absent — exactly the renderBranchTimeline contract.
  const withKeys = { ...baseData, lineage: { navLabel: 'Genealogy', note: 'n', trees: [plainTree] }, branchTimeline: bt };
  assert.equal(renderPage(withKeys, {}), renderPage({ ...withKeys, numbersChart: undefined }, {}));
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

test('renderPage renders the numbers chart section, its nav link, and section order', () => {
  const html = renderPage({ ...baseData, lineage: { navLabel: 'Genealogy', note: 'n', trees: [plainTree] }, branchTimeline: bt, numbersChart: nc }, {});
  assert.match(html, /<a href="#numbers-chart">Numbers<\/a>/);
  assert.match(html, /<section id="numbers-chart">/);
  // Section order: chronology, lineage, branch timeline, numbers chart, figures.
  const order = ['id="chronology"', 'id="lineage"', 'id="branch-timeline"', 'id="numbers-chart"', 'id="figures"'].map((s) => html.indexOf(s));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
});

test('renderPage accepts the original fsspx key episcopalLineage as an alias', () => {
  const html = renderPage({ ...baseData, episcopalLineage: { note: 'n', trees: [plainTree] } }, {});
  assert.match(html, /<section id="lineage">/);
  assert.match(html, /<h2>Episcopal genealogy<\/h2>/);
});
