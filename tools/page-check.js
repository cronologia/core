#!/usr/bin/env node
/*
 * page-check — the rendered-page checks the gate cannot make (core#123).
 *
 * Every visual defect of the #108-#116 waves passed `validate-data && node
 * --test && node build.js` and was caught only in a browser: pages wider than
 * a phone (core#112), dark-mode text below WCAG contrast (core#113). These are
 * those checks, committed instead of living in a session scratchpad.
 *
 *   width     at 390px, no element may extend past the viewport. Reports the
 *             page's scroll width and the element that sticks out furthest.
 *   contrast  in the light AND the dark colour scheme, every element with
 *             visible text must meet WCAG AA against its effective
 *             background (4.5:1; 3:1 for large text). Reports one example
 *             per element kind.
 *
 * Usage:
 *   node tools/page-check.js <docs-dir> [--only width|contrast]
 * Needs the `playwright` package and a Chromium it can launch; set
 * CHROMIUM_PATH to use a preinstalled browser. Dev/CI tooling only: no site
 * build depends on it, so the build stays zero-dependency.
 * Exit status 1 when any page has a finding.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PHONE = 390;

function htmlFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...htmlFiles(p));
    else if (ent.name.endsWith('.html')) out.push(p);
  }
  return out.sort();
}

// Runs in the page. Returns [scrollWidth, worst offender or null].
function widthProbe() {
  const W = window.innerWidth;
  let worst = null;
  const clipped = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX)) return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    const x = el.getBoundingClientRect().right;
    if (x > W + 1 && clipped(el)) continue; // scrolls inside its own container
    if (x > W + 1 && (!worst || x > worst.x)) {
      const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : '';
      worst = { x: Math.round(x), el: el.tagName.toLowerCase() + cls + (el.id ? '#' + el.id : '') };
    }
  }
  return [document.documentElement.scrollWidth, worst];
}

// Runs in the page. Returns ["<kind> <ratio> <fg> on <bg> \"text\"", ...].
function contrastProbe(dark) {
  // rgb()/rgba() and the color(srgb r g b / a) form Chrome reports for
  // color-mix(); channels normalised to 0-255.
  const parse = (c) => {
    let m = c && c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 };
    }
    m = c && c.match(/okl(ch|ab)\(([^)]+)\)/);
    if (m) {
      // oklch()/oklab() - what relative colour syntax computes to (core#118).
      const v = m[2].split(/[ /]+/).filter(Boolean).map((x) => (x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x)));
      let [L, A, B] = v;
      if (m[1] === 'ch') { const h = (B * Math.PI) / 180; [A, B] = [A * Math.cos(h), A * Math.sin(h)]; }
      const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
      const mm = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
      const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
      const enc = (x) => 255 * Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
      return {
        r: enc(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
        g: enc(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
        b: enc(-0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * s),
        a: v.length > 3 ? v[3] : 1,
      };
    }
    m = c && c.match(/color\(srgb ([^)]+)\)/);
    if (m) {
      const v = m[1].split(/[ /]+/).filter(Boolean).map(Number);
      return { r: v[0] * 255, g: v[1] * 255, b: v[2] * 255, a: v.length > 3 ? v[3] : 1 };
    }
    return null;
  };
  const lum = ({ r, g, b }) => {
    const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  // The effective background: semi-transparent layers composited over their
  // ancestors down to the first opaque one. A gradient is not measured (null):
  // header bands are checked by eye, not by a single colour.
  const bgOf = (el) => {
    const layers = [];
    let base = dark ? { r: 18, g: 18, b: 18 } : { r: 255, g: 255, b: 255 };
    for (; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.backgroundImage.includes('gradient')) return null;
      const c = parse(cs.backgroundColor);
      if (!c || c.a === 0) continue;
      if (c.a >= 1) { base = c; break; }
      layers.push(c);
    }
    for (const l of layers.reverse()) {
      base = { r: l.r * l.a + base.r * (1 - l.a), g: l.g * l.a + base.g * (1 - l.a), b: l.b * l.a + base.b * (1 - l.a) };
    }
    return { r: Math.round(base.r), g: Math.round(base.g), b: Math.round(base.b) };
  };
  const out = new Map();
  for (const el of document.querySelectorAll('body *')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('.visually-hidden,[hidden],svg')) continue;
    const fg = parse(cs.color);
    const bg = bgOf(el);
    if (!fg || !bg) continue;
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), weight = +cs.fontWeight;
    // WCAG "large text": 18pt (24px), or 14pt (18.66px) bold.
    const min = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    if (ratio < min) {
      const kind = el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : '');
      if (!out.has(kind)) out.set(kind, `${ratio.toFixed(2)} ${cs.color} on rgb(${bg.r},${bg.g},${bg.b}) "${el.textContent.trim().slice(0, 40)}"`);
    }
  }
  return [...out].map(([k, v]) => `${k} ${v}`);
}

async function main(argv) {
  const args = argv.slice(2);
  const onlyAt = args.indexOf('--only');
  const only = onlyAt >= 0 ? args.splice(onlyAt, 2)[1] : null;
  const dir = args[0];
  if (!dir || !fs.existsSync(dir)) {
    console.error('usage: node tools/page-check.js <docs-dir> [--only width|contrast]');
    return 2;
  }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  // Redirect stubs (the language picker at docs/index.html) render nothing a
  // reader stays on.
  const files = htmlFiles(path.resolve(dir)).filter((f) => !/location\.replace\(|http-equiv="refresh"/.test(fs.readFileSync(f, 'utf8')));
  let bad = 0;
  const report = (file, kind, lines) => {
    bad++;
    console.log(`${kind.padEnd(9)} ${path.relative(process.cwd(), file)}`);
    for (const l of lines) console.log(`          ${l}`);
  };
  try {
    if (only !== 'contrast') {
      const page = await browser.newPage({ viewport: { width: PHONE, height: 860 } });
      for (const f of files) {
        await page.goto('file://' + f);
        const [sw, worst] = await page.evaluate(widthProbe);
        if (sw > PHONE + 1 || worst) report(f, 'WIDTH', [`page is ${sw}px wide at ${PHONE}px` + (worst ? `; widest: ${worst.el} reaches ${worst.x}px` : '')]);
      }
      await page.close();
    }
    if (only !== 'width') {
      for (const scheme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: scheme });
        for (const f of files) {
          await page.goto('file://' + f);
          const low = await page.evaluate(contrastProbe, scheme === 'dark');
          if (low.length) report(f, `CONTRAST`, low.map((l) => `[${scheme}] ${l}`));
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${files.length} page(s) checked; ${bad} finding(s).`);
  return bad ? 1 : 0;
}

if (require.main === module) {
  main(process.argv).then((code) => process.exit(code), (e) => { console.error(e); process.exit(2); });
}
module.exports = { htmlFiles, widthProbe, contrastProbe };
