/* Poster-first video controls. Playback remains an explicit user action. */
(() => {
  'use strict';

  function enhance(video) {
    if (video.closest('.video-shell')) return;
    const shell = document.createElement('div');
    shell.className = 'video-shell';
    const cover = document.createElement('button');
    cover.type = 'button';
    cover.className = 'video-cover';
    const poster = document.createElement('img');
    poster.className = 'video-cover__poster';
    poster.alt = '';
    poster.draggable = false;
    const action = document.createElement('span');
    action.className = 'video-cover-ui';
    const icon = document.createElement('span');
    icon.className = 'video-cover-icon';
    icon.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'M8 5.5v13l10-6.5z');
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
    icon.append(svg);
    const label = document.createElement('span');
    label.className = 'video-cover__label';
    const status = document.createElement('span');
    status.className = 'video-cover-note';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    action.append(icon, label);
    cover.append(poster, action);
    video.before(shell);
    shell.append(video, cover, status);

    let generation = 0;
    let loadingTimer = 0;
    let revealed = false;
    let signature = '';
    const title = () => video.getAttribute('aria-label') || '项目演示视频';
    const clearTimer = () => { window.clearTimeout(loadingTimer); loadingTimer = 0; };
    const show = (state, text) => {
      shell.dataset.videoState = state;
      shell.classList.toggle('is-loading', state === 'loading');
      cover.hidden = false;
      cover.disabled = state === 'loading';
      cover.setAttribute('aria-busy', String(state === 'loading'));
      cover.setAttribute('aria-label', `${text}：${title()}`);
      label.textContent = text;
      status.textContent = state === 'error' ? '视频暂未播放，请点击重试。' : '';
    };
    const fail = () => {
      generation++;
      clearTimer();
      revealed = false;
      video.pause();
      video.controls = false;
      show('error', '播放失败 · 点击重试');
    };
    const reset = () => {
      generation++;
      clearTimer();
      revealed = false;
      video.pause();
      video.controls = false;
      const src = video.getAttribute('poster');
      poster.hidden = !src;
      if (src) poster.src = src;
      else poster.removeAttribute('src');
      show('idle', '播放演示');
    };
    const loading = () => {
      clearTimer();
      video.controls = true;
      show('loading', '正在加载');
      const token = generation;
      loadingTimer = window.setTimeout(() => {
        if (token === generation && !revealed) fail();
      }, 20000);
    };

    cover.addEventListener('click', () => {
      const token = ++generation;
      // A failed media load needs a fresh request; ordinary pause/resume does not.
      if (video.error) video.load();
      if (video.ended) video.currentTime = 0;
      loading();
      try {
        const request = video.play();
        if (request && typeof request.catch === 'function') {
          request.catch(() => { if (token === generation) fail(); });
        }
      } catch (_) { if (token === generation) fail(); }
    });
    // Also supports the existing explicit scene-seek buttons in the core script.
    video.addEventListener('play', () => { if (!video.paused && !revealed) loading(); });
    video.addEventListener('playing', () => {
      if (video.paused) return;
      clearTimer();
      revealed = true;
      video.controls = true;
      shell.dataset.videoState = 'playing';
      shell.classList.remove('is-loading');
      cover.hidden = true;
      cover.disabled = false;
      cover.setAttribute('aria-busy', 'false');
      status.textContent = '';
      // Do not leave keyboard focus on the now-hidden cover.
      if (document.activeElement === cover) video.focus({ preventScroll: true });
    });
    video.addEventListener('pause', () => {
      clearTimer();
      if (!revealed && shell.dataset.videoState === 'loading') {
        generation++;
        video.controls = false;
        show('idle', '播放演示');
      }
    });
    video.addEventListener('ended', () => {
      generation++;
      clearTimer();
      revealed = false;
      video.controls = false;
      show('ended', '重新播放');
    });
    video.addEventListener('error', fail);
    poster.addEventListener('error', () => { poster.hidden = true; });

    const mediaSignature = () => JSON.stringify([
      video.getAttribute('src'), video.getAttribute('poster'),
      [...video.querySelectorAll('source')].map(source => [source.getAttribute('src'), source.getAttribute('type')])
    ]);
    signature = mediaSignature();
    reset();
    new MutationObserver(() => {
      const next = mediaSignature();
      if (next !== signature) {
        signature = next;
        reset();
      } else {
        cover.setAttribute('aria-label', `${label.textContent}：${title()}`);
      }
    }).observe(video, {
      attributes: true, attributeFilter: ['src', 'poster', 'type', 'aria-label'],
      childList: true, subtree: true
    });
  }

  const start = () => document.querySelectorAll('video').forEach(enhance);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
