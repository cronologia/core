#!/usr/bin/env node
/**
 * gen-latam-svg.js — ONE-OFF, DEV-ONLY. Regenerates src/latam.svg from public-
 * domain Natural Earth 1:50m boundaries. NOT part of the zero-dependency build
 * (build.js only inlines the committed src/latam.svg). To re-run:
 *   npm i --no-save world-atlas@2 topojson-client@3 d3-geo@3 && node scripts/gen-latam-svg.js
 * Source data: Natural Earth (public domain). Projection: d3-geo geoMercator.
 */
const topojson = require('topojson-client');
const d3 = require('d3-geo');
const topo = require('world-atlas/countries-50m.json');

const feats = topojson.feature(topo, topo.objects.countries).features;

// Natural Earth numeric ISO -> our alpha-2 (the 16 tracked countries).
const TRACK = {
  '484':'MX','192':'CU','214':'DO','222':'SV','340':'HN','558':'NI','862':'VE',
  '170':'CO','218':'EC','076':'BR','604':'PE','068':'BO','600':'PY','152':'CL',
  '032':'AR','858':'UY'
};
// Neighbours drawn as context backdrop (no interactivity).
const NEIGH = new Set(['320','084','188','591','328','740','332','388','780','630','659','662','670','308','212','214','60','312','254','534','44','52','28','450']);

const id = (f) => String(f.id).padStart(3,'0');
const tracked = feats.filter(f => TRACK[id(f)]);
const region = feats.filter(f => TRACK[id(f)] || NEIGH.has(String(Number(f.id))) || NEIGH.has(id(f)));

const W = 460, H = 780;
// Fit projection to the tracked countries with padding.
const proj = d3.geoMercator();
const fc = { type:'FeatureCollection', features: tracked };
proj.fitExtent([[14,14],[W-14,H-14]], fc);
const path = d3.geoPath(proj);

// Round numbers in the path 'd' to 1 decimal to shrink the output.
const round = (d) => d.replace(/-?\d+\.\d+/g, (m)=> (Math.round(parseFloat(m)*10)/10).toString());

function paths(features, cls, withId){
  return features.map(f => {
    const d = path(f);
    if(!d) return '';
    const code = TRACK[id(f)];
    const attr = withId && code ? ` id="ne-${code}" class="latam-c" data-code="${code}"` : ` class="${cls}"`;
    return `<path${attr} d="${round(d)}"/>`;
  }).filter(Boolean).join('\n');
}

const bg = paths(region.filter(f=>!TRACK[id(f)]), 'latam-bg', false);
const fg = paths(tracked, 'latam-c', true);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="latam-svg" role="img" aria-label="Map of Latin America">
<g class="latam-bg-g">
${bg}
</g>
<g class="latam-fg-g">
${fg}
</g>
</svg>`;

require('fs').writeFileSync('latam.svg', svg);
console.log('countries tracked:', tracked.length, '/ region backdrop:', region.length-tracked.length);
console.log('svg bytes:', svg.length);
console.log('tracked codes:', tracked.map(f=>TRACK[id(f)]).sort().join(','));
