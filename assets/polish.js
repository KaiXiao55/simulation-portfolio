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
    status.hidden = true;
    const help = document.createElement('div');
    help.className = 'video-help';
    help.hidden = true;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '重新加载';
    const open = document.createElement('a');
    open.textContent = '单独打开视频 ↗';
    open.target = '_blank';
    open.rel = 'noopener';
    help.append(retry, open);
    const original = document.createElement('a');
    original.className = 'video-quality-link';
    original.textContent = '打开清晰版 ↗';
    original.target = '_blank';
    original.rel = 'noopener';
    original.hidden = true;
    action.append(icon, label);
    cover.append(poster, action);
    video.before(shell);
    shell.append(video, cover, status);
    shell.after(help, original);

    let generation = 0;
    let loadingTimer = 0;
    let revealed = false;
    let signature = '';
    const title = () => video.getAttribute('aria-label') || '项目演示视频';
    const clearTimer = () => { window.clearTimeout(loadingTimer); loadingTimer = 0; };
    const syncLink = () => {
      // currentSrc can still point to the previous playlist clip during load().
      const source = video.getAttribute('src') || video.querySelector('source[src]')?.getAttribute('src');
      let url;
      try { url = new URL(source || '', document.baseURI); } catch { /* No playable URL. */ }
      const safe = Boolean(source && url && url.origin === window.location.origin && /^https?:$/.test(url.protocol));
      open.hidden = !safe;
      if (safe) open.href = url.href;
      else open.removeAttribute('href');
      open.setAttribute('aria-label', `单独打开视频：${title()}`);
      retry.setAttribute('aria-label', `重新加载：${title()}`);
      const webPath = safe && url.pathname.match(/^(.*\/assets\/)web\/([^/]+\.mp4)$/);
      original.hidden = !webPath;
      if (webPath) {
        const originalUrl = new URL(url);
        originalUrl.pathname = webPath[1] + webPath[2];
        original.href = originalUrl.href;
      } else original.removeAttribute('href');
      original.setAttribute('aria-label', `打开清晰版：${title()}`);
    };
    const note = (text = '', offerHelp = false) => {
      status.textContent = text;
      status.hidden = !text;
      help.hidden = !offerHelp;
      if (offerHelp) syncLink();
    };
    const show = (state, text) => {
      shell.dataset.videoState = state;
      shell.classList.toggle('is-loading', state === 'loading');
      cover.hidden = false;
      cover.disabled = state === 'loading';
      cover.setAttribute('aria-busy', String(state === 'loading'));
      cover.setAttribute('aria-label', `${text}：${title()}`);
      label.textContent = text;
      note(state === 'error' ? '暂时无法播放' : '', state === 'error');
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
      syncLink();
      show('idle', '播放演示');
    };
    const loading = () => {
      clearTimer();
      video.controls = true;
      show('loading', '正在加载');
      const token = generation;
      loadingTimer = window.setTimeout(() => {
        // A slow connection is not a playback failure. Keep the request alive.
        if (token === generation && !revealed && !video.paused) {
          label.textContent = '正在缓冲';
          note('网络较慢，正在缓冲', true);
        }
      }, 20000);
    };
    const startPlayback = (reload = false) => {
      const token = ++generation;
      // Only an explicit retry or actual media error starts a fresh request.
      if (reload || video.error) {
        revealed = false;
        video.load();
      }
      if (video.ended) video.currentTime = 0;
      loading();
      try {
        const request = video.play();
        if (request && typeof request.catch === 'function') {
          request.catch(error => {
            // Changing clips or pausing deliberately aborts pending play().
            if (token === generation && error?.name !== 'AbortError') fail();
          });
        }
      } catch (_) { if (token === generation) fail(); }
    };
    cover.addEventListener('click', () => startPlayback());
    retry.addEventListener('click', () => startPlayback(true));
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
      note();
      // Do not leave keyboard focus on a control hidden after playback starts.
      if (document.activeElement === cover || help.contains(document.activeElement)) video.focus({ preventScroll: true });
    });
    const buffering = () => {
      if (video.paused || video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;
      if (!revealed) {
        if (shell.dataset.videoState !== 'loading') loading();
        return;
      }
      shell.dataset.videoState = 'buffering';
      // Keep native controls available while buffering after the first frame.
      note('正在缓冲', true);
    };
    video.addEventListener('waiting', buffering);
    video.addEventListener('stalled', buffering);
    video.addEventListener('pause', () => {
      // load() may queue an old pause event before a deliberate retry plays.
      if (!video.paused) return;
      clearTimer();
      if (!revealed && shell.dataset.videoState === 'loading') {
        generation++;
        video.controls = false;
        show('idle', '播放演示');
      } else if (revealed) {
        shell.dataset.videoState = 'paused';
        note();
      }
    });
    video.addEventListener('ended', () => {
      generation++;
      clearTimer();
      revealed = false;
      video.controls = false;
      show('ended', '重新播放');
    });
    video.addEventListener('error', () => { if (video.error) fail(); });
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
