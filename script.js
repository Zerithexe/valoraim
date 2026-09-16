/* =========================================================
   RANGE — Valorant nişan antrenörü
   ---------------------------------------------------------
   Hassasiyet mantığı:
   Valorant'ta 1 fare "sayımı" (count) = 0.07 × hassasiyet derece döndürür.
   Bu yüzden 360° için gereken sayım  = 360 / (0.07 × sens)
   cm/360                             = (sayım / DPI) × 2.54
   Arenada da aynı formül kullanılır: hareket derecesi, arenanın
   103° yatay görüş açısına oranlanıp piksele çevrilir. Yani buradaki
   hassasiyet oyundakiyle birebir aynı his verir.
   ========================================================= */

const YAW = 0.07;        // Valorant'ın dönüş katsayısı
const FOV = 103;         // varsayılan yatay görüş açısı

/* ---------- elemanlar ---------- */
const $ = (id) => document.getElementById(id);

const arena     = $('arena');
const crosshair = $('crosshair');
const overlay   = $('overlay');
const startBtn  = $('startBtn');

const hudTime   = $('hudTime');
const hudScore  = $('hudScore');
const hudAcc    = $('hudAcc');
const hudExtra  = $('hudExtra');
const hudExtraLabel = $('hudExtraLabel');

const els = {
  sens: $('sens'), dpi: $('dpi'), size: $('size'),
  duration: $('duration'), count: $('count'), speed: $('speed'),
  sound: $('sound'), punish: $('punish')
};

/* ---------- durum ---------- */
const state = {
  mode: 'gridshot',
  running: false,
  paused: false,
  timeLeft: 60,
  score: 0,
  shots: 0,
  hits: 0,
  reactions: [],
  spawnedAt: 0,
  holding: false,
  onTargetMs: 0,
  heldMs: 0,
  cx: 0, cy: 0,           // nişangâh konumu (px)
  targets: [],
  lastFrame: 0,
  raf: 0
};

const cfg = () => ({
  sens: +els.sens.value,
  dpi: +els.dpi.value,
  radius: +els.size.value / 2,
  duration: +els.duration.value,
  count: +els.count.value,
  speed: +els.speed.value
});

/* ---------- ayar çıktıları ---------- */
function refreshOutputs() {
  const c = cfg();
  $('sensOut').textContent = c.sens.toFixed(2);
  $('dpiOut').textContent = c.dpi;
  $('sizeOut').textContent = els.size.value + ' px';
  $('durationOut').textContent = c.duration + ' sn';
  $('countOut').textContent = c.count;
  $('speedOut').textContent = c.speed + ' px/sn';

  const counts = 360 / (YAW * c.sens);
  const cm360 = (counts / c.dpi) * 2.54;
  $('edpi').textContent = Math.round(c.dpi * c.sens);
  $('cm360').textContent = cm360.toFixed(1);
  $('counts').textContent = Math.round(counts).toLocaleString('tr-TR') + ' sayım';

  if (!state.running) hudTime.textContent = c.duration.toFixed(1);
}

Object.values(els).forEach(el => el.addEventListener('input', refreshOutputs));
refreshOutputs();

/* ---------- mod seçimi ---------- */
const MODE_INFO = {
  gridshot: { foot: 'Mod: Gridshot — aynı anda birden çok hedef. Biri patlayınca yenisi doğar.', extra: 'Hız' },
  flick:    { foot: 'Mod: Flick — hedef tek tek doğar, tek hamlede üstüne git.', extra: 'Ort. tepki' },
  tracking: { foot: 'Mod: Tracking — sol tuşu basılı tut, nişangâhı hareketli hedefin üstünde tut.', extra: 'Takip' }
};

document.getElementById('modes').addEventListener('click', (e) => {
  const btn = e.target.closest('.mode');
  if (!btn || state.running) return;
  document.querySelectorAll('.mode').forEach(b => b.classList.toggle('is-active', b === btn));
  state.mode = btn.dataset.mode;
  $('arenaFoot').textContent = MODE_INFO[state.mode].foot;
  hudExtraLabel.textContent = MODE_INFO[state.mode].extra;
  $('countField').hidden = state.mode !== 'gridshot';
  $('speedField').hidden = state.mode !== 'tracking';
  resetHud();
  showOverlay('Başlamaya hazır', MODE_INFO[state.mode].foot.replace(/^Mod: \w+ — /, ''), 'Antrenmanı başlat');
});

