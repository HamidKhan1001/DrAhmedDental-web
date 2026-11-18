'use strict';

/**
 * Site motion: calm scroll reveal + card pointer tracking.
 * Everything degrades to a static page if JS or motion is unavailable.
 */

(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- scroll reveal ----
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const groups = [
      '.hero-content > *', '.hero-banner',
      '.service .section-subtitle', '.service .section-title', '.service-list > li',
      '.about-banner', '.about-content > *',
      '.doctor .section-subtitle', '.doctor .section-title', '.doctor-profile > *',
      '.explore .container > *',
      '.cta-banner', '.cta-content > *',
      '.blog .section-subtitle', '.blog .section-title', '.blog-list > li',
      '.footer-top .container > *'
    ];

    const targets = [];
    groups.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el, i) {
        el.classList.add('reveal');
        el.style.setProperty('--reveal-delay', Math.min(i, 6) * 0.08 + 's');
        targets.push(el);
      });
    });

    document.documentElement.classList.add('js-reveal');

    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    targets.forEach(function (el) { io.observe(el); });
  }

  // ---- cursor sheen on cards ----
  document.querySelectorAll('.service-card, .blog-card, .doctor-card').forEach(function (card) {
    card.addEventListener('pointermove', function (e) {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });
})();

/**
 * Link anything with [data-explore-view] to the embedded 3D explorer.
 * Views are Dental Scope hash routes, e.g. "tooth/36/dissect".
 */
(function () {
  const frame = document.querySelector('[data-explore-frame]');
  if (!frame) return;
  const chips = document.querySelectorAll('.explore-chip');

  function show(view) {
    // the explorer routes by path (/explorer/tooth/36/dissect); move it in place, without reloading 3D
    const path = '/explorer/' + (view || '');
    try {
      const w = frame.contentWindow;
      if (w && w.location.pathname.indexOf('/explorer/') === 0 && w.document.readyState !== 'loading') {
        w.history.pushState(null, '', path + '?simple');
        w.dispatchEvent(new PopStateEvent('popstate'));
      } else {
        frame.src = path + '?simple';
      }
    } catch (e) {
      frame.src = path + '?simple';
    }
    chips.forEach(function (c) { c.classList.toggle('is-active', c.dataset.exploreView === (view || '')); });
  }

  document.querySelectorAll('[data-explore-view]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      show(el.dataset.exploreView);
      if (el.tagName === 'A') {
        e.preventDefault();
        document.getElementById('explore').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
})();

/**
 * Light / dark theme, shared with the embedded Dental Scope explorer:
 * both read and write the same `ds.theme` preference.
 */
(function () {
  const btn = document.querySelector('[data-theme-toggle]');
  const meta = document.querySelector('meta[name="theme-color"]');
  const frame = document.querySelector('[data-explore-frame]');
  const root = document.documentElement;

  function apply(theme) {
    if (theme === 'dark') root.dataset.theme = 'dark';
    else delete root.dataset.theme;
    if (meta) meta.content = theme === 'dark' ? '#11100e' : '#fbf7ee';
    if (btn) btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }

  apply(root.dataset.theme === 'dark' ? 'dark' : 'light');

  btn && btn.addEventListener('click', function () {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem('ds.theme', next); } catch (e) {}
    // the explorer reads ds.theme on start-up, so reload it in place (keeps its current view)
    try { if (frame && frame.contentWindow && frame.contentWindow.location.href !== 'about:blank') frame.contentWindow.location.reload(); } catch (e) {}
  });

  // the explorer's own theme button writes ds.theme too — follow it
  window.addEventListener('storage', function (e) { if (e.key === 'ds.theme') apply(e.newValue === 'dark' ? 'dark' : 'light'); });
})();
