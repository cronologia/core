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
const I18N_DIR = path.join(ROOT, 'data', 'i18n');
const SRC_DIR = path.join(ROOT, 'src');
const OUT_DIR = path.join(ROOT, 'docs');

/* ---------------------------------------------------------------------------
 * Multi-language (i18n) + SEO. English is authoritative and hand-written; es/pt
 * are machine-translated from committed caches (data/i18n/<lang>.json, generated
 * by scripts/translate.js — never hand-edit) and carry a visible disclaimer.
 *
 * The language is a path segment AFTER the project (/<repo>/{en,es,pt}/…) because
 * GitHub Pages serves each repo under https://<org>.github.io/<repo>/. Content is
 * localized at the DATA level (a key-based walk, so every renderer — chronology,
 * genealogy, charts, glossary links — is covered automatically); the compiler's
 * own chrome is localized from the UI table below. English (empty dict) is
 * byte-identical to a pre-i18n render except for the new /en/ path + SEO head.
 * See adrs/0001-multilingual.md and cronologia/core#9.
 * ------------------------------------------------------------------------- */

const LOCALES = ['en', 'es', 'pt'];
const OG_LOCALE = { en: 'en_US', es: 'es_ES', pt: 'pt_BR' };
// Page paths (relative to a locale root) the site emits. The base template ships
// a single page; sites with detail pages push their routes here so the sitemap
// and hreflang stay complete.
const ROUTES = [''];

// Data fields whose string values are prose to translate. Reference titles/
// publishers, proper names, URLs, ids, dates and numbers are NOT here, and the
// whole `references` array is skipped, so bibliographic data is passed verbatim.
const TRANSLATABLE_KEYS = new Set([
  'title', 'subtitle', 'description', 'dataQualityNote', 'label', 'value', 'text',
  'place', 'role', 'country', 'notes', 'note', 'heading', 'navLabel', 'summary',
  'detail', 'status', 'relation', 'unitNote', 'sourceLabel', 'display', 'unit', 'edgeLabel',
]);

// Interface strings the compiler emits itself (everything not sourced from data).
const UI = {
  en: {
    about: 'About', chronology: 'Chronology', figures: 'Key figures',
    organizations: 'Organizations', disambiguation: 'Disambiguation', references: 'References',
    figuresHeading: 'Key figures', organizationsHeading: 'Related organizations',
    disambiguationHeading: 'Disambiguation &amp; nuance', referencesHeading: 'References',
    aboutHeading: 'About', chronologyHeading: 'Chronology',
    lastUpdated: 'Last updated:', language: 'Language',
    chronologyIntro: 'Key events in chronological order. A <span class="flag">?</span> flag marks\n      dates not yet verified against a primary source.',
    thYear: 'Year', thDate: 'Date', thPlace: 'Place', thEvent: 'Event',
    flagTitle: 'Date not yet verified against a primary source',
    factFlagTitle: 'Not yet verified against a primary source',
    footer: 'Compiled static site generated from <code>data/chronology.json</code> by <code>build.js</code>. Open data — corrections welcome via pull request.\n      Part of the Cronologia project family.',
    refsIntro: (n, a) => `${n} sources${a ? ` · ${a} with an Internet Archive fallback` : ''}. Sources span the\n      spectrum of perspectives by design; contested claims are attributed to their authors.`,
    disclaimer: null,
  },
  es: {
    about: 'Acerca de', chronology: 'Cronología', figures: 'Figuras clave',
    organizations: 'Organizaciones', disambiguation: 'Desambiguación', references: 'Referencias',
    figuresHeading: 'Figuras clave', organizationsHeading: 'Organizaciones relacionadas',
    disambiguationHeading: 'Desambiguación y matices', referencesHeading: 'Referencias',
    aboutHeading: 'Acerca de', chronologyHeading: 'Cronología',
    lastUpdated: 'Última actualización:', language: 'Idioma',
    chronologyIntro: 'Acontecimientos clave en orden cronológico. Una marca <span class="flag">?</span> indica\n      fechas aún no verificadas con una fuente primaria.',
    thYear: 'Año', thDate: 'Fecha', thPlace: 'Lugar', thEvent: 'Acontecimiento',
    flagTitle: 'Fecha aún no verificada con una fuente primaria',
    factFlagTitle: 'Aún no verificado con una fuente primaria',
    footer: 'Sitio estático compilado a partir de <code>data/chronology.json</code> por <code>build.js</code>. Datos abiertos — correcciones bienvenidas mediante pull request.\n      Parte de la familia de proyectos Cronologia.',
    refsIntro: (n, a) => `${n} fuentes${a ? ` · ${a} con copia en Internet Archive` : ''}. Las fuentes abarcan el\n      espectro de perspectivas de forma deliberada; las afirmaciones controvertidas se atribuyen a sus autores.`,
    disclaimer: 'Traducción automática del inglés; la página en inglés es la versión de referencia.',
  },
  pt: {
    about: 'Sobre', chronology: 'Cronologia', figures: 'Figuras-chave',
    organizations: 'Organizações', disambiguation: 'Desambiguação', references: 'Referências',
    figuresHeading: 'Figuras-chave', organizationsHeading: 'Organizações relacionadas',
    disambiguationHeading: 'Desambiguação e nuances', referencesHeading: 'Referências',
    aboutHeading: 'Sobre', chronologyHeading: 'Cronologia',
    lastUpdated: 'Última atualização:', language: 'Idioma',
    chronologyIntro: 'Principais acontecimentos em ordem cronológica. Uma marca <span class="flag">?</span> indica\n      datas ainda não verificadas com uma fonte primária.',
    thYear: 'Ano', thDate: 'Data', thPlace: 'Local', thEvent: 'Acontecimento',
    flagTitle: 'Data ainda não verificada com uma fonte primária',
    factFlagTitle: 'Ainda não verificado com uma fonte primária',
    footer: 'Site estático compilado a partir de <code>data/chronology.json</code> por <code>build.js</code>. Dados abertos — correções bem-vindas via pull request.\n      Parte da família de projetos Cronologia.',
    refsIntro: (n, a) => `${n} fontes${a ? ` · ${a} com cópia no Internet Archive` : ''}. As fontes abrangem o\n      espectro de perspectivas de forma deliberada; afirmações controversas são atribuídas aos seus autores.`,
    disclaimer: 'Tradução automática do inglês; a página em inglês é a versão de referência.',
  },
};

