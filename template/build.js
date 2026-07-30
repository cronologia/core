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
const PLACES_FILE = path.join(ROOT, 'data', 'places.json');
const I18N_DIR = path.join(ROOT, 'data', 'i18n');
const SRC_DIR = path.join(ROOT, 'src');
const WORLD_FILE = path.join(SRC_DIR, 'world-land.json');
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
  'detail', 'status', 'relation', 'unitNote', 'sourceLabel', 'display', 'unit', 'edgeLabel', 'unlistedLabel',
  // Lane bases are prose and RENDER on the page (renderSwimlanes publishes each
  // lane's grounding), so they are translated like any other visible prose.
  'basis', 'intro',
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
    spineHeading: 'Events over time', spineNav: 'Over time',
    spineIntro: 'How the record is distributed across time. Bar height is the number of recorded events in that decade; the hatched part of a bar is events whose date is not yet verified against a primary source. Select a decade to jump to it in the chronology below.',
    spineBreakLabel: (n, from_, to) => `${n} decades with no recorded events (${from_}–${to})`,
    spineColLabel: (dec, n, u) => `${dec}: ${n} event${n === 1 ? '' : 's'}${u ? `, ${u} with an unverified date` : ''}`,
    spineCaption: (n, span, u) => `${n} events, ${span}${u ? ` · ${u} with a date not yet verified against a primary source` : ''}. Gaps are shown as explicit breaks, never compressed away.`,
    mapHeading: 'Events on the map', mapNav: 'Map',
    mapIntro: 'Every recorded event that names a place, placed at that place. Marker area grows with the number of events there; an event naming more than one place appears at each. Select a marker to jump to its first decade in the chronology.',
    mapLegendSize: 'marker area = number of recorded events',
    mapLegendApprox: 'hollow marker = country-level location (approximate centre, not a specific site)',
    mapApproxBadge: 'country-level, approximate',
    mapLegendUnverified: 'dashed marker = the first date recorded there is not yet verified against a primary source',
    mapCredit: 'Basemap: Natural Earth (public domain).',
    tierMapHeading: 'Map', tierMapHint: 'Hover or focus a country for details.',
    mapPinLabel: (name, n, y, u) => `${name}: ${n} event${n === 1 ? '' : 's'}, first recorded ${y}${u ? ' (date not yet verified)' : ''}`,
    mapListHeading: 'Mapped places',
    mapCaption: (nEv, nPl, span) => `${nEv} events at ${nPl} mapped places, first recorded ${span}.`,
    mapNonGeoNote: (n) => `${n} event${n === 1 ? ' has' : 's have'} a non-geographic scope (e.g. worldwide) and ${n === 1 ? 'is' : 'are'} deliberately not mapped.`,
    mapUnresolvedNote: (n) => `${n} event${n === 1 ? '' : 's'} name${n === 1 ? 's' : ''} a place not yet in the gazetteer and ${n === 1 ? 'is' : 'are'} not mapped.`,
    mapSliderLabel: 'Show places first recorded up to',
    mapPlay: '▶ Play', mapPause: '⏸ Pause',
    mapShowing: (y, shown, total) => `Showing places first recorded up to ${y}: ${shown} of ${total}.`,
    swHeading: 'Parallel storylines', swNav: 'Storylines',
    swIntro: 'The chronology read as parallel storylines: one row per lane, one column per decade, each cell the number of that lane’s events in that decade. An event that belongs to several storylines is counted in each, so the rows sum to more than the number of events. Select a number to jump to that decade in the chronology.',
    swLaneHeader: 'Storyline', swTotalHeader: 'Events',
    swBasesHeading: 'What each lane is grounded in',
    swCellLabel: (lane, dec, n, u) => `${lane}, ${dec}: ${n} event${n === 1 ? '' : 's'}${u ? `, ${u} with a date not yet verified against a primary source` : ''}`,
    swEmptyCell: (lane, dec) => `${lane}, ${dec}: no recorded events`,
    swCaption: (n, lanes, span, assign) => `${n} events across ${lanes} lanes, ${span} · ${assign} lane assignments, because an event may belong to more than one storyline. Gaps are shown as explicit breaks, never compressed away.`,
    swUntaggedNote: (n) => `${n} dated event${n === 1 ? ' carries' : 's carry'} no lane yet and ${n === 1 ? 'is' : 'are'} therefore not shown here.`,
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
    spineHeading: 'Acontecimientos a lo largo del tiempo', spineNav: 'En el tiempo',
    spineIntro: 'Cómo se distribuye el registro en el tiempo. La altura de cada barra es el número de acontecimientos registrados en esa década; la parte rayada corresponde a acontecimientos cuya fecha aún no se ha verificado con una fuente primaria. Seleccione una década para ir a ella en la cronología.',
    spineBreakLabel: (n, from_, to) => `${n} décadas sin acontecimientos registrados (${from_}–${to})`,
    spineColLabel: (dec, n, u) => `${dec}: ${n} acontecimiento${n === 1 ? '' : 's'}${u ? `, ${u} con fecha no verificada` : ''}`,
    spineCaption: (n, span, u) => `${n} acontecimientos, ${span}${u ? ` · ${u} con fecha aún no verificada con una fuente primaria` : ''}. Los vacíos se muestran como cortes explícitos, nunca comprimidos.`,
    mapHeading: 'Acontecimientos en el mapa', mapNav: 'Mapa',
    mapIntro: 'Cada acontecimiento registrado que nombra un lugar, situado en ese lugar. El área del marcador crece con el número de acontecimientos allí; un acontecimiento que nombra más de un lugar aparece en cada uno. Seleccione un marcador para ir a su primera década en la cronología.',
    mapLegendSize: 'área del marcador = número de acontecimientos registrados',
    mapLegendApprox: 'marcador hueco = ubicación a nivel de país (centro aproximado, no un sitio concreto)',
    mapApproxBadge: 'nivel de país, aproximado',
    mapLegendUnverified: 'marcador discontinuo = la primera fecha registrada allí aún no está verificada con una fuente primaria',
    mapCredit: 'Mapa base: Natural Earth (dominio público).',
    tierMapHeading: 'Mapa', tierMapHint: 'Pase el cursor o enfoque un país para ver detalles.',
    mapPinLabel: (name, n, y, u) => `${name}: ${n} acontecimiento${n === 1 ? '' : 's'}, primero registrado en ${y}${u ? ' (fecha aún no verificada)' : ''}`,
    mapListHeading: 'Lugares en el mapa',
    mapCaption: (nEv, nPl, span) => `${nEv} acontecimientos en ${nPl} lugares del mapa, primeros registros ${span}.`,
    mapNonGeoNote: (n) => `${n} acontecimiento${n === 1 ? ' tiene' : 's tienen'} un alcance no geográfico (p. ej. mundial) y deliberadamente no se ${n === 1 ? 'mapea' : 'mapean'}.`,
    mapUnresolvedNote: (n) => `${n} acontecimiento${n === 1 ? ' nombra' : 's nombran'} un lugar que aún no está en el gacetero y no se ${n === 1 ? 'mapea' : 'mapean'}.`,
    mapSliderLabel: 'Mostrar lugares registrados por primera vez hasta',
    mapPlay: '▶ Reproducir', mapPause: '⏸ Pausa',
    mapShowing: (y, shown, total) => `Mostrando lugares registrados por primera vez hasta ${y}: ${shown} de ${total}.`,
    swHeading: 'Relatos paralelos', swNav: 'Relatos',
    swIntro: 'La cronología leída como relatos paralelos: una fila por franja, una columna por década, y en cada celda el número de acontecimientos de esa franja en esa década. Un acontecimiento que pertenece a varios relatos se cuenta en cada uno, de modo que las filas suman más que el total de acontecimientos. Seleccione un número para ir a esa década en la cronología.',
    swLaneHeader: 'Relato', swTotalHeader: 'Acontecimientos',
    swBasesHeading: 'En qué se funda cada franja',
    swCellLabel: (lane, dec, n, u) => `${lane}, ${dec}: ${n} acontecimiento${n === 1 ? '' : 's'}${u ? `, ${u} con fecha aún no verificada con una fuente primaria` : ''}`,
    swEmptyCell: (lane, dec) => `${lane}, ${dec}: sin acontecimientos registrados`,
    swCaption: (n, lanes, span, assign) => `${n} acontecimientos en ${lanes} franjas, ${span} · ${assign} asignaciones a franjas, porque un acontecimiento puede pertenecer a más de un relato. Los vacíos se muestran como cortes explícitos, nunca comprimidos.`,
    swUntaggedNote: (n) => `${n} acontecimiento${n === 1 ? ' fechado no tiene' : 's fechados no tienen'} todavía ninguna franja y por eso no ${n === 1 ? 'aparece' : 'aparecen'} aquí.`,
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
    spineHeading: 'Acontecimentos ao longo do tempo', spineNav: 'No tempo',
    spineIntro: 'Como o registo se distribui no tempo. A altura de cada barra é o número de acontecimentos registados nessa década; a parte tracejada corresponde a acontecimentos cuja data ainda não foi verificada com uma fonte primária. Selecione uma década para saltar para ela na cronologia.',
    spineBreakLabel: (n, from_, to) => `${n} décadas sem acontecimentos registados (${from_}–${to})`,
    spineColLabel: (dec, n, u) => `${dec}: ${n} acontecimento${n === 1 ? '' : 's'}${u ? `, ${u} com data não verificada` : ''}`,
    spineCaption: (n, span, u) => `${n} acontecimentos, ${span}${u ? ` · ${u} com data ainda não verificada com uma fonte primária` : ''}. As lacunas são mostradas como cortes explícitos, nunca comprimidas.`,
    mapHeading: 'Acontecimentos no mapa', mapNav: 'Mapa',
    mapIntro: 'Cada acontecimento registado que nomeia um lugar, situado nesse lugar. A área do marcador cresce com o número de acontecimentos ali; um acontecimento que nomeia mais de um lugar aparece em cada um. Selecione um marcador para ir à sua primeira década na cronologia.',
    mapLegendSize: 'área do marcador = número de acontecimentos registados',
    mapLegendApprox: 'marcador vazado = localização ao nível do país (centro aproximado, não um local específico)',
    mapApproxBadge: 'nível de país, aproximado',
    mapLegendUnverified: 'marcador tracejado = a primeira data registada ali ainda não foi verificada com uma fonte primária',
    mapCredit: 'Mapa-base: Natural Earth (domínio público).',
    tierMapHeading: 'Mapa', tierMapHint: 'Passe o cursor ou foque um país para ver detalhes.',
    mapPinLabel: (name, n, y, u) => `${name}: ${n} acontecimento${n === 1 ? '' : 's'}, primeiro registo em ${y}${u ? ' (data ainda não verificada)' : ''}`,
    mapListHeading: 'Lugares no mapa',
    mapCaption: (nEv, nPl, span) => `${nEv} acontecimentos em ${nPl} lugares do mapa, primeiros registos ${span}.`,
    mapNonGeoNote: (n) => `${n} acontecimento${n === 1 ? ' tem' : 's têm'} um alcance não geográfico (p. ex. mundial) e deliberadamente não ${n === 1 ? 'é mapeado' : 'são mapeados'}.`,
    mapUnresolvedNote: (n) => `${n} acontecimento${n === 1 ? ' nomeia' : 's nomeiam'} um lugar que ainda não está no dicionário geográfico e não ${n === 1 ? 'é mapeado' : 'são mapeados'}.`,
    mapSliderLabel: 'Mostrar lugares registados pela primeira vez até',
    mapPlay: '▶ Reproduzir', mapPause: '⏸ Pausar',
    mapShowing: (y, shown, total) => `A mostrar lugares registados pela primeira vez até ${y}: ${shown} de ${total}.`,
    swHeading: 'Narrativas paralelas', swNav: 'Narrativas',
    swIntro: 'A cronologia lida como narrativas paralelas: uma linha por faixa, uma coluna por década, e em cada célula o número de acontecimentos dessa faixa nessa década. Um acontecimento que pertence a várias narrativas é contado em cada uma, pelo que as linhas somam mais do que o total de acontecimentos. Selecione um número para ir a essa década na cronologia.',
    swLaneHeader: 'Narrativa', swTotalHeader: 'Acontecimentos',
    swBasesHeading: 'Em que se fundamenta cada faixa',
    swCellLabel: (lane, dec, n, u) => `${lane}, ${dec}: ${n} acontecimento${n === 1 ? '' : 's'}${u ? `, ${u} com data ainda não verificada com uma fonte primária` : ''}`,
    swEmptyCell: (lane, dec) => `${lane}, ${dec}: sem acontecimentos registados`,
    swCaption: (n, lanes, span, assign) => `${n} acontecimentos em ${lanes} faixas, ${span} · ${assign} atribuições a faixas, porque um acontecimento pode pertencer a mais de uma narrativa. As lacunas são mostradas como cortes explícitos, nunca comprimidas.`,
    swUntaggedNote: (n) => `${n} acontecimento${n === 1 ? ' datado não tem' : 's datados não têm'} ainda qualquer faixa e por isso não ${n === 1 ? 'aparece' : 'aparecem'} aqui.`,
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
  // `place` IS translated prose (the chronology's Place column reads in the
  // page's language), but the gazetteer behind the places map is keyed on the
  // CANONICAL English strings — a translated "Roma" resolves to nothing. So
  // record the source string next to the translated one and let the map resolve
  // on that. Without this a localized page silently loses markers AND its
  // caption reports the events as missing from the gazetteer, which is false:
  // the entries are there, only the lookup key was translated out from under
  // them. Compound strings are the worst case — "Topeka / Los Angeles, USA"
  // keeps its first pin and drops the second, exactly the origin-misplacement
  // failure the list-valued resolution exists to prevent (core#24).
  // Set ONLY when translation actually moved the string, so English (and any
  // untranslated place) stays byte-identical to the source — the identity-
  // localization invariant the helper tests pin. The map falls back to `place`.
  if (Array.isArray(copy.events) && Array.isArray(data.events)) {
    copy.events.forEach((ev, i) => {
      const src = data.events[i];
      if (src && src.place && ev.place !== src.place) ev.placeKey = src.place;
    });
  }
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

