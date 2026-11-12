/* Progressive enhancement for the vertical portfolio and its horizontal decks. */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const deckStates = new Map();
  const pendingSeeks = new WeakMap();
  const isVideo = element => element instanceof HTMLVideoElement;
  const pauseVideos = root => root.querySelectorAll('video').forEach(video => video.pause());
  const playSafely = video => {
    const request = video.play();
    if (request && typeof request.catch === 'function') request.catch(() => {});
  };

  // Capture also covers videos added after initial page load.
  document.addEventListener('play', event => {
    if (!isVideo(event.target)) return;
    if (event.target.closest('[data-slide][inert]')) {
      event.target.pause();
      return;
    }
    document.querySelectorAll('video').forEach(video => {
      if (video !== event.target) video.pause();
    });
  }, true);

  const owns = (element, deck) => element.closest('[data-deck]') === deck;
  const owned = (deck, selector) => Array.from(deck.querySelectorAll(selector)).filter(element => owns(element, deck));
  const indexOfTab = tab => Number.parseInt(tab.dataset.slideTo, 10);
  const leftFor = (state, index) => {
    const trackRect = state.track.getBoundingClientRect();
    const slideRect = state.slides[index].getBoundingClientRect();
    return state.track.scrollLeft + slideRect.left - trackRect.left - state.track.clientLeft;
  };
  const nearestIndex = state => {
    const trackRect = state.track.getBoundingClientRect();
    const center = trackRect.left + state.track.clientLeft + state.track.clientWidth / 2;
    let nearest = 0;
    let distance = Infinity;
    state.slides.forEach((slide, index) => {
      const rect = slide.getBoundingClientRect();
      const delta = Math.abs(rect.left + rect.width / 2 - center);
      if (delta < distance) { distance = delta; nearest = index; }
    });
    return nearest;
  };
  const renderState = (state, index) => {
    state.index = index;
    const activeElement = document.activeElement;
    let moveFocus = false;
    state.slides.forEach((slide, slideIndex) => {
      const active = slideIndex === index;
      if (!active && slide.contains(activeElement)) moveFocus = true;
      if (!active && !slide.inert) pauseVideos(slide);
      slide.inert = !active;
      slide.toggleAttribute('inert', !active);
      slide.setAttribute('aria-hidden', String(!active));
      slide.classList.toggle('is-active', active);
    });
    state.tabs.forEach(tab => {
      const active = indexOfTab(tab) === index;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.classList.toggle('is-active', active);
    });
    state.previous.forEach(button => {
      button.disabled = index === 0;
      button.setAttribute('aria-disabled', String(index === 0));
    });
    state.next.forEach(button => {
      button.disabled = index === state.slides.length - 1;
      button.setAttribute('aria-disabled', String(index === state.slides.length - 1));
    });
    state.counters.forEach(counter => {
      counter.textContent = `${String(index + 1).padStart(2, '0')}/${String(state.slides.length).padStart(2, '0')}`;
    });
    if (moveFocus) {
      const tab = state.tabs.find(candidate => indexOfTab(candidate) === index);
      (tab || state.track).focus({ preventScroll: true });
    }
  };
  const settle = state => {
    window.clearTimeout(state.settleTimer);
    if (state.pointerActive) return;
    state.pendingIndex = null;
    const index = nearestIndex(state);
    renderState(state, index);
    // Anchor/focus restoration after a resize can leave a browser between snaps.
    // Correct only the horizontal deck after interaction ends; never the page.
    const left = leftFor(state, index);
    if (Math.abs(state.track.scrollLeft - left) > 0.5) {
      state.track.scrollTo({ left, behavior: 'instant' });
    }
  };
  const goTo = (state, index, immediate = false) => {
    if (!Number.isInteger(index)) return;
    index = Math.max(0, Math.min(state.slides.length - 1, index));
    state.pendingIndex = index;
    renderState(state, index);
    const smooth = !immediate && !reduceMotion.matches;
    // Explicit "instant" avoids a CSS scroll-behavior:smooth overriding reduced motion.
    state.track.scrollTo({ left: leftFor(state, index), behavior: smooth ? 'smooth' : 'instant' });
    window.clearTimeout(state.settleTimer);
    if (!smooth) state.pendingIndex = null;
    // Fallback for browsers without scrollend, including an already-aligned target.
    state.settleTimer = window.setTimeout(() => settle(state), smooth ? 700 : 40);
  };

  document.querySelectorAll('[data-deck]').forEach(deck => {
    const track = owned(deck, '[data-slide-track]')[0];
    if (!track) return;
    const slides = Array.from(track.querySelectorAll('[data-slide]')).filter(slide => owns(slide, deck));
    if (!slides.length) return;
    const state = {
      deck, track, slides,
      tabs: owned(deck, '[data-slide-to]'),
      previous: owned(deck, '[data-slide-prev]'),
      next: owned(deck, '[data-slide-next]'),
      counters: owned(deck, '[data-slide-counter]'),
      index: 0, pendingIndex: null, frame: 0, settleTimer: 0, pointerActive: false
    };
    deckStates.set(deck, state);
    if (!track.hasAttribute('tabindex')) track.tabIndex = 0;
    state.tabs.forEach(tab => {
      const index = indexOfTab(tab);
      if (!Number.isInteger(index) || !slides[index]) return;
      if (!tab.hasAttribute('role')) tab.setAttribute('role', 'tab');
      if (slides[index].id) tab.setAttribute('aria-controls', slides[index].id);
      tab.addEventListener('click', () => goTo(state, index));
    });
    state.previous.forEach(button => button.addEventListener('click', () => goTo(state, (state.pendingIndex ?? state.index) - 1)));
    state.next.forEach(button => button.addEventListener('click', () => goTo(state, (state.pendingIndex ?? state.index) + 1)));

    track.addEventListener('pointerdown', () => {
      state.pendingIndex = null;
      state.pointerActive = true;
    }, { passive: true });
    const finishPointer = () => {
      if (!state.pointerActive) return;
      state.pointerActive = false;
      window.clearTimeout(state.settleTimer);
      state.settleTimer = window.setTimeout(() => settle(state), 160);
    };
    window.addEventListener('pointerup', finishPointer, { passive: true });
    window.addEventListener('pointercancel', finishPointer, { passive: true });
    track.addEventListener('scroll', () => {
      if (!state.frame) state.frame = window.requestAnimationFrame(() => {
        state.frame = 0;
        // Keep deliberate navigation stable while its smooth scroll is in flight.
        if (state.pendingIndex === null) renderState(state, nearestIndex(state));
      });
      window.clearTimeout(state.settleTimer);
      state.settleTimer = window.setTimeout(() => settle(state), 160);
    }, { passive: true });
    track.addEventListener('scrollend', () => settle(state));

    deck.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (!(target instanceof Element) || !owns(target, deck)) return;
      // Native media controls, playlist choices and form controls own their keys.
      const deckButton = target.closest('[data-slide-to], [data-slide-prev], [data-slide-next]');
      const control = target.closest('video, audio, input, textarea, select, summary, a, button, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="combobox"], [data-video-src], [data-seek]');
      if (control && !deckButton) return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      goTo(state, (state.pendingIndex ?? state.index) + direction);
      if (target.closest('[data-slide-to]')) {
        const activeTab = state.tabs.find(tab => indexOfTab(tab) === state.index);
        activeTab?.focus({ preventScroll: true });
      }
    });
    renderState(state, nearestIndex(state));
    deck.dataset.enhanced = 'true';

    if ('ResizeObserver' in window) {
      let previousWidth = track.clientWidth;
      const observer = new ResizeObserver(() => {
        if (track.clientWidth === previousWidth) return;
        previousWidth = track.clientWidth;
        goTo(state, state.pendingIndex ?? state.index, true);
      });
      observer.observe(track);
    }
  });

  const revealHashSlide = () => {
    let id;
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
    if (!id) return;
    const target = document.getElementById(id);
    const slide = target?.closest('[data-slide]');
    const chapter = target?.closest('section[data-chapter]');
    if (slide) {
      const state = deckStates.get(slide.closest('[data-deck]'));
      if (state) goTo(state, state.slides.indexOf(slide), true);
    } else if (target?.matches('section[data-chapter]')) {
      // A project navigation link starts its narrative at the first slide.
      const state = deckStates.get(target.querySelector('[data-deck]'));
      if (state) goTo(state, 0, true);
    }
    if (chapter) {
      // Only explicit hash navigation aligns the chapter below the sticky header.
      // Native vertical wheel/touch scrolling remains entirely untouched.
      const margin = Number.parseFloat(getComputedStyle(chapter).scrollMarginTop) || 0;
      window.scrollTo({ top: window.scrollY + chapter.getBoundingClientRect().top - margin, behavior: 'instant' });
    }
  };
  let hashFrame = 0;
  const scheduleHashReveal = () => {
    revealHashSlide();
    window.cancelAnimationFrame(hashFrame);
    // Reconcile once after the browser's own anchor scroll has been applied.
    hashFrame = window.requestAnimationFrame(revealHashSlide);
  };
  window.addEventListener('hashchange', scheduleHashReveal);
  scheduleHashReveal();

  const simulation = document.getElementById('simulation-video');
  const seekButtons = Array.from(document.querySelectorAll('[data-seek]')).filter(button => Number.isFinite(Number(button.dataset.seek)));
  const wireChoiceKeys = buttons => {
    buttons.forEach((button, index) => button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      // Button defaults can scroll their horizontal ancestor even when the deck's
      // handler opts out. Keep these keys inside the local set of clip choices.
      event.preventDefault();
      event.stopPropagation();
      const next = Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
      buttons[next].focus({ preventScroll: true });
    }));
  };
  if (isVideo(simulation)) {
    wireChoiceKeys(seekButtons);
    const updateSeekButtons = () => {
      let chosen = null;
      let latestTime = -Infinity;
      seekButtons.forEach(button => {
        const time = Number(button.dataset.seek);
        if (time <= simulation.currentTime + 0.02 && time > latestTime) { chosen = button; latestTime = time; }
      });
      seekButtons.forEach(button => button.setAttribute('aria-pressed', String(button === chosen)));
    };
    const applyPendingSeek = () => {
      const time = pendingSeeks.get(simulation);
      if (time === undefined || simulation.readyState < 1) return;
      pendingSeeks.delete(simulation);
      const limit = Number.isFinite(simulation.duration) ? Math.max(0, simulation.duration - 0.01) : Infinity;
      simulation.currentTime = Math.max(0, Math.min(time, limit));
      updateSeekButtons();
      playSafely(simulation);
    };
    seekButtons.forEach(button => button.addEventListener('click', () => {
      pendingSeeks.set(simulation, Number(button.dataset.seek));
      if (simulation.readyState >= 1) applyPendingSeek();
      else simulation.load();
    }));
    simulation.addEventListener('loadedmetadata', applyPendingSeek);
    simulation.addEventListener('timeupdate', updateSeekButtons);
    updateSeekButtons();
  }

  document.querySelectorAll('[data-playlist]').forEach(container => {
    const player = container.querySelector('video');
    if (!player) return;
    const caption = container.querySelector('[data-clip-caption]');
    const buttons = Array.from(container.querySelectorAll('[data-video-src]')).filter(button => button.closest('[data-playlist]') === container);
    wireChoiceKeys(buttons);
    buttons.forEach(button => button.addEventListener('click', () => {
      if (!button.dataset.videoSrc) return;
      const resume = !player.paused && !player.ended;
      pendingSeeks.delete(player);
      player.pause();
      player.src = button.dataset.videoSrc;
      if (button.dataset.poster) player.poster = button.dataset.poster;
      else player.removeAttribute('poster');
      player.setAttribute('aria-label', button.dataset.label || button.textContent.trim());
      if (caption) caption.textContent = button.dataset.caption || '';
      buttons.forEach(other => {
        other.setAttribute('aria-pressed', String(other === button));
        other.classList.toggle('is-active', other === button);
      });
      player.load();
      if (resume) playSafely(player);
    }));
  });

  const chapters = Array.from(document.querySelectorAll('section[data-chapter]'));
  const chapterLinks = Array.from(document.querySelectorAll('[data-chapter-link]'));
  const updateChapterNavigation = () => {
    if (!chapters.length) return;
    const line = window.innerHeight * 0.28;
    let chosen = chapters[0];
    let distance = Infinity;
    chapters.forEach(chapter => {
      const rect = chapter.getBoundingClientRect();
      const delta = rect.top <= line && rect.bottom > line ? 0 : Math.min(Math.abs(rect.top - line), Math.abs(rect.bottom - line));
      if (delta < distance) { chosen = chapter; distance = delta; }
    });
    chapterLinks.forEach(link => {
      let hash = '';
      try { hash = decodeURIComponent(new URL(link.href, document.baseURI).hash.slice(1)); } catch { /* Ignore malformed links. */ }
      const active = hash === chosen.id;
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
      link.classList.toggle('is-active', active);
    });
  };
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(updateChapterNavigation, { rootMargin: '-20% 0px -65% 0px', threshold: [0, 0.01, 0.5, 1] });
    chapters.forEach(chapter => observer.observe(chapter));
    let visibilityObserver;
    const observeVisibility = () => {
      visibilityObserver?.disconnect();
      const header = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header')) || 0;
      visibilityObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting || entry.intersectionRatio === 0) pauseVideos(entry.target);
        });
      }, { rootMargin: `-${header + 1}px 0px 0px 0px`, threshold: 0 });
      chapters.forEach(chapter => visibilityObserver.observe(chapter));
    };
    observeVisibility();
    window.addEventListener('resize', observeVisibility, { passive: true });
  }
  window.addEventListener('hashchange', updateChapterNavigation);
  updateChapterNavigation();
})();
