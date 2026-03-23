(function () {
  if (window.__mindfultab_birds) return;
  window.__mindfultab_birds = true;

  const BIRD_SIZE = 64;
  const FRAME_MS = 80;
  const MIN_SPEED = 1.5;
  const MAX_SPEED = 3;
  const BODY_COLORS = ['#86EFAC', '#D8B4FE', '#FCA5A5'];

  let colorIndex = 0;
  const birds = [];
  let ticking = false;
  let lastFrame = 0;

  function makeSVG(bodyColor) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
      <path fill="#5D4037" d="M14,46C18,42 24,40 32,40C40,40 46,42 50,46L48,50C44,47 38.7,45.7 32,45.7C25.3,45.7 20,47 16,50Z"/>
      <path fill="${bodyColor}" d="M31.5,18C38.4,18 44,23.6 44,30.5C44,37.4 38.4,43 31.5,43C24.6,43 19,37.4 19,30.5C19,23.6 24.6,18 31.5,18Z"/>
      <path fill="#FFAB40" d="M42,29C47,30 50.7,32.2 53,35.8L48.8,36.8C46.9,34.5 44.3,33 40.6,32.2Z"/>
      <path fill="#6D4C41" d="M23.8,30.4C27.2,25.7 32.5,23 38.3,23.2C34.7,20 29.3,19.1 24.7,21C20.1,22.9 16.8,27.3 16,32.1C18.2,31.3 20.9,30.8 23.8,30.4Z"/>
      <path fill="#5D4037" d="M35.5,30.1C36.7,30.1 37.7,31.1 37.7,32.3C37.7,33.5 36.7,34.5 35.5,34.5C34.3,34.5 33.3,33.5 33.3,32.3C33.3,31.1 34.3,30.1 35.5,30.1Z"/>
      <path fill="#FF8F00" d="M40.2,33.2L45.4,31.8L40.9,36.1Z"/>
    </svg>`;
  }

  function randomVelocity() {
    const speed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
    return Math.random() < 0.5 ? speed : -speed;
  }

  function spawnBird() {
    const el = document.createElement('div');
    el.className = 'mindfultab-flying-bird';
    el.innerHTML = makeSVG(BODY_COLORS[colorIndex % BODY_COLORS.length]);
    colorIndex++;

    const x = Math.random() * (window.innerWidth - BIRD_SIZE);
    const y = Math.random() * (window.innerHeight - BIRD_SIZE);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);

    birds.push({ el, x, y, vx: randomVelocity(), vy: randomVelocity() });

    if (!ticking) {
      ticking = true;
      lastFrame = performance.now();
      requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    if (birds.length === 0) { ticking = false; return; }

    if (now - lastFrame >= FRAME_MS) {
      lastFrame = now;
      const maxX = window.innerWidth - BIRD_SIZE;
      const maxY = window.innerHeight - BIRD_SIZE;

      for (const b of birds) {
        b.x += b.vx;
        b.y += b.vy;

        if (b.x < 0)    { b.x = 0;    b.vx = -b.vx; }
        if (b.x > maxX) { b.x = maxX; b.vx = -b.vx; }
        if (b.y < 0)    { b.y = 0;    b.vy = -b.vy; }
        if (b.y > maxY) { b.y = maxY; b.vy = -b.vy; }

        b.el.style.left = b.x + 'px';
        b.el.style.top  = b.y + 'px';
        b.el.style.transform = b.vx < 0 ? 'scaleX(-1)' : 'scaleX(1)';
      }
    }

    requestAnimationFrame(tick);
  }

  spawnBird();
  setInterval(spawnBird, 20_000);
})();