/* ---------- ses ---------- */
let actx;
function beep(freq = 660, dur = 0.05) {
  if (!els.sound.checked) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.06, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(actx.currentTime + dur);
  } catch (_) {}
}

/* ---------- hedefler ---------- */
function rect() { return arena.getBoundingClientRect(); }

function spawnTarget() {
  const r = rect(), c = cfg(), pad = c.radius + 8;
  const t = {
    x: pad + Math.random() * (r.width - pad * 2),
    y: pad + Math.random() * (r.height - pad * 2),
    r: c.radius,
    vx: 0, vy: 0,
    el: document.createElement('div')
  };
  if (state.mode === 'tracking') {
    const a = Math.random() * Math.PI * 2;
    t.vx = Math.cos(a) * c.speed;
    t.vy = Math.sin(a) * c.speed;
  }
  t.el.className = 'target';
  t.el.style.width = t.el.style.height = t.r * 2 + 'px';
  place(t);
  arena.appendChild(t.el);
  state.targets.push(t);
  state.spawnedAt = performance.now();
  return t;
}

function place(t) {
  t.el.style.left = t.x + 'px';
  t.el.style.top = t.y + 'px';
}

function killTarget(t) {
  const i = state.targets.indexOf(t);
  if (i > -1) state.targets.splice(i, 1);
  t.el.classList.add('pop');
  setTimeout(() => t.el.remove(), 180);
}

function clearTargets() {
  state.targets.forEach(t => t.el.remove());
  state.targets = [];
}

/* ---------- nişangâh ---------- */
function pxPerDegree() { return rect().width / FOV; }

function moveCrosshair(dx, dy) {
  const k = YAW * cfg().sens * pxPerDegree();
  const r = rect();
  state.cx = Math.max(0, Math.min(r.width, state.cx + dx * k));
  state.cy = Math.max(0, Math.min(r.height, state.cy + dy * k));
  crosshair.style.left = state.cx + 'px';
  crosshair.style.top = state.cy + 'px';
}

function centerCrosshair() {
  const r = rect();
  state.cx = r.width / 2;
  state.cy = r.height / 2;
  crosshair.style.left = state.cx + 'px';
  crosshair.style.top = state.cy + 'px';
}

function targetUnderCrosshair() {
  for (let i = state.targets.length - 1; i >= 0; i--) {
    const t = state.targets[i];
    if (Math.hypot(t.x - state.cx, t.y - state.cy) <= t.r) return t;
  }
  return null;
}

/* ---------- girdi ---------- */
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === arena) moveCrosshair(e.movementX, e.movementY);
});

document.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== arena || e.button !== 0) return;
  e.preventDefault();
  if (state.mode === 'tracking') { state.holding = true; return; }
  shoot();
});

document.addEventListener('mouseup', (e) => {
  if (e.button === 0) state.holding = false;
});

document.addEventListener('contextmenu', (e) => {
  if (document.pointerLockElement === arena) e.preventDefault();
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !state.running) {
    e.preventDefault();
    const btn = overlay.querySelector('.btn-primary');
    if (btn) btn.click();
  }
});

arena.addEventListener('click', () => {
  if (state.running && state.paused) resume();
});

startBtn.addEventListener('click', () => {
  if (state.paused) resume(); else start();
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === arena;
  crosshair.hidden = !locked;
  arena.classList.toggle('is-live', locked);
  if (!locked && state.running && !state.paused) pause();
});

/* ---------- atış ---------- */
function shoot() {
  state.shots++;
  const t = targetUnderCrosshair();
  if (t) {
    state.hits++;
    state.score++;
    if (state.mode === 'flick') state.reactions.push(performance.now() - state.spawnedAt);
    beep(760, 0.045);
    killTarget(t);
    if (state.mode === 'flick') setTimeout(() => { if (state.running && !state.paused) spawnTarget(); }, 200);
    else spawnTarget();
  } else {
    if (els.punish.checked) state.score = Math.max(0, state.score - 1);
    beep(180, 0.05);
  }
  updateHud();
}

