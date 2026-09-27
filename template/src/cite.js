/*
 * Citation previews (core#119).
 *
 * A citation marker [n] is a plain link to #ref-n at the foot of the page. On a
 * phone, checking one source meant losing your place. This script shows the
 * reference beside the claim instead: a click or tap on a marker opens a
 * popover holding a COPY of the reference list's own entry (title, publisher,
 * type, archive link, note), so there is one renderer and nothing to drift.
 *
 * Progressive enhancement, all the way down:
 *   - no script, no Popover API, or a modified click (Ctrl/Cmd/Shift, middle
 *     button): the marker is the link it always was;
 *   - print is untouched (the popover is never in the printed page);
 *   - keyboard: Enter on a marker opens it, Esc closes it (the Popover API's
 *     light dismiss), and focus returns to the marker.
 * Labels come from the script tag's data attributes, so they are localized by
 * the build like the rest of the chrome.
 */
(function () {
  'use strict';
  var me = document.currentScript;
  var pop = document.createElement('div');
  if (typeof pop.togglePopover !== 'function') return;

  var label = (me && me.dataset.label) || 'Reference';
  var allLabel = (me && me.dataset.all) || 'All references';
  pop.id = 'cite-pop';
  pop.className = 'cite-pop';
  pop.setAttribute('popover', 'auto');
  pop.setAttribute('role', 'dialog');
  document.body.appendChild(pop);

  var opener = null;

  function place(marker) {
    var r = marker.getBoundingClientRect();
    var w = Math.min(pop.offsetWidth, window.innerWidth - 16);
    var left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    var below = r.bottom + 6;
    var top = below + pop.offsetHeight > window.innerHeight - 8 && r.top - 6 - pop.offsetHeight > 8
      ? r.top - 6 - pop.offsetHeight
      : below;
    pop.style.left = left + 'px';
    pop.style.top = Math.max(8, top) + 'px';
  }

  function open(marker, n) {
    var entry = document.getElementById('ref-' + n);
    if (!entry) return false;
    pop.textContent = '';
    var head = document.createElement('p');
    head.className = 'cite-pop-head';
    head.textContent = label + ' ' + n;
    var body = document.createElement('div');
    body.className = 'cite-pop-body';
    for (var i = 0; i < entry.childNodes.length; i++) body.appendChild(entry.childNodes[i].cloneNode(true));
    var foot = document.createElement('p');
    foot.className = 'cite-pop-foot';
    var all = document.createElement('a');
    all.href = '#ref-' + n;
    all.textContent = allLabel + ' ↓';
    all.addEventListener('click', function () { pop.hidePopover(); });
    foot.appendChild(all);
    pop.appendChild(head);
    pop.appendChild(body);
    pop.appendChild(foot);
    pop.setAttribute('aria-label', head.textContent);
    opener = marker;
    pop.showPopover();
    place(marker);
    var first = pop.querySelector('a');
    if (first) first.focus({ preventScroll: true });
    return true;
  }

  pop.addEventListener('toggle', function (e) {
    if (e.newState === 'closed' && opener) {
      var o = opener;
      opener = null;
      if (pop.contains(document.activeElement) || document.activeElement === document.body) o.focus({ preventScroll: true });
    }
  });

  window.addEventListener('resize', function () { if (opener) place(opener); });

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('sup.cite a[href^="#ref-"]');
    if (!a) return;
    var n = a.getAttribute('href').slice(5);
    if (opener === a && pop.matches(':popover-open')) { pop.hidePopover(); e.preventDefault(); return; }
    if (open(a, n)) {
      e.preventDefault();
      a.setAttribute('aria-expanded', 'true');
    }
  });

  pop.addEventListener('toggle', function (e) {
    if (e.newState === 'closed') {
      var marks = document.querySelectorAll('sup.cite a[aria-expanded]');
      for (var i = 0; i < marks.length; i++) marks[i].removeAttribute('aria-expanded');
    }
  });

  // The markers' English title ("Reference 3") duplicated the popover and was
  // untranslated on es/pt pages; the popover now carries the localized label.
  var marks = document.querySelectorAll('sup.cite a[href^="#ref-"]');
  for (var j = 0; j < marks.length; j++) {
    marks[j].removeAttribute('title');
    marks[j].setAttribute('aria-haspopup', 'dialog');
  }
})();
