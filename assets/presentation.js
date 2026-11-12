/* Progressive enhancement for the vertical portfolio and its horizontal decks. */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const deckStates = new Map();
  const playlistsBySlide = new WeakMap();
  let storyMeasureFrame = 0;
  let storyScrollFrame = 0;
  let storyScrollTimer = 0;
  let storyPreservePosition = true;
  const storyMeasureCallbacks = [];
  const pendingSeeks = new WeakMap();
  const isVideo = element => element instanceof HTMLVideoElement;
  const pauseVideos = root => root.querySelectorAll('video').forEach(video => { if (!video.paused) video.pause(); });
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
      if (video !== event.target && !video.paused) video.pause();
    });
  }, true);

  const owns = (element, deck) => element.closest('[data-deck]') === deck;
  const owned = (deck, selector) => Array.from(deck.querySelectorAll(selector)).filter(element => owns(element, deck));
  const indexOfTab = tab => Number.parseInt(tab.dataset.slideTo, 10);
  const tabTitle = (state, index) => {
    const tab = state.tabs.find(candidate => indexOfTab(candidate) === index);
    return (tab?.textContent || state.slides[index]?.querySelector('h3, h2')?.textContent || '')
      .trim().replace(/^(?:第\s*)?\d{1,2}(?:\s*页)?[\s.、．:：·\-—)）]*/, '').trim();
  };
  const scrollContext = (element, immediate = true) => {
    if (!element) return;
    const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    window.scrollTo({
      top: window.scrollY + element.getBoundingClientRect().top - margin,
      behavior: immediate || reduceMotion.matches ? 'instant' : 'smooth'
    });
  };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const headerHeight = () => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header')) || 0;
  const storyEnabled = state => Boolean(state.stage) && !state.expanded;
  const clipTitle = (playlist, index) => playlist.buttons[index]?.textContent.trim() || playlist.buttons[index]?.dataset.label || '';
  function updateMediaCounter(state, index, mediaIndex) {
    const slide = state.slides[index];
    const playlist = playlistsBySlide.get(slide);
    const hasVideo = Boolean(slide.querySelector('video'));
    const count = playlist?.buttons.length || 1;
    const current = clamp(mediaIndex ?? playlist?.index ?? 0, 0, count - 1);
    const text = state.expanded ? '选择片段后点击播放' : playlist
      ? `片段 ${current + 1}/${count} · ${current < count - 1 ? `下一段：${clipTitle(playlist, current + 1)}` : '本页最后一段 · 点击播放'}`
      : '本页 1 段视频 · 点击播放';
    state.mediaCounters.forEach(label => { label.hidden = !hasVideo; label.textContent = hasVideo ? text : ''; });
  }
  function updateStoriesFromScroll() {
    storyScrollFrame = 0;
    // Layout changes can move the native scroll anchor before measurement. Keep
    // the last rendered logical position until the new geometry is available.
    if (storyMeasureFrame) return;
    const y = window.scrollY;
    deckStates.forEach(state => {
      const story = state.story;
      if (!storyEnabled(state) || !story?.configured) return;
      const offset = clamp(y - story.start, 0, story.total);
      const index = story.steps.findIndex(step => offset < step.end - 0.5);
      const actualIndex = index < 0 ? story.steps.length - 1 : index;
      const step = story.steps[actualIndex];
      const local = clamp(offset - step.offset, 0, step.distance);
      const transitionFraction = step.transitionDistance ? clamp((local - step.contentDistance) / step.transitionDistance, 0, 1) : 0;
      const mediaIndex = local < step.baseDistance - 0.5 ? 0 : Math.min(step.mediaCount - 1, 1 + Math.floor(Math.max(0, local - step.baseDistance + 0.5) / step.mediaDistance));
      const mediaLocal = local - step.mediaOffsets[mediaIndex];
      const mediaFraction = mediaIndex ? clamp(mediaLocal / step.mediaDistance, 0, 1) : 0;
      story.wasActive = y >= story.start - 1 && y < story.start + story.total;
      story.local = local;
      story.mediaIndex = mediaIndex;
      story.mediaFraction = mediaFraction;
      story.transitionFraction = transitionFraction;
      if (state.index !== actualIndex) renderState(state, actualIndex);
      const playlist = playlistsBySlide.get(state.slides[actualIndex]);
      if (playlist && playlist.index !== mediaIndex) playlist.select(mediaIndex);
      updateMediaCounter(state, actualIndex, mediaIndex);
      const fromLeft = leftFor(state, actualIndex);
      const left = transitionFraction && actualIndex < state.slides.length - 1
        ? fromLeft + (leftFor(state, actualIndex + 1) - fromLeft) * transitionFraction : fromLeft;
      story.expectedLeft = left;
      if (Math.abs(state.track.scrollLeft - left) > 0.5) state.track.scrollTo({ left, behavior: 'instant' });
      if (transitionFraction && actualIndex < state.slides.length - 1) {
        const nextSlide = state.slides[actualIndex + 1];
        nextSlide.scrollTop = 0;
        const nextPlaylist = playlistsBySlide.get(nextSlide);
        if (nextPlaylist && nextPlaylist.index !== 0) nextPlaylist.select(0);
      }
      const top = mediaIndex ? step.mediaTop : clamp(local - step.lead, 0, step.overflow);
      if (Math.abs(state.slides[actualIndex].scrollTop - top) > 0.5) state.slides[actualIndex].scrollTop = top;
      const progress = clamp(local / step.distance, 0, 1);
      state.storyProgress.forEach(bar => { bar.style.transform = `scaleX(${progress})`; });
      const readingBody = mediaIndex === 0 && step.overflow > 0 && local < step.lead + step.overflow;
      const hint = readingBody ? '继续下滑，查看本页完整内容' : playlist && mediaIndex < step.mediaCount - 1
        ? `下滑展示下一段：${clipTitle(playlist, mediaIndex + 1)}` : actualIndex < state.slides.length - 1
          ? `向下继续：${tabTitle(state, actualIndex + 1)}` : '继续下滑，进入下一章节';
      state.scrollHints.forEach(label => { label.textContent = hint; });
      if (story.targetY !== null && Math.abs(y - story.targetY) < 2) {
        story.targetY = null;
        state.pendingIndex = null;
      }
    });
  }
  function requestStoryScrollUpdate() {
    if (!storyScrollFrame) storyScrollFrame = window.requestAnimationFrame(updateStoriesFromScroll);
  }
  function measureStories(preservePosition) {
    let anchor = null;
    if (preservePosition) {
      deckStates.forEach(state => {
        const story = state.story;
        if (!storyEnabled(state) || !story?.configured) return;
        if (story.targetY !== null && Number.isInteger(state.pendingIndex)) {
          // A second ResizeObserver delivery can follow an all→story switch.
          // Preserve the explicitly requested destination, not its interim page.
          anchor = { state, index: state.pendingIndex, local: 0, mediaIndex: story.targetMediaIndex || 0, mediaFraction: 0, transitionFraction: 0 };
        } else if (story.wasActive) anchor = { state, index: state.index, local: story.local || 0, mediaIndex: story.mediaIndex || 0, mediaFraction: story.mediaFraction || 0, transitionFraction: story.transitionFraction || 0 };
      });
    }
    deckStates.forEach(state => {
      if (!state.stage) return;
      if (state.expanded) {
        state.chapter.removeAttribute('data-scroll-story');
        state.chapter.style.height = state.originalChapterHeight;
        state.track.style.scrollSnapType = state.originalTrackSnap;
        state.story.configured = false;
        return;
      }
      state.chapter.dataset.scrollStory = 'true';
      // Document position owns horizontal position, including fractional slides.
      state.track.style.scrollSnapType = 'none';
      const stageHeight = state.stage.getBoundingClientRect().height;
      const viewHeight = state.track.clientHeight;
      if (stageHeight < 200 || viewHeight < 100 || state.slides.some(slide => slide.clientHeight < 60)) {
        // A cramped landscape viewport or unavailable CSS must never hide text.
        state.expanded = true;
        state.deck.dataset.mode = 'all';
        state.chapter.removeAttribute('data-scroll-story');
        state.chapter.style.height = state.originalChapterHeight;
        state.track.style.scrollSnapType = state.originalTrackSnap;
        state.story.configured = false;
        state.slides.forEach(slide => { slide.scrollTop = 0; });
        renderState(state, state.index);
        return;
      }
      const reading = Math.max(180, viewHeight * 0.8);
      let offset = 0;
      const steps = state.slides.map((slide, slideIndex) => {
        const overflow = Math.max(0, slide.scrollHeight - slide.clientHeight);
        const playlist = playlistsBySlide.get(slide);
        const mediaCount = playlist?.buttons.length || 1;
        const mediaDistance = Math.max(140, viewHeight * 0.7);
        const baseDistance = reading + overflow;
        const contentDistance = baseDistance + (mediaCount - 1) * mediaDistance;
        const transitionDistance = !reduceMotion.matches && slideIndex < state.slides.length - 1 ? viewHeight * 0.25 : 0;
        const distance = contentDistance + transitionDistance;
        const mediaOffsets = Array.from({ length: mediaCount }, (_, index) => index ? baseDistance + (index - 1) * mediaDistance : 0);
        const mediaTop = playlist ? clamp(playlist.container.getBoundingClientRect().top - slide.getBoundingClientRect().top + slide.scrollTop - 12, 0, overflow) : 0;
        const step = { offset, end: offset + distance, distance, contentDistance, transitionDistance, baseDistance, lead: reading * 0.4, overflow, mediaCount, mediaDistance, mediaOffsets, mediaTop };
        offset += distance;
        return step;
      });
      const style = getComputedStyle(state.chapter);
      const inset = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.borderTopWidth) || 0);
      const bottom = (Number.parseFloat(style.paddingBottom) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
      const height = `${Math.ceil(stageHeight + offset + inset + bottom)}px`;
      if (state.chapter.style.height !== height) state.chapter.style.height = height;
      Object.assign(state.story, { configured: true, steps, total: offset, stageHeight, viewHeight, inset });
    });
    // Read document positions only after all preceding story heights are final.
    deckStates.forEach(state => {
      if (storyEnabled(state) && state.story.configured) {
        state.story.start = window.scrollY + state.chapter.getBoundingClientRect().top + state.story.inset - headerHeight();
      }
    });
    if (anchor && storyEnabled(anchor.state) && anchor.state.story.configured) {
      const step = anchor.state.story.steps[anchor.index];
      const mediaIndex = Math.min(anchor.mediaIndex, step.mediaCount - 1);
      const local = anchor.transitionFraction ? step.contentDistance + anchor.transitionFraction * step.transitionDistance
        : mediaIndex ? step.mediaOffsets[mediaIndex] + anchor.mediaFraction * step.mediaDistance : clamp(anchor.local, 0, step.baseDistance - 1);
      const top = Math.ceil(anchor.state.story.start + step.offset + local);
      if (Math.abs(window.scrollY - top) > 1) window.scrollTo({ top, behavior: 'instant' });
    }
    updateStoriesFromScroll();
  }
  function scheduleStoryMeasure(preservePosition = true, callback) {
    storyPreservePosition = storyPreservePosition && preservePosition;
    if (callback) storyMeasureCallbacks.push(callback);
    if (storyMeasureFrame) return;
    storyMeasureFrame = window.requestAnimationFrame(() => {
      storyMeasureFrame = 0;
      const preserve = storyPreservePosition;
      storyPreservePosition = true;
      measureStories(preserve);
      storyMeasureCallbacks.splice(0).forEach(fn => fn());
    });
  }
  function navigateStory(state, index, immediate, mediaIndex = 0) {
    if (!state.story.configured) {
      scheduleStoryMeasure(false, () => {
        if (storyEnabled(state) && state.story.configured) navigateStory(state, index, immediate, mediaIndex);
        else scrollContext(state.slides[index], immediate);
      });
      return;
    }
    const step = state.story.steps[index];
    mediaIndex = clamp(mediaIndex, 0, step.mediaCount - 1);
    const top = Math.ceil(state.story.start + step.offset + step.mediaOffsets[mediaIndex]);
    state.pendingIndex = index;
    state.story.targetY = top;
    state.story.targetMediaIndex = mediaIndex;
    window.scrollTo({ top, behavior: immediate || reduceMotion.matches ? 'instant' : 'smooth' });
    requestStoryScrollUpdate();
  }
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
      const hidden = !state.expanded && !active;
      if (hidden && slide.contains(activeElement)) moveFocus = true;
      if (hidden && !slide.inert) pauseVideos(slide);
      slide.inert = hidden;
      slide.toggleAttribute('inert', hidden);
      if (state.expanded) slide.removeAttribute('aria-hidden');
      else slide.setAttribute('aria-hidden', String(hidden));
      slide.classList.toggle('is-active', active);
    });
    state.tabs.forEach(tab => {
      const active = indexOfTab(tab) === index;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = state.expanded || active ? 0 : -1;
      tab.classList.toggle('is-active', active);
    });
    state.previous.forEach(button => {
      button.disabled = state.expanded || index === 0;
      button.setAttribute('aria-disabled', String(button.disabled));
      const label = button.querySelector('[data-prev-label]');
      if (label) label.textContent = index === 0 ? '已到首页' : `上一页：${tabTitle(state, index - 1)}`;
    });
    state.next.forEach(button => {
      button.disabled = state.expanded || index === state.slides.length - 1;
      button.setAttribute('aria-disabled', String(button.disabled));
      const label = button.querySelector('[data-next-label]');
      if (label) label.textContent = index === state.slides.length - 1 ? '本项目末页' : `下一页：${tabTitle(state, index + 1)}`;
    });
    state.counters.forEach(counter => {
      counter.textContent = `第 ${index + 1} / ${state.slides.length} 页`;
    });
    state.expandButtons.forEach(button => {
      button.setAttribute('aria-expanded', String(state.expanded));
      button.textContent = state.expanded ? '左右翻页演示 ↔' : '展开全部内容 ↓';
    });
    updateMediaCounter(state, index);
    if (moveFocus) {
      const tab = state.tabs.find(candidate => indexOfTab(candidate) === index);
      (tab || state.track).focus({ preventScroll: true });
    }
  };
  const settle = state => {
    window.clearTimeout(state.settleTimer);
    if (state.expanded || state.pointerActive) return;
    if (storyEnabled(state)) {
      if (Math.abs(state.track.scrollLeft - state.story.expectedLeft) <= 1) return;
      const index = nearestIndex(state);
      if (index !== state.index) navigateStory(state, index, true);
      else requestStoryScrollUpdate();
      return;
    }
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
    if (state.expanded) {
      // Expanded content is ordinary document navigation, not a read-progress
      // signal: preserve the carousel's previous selection for restoration.
      scrollContext(state.slides[index], immediate);
      return;
    }
    if (storyEnabled(state)) {
      navigateStory(state, index, immediate);
      return;
    }
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
  const setExpanded = (state, expanded) => {
    window.clearTimeout(state.settleTimer);
    window.cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.pendingIndex = null;
    state.pointerActive = false;
    state.expanded = expanded;
    state.deck.dataset.mode = expanded ? 'all' : 'slides';
    const rememberedIndex = state.index;
    const rememberedMediaIndex = playlistsBySlide.get(state.slides[rememberedIndex])?.index ?? state.story?.mediaIndex ?? 0;
    if (state.stage) {
      if (expanded) state.chapter.removeAttribute('data-scroll-story');
      else state.chapter.dataset.scrollStory = 'true';
      state.chapter.style.height = state.originalChapterHeight;
      state.story.configured = false;
      state.story.targetY = null;
      state.slides.forEach(slide => { slide.scrollTop = 0; });
    }
    renderState(state, state.index);
    if (expanded) state.track.scrollTo({ left: 0, behavior: 'instant' });
    if (state.stage) {
      scheduleStoryMeasure(false, () => {
        if (state.expanded) scrollContext(state.chapter);
        else navigateStory(state, rememberedIndex, true, rememberedMediaIndex);
      });
    } else {
      if (!expanded) goTo(state, state.index, true);
      scrollContext(state.deck.closest('section[data-chapter]'));
    }
  };

  document.querySelectorAll('[data-deck]').forEach(deck => {
    const track = owned(deck, '[data-slide-track]')[0];
    if (!track) return;
    const slides = Array.from(track.querySelectorAll('[data-slide]')).filter(slide => owns(slide, deck));
    if (!slides.length) return;
    const state = {
      deck, track, slides,
      chapter: deck.closest('section[data-chapter]'),
      stage: deck.closest('.chapter-stage'),
      tabs: owned(deck, '[data-slide-to]'),
      previous: owned(deck, '[data-slide-prev]'),
      next: owned(deck, '[data-slide-next]'),
      counters: owned(deck, '[data-slide-counter]'),
      expandButtons: owned(deck, '[data-deck-expand]'),
      scrollHints: owned(deck, '[data-scroll-hint]'),
      storyProgress: owned(deck, '[data-story-progress]'),
      mediaCounters: owned(deck, '[data-media-counter]'),
      expanded: deck.dataset.startExpanded === 'true',
      index: 0, pendingIndex: null, frame: 0, settleTimer: 0, pointerActive: false
    };
    state.originalChapterHeight = state.chapter?.style.height || '';
    state.originalTrackSnap = state.track.style.scrollSnapType;
    state.story = { configured: false, steps: [], total: 0, start: 0, targetY: null, expectedLeft: 0 };
    if (state.stage && !state.expanded) state.chapter.dataset.scrollStory = 'true';
    deckStates.set(deck, state);
    deck.dataset.mode = state.expanded ? 'all' : 'slides';
    if (!track.hasAttribute('tabindex')) track.tabIndex = 0;
    state.tabs.forEach(tab => {
      const index = indexOfTab(tab);
      if (!Number.isInteger(index) || !slides[index]) return;
      if (!tab.hasAttribute('role')) tab.setAttribute('role', 'tab');
      if (slides[index].id) tab.setAttribute('aria-controls', slides[index].id);
      tab.addEventListener('click', () => goTo(state, index));
    });
    state.previous.forEach(button => button.addEventListener('click', () => {
      if (!state.expanded) goTo(state, (state.pendingIndex ?? state.index) - 1);
    }));
    state.next.forEach(button => button.addEventListener('click', () => {
      if (!state.expanded) goTo(state, (state.pendingIndex ?? state.index) + 1);
    }));
    state.expandButtons.forEach(button => button.addEventListener('click', () => setExpanded(state, !state.expanded)));

    track.addEventListener('pointerdown', () => {
      if (state.expanded) return;
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
      if (state.expanded) return;
      if (!state.frame) state.frame = window.requestAnimationFrame(() => {
        state.frame = 0;
        // Keep deliberate navigation stable while its smooth scroll is in flight.
        if (!state.expanded && !storyEnabled(state) && state.pendingIndex === null) renderState(state, nearestIndex(state));
      });
      window.clearTimeout(state.settleTimer);
      state.settleTimer = window.setTimeout(() => settle(state), 160);
    }, { passive: true });
    track.addEventListener('scrollend', () => settle(state));

    deck.addEventListener('keydown', event => {
      if (state.expanded) return;
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
    renderState(state, state.expanded ? 0 : nearestIndex(state));
    deck.dataset.enhanced = 'true';

    if ('ResizeObserver' in window) {
      let previousWidth = track.clientWidth;
      let previousHeight = track.clientHeight;
      const observer = new ResizeObserver(() => {
        if (track.clientWidth === previousWidth && track.clientHeight === previousHeight) return;
        previousWidth = track.clientWidth;
        previousHeight = track.clientHeight;
        if (state.stage) { scheduleStoryMeasure(); return; }
        if (state.expanded) return;
        goTo(state, state.pendingIndex ?? state.index, true);
      });
      observer.observe(track);
      if (state.stage) {
        const contentObserver = new ResizeObserver(() => scheduleStoryMeasure());
        state.slides.forEach(slide => slide.querySelectorAll('.slide-copy, .slide-evidence, details, img, video, .points').forEach(element => contentObserver.observe(element)));
      }
    }
  });

  window.addEventListener('scroll', () => {
    requestStoryScrollUpdate();
    window.clearTimeout(storyScrollTimer);
    storyScrollTimer = window.setTimeout(() => {
      deckStates.forEach(state => {
        if (storyEnabled(state)) { state.pendingIndex = null; state.story.targetY = null; }
      });
    }, 180);
  }, { passive: true });
  window.addEventListener('resize', () => scheduleStoryMeasure(), { passive: true });
  reduceMotion.addEventListener?.('change', () => scheduleStoryMeasure());
  document.addEventListener('toggle', event => {
    if (event.target instanceof Element && event.target.closest('[data-slide]')) scheduleStoryMeasure();
  }, true);
  document.fonts?.ready.then(() => scheduleStoryMeasure());
  scheduleStoryMeasure(false);

  const revealHashSlide = () => {
    let id;
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
    if (!id) return;
    const target = document.getElementById(id);
    const slide = target?.closest('[data-slide]');
    const chapter = target?.closest('section[data-chapter]');
    let expandedSlide = false;
    if (slide) {
      const state = deckStates.get(slide.closest('[data-deck]'));
      if (state) {
        expandedSlide = state.expanded;
        goTo(state, state.slides.indexOf(slide), true);
        if (storyEnabled(state)) return;
      }
    } else if (target?.matches('section[data-chapter]')) {
      // A project navigation link starts its narrative at the first slide.
      const state = deckStates.get(target.querySelector('[data-deck]'));
      if (state && !state.expanded) {
        goTo(state, 0, true);
        if (storyEnabled(state)) return;
      }
    }
    if (chapter) {
      // Only explicit hash navigation aligns the chapter below the sticky header.
      // Native vertical wheel/touch scrolling remains entirely untouched.
      scrollContext(expandedSlide ? slide : chapter);
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
    if (!buttons.length) return;
    const slide = container.closest('[data-slide]');
    const state = slide && deckStates.get(slide.closest('[data-deck]'));
    const initial = buttons.findIndex(button => button.getAttribute('aria-pressed') === 'true');
    const playlist = {
      container, player, buttons, index: Math.max(0, initial),
      select(index) {
        index = clamp(index, 0, buttons.length - 1);
        const button = buttons[index];
        if (!button.dataset.videoSrc) return;
        if (index !== playlist.index) {
          pendingSeeks.delete(player);
          if (!player.paused) player.pause();
          player.src = button.dataset.videoSrc;
          if (button.dataset.poster) player.poster = button.dataset.poster;
          else player.removeAttribute('poster');
          player.setAttribute('aria-label', button.dataset.label || button.textContent.trim());
          if (caption) caption.textContent = button.dataset.caption || '';
          player.load();
          // Exposing a clip is not watching it. Only a separate play action
          // starts playback, including when another clip was already playing.
        }
        playlist.index = index;
        buttons.forEach((other, otherIndex) => {
          other.setAttribute('aria-pressed', String(otherIndex === index));
          other.classList.toggle('is-active', otherIndex === index);
        });
        if (state && state.slides[state.index] === slide) updateMediaCounter(state, state.index, index);
      }
    };
    if (slide && !playlistsBySlide.has(slide)) playlistsBySlide.set(slide, playlist);
    wireChoiceKeys(buttons);
    buttons.forEach((button, index) => button.addEventListener('click', () => {
      playlist.select(index);
      if (state?.expanded) renderState(state, state.slides.indexOf(slide));
      if (state && storyEnabled(state) && playlistsBySlide.get(slide) === playlist) {
        navigateStory(state, state.slides.indexOf(slide), true, index);
      }
    }));
    playlist.select(playlist.index);
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