/* ---------- akış ---------- */
function start() {
  const c = cfg();
  Object.assign(state, {
    running: true, paused: false, timeLeft: c.duration,
    score: 0, shots: 0, hits: 0, reactions: [],
    onTargetMs: 0, heldMs: 0, holding: false
  });
  clearTargets();
  overlay.hidden = true;
  centerCrosshair();
  arena.requestPointerLock();

  if (state.mode === 'gridshot') for (let i = 0; i < c.count; i++) spawnTarget();
  else spawnTarget();

  updateHud();
  state.lastFrame = performance.now();
  state.raf = requestAnimationFrame(loop);
}

function pause() {
  state.paused = true;
  cancelAnimationFrame(state.raf);
  state.holding = false;
  showOverlay('Duraklatıldı', 'Fare kilidi bırakıldı. Kaldığın yerden devam etmek için alana tıkla.', 'Devam et');
}

function resume() {
  overlay.hidden = true;
  state.paused = false;
  arena.requestPointerLock();
  state.lastFrame = performance.now();
  state.raf = requestAnimationFrame(loop);
}

function loop(now) {
  const dt = Math.min((now - state.lastFrame) / 1000, 0.1);
  state.lastFrame = now;

  if (state.mode === 'tracking') {
    const r = rect();
    state.targets.forEach(t => {
      t.x += t.vx * dt; t.y += t.vy * dt;
      if (t.x < t.r) { t.x = t.r; t.vx *= -1; }
      if (t.x > r.width - t.r) { t.x = r.width - t.r; t.vx *= -1; }
      if (t.y < t.r) { t.y = t.r; t.vy *= -1; }
      if (t.y > r.height - t.r) { t.y = r.height - t.r; t.vy *= -1; }
      // rastgele küçük yön değişimi: takip zorlaşsın
      if (Math.random() < 0.02) {
        const a = Math.atan2(t.vy, t.vx) + (Math.random() - 0.5) * 1.6;
        const sp = Math.hypot(t.vx, t.vy);
        t.vx = Math.cos(a) * sp; t.vy = Math.sin(a) * sp;
      }
      place(t);
    });

    const on = !!targetUnderCrosshair();
    state.targets.forEach(t => t.el.classList.toggle('is-held', on && state.holding));
    if (state.holding) {
      state.heldMs += dt * 1000;
      if (on) { state.onTargetMs += dt * 1000; state.score = Math.round(state.onTargetMs / 100); }
    }
  }

  state.timeLeft -= dt;
  if (state.timeLeft <= 0) { state.timeLeft = 0; updateHud(); return finish(); }

  updateHud();
  state.raf = requestAnimationFrame(loop);
}

function finish() {
  state.running = false;
  cancelAnimationFrame(state.raf);
  document.exitPointerLock();
  clearTargets();

  const acc = accuracy();
  const isRecord = saveBest(state.score);
  const rows = [
    ['Skor', state.score],
    state.mode === 'tracking'
      ? ['Takipte', (state.onTargetMs / 1000).toFixed(1) + ' sn']
      : ['İsabet', acc === null ? '—' : acc + '%'],
    state.mode === 'flick'
      ? ['Ort. tepki', avgReaction() ? avgReaction() + ' ms' : '—']
      : ['Vuruş', state.mode === 'tracking' ? (state.heldMs ? Math.round(state.onTargetMs / state.heldMs * 100) + '%' : '—') : state.hits]
  ];

  showOverlay(
    'Seans bitti',
    tip(),
    'Yeniden dene',
    rows,
    isRecord ? 'Yeni rekor!' : ''
  );
  renderBest();
}

function tip() {
  const acc = accuracy();
  if (state.mode === 'tracking') {
    const p = state.heldMs ? state.onTargetMs / state.heldMs : 0;
    if (p < 0.4) return 'Hedefin peşinden koşuyorsun. Hedefin gideceği yeri tahmin edip nişangâhı oraya yerleştir, sonra ince düzelt.';
    if (p < 0.7) return 'Fena değil. Hız ayarını 40 px/sn artırıp aynı oranı korumaya çalış.';
    return 'Güzel takip. Hedef boyutunu 4 px küçült ya da hızı artır.';
  }
  if (acc === null) return 'Hiç atış yapmadın. Alana tıklayıp fareyi kilitlemen gerekiyor.';
  if (acc < 60) return 'Acele ediyorsun. Yavaşla; isabet %85 olmadan hız artırmak kötü alışkanlık öğretir.';
  if (acc < 85) return 'Dengeli bir seans. Aynı ayarlarla birkaç tekrar yap, sonra hedefi küçült.';
  return 'İsabet çok yüksek — biraz daha hızlı oyna ya da hedef boyutunu düşür.';
}

