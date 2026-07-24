# ADR 0001 — Multi-language sites (PT + ES) with per-locale SEO

Status: Accepted · Applies to: every cronologia chronology site · See: core#9

## Context

The sites document Latin American subjects but were English-only. The goal is
to reach Portuguese- and Spanish-speaking audiences — which, for reference
sites, means being **found via search** in those languages, not just offering a
toggle. Constraints: zero runtime dependencies, JSON as the single source of
truth, GitHub Pages hosting.

## Decision

1. **Locales.** English (default, authoritative) plus `es` and `pt`.
2. **Language in the URL path, after the project segment.** GitHub Pages serves
   each repo at `https://<org>.github.io/<repo>/`, so a locale-first path
   (`/es/<repo>`) is impossible — each repo only controls its own `/<repo>/`
   subtree. Layout: `/<repo>/{en,es,pt}/…`, with `/<repo>/` a redirect stub to
   the visitor's preferred locale. The hub (`cronologia.github.io`) uses the
   served root: `/{en,es,pt}/…`.
3. **Static per-locale pages** (not client-side switching). Each (page × locale)
   is its own file, independently indexable and shareable. Client-side `?lang=`
   was rejected: it isn't reliably indexed, so it would defeat the reach goal.
4. **Machine translation, no review gate, with a visible disclaimer — and no
   runtime/build backend.** The sites are static HTML on GitHub Pages; nothing
   translates at request time. `es`/`pt` are **pre-authored, committed** caches
   `data/i18n/<lang>.json` (keyed by the English source string; missing strings
   fall back to English), baked into the static pages at build time. The caches
   are filled by *authoring* the translations (assistant or human) and
   committing them — `scripts/translate.js --stats` reports what still needs one;
   an env-configured MT service is an optional convenience, never required.
   Every non-English page shows a "machine-translated; English is authoritative"
   banner — necessary because the content is often contested and attributed.
5. **Data-level localization.** `build.js` translates the *data* through a
   key-based walk (`TRANSLATABLE_KEYS`) before rendering, so every renderer —
   chronology, genealogy, branch-timeline, numbers-chart, glossary links — is
   localized automatically. Only the compiler's own chrome is translated from a
   UI table. **Never translated:** reference titles/publishers, proper names,
   URLs, dates, ids — passed through verbatim.
6. **Per-locale SEO** is part of the build: localized `<title>`/description,
   Open Graph/Twitter, self canonical + `hreflang` (en/es/pt + `x-default`),
   JSON-LD (`inLanguage`), a generated `sitemap.xml` with `xhtml:link` hreflang
   alternates, and `robots.txt`. Translated pages stay indexable (no `noindex`).

## Consequences

- The build emits N locales × M routes into `docs/{en,es,pt}/…`, plus a root
  `docs/index.html` redirect stub, `sitemap.xml` and `robots.txt`. The drift
  test covers every locale.
- English output is byte-identical to the pre-i18n render except that it now
  lives at `/<repo>/en/` and carries the SEO head — because localizing with an
  empty dictionary is the identity transform.
- Translation caches are committed data, filled by authoring (no backend at
  build or runtime; the whole toolchain and the published site stay dependency-
  and secret-free). An env-configured MT service (`TRANSLATE_ENDPOINT`/
  `TRANSLATE_API_KEY`) can fill them automatically but is optional; regenerate/
  re-author when the English content changes so a locale doesn't drift stale.
- Existing `/<repo>/` links keep working via the redirect stub; the canonical
  English page moves to `/<repo>/en/`.
