/* The cursor: a small planet with a satellite going round it.
   The system draws the gold dot, so the pointer itself never lags, even while the 3D world is busy.
   The orbit follows a moment behind, with its satellite circling, and a little stardust trails off as
   the mouse moves. Mouse and trackpad only; touch screens keep their usual behaviour. */
const html = document.documentElement;
if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) start();

function start() {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  html.classList.add('cur-on');

  const layer = document.createElement('div');
  layer.className = 'cur away';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML =
    '<div class="cur-pos"><div class="cur-orbit">' +
    '<svg class="cur-ring" width="48" height="48" viewBox="-24 -24 48 48"><ellipse rx="18" ry="6.9" transform="rotate(-24)"/></svg>' +
    '<div class="cur-tilt"><div class="cur-spin"><i class="cur-sat"></i></div></div>' +
    '</div></div>';
  const dust = [];
  for (let i = 0; i < 26; i++) {
    const el = document.createElement('i');
    el.className = 'cur-dust';
    layer.appendChild(el);
    dust.push({ el, anim: null });
  }
  const ping = document.createElement('i');
  ping.className = 'cur-ping';
  layer.appendChild(ping);
  document.body.appendChild(layer);
  const pos = layer.firstChild;
  const viewer = document.getElementById('viewer');

  // things you can click make the orbit open up; over the dispenser loupe it steps aside
  const HOT = 'a, button, [role="button"], label, select, summary, .src-steps li';
  let mx = 0, my = 0, fx = 0, fy = 0;
  let inside = false, target = null, raf = 0, last = 0;
  let away = true, hot = false;
  let dustX = 0, dustY = 0, dustT = 0, di = 0, pingAnim = null;

  function frame(now) {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    const k = still ? 1 : 1 - Math.exp(-dt * 26);
    fx += (mx - fx) * k;
    fy += (my - fy) * k;
    pos.style.transform = `translate3d(${fx.toFixed(1)}px, ${fy.toFixed(1)}px, 0)`;
    const t = target && target.closest ? target : null;
    const a = !inside || !!(viewer && viewer.open) || !!(t && t.closest('[data-loupe]'));
    const h = !a && !!(t && t.closest(HOT));
    if (a !== away) { away = a; layer.classList.toggle('away', a); }
    if (h !== hot) { hot = h; layer.classList.toggle('hot', h); }
    if (Math.abs(mx - fx) > 0.15 || Math.abs(my - fy) > 0.15) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  // a speck of stardust left behind, drifting off and fading
  function sprinkle(x, y) {
    const d = dust[di++ % dust.length];
    if (d.anim) d.anim.cancel();
    d.el.classList.toggle('g', Math.random() < 0.3);
    const ang = Math.random() * Math.PI * 2, r = 4 + Math.random() * 10;
    const dx = Math.cos(ang) * r, dy = Math.sin(ang) * r;
    const x0 = x + (Math.random() - 0.5) * 6, y0 = y + (Math.random() - 0.5) * 6;
    const s = 0.8 + Math.random() * 0.7;
    const at = (f, sc) => `translate3d(${(x0 + dx * f).toFixed(1)}px, ${(y0 + dy * f).toFixed(1)}px, 0) scale(${sc.toFixed(2)})`;
    // drifts out quickly and slows down, staying lit for a moment before it fades
    d.anim = d.el.animate([
      { transform: at(0, s), opacity: 0.9 },
      { transform: at(0.7, s * 0.85), opacity: 0.7, offset: 0.45 },
      { transform: at(1, 0.15), opacity: 0 },
    ], { duration: 900 + Math.random() * 600 });
  }

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') {
      if (inside) { inside = false; kick(); }
      return;
    }
    mx = e.clientX; my = e.clientY; target = e.target;
    if (!inside) {
      // coming back in: start from here instead of sliding over from where it left
      inside = true;
      fx = mx; fy = my; dustX = mx; dustY = my;
    }
    if (!still && !away) {
      const now = performance.now();
      if (Math.hypot(mx - dustX, my - dustY) > 14 && now - dustT > 22) {
        sprinkle(mx, my);
        dustX = mx; dustY = my; dustT = now;
      }
    }
    kick();
  }, { passive: true });

  // what's under the pointer changes when the page scrolls under a still mouse too
  document.addEventListener('mouseover', (e) => { target = e.target; kick(); }, { passive: true });
  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) { inside = false; kick(); } }, { passive: true });

  // a click sends out a small ping, like a signal
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    layer.classList.add('down');
    if (still || away) return;
    if (pingAnim) pingAnim.cancel();
    const at = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    pingAnim = ping.animate([
      { transform: `${at} scale(0.25)`, opacity: 0.75 },
      { transform: `${at} scale(1)`, opacity: 0 },
    ], { duration: 520, easing: 'cubic-bezier(.2, .7, .3, 1)' });
  }, { passive: true });
  const up = () => layer.classList.remove('down');
  window.addEventListener('pointerup', up, { passive: true });
  window.addEventListener('pointercancel', up, { passive: true });
  window.addEventListener('blur', up);
}