function accuracy() {
  if (state.mode === 'tracking' || state.shots === 0) return state.shots === 0 ? null : 0;
  return Math.round(state.hits / state.shots * 100);
}

function avgReaction() {
  if (!state.reactions.length) return 0;
  return Math.round(state.reactions.reduce((a, b) => a + b, 0) / state.reactions.length);
}

function updateHud() {
  hudTime.textContent = state.timeLeft.toFixed(1);
  hudScore.textContent = state.score;
  const acc = accuracy();
  hudAcc.textContent = state.mode === 'tracking'
    ? (state.heldMs ? Math.round(state.onTargetMs / state.heldMs * 100) + '%' : '—')
    : (acc === null ? '—' : acc + '%');
  if (state.mode === 'flick') {
    hudExtra.textContent = avgReaction() ? avgReaction() + ' ms' : '—';
  } else if (state.mode === 'tracking') {
    hudExtra.textContent = (state.onTargetMs / 1000).toFixed(1) + ' sn';
  } else {
    const elapsed = cfg().duration - state.timeLeft;
    hudExtra.textContent = (state.hits && elapsed > 0)
      ? (state.hits / elapsed).toFixed(2) + ' hdf/sn'
      : '—';
  }
}

function resetHud() {
  state.score = 0; state.shots = 0; state.hits = 0;
  state.onTargetMs = 0; state.heldMs = 0; state.reactions = [];
  state.timeLeft = cfg().duration;
  updateHud();
}

function showOverlay(title, text, btn, rows = null, record = '') {
  overlay.innerHTML = '';
  const h = document.createElement('h2'); h.textContent = title;
  overlay.appendChild(h);

  if (rows) {
    const wrap = document.createElement('div'); wrap.className = 'summary';
    rows.forEach(([k, v]) => {
      const d = document.createElement('div');
      d.innerHTML = `<span></span><b></b>`;
      d.querySelector('span').textContent = k;
      d.querySelector('b').textContent = v;
      wrap.appendChild(d);
    });
    overlay.appendChild(wrap);
    if (record) {
      const r = document.createElement('p'); r.className = 'record'; r.textContent = record;
      overlay.appendChild(r);
    }
  }

  const p = document.createElement('p'); p.textContent = text;
  overlay.appendChild(p);

  const b = document.createElement('button');
  b.className = 'btn-primary'; b.id = 'startBtn'; b.textContent = btn;
  b.addEventListener('click', () => { if (state.paused) resume(); else start(); });
  overlay.appendChild(b);

  const hint = document.createElement('p');
  hint.className = 'overlay-hint';
  hint.innerHTML = 'Kısayol: <kbd>Boşluk</kbd> başlat / yeniden dene · <kbd>Esc</kbd> duraklat';
  overlay.appendChild(hint);

  overlay.hidden = false;
}

/* ---------- rekorlar ---------- */
const BEST_KEY = 'range-best-v1';

function loadBest() {
  try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; }
  catch (_) { return {}; }
}

function saveBest(score) {
  const best = loadBest();
  const key = state.mode;
  if (!best[key] || score > best[key]) {
    best[key] = score;
    try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch (_) {}
    return true;
  }
  return false;
}

function renderBest() {
  const best = loadBest();
  const list = $('bestList');
  const names = { gridshot: 'Gridshot', flick: 'Flick', tracking: 'Tracking' };
  const keys = Object.keys(names).filter(k => best[k] != null);
  list.innerHTML = '';
  if (!keys.length) { list.innerHTML = '<li>Henüz kayıt yok.</li>'; return; }
  keys.forEach(k => {
    const li = document.createElement('li');
    li.innerHTML = `<span></span><b></b>`;
    li.querySelector('span').textContent = names[k];
    li.querySelector('b').textContent = best[k];
    list.appendChild(li);
  });
}

$('resetBest').addEventListener('click', () => {
  try { localStorage.removeItem(BEST_KEY); } catch (_) {}
  renderBest();
});

renderBest();
window.addEventListener('resize', () => { if (!state.running) centerCrosshair(); });
centerCrosshair();
