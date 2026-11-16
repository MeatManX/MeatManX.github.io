(() => {
  'use strict';

  const slides = [...document.querySelectorAll('.slide')];
  const previous = document.getElementById('previous');
  const next = document.getElementById('next');
  const restart = document.getElementById('restart');
  const counter = document.getElementById('counter');
  const progress = document.getElementById('progress');
  let current = 0;
  let touchStartX = 0;

  slides.forEach((slide, index) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'dot';
    dot.setAttribute('aria-label', 'Go to step ' + (index + 1) + ': ' + slide.dataset.title);
    dot.addEventListener('click', () => show(index));
    progress.appendChild(dot);
  });

  const dots = [...progress.children];

  function indexFromHash() {
    const match = location.hash.match(/^#step-(\d+)$/);
    if (!match) return 0;
    return Math.min(slides.length - 1, Math.max(0, Number(match[1]) - 1));
  }

  function show(index, updateHash = true) {
    current = Math.min(slides.length - 1, Math.max(0, index));
    slides.forEach((slide, slideIndex) => {
      const active = slideIndex === current;
      slide.classList.toggle('is-active', active);
      slide.setAttribute('aria-hidden', String(!active));
    });
    dots.forEach((dot, dotIndex) => {
      const active = dotIndex === current;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-current', active ? 'step' : 'false');
    });
    previous.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    next.textContent = current === slides.length - 2 ? 'Final check →' : 'Next →';
    counter.textContent = (current + 1) + ' of ' + slides.length + ' // ' + slides[current].dataset.title;
    document.title = slides[current].dataset.title + ' // OGX-Mini AFK Quick Start';
    if (updateHash) history.replaceState(null, '', '#step-' + (current + 1));
    document.querySelector('.deck').scrollIntoView({behavior:'smooth', block:'start'});
  }

  previous.addEventListener('click', () => show(current - 1));
  next.addEventListener('click', () => show(current + 1));
  if (restart) restart.addEventListener('click', () => show(0));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'PageDown') show(current + 1);
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') show(current - 1);
    if (event.key === 'Home') show(0);
    if (event.key === 'End') show(slides.length - 1);
  });

  document.querySelector('.slides').addEventListener('touchstart', (event) => {
    touchStartX = event.changedTouches[0].clientX;
  }, {passive:true});

  document.querySelector('.slides').addEventListener('touchend', (event) => {
    const distance = event.changedTouches[0].clientX - touchStartX;
    if (Math.abs(distance) < 55) return;
    show(current + (distance < 0 ? 1 : -1));
  }, {passive:true});

  window.addEventListener('hashchange', () => show(indexFromHash(), false));
  show(indexFromHash(), false);
})();
