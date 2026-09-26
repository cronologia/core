/* Time river (core#108): filters, find box and the ribbon's reading window.
 * The page is complete without this file. It only reveals the controls,
 * hides what they filter out, and keeps the ribbon in step with the list.
 * No dependencies; strings come from data- attributes the build localizes. */
(function () {
  'use strict';
  var sec = document.querySelector('section.river');
  if (!sec) return;
  var controls = sec.querySelector('.rv-controls');
  var status = sec.querySelector('.rv-status');
  var find = sec.querySelector('.rv-find input');
  var firm = sec.querySelector('input[data-firm]');
  var laneBoxes = [].slice.call(sec.querySelectorAll('input[data-lane]'));
  var items = [].slice.call(sec.querySelectorAll('.rv-e'));
  var gaps = [].slice.call(sec.querySelectorAll('.rv-gap'));
  var ticks = [].slice.call(sec.querySelectorAll('.rv-tick'));
  var ribbon = sec.querySelector('.rv-ribbon');
  var win = sec.querySelector('.rv-win');
  var empty = sec.querySelector('.rv-empty');
  var tickX = {};
  ticks.forEach(function (t) { tickX[t.getAttribute('data-i')] = +t.getAttribute('x1'); });
  var shown = items.map(function () { return true; });
  var reading = '';

  function fill(tpl, n) { return tpl.replace('{n}', n).replace('{total}', items.length); }
  function report() {
    var n = shown.filter(Boolean).length;
    var count = n === items.length ? fill(status.dataset.all, n) : fill(status.dataset.some, n);
    status.textContent = (reading ? status.dataset.reading + ' ' + reading + ' · ' : '') + count;
  }

  function apply() {
    var on = {};
    laneBoxes.forEach(function (b) { on[b.dataset.lane] = b.checked; });
    var q = find.value.trim().toLowerCase();
    items.forEach(function (li, i) {
      var lanes = li.dataset.lanes ? li.dataset.lanes.split(' ') : [];
      var laneOk = !laneBoxes.length || !lanes.length || lanes.some(function (l) { return on[l]; });
      var firmOk = !firm.checked || !li.classList.contains('rv-u');
      var textOk = !q || li.textContent.toLowerCase().indexOf(q) !== -1;
      shown[i] = laneOk && firmOk && textOk;
      li.hidden = !shown[i];
      li.classList.toggle('rv-hit', !!q && shown[i]);
    });
    ticks.forEach(function (t) { t.classList.toggle('rv-off', !shown[+t.getAttribute('data-i')]); });
    // A gap row describes the whole record; once anything is filtered out,
    // the rows left no longer sit either side of it, so the gaps step aside.
    var all = shown.every(Boolean);
    gaps.forEach(function (g) { g.hidden = !all; });
    empty.hidden = shown.some(Boolean);
    report();
    requestAnimationFrame(updateWindow);
  }

  var visible = {};
  function updateWindow() {
    var on = Object.keys(visible).filter(function (i) { return shown[i]; }).map(Number).sort(function (a, b) { return a - b; });
    if (!on.length) { win.setAttribute('width', 0); return; }
    var x0 = tickX[on[0]], x1 = tickX[on[on.length - 1]];
    win.setAttribute('x', (x0 - 4).toFixed(1));
    win.setAttribute('width', (x1 - x0 + 8).toFixed(1));
    var top = items.filter(function (li) { return +li.dataset.i === on[0]; })[0];
    var label = top ? top.dataset.decade : '';
    if (label !== reading) { reading = label; report(); }
  }

  // Keep the sticky bar below the sticky site navigation.
  var nav = document.querySelector('.site-nav');
  var bar = sec.querySelector('.rv-bar');
  function offset() {
    var top = nav ? nav.offsetHeight : 0;
    sec.style.setProperty('--rv-top', top + 'px');
    sec.style.setProperty('--rv-clear', (top + (getComputedStyle(bar).position === 'sticky' ? bar.offsetHeight : 0) + 8) + 'px');
  }
  controls.hidden = false;
  offset(); window.addEventListener('resize', offset);
  laneBoxes.concat([firm]).forEach(function (b) { b.addEventListener('change', apply); });
  find.addEventListener('input', apply);

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var i = en.target.dataset.i;
        if (en.isIntersecting) visible[i] = true; else delete visible[i];
      });
      updateWindow();
    }, { rootMargin: '-' + (parseInt(sec.style.getPropertyValue('--rv-clear'), 10) || 0) + 'px 0px -40% 0px' });
    items.forEach(function (li) { io.observe(li); });
  }

  // Click the ribbon: jump to the nearest event still shown.
  ribbon.addEventListener('click', function (ev) {
    var pt = ribbon.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    var x = pt.matrixTransform(ribbon.getScreenCTM().inverse()).x;
    var best = -1, bd = Infinity;
    items.forEach(function (li, i) {
      if (!shown[i]) return;
      var d = Math.abs(tickX[li.dataset.i] - x);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) items[best].scrollIntoView({ block: 'start' });
  });

  apply();
}());