/** Load a locale's committed translation cache ({ english: translated }). */
function loadDict(lang) {
  if (lang === 'en') return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${lang}.json`), 'utf8'));
    return (parsed && parsed.strings) || {};
  } catch {
    return {};
  }
}

/** Normalize a public base URL to exactly one trailing slash. */
function siteBase(meta) {
  const raw = (meta && meta.siteUrl) || 'https://cronologia.github.io/PROJECT/';
  return raw.replace(/\/+$/, '') + '/';
}

/** dict hit, else the English source string. */
function translator(dict) {
  return (s) => (s !== null && s !== undefined && Object.prototype.hasOwnProperty.call(dict, s) ? dict[s] : s);
}

/**
 * Deep-copy `data` with every translatable prose field replaced by its
 * translation (fallback: English), and meta.language set to `lang`. The whole
 * `references` array is passed through verbatim (bibliographic data). With an
 * empty dictionary (English) the values are unchanged, so the render stays
 * byte-identical to a pre-i18n build.
 */
function localizeData(data, dict, lang) {
  const t = translator(dict);
  const walk = (val, key) => {
    if (key === 'references') return val; // never translate bibliographic entries
    if (Array.isArray(val)) return val.map((v) => walk(v, key));
    if (val && typeof val === 'object') {
      const out = {};
      for (const k of Object.keys(val)) out[k] = walk(val[k], k);
      return out;
    }
    if (typeof val === 'string' && TRANSLATABLE_KEYS.has(key)) return t(val);
    return val;
  };
  const copy = walk(data, null);
  copy.meta = Object.assign({}, copy.meta, { language: lang });
  return copy;
}

/** hreflang + canonical alternates for one route across every locale. */
function alternates(base, route, lang) {
  const url = (l) => `${base}${l}/${route}`;
  const links = LOCALES.map((l) => `  <link rel="alternate" hreflang="${l}" href="${esc(url(l))}">`).join('\n');
  return `  <link rel="canonical" href="${esc(url(lang))}">\n${links}\n  <link rel="alternate" hreflang="x-default" href="${esc(base)}">`;
}

/** Localized <head> SEO block (canonical/hreflang/OG/Twitter/JSON-LD). */
function seoHead(meta, base, route, lang) {
  const title = meta.title;
  const description = meta.description;
  const pageUrl = `${base}${lang}/${route}`;
  const jsonLd = { '@context': 'https://schema.org', '@type': 'WebSite', name: title, description, url: pageUrl, inLanguage: lang };
  return `${alternates(base, route, lang)}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(title)}">
  <meta property="og:locale" content="${OG_LOCALE[lang] || 'en_US'}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(pageUrl)}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2).split('\n').map((l) => '  ' + l).join('\n')}
  </script>`;
}

/** Path-preserving language switcher (swap only the locale segment). */
function langSwitcher(route, lang, ui) {
  const links = LOCALES.map((l) => (l === lang
    ? `<span class="lang-current" aria-current="true">${l.toUpperCase()}</span>`
    : `<a href="../${l}/${route}" hreflang="${l}">${l.toUpperCase()}</a>`)).join('');
  return `<nav class="lang-switch" aria-label="${esc(ui.language)}">${links}</nav>`;
}

/** The root redirect stub: send visitors to their preferred locale. */
function renderRootStub(base) {
  const alt = LOCALES.map((l) => `  <link rel="alternate" hreflang="${l}" href="${esc(base + l + '/')}">`).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <link rel="canonical" href="${esc(base + 'en/')}">
${alt}
  <link rel="alternate" hreflang="x-default" href="${esc(base + 'en/')}">
  <script>
    (function () {
      var supported = ${JSON.stringify(LOCALES)};
      var stored = null; try { stored = localStorage.getItem('lang'); } catch (e) {}
      var nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
      var pick = supported.indexOf(stored) >= 0 ? stored : (supported.indexOf(nav) >= 0 ? nav : 'en');
      location.replace('./' + pick + '/');
    })();
  </script>
  <noscript><meta http-equiv="refresh" content="0; url=./en/"></noscript>
  <title>Cronologia</title>
</head>
<body><p>Redirecting… <a href="./en/">English</a> · <a href="./es/">Español</a> · <a href="./pt/">Português</a></p></body>
</html>
`;
}

