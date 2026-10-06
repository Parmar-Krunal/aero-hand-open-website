/* ============================================================
   AERO HAND OPEN — VIEWPORT REVEALS & SPEC COUNT-UP
   ============================================================ */

(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionElements = [
    '.intro-copy > .eyebrow',
    '.intro-title',
    '.intro-lede',
    '.intro-actions',
    '.intro-metrics',
    '.intro-product',
    '.intro-pathways > a',
    '.overview-gallery > *',
    '.main > section.active > .eyebrow',
    '.main > section.active > .s-title',
    '.main > section.active > .s-sub',
    '.main > section.active > .card',
    '.main > section.active > .g2 > .card',
    '.main > section.active > .g3 > .card',
    '.main > section.active > .g4 > .card',
    '.main > section.active > .pkg-grid > .card'
  ].join(',');

  let observer = null;

  function animateMetric(metric) {
    if (reduceMotion.matches || metric.dataset.counted === 'true') return;

    const original = metric.textContent.trim();
    const match = original.match(/^([^0-9]*)([0-9]+)(.*)$/);
    if (!match) return;

    const [, prefix, rawValue, suffix] = match;
    const target = Number(rawValue);
    if (!Number.isFinite(target) || target === 0) return;

    metric.dataset.counted = 'true';
    const startedAt = performance.now();
    const duration = 850;

    function tick(now) {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      metric.textContent = `${prefix}${Math.round(target * eased)}${suffix}`;

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        metric.textContent = original;
      }
    }

    requestAnimationFrame(tick);
  }

  function reveal(element) {
    if (element.classList.contains('is-visible')) return;
    element.classList.add('is-visible');

    if (element.matches('.intro-metrics')) {
      element.querySelectorAll('strong').forEach(animateMetric);
    }
  }

  function prepareActiveSection() {
    if (observer) observer.disconnect();

    const activeSection = document.querySelector('.main > section.active');
    if (!activeSection) return;

    const targets = Array.from(activeSection.querySelectorAll(motionElements));
    targets.forEach((element, index) => {
      element.dataset.motion = 'reveal';
      element.style.setProperty('--motion-delay', `${Math.min(index % 6, 5) * 65}ms`);
    });

    if (reduceMotion.matches || !('IntersectionObserver' in window)) {
      targets.forEach(reveal);
      return;
    }

    if (!document.body.classList.contains('motion-ready')) {
      document.body.classList.add('motion-ready');
    }

    observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          reveal(entry.target);
          currentObserver.unobserve(entry.target);
        }
      });
    }, {
      root: null,
      rootMargin: '0px 0px -7% 0px',
      threshold: 0.08
    });

    targets.forEach(element => {
      if (element.classList.contains('is-visible')) return;
      const rect = element.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) {
        reveal(element);
      } else {
        observer.observe(element);
      }
    });
  }

  function initMotion() {
    prepareActiveSection();
    window.addEventListener('aero-section-change', prepareActiveSection);
    reduceMotion.addEventListener('change', prepareActiveSection);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMotion, { once: true });
  } else {
    initMotion();
  }
})();
