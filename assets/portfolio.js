const videos = Array.from(document.querySelectorAll('video'));
const pauseOthers = active => videos.forEach(other => { if (other !== active) other.pause(); });
videos.forEach(video => video.addEventListener('play', () => pauseOthers(video)));

const simulation = document.getElementById('simulation-video');
const chapters = Array.from(document.querySelectorAll('[data-seek]'));
if (simulation) {
  chapters.forEach(button => button.addEventListener('click', () => {
    const seek = () => {
      pauseOthers(simulation);
      simulation.currentTime = Number(button.dataset.seek);
      chapters.forEach(other => other.setAttribute('aria-pressed', String(other === button)));
      simulation.play().catch(() => {});
    };
    if (simulation.readyState >= 1) seek();
    else { simulation.addEventListener('loadedmetadata', seek, { once: true }); simulation.load(); }
  }));
  simulation.addEventListener('timeupdate', () => {
    const current = Math.min(5, Math.floor(simulation.currentTime / 6));
    chapters.forEach((button, i) => button.setAttribute('aria-pressed', String(i === current)));
  });
}

document.querySelectorAll('[data-playlist]').forEach(container => {
  const player = container.querySelector('video');
  const caption = container.querySelector('[data-clip-caption]');
  const buttons = Array.from(container.querySelectorAll('[data-video-src]'));
  buttons.forEach(button => button.addEventListener('click', () => {
    const wasPlaying = !player.paused;
    player.pause();
    player.querySelector('source').src = button.dataset.videoSrc;
    player.poster = button.dataset.poster;
    player.setAttribute('aria-label', button.dataset.label);
    if (caption) caption.textContent = button.dataset.caption;
    buttons.forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    player.load();
    if (wasPlaying) { pauseOthers(player); player.play().catch(() => {}); }
  }));
});