/** sitemap.xml enumerating every route × locale with hreflang alternates. */
function renderSitemap(base, routes) {
  const urls = [];
  for (const route of routes) {
    for (const lang of LOCALES) {
      const alts = LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${esc(base + l + '/' + route)}"/>`).join('\n');
      urls.push(`  <url>
    <loc>${esc(base + lang + '/' + route)}</loc>
${alts}
    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(base + 'en/' + route)}"/>
  </url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
}

function renderRobots(base) {
  return `User-agent: *\nAllow: /\nSitemap: ${base}sitemap.xml\n`;
}

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

/* ---------------------------------------------------------------------------
 * Contested-numbers chart — NEW (follows the same template copy-pattern as the
 * branch-timeline: a pure layout function, a data-driven optional top-level
 * key, a cited <figcaption>, a .viz-scroll container, and print/mobile rules).
 *
 * The point of this figure is HONESTY about incomparable numbers. Each series
 * is drawn on its OWN axis with its OWN unit and its OWN source label — the
 * series are never merged onto a single scale, because e.g. a movement's
 * self-reported participant counts and a survey's population percentages
 * measure different things by different methods. The <figcaption> carries the
 * per-series citations, so the bars never assert an uncited number on their
 * own. An explicit `unitNote` banner states, in the page's own words, that the
 * series are NOT directly comparable — contested numbers are never silently
 * unified (sourcing rules).
 *
 * Driven by the optional top-level `numbersChart` key:
 *
 *   numbersChart: {
 *     heading?:  string      // default "Numbers"
 *     navLabel?: string      // default "Numbers" (nav bar link text)
 *     note?:     string      // section intro
 *     unitNote:  string      // the "not directly comparable" banner (required)
 *     series: [{
 *       label:       string  // what this series measures
 *       sourceLabel: string  // WHO reported it (movement vs external survey)
 *       unit:        string  // axis unit ("million participants", "% share")
 *       axisMax?:    number  // top of THIS series' own axis (default: max point)
 *       sources:     [refId]
 *       points: [{ year?: number|string, value: number, display: string }]
 *     }]
 *   }
 *
 * Absent key = '' = byte-identical page.
 * ------------------------------------------------------------------------- */

/**
 * Pure geometry for the numbers chart: for every series, clamp each point to
 * that series' own axis and compute a bar percentage. Returns null when the
 * data is absent or declares no series (renderNumbersChart then renders '').
 */
function layoutNumbersChart(nc) {
  if (!nc || !Array.isArray(nc.series) || nc.series.length === 0) return null;
  const series = nc.series
    .filter((s) => s && Array.isArray(s.points) && s.points.length > 0)
    .map((s, i) => {
      const axisMax = Number.isFinite(s.axisMax) && s.axisMax > 0
        ? s.axisMax
        : Math.max(...s.points.map((p) => (Number.isFinite(p.value) ? p.value : 0)), 1);
      const points = s.points.map((p) => {
        const value = Number.isFinite(p.value) ? p.value : 0;
        const pct = Math.max(0, Math.min(100, (value / axisMax) * 100));
        return { year: p.year, value, display: p.display, pct: Math.round(pct * 10) / 10 };
      });
      return {
        label: s.label, sourceLabel: s.sourceLabel, unit: s.unit,
        sources: s.sources, axisMax, colorIndex: i % 6,
        ticks: [0, axisMax / 2, axisMax], points,
      };
    });
  if (series.length === 0) return null;
  return { series };
}

/** Render the contested-numbers chart (per-series axes + cited caption), or ''. */
function renderNumbersChart(nc, refNumById) {
  const layout = layoutNumbersChart(nc);
  if (!layout) return '';

  const fmtTick = (t) => (Number.isInteger(t) ? String(t) : String(Math.round(t * 10) / 10));

  const panels = layout.series
    .map((s) => {
      const rows = s.points
        .map((p) => `            <div class="nc-row">
              <span class="nc-year">${esc(p.year !== undefined ? p.year : '')}</span>
              <span class="nc-track"><span class="nc-bar nc-c${s.colorIndex}" style="width:${p.pct}%"></span></span>
              <span class="nc-value">${esc(p.display)}</span>
            </div>`)
        .join('\n');
      const ticks = s.ticks
        .map((t) => `<span class="nc-tick">${esc(fmtTick(t))}</span>`)
        .join('');
      return `          <div class="nc-series">
            <div class="nc-series-head">
              <span class="nc-series-label">${esc(s.label)}</span>
              <span class="nc-source-badge">${esc(s.sourceLabel)}</span>
            </div>
            <div class="nc-axis-note">axis: 0–${esc(fmtTick(s.axisMax))} ${esc(s.unit)}</div>
${rows}
            <div class="nc-axis"><span class="nc-year"></span><span class="nc-ticks">${ticks}</span><span class="nc-value"></span></div>
          </div>`;
    })
    .join('\n');

  const captionItems = layout.series
    .map((s) => `            <li><strong>${esc(s.label)}</strong> — reported by ${esc(s.sourceLabel)}, in ${esc(s.unit)}${renderCites(s.sources, refNumById)}</li>`)
    .join('\n');

  const heading = nc.heading || 'Numbers';
  return `    <section id="numbers-chart">
      <h2>${esc(heading)}</h2>
      ${nc.note ? `<p class="section-intro">${esc(nc.note)}</p>` : ''}
      ${nc.unitNote ? `<p class="notice notice-attribution">${esc(nc.unitNote)}</p>` : ''}
      <figure class="numbers-chart">
        <div class="viz-scroll">
${panels}
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

function renderEventRow(ev, refNumById, ui) {
  const flag = ev.dateVerified === false
    ? ` <span class="flag" title="${esc((ui || UI.en).flagTitle)}">?</span>`
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

function renderPage(data, archives, opts = {}) {
  const { meta, facts, events, figures, organizations, disambiguation, references } = data;
  const lang = opts.lang || (meta && meta.language) || 'en';
  const ui = UI[lang] || UI.en;
  const base = opts.base || siteBase(meta);
  const route = opts.route || '';
  // `episcopalLineage` is the original fsspx key, kept as an alias.
  const lineage = data.lineage || data.episcopalLineage;
  const branchTimeline = data.branchTimeline;
  const numbersChart = data.numbersChart;

  // Stable citation numbering: references keep their file order.
  const refNumById = new Map(references.map((r, i) => [r.id, i + 1]));

  // Optional visual sections ('' when the data declares none — the page is
  // then byte-identical to a build without these features).
  const lineageHtml = renderLineageSection(lineage, refNumById);
  const branchTimelineHtml = renderBranchTimeline(branchTimeline, refNumById);
  const numbersChartHtml = renderNumbersChart(numbersChart, refNumById);

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
      return header + renderEventRow(ev, refNumById, ui);
    })
    .join('\n');

  const factRows = (facts || [])
    .map((f) => {
      const flag = f.verified === false ? ` <span class="flag" title="${esc(ui.factFlagTitle)}">?</span>` : '';
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
  <link rel="stylesheet" href="../styles.css">
${seoHead(meta, base, route, lang)}
</head>
<body>
  <header class="site-header">
    <div class="wrap">
      ${langSwitcher(route, lang, ui)}
      <h1>${esc(meta.title)}</h1>
      <p class="subtitle">${esc(meta.subtitle)}</p>
      <p class="lead">${esc(meta.description)}</p>
      <p class="updated">${esc(ui.lastUpdated)} ${esc(meta.lastUpdated)}</p>${renderVizChips(meta.vizChips)}
    </div>
  </header>${ui.disclaimer ? `\n  <div class="i18n-disclaimer" role="note">🌐 ${esc(ui.disclaimer)}</div>` : ''}

  <nav class="site-nav">
    <div class="wrap">
      <a href="#about">${esc(ui.about)}</a>
      <a href="#chronology">${esc(ui.chronology)}</a>${lineageHtml ? `\n      <a href="#lineage">${esc(lineage.navLabel || 'Genealogy')}</a>` : ''}${branchTimelineHtml ? `\n      <a href="#branch-timeline">${esc(branchTimeline.navLabel || 'Divisions')}</a>` : ''}${numbersChartHtml ? `\n      <a href="#numbers-chart">${esc(numbersChart.navLabel || 'Numbers')}</a>` : ''}
      <a href="#figures">${esc(ui.figures)}</a>
      <a href="#organizations">${esc(ui.organizations)}</a>
      ${disambigCards ? `<a href="#disambiguation">${esc(ui.disambiguation)}</a>` : ''}
      <a href="#references">${esc(ui.references)}</a>
    </div>
  </nav>

  <main class="wrap">
    <section id="about">
      <h2>${esc(ui.aboutHeading)}</h2>
      <p class="notice">${esc(meta.dataQualityNote)}</p>
      <dl class="facts">
${factRows}
      </dl>
    </section>

    <section id="chronology">
      <h2>${esc(ui.chronologyHeading)}</h2>
      <p class="section-intro">${ui.chronologyIntro}</p>
      <div class="table-scroll">
      <table class="meetings">
        <thead>
          <tr><th>${esc(ui.thYear)}</th><th>${esc(ui.thDate)}</th><th>${esc(ui.thPlace)}</th><th>${esc(ui.thEvent)}</th></tr>
        </thead>
        <tbody>
${eventRows}
        </tbody>
      </table>
      </div>
    </section>

${lineageHtml}${branchTimelineHtml}${numbersChartHtml}    <section id="figures">
      <h2>${esc(ui.figuresHeading)}</h2>
      <div class="party-grid">
${figures.map((f) => renderFigureCard(f, refNumById)).join('\n')}
      </div>
    </section>

    <section id="organizations">
      <h2>${esc(ui.organizationsHeading)}</h2>
      <div class="party-grid">
${(organizations || []).map((o) => renderOrgCard(o, refNumById)).join('\n')}
      </div>
    </section>

${disambigCards ? `    <section id="disambiguation">
      <h2>${ui.disambiguationHeading}</h2>
      ${disambiguation.note ? `<p class="notice notice-attribution">${esc(disambiguation.note)}</p>` : ''}
      <div class="party-grid">
${disambigCards}
      </div>
    </section>
` : ''}
    <section id="references">
      <h2>${esc(ui.referencesHeading)}</h2>
      <p class="section-intro">${ui.refsIntro(references.length, archivedRefs)}</p>
      <ol class="references">
${references.map((r, i) => renderReference(r, i + 1, archives)).join('\n')}
      </ol>
    </section>
  </main>

  <footer class="site-footer">
    <div class="wrap">
      <p>${ui.footer}</p>
    </div>
  </footer>
</body>
</html>
`;
}

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const archives = loadArchives();
  const base = siteBase(data.meta);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const lang of LOCALES) {
    const localized = localizeData(data, loadDict(lang), lang);
    const dir = path.join(OUT_DIR, lang);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderPage(localized, archives, { lang, base, route: '' }));
  }
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), renderRootStub(base));
  fs.writeFileSync(path.join(OUT_DIR, 'sitemap.xml'), renderSitemap(base, ROUTES));
  fs.writeFileSync(path.join(OUT_DIR, 'robots.txt'), renderRobots(base));
  fs.copyFileSync(path.join(SRC_DIR, 'styles.css'), path.join(OUT_DIR, 'styles.css'));
  // Disable Jekyll processing on GitHub Pages.
  fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '');

  const archivedRefs = data.references.filter((r) => archives[r.url] && archives[r.url].archiveUrl).length;
  console.log(
    `Built ${LOCALES.length} locales (${LOCALES.join(', ')}) × ${ROUTES.length} route(s) + root redirect, sitemap, robots — ` +
    `${data.events.length} events, ${data.figures.length} figures, ` +
    `${data.references.length} references, ${archivedRefs} with archive fallback.`
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
  layoutNumbersChart, renderNumbersChart,
  renderPage,
  LOCALES, ROUTES, OG_LOCALE, UI, loadDict, siteBase, translator, localizeData,
  alternates, seoHead, langSwitcher, renderRootStub, renderSitemap, renderRobots,
};