/** Vendored gazetteer (data/places.json, refreshed by scripts/sync-places.js). */
function loadPlaces() {
  try {
    return JSON.parse(fs.readFileSync(PLACES_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** Committed world basemap (src/world-land.json — see its _meta for provenance). */
function loadWorld() {
  try {
    return JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
  } catch {
    return null;
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

/* ---------------------------------------------------------------------------
 * Chronology spine — a density chart placed at the TOP of the page.
 *
 * The chronology table answers "what happened, and when". It cannot answer
 * "where is this record dense, and where is it thin" — that shape is only
 * visible as a picture. This renders one bar per decade, bar height = number
 * of events, so a founding burst or a quiet stretch is legible at a glance.
 *
 * Three properties are deliberate and must survive any redesign:
 *
 * 1. GAPS ARE EXPLICIT. Runs of empty decades collapse into a labelled break
 *    that states how many decades and which years were skipped. A silent
 *    rescale would present perennialism's 380-year gap as ordinary spacing —
 *    that is a factual distortion, not a cosmetic one.
 * 2. UNVERIFIED DATES STAY VISIBLY UNVERIFIED. Placing a mark on a time axis
 *    is an implicit precision claim, so events with `dateVerified: false` are
 *    drawn as a separate hatched segment and named in the label and caption.
 * 3. NO COLOUR-ONLY ENCODING. Every quantity is also text (the count is
 *    printed above the bar) and every column is a focusable link, so the
 *    figure is usable without colour, without a pointer, and — since it is
 *    plain markup — without JavaScript.
 *
 * Driven by the optional top-level `chronologySpine` key:
 *
 *   chronologySpine: {
 *     heading?:      string   // default: locale's spineHeading
 *     navLabel?:     string   // default: locale's spineNav
 *     note?:         string   // replaces the default intro
 *     collapseAfter?: number  // consecutive empty decades before a break (default 2)
 *   }
 *
 * Absent key = '' = byte-identical page. Same contract as the other renderers.
 * ------------------------------------------------------------------------- */

/** Decade of a year, as the bucket key both time renderers use. */
function decadeBucket(year) {
  return Math.floor(year / 10) * 10;
}

/**
 * The shared COLUMN MODEL for every decade-based figure: which decades get a
 * column, and where a run of empty ones collapses into an explicit labelled
 * break. Extracted so the spine and the swimlanes cannot disagree about a gap —
 * two figures on one page showing the same span differently would be a defect,
 * and perennialism's 380-year hole is exactly where they would diverge.
 *
 * `presentDecades` is a Set of decades that have at least one event.
 * Returns [{ type: 'decade', decade } | { type: 'break', count, from, to }].
 */
function decadeColumns(presentDecades, collapseAfter) {
  const present = [...presentDecades].sort((a, b) => a - b);
  if (present.length === 0) return [];
  const first = present[0];
  const last = present[present.length - 1];
  const has = new Set(present);

  const cells = [];
  let run = [];
  const flushRun = () => {
    if (run.length === 0) return;
    // A run shorter than the threshold is drawn as real empty columns, so
    // small gaps keep their true width; only long runs collapse.
    if (run.length < collapseAfter) {
      for (const d of run) cells.push({ type: 'decade', decade: d });
    } else {
      cells.push({ type: 'break', count: run.length, from: run[0], to: run[run.length - 1] + 9 });
    }
    run = [];
  };
  for (let d = first; d <= last; d += 10) {
    if (!has.has(d)) { run.push(d); continue; }
    flushRun();
    cells.push({ type: 'decade', decade: d });
  }
  flushRun();
  return cells;
}

/** Normalize a `collapseAfter` option (consecutive empty decades before a break). */
function collapseAfterOf(cfg) {
  return cfg && Number.isFinite(cfg.collapseAfter) && cfg.collapseAfter > 0
    ? Math.floor(cfg.collapseAfter)
    : 2;
}

/**
 * Pure layout: bucket events by decade, collapse empty runs into breaks.
 * Returns null when there is nothing to draw (renderChronologySpine then '').
 */
function layoutChronologySpine(spine, events) {
  if (!spine) return null;
  const withYear = (events || []).filter((e) => Number.isFinite(e.year));
  if (withYear.length === 0) return null;

  const collapseAfter = collapseAfterOf(spine);

  const dec = decadeBucket;
  const counts = new Map();
  for (const e of withYear) {
    const d = dec(e.year);
    const c = counts.get(d) || { total: 0, unverified: 0 };
    c.total += 1;
    if (e.dateVerified === false) c.unverified += 1;
    counts.set(d, c);
  }

  const max = Math.max(...[...counts.values()].map((c) => c.total));

  // Shared column model, so this figure and the swimlanes agree about gaps.
  const cells = decadeColumns(counts.keys(), collapseAfter).map((col) => {
    if (col.type === 'break') return col;
    const c = counts.get(col.decade) || { total: 0, unverified: 0 };
    return {
      type: 'decade', decade: col.decade, total: c.total, unverified: c.unverified,
      pct: max ? Math.round((c.total / max) * 1000) / 10 : 0,
      uPct: max ? Math.round((c.unverified / max) * 1000) / 10 : 0,
    };
  });

  const years = withYear.map((e) => e.year);
  return {
    cells, max,
    totalEvents: withYear.length,
    unverified: withYear.filter((e) => e.dateVerified === false).length,
    span: `${Math.min(...years)}–${Math.max(...years)}`,
    breaks: cells.filter((c) => c.type === 'break').length,
  };
}

/** Render the chronology spine, or '' when the data declares none. */
function renderChronologySpine(spine, events, ui) {
  const layout = layoutChronologySpine(spine, events);
  if (!layout) return '';
  const t = ui || UI.en;

  const cells = layout.cells
    .map((c) => {
      if (c.type === 'break') {
        const label = t.spineBreakLabel(c.count, c.from, c.to);
        return `          <li class="cs-break"><span class="cs-break-mark" aria-hidden="true">⸺</span><span class="cs-break-label">${esc(label)}</span></li>`;
      }
      const dLabel = `${c.decade}s`;
      const label = t.spineColLabel(dLabel, c.total, c.unverified);
      if (c.total === 0) {
        return `          <li class="cs-col cs-empty"><span class="cs-count"></span><span class="cs-track"></span><span class="cs-label">${esc(dLabel)}</span></li>`;
      }
      const uSeg = c.unverified > 0
        ? `<span class="cs-unverified" style="height:${(c.uPct / c.pct) * 100}%"></span>`
        : '';
      return `          <li class="cs-col"><a href="#decade-${c.decade}" title="${esc(label)}"><span class="cs-count">${c.total}</span><span class="cs-track"><span class="cs-bar" style="height:${c.pct}%">${uSeg}</span></span><span class="cs-label">${esc(dLabel)}</span><span class="visually-hidden">${esc(label)}</span></a></li>`;
    })
    .join('\n');

  const heading = spine.heading || t.spineHeading;
  const intro = spine.note || t.spineIntro;
  return `    <section id="chronology-spine" class="viz">
      <h2>${esc(heading)}</h2>
      <p class="section-intro">${esc(intro)}</p>
      <figure class="chrono-spine">
        <div class="viz-scroll">
        <ol class="cs-track-list">
${cells}
        </ol>
        </div>
        <figcaption>${esc(t.spineCaption(layout.totalEvents, layout.span, layout.unverified))}</figcaption>
      </figure>
    </section>

`;
}

/* ---------------------------------------------------------------------------
 * Places map — event places as sized markers on a world basemap.
 *
 * The chronology table names places; only a map shows the geography — for a
 * diffusion story (Topeka → Pittsburgh → Ann Arbor → Brazil) the geography IS
 * the argument. Extracted per core#3 item 2; the data half is core#24's
 * committed gazetteer (data/places.json, vendored like glossary-terms.json).
 *
 * Five properties are deliberate and must survive any redesign:
 *
 * 1. A PLACE STRING RESOLVES TO A LIST of gazetteer ids, never a single one.
 *    "Topeka / Los Angeles, USA" is ONE event in TWO places; dropping the
 *    second pin would misplace the origin of rcc's entire subject (core#24).
 * 2. NON-GEOGRAPHIC SCOPES ARE NOT MAPPED, and the omission is stated in the
 *    caption. "Worldwide" is a scope, not a place; a pin for it would invent
 *    a location the source does not claim.
 * 3. COUNTRY-LEVEL LOCATIONS LOOK DIFFERENT (hollow marker). A centroid pin
 *    drawn like a settlement pin implies a precision the data does not have.
 * 4. UNVERIFIED DATES STAY VISIBLY UNVERIFIED (dashed marker + text). The
 *    marker's "first recorded" year is an implicit dating claim, so it is
 *    flagged exactly like the table's `?` when that earliest date carries
 *    `dateVerified: false`.
 * 5. NO COLOUR-ONLY OR POINTER-ONLY ENCODING. Every marker is a focusable
 *    link with an accessible label, and the full text list of mapped places
 *    renders under the figure — that list, not the picture, is the baseline
 *    (and the print form beside the cropped map).
 *
 * The year control (a slider that hides places first recorded after the
 * chosen year) is progressive enhancement: the no-JS and print state is the
 * complete map, and the controls stay hidden until the inline script enables
 * them.
 *
 * Driven by the optional top-level `placesMap` key:
 *
 *   placesMap: {
 *     heading?:  string   // default: locale's mapHeading
 *     navLabel?: string   // default: locale's mapNav
 *     note?:     string   // replaces the default intro
 *   }
 *
 * Requires the vendored gazetteer data/places.json (scripts/sync-places.js)
 * and the basemap src/world-land.json. Absent key = '' = byte-identical page.
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * Swimlanes — the thread-lane figure (core#23).
 *
 * One row per declared lane, one column per decade, each cell the number of
 * that lane's events in that decade. It is rendered as a real <table> because
 * that is what the data is: a categorical value over time, with row and column
 * headers. The table IS the accessible baseline and the print form — the
 * colour is decoration layered on a printed number, never the encoding.
 *
 * Five properties are deliberate and must survive any redesign:
 *
 * 1. THE EDITORIAL NOTE RENDERS WITH THE FIGURE, always. `meta.threads.note`
 *    is the visible statement that the lanes are a reading and not a neutral
 *    index; a lane display without it would assert exactly what the taxonomy
 *    is careful not to claim (core#23, sourcing-rules).
 * 2. EACH LANE'S GROUNDING IS ON THE PAGE. Every lane's `basis` renders below
 *    the figure with its citations — the reasoning is published, not buried in
 *    the data file or in a tooltip nobody opens.
 * 3. LANE LABELS RENDER VERBATIM. A label may carry an attribution that is
 *    load-bearing ("Antecedents (attributed, not adopted)"); truncating or
 *    prettifying it would destroy the hedge.
 * 4. GAPS ARE EXPLICIT, and identical to the spine's — both use
 *    decadeColumns(), so one page cannot show the same span two ways.
 * 5. UNVERIFIED DATES STAY VISIBLY UNVERIFIED: a cell states how many of its
 *    events carry `dateVerified: false`, in text and with a hatch.
 *
 * Driven by `meta.threads` (the taxonomy) + `events[].threads`. Declaring a
 * taxonomy is what turns the figure on: a classification the site keeps but
 * never shows would be latent editorialising. Absent key = '' = byte-identical.
 * ------------------------------------------------------------------------- */

/**
 * Pure layout: lanes × decade columns, with per-cell and per-lane totals.
 * Returns null when there is nothing to draw (renderSwimlanes then '').
 */
function layoutSwimlanes(threads, events) {
  if (!threads || !Array.isArray(threads.lanes) || threads.lanes.length === 0) return null;
  const withYear = (events || []).filter((e) => Number.isFinite(e.year));
  if (withYear.length === 0) return null;

  const tagged = withYear.filter((e) => Array.isArray(e.threads) && e.threads.length > 0);
  if (tagged.length === 0) return null;

  const collapseAfter = collapseAfterOf(threads);
  const present = new Set(tagged.map((e) => decadeBucket(e.year)));
  const columns = decadeColumns(present, collapseAfter);

  let maxCell = 0;
  const lanes = threads.lanes.map((lane) => {
    const mine = tagged.filter((e) => e.threads.includes(lane.id));
    const cells = columns.map((col) => {
      if (col.type === 'break') return col;
      const inDecade = mine.filter((e) => decadeBucket(e.year) === col.decade);
      const unverified = inDecade.filter((e) => e.dateVerified === false).length;
      if (inDecade.length > maxCell) maxCell = inDecade.length;
      return { type: 'decade', decade: col.decade, total: inDecade.length, unverified };
    });
    const years = mine.map((e) => e.year);
    return {
      id: lane.id,
      label: lane.label,
      basis: lane.basis,
      sources: lane.sources,
      cells,
      total: mine.length,
      unverified: mine.filter((e) => e.dateVerified === false).length,
      span: years.length ? `${Math.min(...years)}–${Math.max(...years)}` : null,
    };
  });

  const years = tagged.map((e) => e.year);
  return {
    lanes,
    columns,
    maxCell,
    span: `${Math.min(...years)}–${Math.max(...years)}`,
    taggedEvents: tagged.length,
    // Events with a year but no lane: reported, never silently absent.
    untagged: withYear.length - tagged.length,
    // An event in two lanes is counted in both, so the column sums exceed the
    // event count. Stated in the caption rather than hidden.
    laneAssignments: lanes.reduce((n, l) => n + l.total, 0),
  };
}

/** Render the swimlanes figure, or '' when the data declares no taxonomy. */
function renderSwimlanes(threads, events, refNumById, ui) {
  const layout = layoutSwimlanes(threads, events);
  if (!layout) return '';
  const t = ui || UI.en;

  const headCells = layout.columns
    .map((col) => (col.type === 'break'
      ? `<th scope="col" class="sw-break" title="${esc(t.spineBreakLabel(col.count, col.from, col.to))}"><span aria-hidden="true">⸺</span><span class="visually-hidden">${esc(t.spineBreakLabel(col.count, col.from, col.to))}</span></th>`
      : `<th scope="col">${esc(`${col.decade}s`)}</th>`))
    .join('');

  const rows = layout.lanes
    .map((lane) => {
      const cells = lane.cells
        .map((c) => {
          if (c.type === 'break') return '<td class="sw-break"></td>';
          if (c.total === 0) {
            return `<td class="sw-cell sw-zero"><span class="visually-hidden">${esc(t.swEmptyCell(lane.label, `${c.decade}s`))}</span></td>`;
          }
          // Intensity is a redundant cue on top of the printed number.
          const step = layout.maxCell > 1 ? Math.ceil((c.total / layout.maxCell) * 4) : 4;
          const label = t.swCellLabel(lane.label, `${c.decade}s`, c.total, c.unverified);
          const hatch = c.unverified > 0 ? ' sw-has-unverified' : '';
          return `<td class="sw-cell sw-i${step}${hatch}"><a href="#decade-${c.decade}" title="${esc(label)}">${c.total}${c.unverified > 0 ? `<span class="sw-flag" aria-hidden="true">?</span>` : ''}<span class="visually-hidden">${esc(label)}</span></a></td>`;
        })
        .join('');
      return `          <tr>
            <th scope="row">${esc(lane.label)}</th>
${cells ? `            ${cells}\n` : ''}            <td class="sw-total">${lane.total}</td>
          </tr>`;
    })
    .join('\n');

  const bases = layout.lanes
    .map((lane) => `            <li><strong>${esc(lane.label)}</strong> — ${renderText(lane.basis || '')}${renderCites(lane.sources, refNumById)}</li>`)
    .join('\n');

  const heading = threads.heading || t.swHeading;
  const intro = threads.intro || t.swIntro;
  const captionParts = [t.swCaption(layout.taggedEvents, layout.lanes.length, layout.span, layout.laneAssignments)]
    .concat(layout.untagged ? [t.swUntaggedNote(layout.untagged)] : []);

  return `    <section id="threads" class="viz">
      <h2>${esc(heading)}</h2>
      <p class="section-intro">${esc(intro)}</p>
      <p class="notice notice-attribution">${esc(threads.note)}</p>
      <figure class="swimlanes">
        <div class="viz-scroll">
        <table class="sw-grid">
          <thead>
            <tr><th scope="col">${esc(t.swLaneHeader)}</th>${headCells}<th scope="col" class="sw-total">${esc(t.swTotalHeader)}</th></tr>
          </thead>
          <tbody>
${rows}
          </tbody>
        </table>
        </div>
        <figcaption>${captionParts.map(esc).join(' ')}</figcaption>
      </figure>
      <details class="sw-bases" open>
        <summary>${esc(t.swBasesHeading)}</summary>
        <ol class="branch-notes">
${bases}
        </ol>
      </details>
    </section>

`;
}

const PLACE_COMPOUND_SEP = ' / ';

/** Build a lookup: casefolded place name/variant -> [gazetteer ids]. */
function placeIndex(places) {
  const index = new Map();
  for (const e of (places && places.places) || []) {
    for (const v of [e.name].concat(e.variants || [])) {
      const key = String(v).toLowerCase();
      const bucket = index.get(key) || [];
      if (!bucket.includes(e.id)) bucket.push(e.id);
      index.set(key, bucket);
    }
  }
  return index;
}

/**
 * Resolve one event's place string to gazetteer ids. A compound string
 * (" / " separated) is one event in several places and yields several ids.
 * Commas are address structure, never a separator (same rule as
 * core/tools/places.py — keep the two implementations in agreement).
 */
function resolvePlaceString(place, index) {
  const ids = [];
  const missing = [];
  for (const part of String(place).split(PLACE_COMPOUND_SEP).map((s) => s.trim()).filter(Boolean)) {
    const hit = index.get(part.toLowerCase());
    if (hit) { for (const id of hit) if (!ids.includes(id)) ids.push(id); }
    else missing.push(part);
  }
  return { ids, missing };
}

/**
 * Pure layout: aggregate events per mapped place, crop the viewBox to the
 * used places, and account for every event the map does NOT show (so the
 * caption can say so instead of silently dropping it).
 * Returns null when there is nothing to draw (renderPlacesMap then '').
 */
function layoutPlacesMap(pm, events, places) {
  if (!pm) return null;
  const entries = new Map((((places && places.places) || [])).map((e) => [e.id, e]));
  if (entries.size === 0) return null;
  const index = placeIndex(places);

  const perPlace = new Map(); // id -> { count, firstYear, firstUnverified }
  const unresolvedStrings = new Set();
  let nonGeoEvents = 0;
  let unresolvedEvents = 0;
  let mappedEvents = 0;

  const sorted = [...(events || [])]
    .filter((e) => Number.isFinite(e.year))
    .sort((a, b) => a.year - b.year || String(a.date || '').localeCompare(String(b.date || '')));

  for (const ev of sorted) {
    if (!ev.place) continue;
    // `placeKey` is the canonical English string kept by localizeData; `place`
    // may have been translated, and the gazetteer is keyed on the canonical
    // form. Resolve on the key, never on the display string.
    const { ids, missing } = resolvePlaceString(ev.placeKey || ev.place, index);
    for (const m of missing) unresolvedStrings.add(m);
    if (missing.length > 0) unresolvedEvents += 1;
    const geoIds = ids.filter((id) => {
      const e = entries.get(id);
      return e && Number.isFinite(e.lat) && Number.isFinite(e.lon);
    });
    if (geoIds.length === 0) {
      // Resolved, but only to non-geographic scopes ("Worldwide"): counted,
      // deliberately not mapped. (Fully unresolved events are counted above.)
      if (missing.length === 0 && ids.length > 0) nonGeoEvents += 1;
      continue;
    }
    mappedEvents += 1;
    for (const id of geoIds) {
      const cur = perPlace.get(id) || { count: 0, firstYear: Infinity, firstUnverified: false };
      cur.count += 1;
      if (ev.year < cur.firstYear) {
        cur.firstYear = ev.year;
        cur.firstUnverified = ev.dateVerified === false;
      } else if (ev.year === cur.firstYear && ev.dateVerified === false) {
        // Any event in the first year with an unverified date keeps the flag.
        cur.firstUnverified = cur.firstUnverified || true;
      }
      perPlace.set(id, cur);
    }
  }
  if (perPlace.size === 0) return null;

  // Crop to the used places. Padding keeps coastline context; minimum spans
  // stop a tight cluster from zooming past the basemap's 1:110m resolution.
  const xs = []; const ys = [];
  for (const id of perPlace.keys()) {
    const e = entries.get(id);
    xs.push(e.lon + 180);
    ys.push(90 - e.lat);
  }
  const pad = 6;
  let minX = Math.min(...xs) - pad; let maxX = Math.max(...xs) + pad;
  let minY = Math.min(...ys) - pad; let maxY = Math.max(...ys) + pad;
  const MIN_W = 60; const MIN_H = 30;
  if (maxX - minX < MIN_W) { const c = (minX + maxX) / 2; minX = c - MIN_W / 2; maxX = c + MIN_W / 2; }
  if (maxY - minY < MIN_H) { const c = (minY + maxY) / 2; minY = c - MIN_H / 2; maxY = c + MIN_H / 2; }
  minX = Math.max(0, minX); maxX = Math.min(360, maxX);
  minY = Math.max(0, minY); maxY = Math.min(180, maxY);
  const r1 = (n) => Math.round(n * 10) / 10;
  const vbW = r1(maxX - minX); const vbH = r1(maxY - minY);

  // Marker radius in viewBox units, so it scales with the crop: area ~ count.
  const rUnit = vbW / 150;
  const pins = [...perPlace.entries()]
    .map(([id, agg]) => {
      const e = entries.get(id);
      return {
        id,
        name: e.name,
        note: e.note || '',
        x: r1(e.lon + 180),
        y: r1(90 - e.lat),
        r: r1(rUnit * (1 + Math.sqrt(agg.count))),
        count: agg.count,
        firstYear: agg.firstYear,
        firstUnverified: agg.firstUnverified,
        approx: e.precision === 'country-centroid',
      };
    })
    .sort((a, b) => a.firstYear - b.firstYear || a.name.localeCompare(b.name, 'en'));

  const firstYears = [...new Set(pins.map((p) => p.firstYear))].sort((a, b) => a - b);
  return {
    pins,
    viewBox: `${r1(minX)} ${r1(minY)} ${vbW} ${vbH}`,
    mappedEvents,
    nonGeoEvents,
    unresolvedEvents,
    unresolvedStrings: [...unresolvedStrings].sort(),
    firstYears,
    span: `${firstYears[0]}–${firstYears[firstYears.length - 1]}`,
    hasApprox: pins.some((p) => p.approx),
    hasUnverified: pins.some((p) => p.firstUnverified),
  };
}

/** Render the places map, or '' when the data declares none. */
function renderPlacesMap(pm, events, places, world, ui) {
  const layout = layoutPlacesMap(pm, events, places);
  if (!layout) return '';
  if (!world || typeof world.d !== 'string' || !world.d) {
    // The data declares a map; building silently without the basemap would
    // ship a broken section. Fail loudly instead.
    throw new Error('placesMap is declared in the data but src/world-land.json is missing or empty');
  }
  const t = ui || UI.en;

  const pinMarkup = layout.pins
    .map((p) => {
      const cls = `pm-pin${p.approx ? ' pm-approx' : ''}${p.firstUnverified ? ' pm-unverified' : ''}`;
      const label = t.mapPinLabel(p.name, p.count, p.firstYear, p.firstUnverified);
      return `            <a class="${cls}" href="#decade-${Math.floor(p.firstYear / 10) * 10}" data-year="${p.firstYear}" aria-label="${esc(label)}"><circle cx="${p.x}" cy="${p.y}" r="${p.r}"/><title>${esc(label)}</title></a>`;
    })
    .join('\n');

  const listItems = layout.pins
    .map((p) => {
      const flag = p.firstUnverified ? ` <span class="flag" title="${esc(t.flagTitle)}">?</span>` : '';
      const approx = p.approx ? ` <span class="pm-approx-badge">${esc(t.mapApproxBadge)}</span>` : '';
      return `          <li>${esc(t.mapPinLabel(p.name, p.count, p.firstYear, false))}${flag}${approx}${p.note ? ` <span class="muted">— ${esc(p.note)}</span>` : ''}</li>`;
    })
    .join('\n');

  const legendParts = [t.mapLegendSize]
    .concat(layout.hasApprox ? [t.mapLegendApprox] : [])
    .concat(layout.hasUnverified ? [t.mapLegendUnverified] : []);
  const captionNotes = [t.mapCaption(layout.mappedEvents, layout.pins.length, layout.span)]
    .concat(layout.nonGeoEvents ? [t.mapNonGeoNote(layout.nonGeoEvents)] : [])
    .concat(layout.unresolvedEvents ? [t.mapUnresolvedNote(layout.unresolvedEvents)] : []);

  // Year control: progressive enhancement only — rendered hidden, enabled by
  // the inline script, and pointless with a single first-year.
  const minYear = layout.firstYears[0];
  const maxYear = layout.firstYears[layout.firstYears.length - 1];
  const slider = layout.firstYears.length > 1
    ? `        <div class="pm-controls" hidden>
          <button type="button" class="pm-play" data-play="${esc(t.mapPlay)}" data-pause="${esc(t.mapPause)}">${esc(t.mapPlay)}</button>
          <label><span class="visually-hidden">${esc(t.mapSliderLabel)}</span>
          <input type="range" class="pm-slider" min="${minYear}" max="${maxYear}" value="${maxYear}" step="1"></label>
          <output class="pm-year">${maxYear}</output>
        </div>\n`
    : '';
  const script = layout.firstYears.length > 1
    ? `      <script>(function () {
        var s = document.currentScript.closest('section');
        var controls = s.querySelector('.pm-controls');
        var slider = s.querySelector('.pm-slider');
        var out = s.querySelector('.pm-year');
        var play = s.querySelector('.pm-play');
        var live = s.querySelector('.pm-live');
        var pins = Array.prototype.slice.call(s.querySelectorAll('.pm-pin'));
        var total = pins.length;
        var liveTpl = ${JSON.stringify(t.mapShowing('{Y}', '{S}', '{T}'))};
        var timer = null;
        function apply(y) {
          var shown = 0;
          pins.forEach(function (p) {
            var vis = Number(p.getAttribute('data-year')) <= y;
            p.classList.toggle('pm-future', !vis);
            if (vis) shown += 1;
          });
          out.textContent = y;
          live.textContent = liveTpl.replace('{Y}', y).replace('{S}', shown).replace('{T}', total);
        }
        function stop() { if (timer) { clearInterval(timer); timer = null; play.textContent = play.getAttribute('data-play'); } }
        slider.addEventListener('input', function () { stop(); apply(Number(slider.value)); });
        play.addEventListener('click', function () {
          if (timer) { stop(); return; }
          if (Number(slider.value) >= ${maxYear}) slider.value = ${minYear};
          play.textContent = play.getAttribute('data-pause');
          timer = setInterval(function () {
            var y = Number(slider.value) + 1;
            slider.value = y;
            apply(y);
            if (y >= ${maxYear}) stop();
          }, 350);
        });
        controls.hidden = false;
        apply(${maxYear});
      })();</script>\n`
    : '';

  const heading = pm.heading || t.mapHeading;
  const intro = pm.note || t.mapIntro;
  return `    <section id="places-map" class="viz">
      <h2>${esc(heading)}</h2>
      <p class="section-intro">${esc(intro)}</p>
      <figure class="places-map">
${slider}        <div class="viz-scroll">
          <svg viewBox="${layout.viewBox}" role="img" aria-label="${esc(heading)}" preserveAspectRatio="xMidYMid meet">
            <path class="pm-land" d="${world.d}" fill-rule="evenodd"/>
${pinMarkup}
          </svg>
        </div>
        <p class="pm-legend">${legendParts.map(esc).join(' · ')} · ${esc(t.mapCredit)}</p>
        <p class="pm-live visually-hidden" aria-live="polite"></p>
        <figcaption>${captionNotes.map(esc).join(' ')}</figcaption>
      </figure>
      <details class="pm-list" open>
        <summary>${esc(t.mapListHeading)}</summary>
        <ol>
${listItems}
        </ol>
      </details>
${script}    </section>

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


// ---------------------------------------------------------------------------
// Country tier map (`map` key — the tl presence-map pattern, core#3 item 2).
// A static choropleth of the vendored Latin America base map (src/latam.svg):
// each listed country is filled by its TIER — a per-repo, DATA-DECLARED
// vocabulary, like the thread lanes (core#23): what a tier means is an
// editorial claim, so its id and legend label live in the data, never in the
// renderer. Distinct from `placesMap` (event pins): this section says what
// KIND of place a country is in the subject's story, not where events
// happened. The year-slider mode (fsp's member map) is a declared follow-up.

const LATAM_SVG_FILE = path.join(__dirname, 'src', 'latam.svg');

function loadLatamSvg() {
  try {
    return fs.readFileSync(LATAM_SVG_FILE, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Replace glossary [[markers]] with their visible text (no link) — for HTML
 * ATTRIBUTES, where an anchor cannot render. Keeps a marked-up country note
 * readable in the map tooltip while the card below carries the real link.
 */
function stripGlossaryMarkers(value) {
  const s = String(value ?? '');
  if (s.indexOf('[[') === -1) return s;
  return s.replace(new RegExp(GLOSSARY_MARKER.source, 'g'), (_m, id, label) => (label && label.trim() ? label : id));
}

/**
 * Render the country tier map. Returns '' when the data declares no map —
 * the page is then byte-identical to a build without the feature. A missing
 * src/latam.svg also renders '' here, but validate-data.js errors on that
 * combination first, so a broken adoption never fails silently.
 */
function renderTierMap(map, refNumById, ui) {
  if (!map || !Array.isArray(map.countries) || map.countries.length === 0) return '';
  let svg = loadLatamSvg();
  if (!svg) return '';

  const tiers = Array.isArray(map.tiers) ? map.tiers : [];
  const rank = new Map(tiers.map((t, i) => [t.id, i]));

  for (const c of map.countries) {
    const marker = `id="ne-${c.code}" class="latam-c"`;
    svg = svg.replace(
      marker,
      `id="ne-${c.code}" class="latam-c map-t${rank.get(c.tier)}" tabindex="0" ` +
        `data-name="${esc(stripGlossaryMarkers(c.name))}" data-note="${esc(stripGlossaryMarkers(c.note))}"`
    );
  }

  const legend = tiers
    .map((t, i) => `            <span class="ptl-key"><span class="atlas-swatch map-t${i}"></span> ${esc(t.label)}</span>`)
    .join('\n')
    + `\n            <span class="ptl-key"><span class="atlas-swatch"></span> ${esc(map.unlistedLabel)}</span>`;

  const cards = map.countries
    .map((c) => `        <div class="map-card map-card-t${rank.get(c.tier)}">
          <h3>${esc(c.name)}</h3>
          <p>${renderText(c.note)}${renderCites(c.sources, refNumById)}</p>
        </div>`)
    .join('\n');

  const heading = map.heading || ui.tierMapHeading;
  return `    <section id="map" class="viz">
      <h2>${esc(heading)}</h2>
      <p class="section-intro">${esc(map.note)}</p>
      <div class="map-cols">
        <div class="atlas-map">
${svg}
          <p class="ptl-caption" id="tier-map-caption" aria-live="polite">${esc(ui.tierMapHint)}</p>
          <div class="ptl-legend">
${legend}
          </div>
          <p class="atlas-credit">${esc(ui.mapCredit)}</p>
        </div>
        <div class="map-cards">
${cards}
        </div>
      </div>
      <script>
        (function () {
          var cap = document.getElementById('tier-map-caption');
          if (!cap) return;
          var idle = cap.textContent;
          var reset = function () { cap.textContent = idle; };
          document.querySelectorAll('#map .latam-c[data-name]').forEach(function (el) {
            var show = function () { cap.textContent = el.getAttribute('data-name') + ' — ' + el.getAttribute('data-note'); };
            el.addEventListener('mouseenter', show);
            el.addEventListener('focus', show);
            el.addEventListener('mouseleave', reset);
            el.addEventListener('blur', reset);
          });
        })();
      </script>
    </section>
`;
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
  const chronologySpine = data.chronologySpine;
  const placesMap = data.placesMap;
  const tierMap = data.map;
  // The lane taxonomy lives in meta; declaring one turns the figure on.
  const threads = meta && meta.threads;

  // Stable citation numbering: references keep their file order.
  const refNumById = new Map(references.map((r, i) => [r.id, i + 1]));

  // Optional visual sections ('' when the data declares none — the page is
  // then byte-identical to a build without these features).
  const lineageHtml = renderLineageSection(lineage, refNumById);
  const branchTimelineHtml = renderBranchTimeline(branchTimeline, refNumById);
  const numbersChartHtml = renderNumbersChart(numbersChart, refNumById);
  const chronologySpineHtml = renderChronologySpine(chronologySpine, events, ui);
  const placesMapHtml = renderPlacesMap(placesMap, events, opts.places, opts.world, ui);
  const tierMapHtml = renderTierMap(tierMap, refNumById, ui);
  const swimlanesHtml = renderSwimlanes(threads, events, refNumById, ui);

  const sortedEvents = [...events].sort((a, b) => a.year - b.year || String(a.date || '').localeCompare(String(b.date || '')));

  // Chronology rows with a decade header row whenever the decade changes.
  let lastDecade = null;
  const eventRows = sortedEvents
    .map((ev) => {
      const d = decadeOf(ev.year);
      const header = d !== lastDecade
        ? `        <tr class="decade-row" id="decade-${Math.floor(ev.year / 10) * 10}"><th colspan="4">${esc(d)}</th></tr>\n`
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
      <a href="#chronology">${esc(ui.chronology)}</a>${chronologySpineHtml ? `\n      <a href="#chronology-spine">${esc((chronologySpine && chronologySpine.navLabel) || ui.spineNav)}</a>` : ''}${swimlanesHtml ? `\n      <a href="#threads">${esc((threads && threads.navLabel) || ui.swNav)}</a>` : ''}${placesMapHtml ? `\n      <a href="#places-map">${esc((placesMap && placesMap.navLabel) || ui.mapNav)}</a>` : ''}${tierMapHtml ? `\n      <a href="#map">${esc((tierMap && tierMap.navLabel) || ui.tierMapHeading)}</a>` : ''}${lineageHtml ? `\n      <a href="#lineage">${esc(lineage.navLabel || 'Genealogy')}</a>` : ''}${branchTimelineHtml ? `\n      <a href="#branch-timeline">${esc(branchTimeline.navLabel || 'Divisions')}</a>` : ''}${numbersChartHtml ? `\n      <a href="#numbers-chart">${esc(numbersChart.navLabel || 'Numbers')}</a>` : ''}
      <a href="#figures">${esc(ui.figures)}</a>
      <a href="#organizations">${esc(ui.organizations)}</a>
      ${disambigCards ? `<a href="#disambiguation">${esc(ui.disambiguation)}</a>` : ''}
      <a href="#references">${esc(ui.references)}</a>
    </div>
  </nav>

  <main class="wrap">
${chronologySpineHtml}    <section id="about">
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

${swimlanesHtml}${placesMapHtml}${tierMapHtml}${lineageHtml}${branchTimelineHtml}${numbersChartHtml}    <section id="figures">
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
  const places = loadPlaces();
  const world = loadWorld();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const lang of LOCALES) {
    const localized = localizeData(data, loadDict(lang), lang);
    const dir = path.join(OUT_DIR, lang);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderPage(localized, archives, { lang, base, route: '', places, world }));
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
  renderTierMap, stripGlossaryMarkers,
  layoutChronologySpine, renderChronologySpine, decadeBucket, decadeColumns, collapseAfterOf,
  layoutSwimlanes, renderSwimlanes,
  PLACE_COMPOUND_SEP, placeIndex, resolvePlaceString, layoutPlacesMap, renderPlacesMap,
  loadPlaces, loadWorld,
  renderPage,
  LOCALES, ROUTES, OG_LOCALE, UI, loadDict, siteBase, translator, localizeData,
  alternates, seoHead, langSwitcher, renderRootStub, renderSitemap, renderRobots,
};
