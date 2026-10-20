/* Sound (synthesised, no files), haptics, sparkles and ambient background. */

/* ---------- Sound ---------- */
let ctx = null, master = null;
export const Sound = {
  enabled: true,
  unlock() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
      }
      if (ctx.state !== 'running') ctx.resume();
    } catch {}
  },
  _tone(freq, t, dur, type = 'sine', gain = 0.18, detune = 0) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  },
  chime(rarity = 'Pink') {
    if (!this.enabled || !ctx) return;
    const t = ctx.currentTime + 0.02;
    // pentatonic, climbs with rarity
    const base = { Pink: 523.25, Rose: 587.33, Ruby: 659.25, Gold: 783.99, Platinum: 880 }[rarity] || 523.25;
    const ratios = [1, 1.2599, 1.4983, 1.7818, 2, 2.5198];
    const n = { Pink: 2, Rose: 3, Ruby: 4, Gold: 5, Platinum: 6 }[rarity] || 2;
    for (let i = 0; i < n; i++) {
      const f = base * ratios[i];
      this._tone(f, t + i * 0.085, 1.1, 'sine', 0.16);
      this._tone(f * 2.005, t + i * 0.085, 0.6, 'triangle', 0.05);
    }
    if (rarity === 'Platinum') for (let i = 0; i < 7; i++) this._tone(1760 * (1 + i * 0.12), t + 0.5 + i * 0.06, 0.9, 'sine', 0.05);
  },
  clink() {
    if (!this.enabled || !ctx) return; const t = ctx.currentTime;
    this._tone(1480, t, 0.35, 'sine', 0.12); this._tone(2210, t, 0.25, 'triangle', 0.06); this._tone(990, t + 0.02, 0.4, 'sine', 0.06);
  },
  rattle(k = 1) {
    if (!this.enabled || !ctx) return;
    const now = performance.now(); if (now - (this._lr || 0) < 90) return; this._lr = now;
    const len = 0.07, buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400 + Math.random() * 2600; f.Q.value = 1.4;
    const g = ctx.createGain(); g.gain.value = Math.min(0.35, 0.1 * k);
    s.connect(f); f.connect(g); g.connect(master); s.start();
  },
  tick() { if (!this.enabled || !ctx) return; this._tone(1900 + Math.random() * 600, ctx.currentTime, 0.12, 'sine', 0.05); },
  save() { if (!this.enabled || !ctx) return; const t = ctx.currentTime; this._tone(880, t, 0.25, 'sine', 0.12); this._tone(1318, t + 0.07, 0.4, 'sine', 0.12); },
};

/* ---------- Haptics ---------- */
// iOS Safari has no navigator.vibrate. Toggling a hidden <input switch> gives a real haptic tick on iOS 17.4+.
let hEl = null;
function ensureH() {
  if (hEl) return;
  const l = document.createElement('label'); l.setAttribute('aria-hidden', 'true');
  l.style.cssText = 'position:fixed;left:-300px;top:-300px;width:1px;height:1px;opacity:0;pointer-events:none';
  const i = document.createElement('input'); i.type = 'checkbox'; i.setAttribute('switch', ''); l.appendChild(i);
  document.body.appendChild(l); hEl = l;
}
export const Haptics = {
  enabled: true,
  tick() {
    if (!this.enabled) return;
    try { if (navigator.vibrate) navigator.vibrate(12); else { ensureH(); hEl.click(); } } catch {}
  },
  pattern(n = 3, gap = 70) { for (let i = 0; i < n; i++) setTimeout(() => this.tick(), i * gap); },
  rarity(r) { this.pattern({ Pink: 1, Rose: 2, Ruby: 2, Gold: 3, Platinum: 5 }[r] || 1, 75); },
};

/* ---------- Sparkles / confetti (full-screen canvas) ---------- */
export class Particles {
  constructor(canvas) {
    this.c = canvas; this.x = canvas.getContext('2d'); this.p = []; this.running = false;
    this.resize(); addEventListener('resize', () => this.resize());
  }
  resize() { const d = Math.min(devicePixelRatio || 1, 2); this.d = d; this.c.width = innerWidth * d; this.c.height = innerHeight * d; }
  burst(x, y, rgb = '255,200,120', n = 24, spread = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = (60 + Math.random() * 260) * spread;
      this.p.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: 0.8 + Math.random() * 0.8, age: 0, r: 1.5 + Math.random() * 3, rgb, kind: Math.random() < 0.4 ? 'star' : 'dot', g: 260 });
    }
    this._go();
  }
  hearts(x, y, rgb, n = 10) {
    for (let i = 0; i < n; i++) this.p.push({ x: x + (Math.random() - 0.5) * 40, y, vx: (Math.random() - 0.5) * 80, vy: -90 - Math.random() * 140, life: 1.4 + Math.random(), age: 0, r: 5 + Math.random() * 6, rgb, kind: 'heart', g: -20 });
    this._go();
  }
  confetti(n = 90) {
    const cols = ['246,184,199', '233,123,154', '232,189,88', '216,227,234', '185,66,97'];
    for (let i = 0; i < n; i++) this.p.push({ x: Math.random() * innerWidth, y: -20 - Math.random() * 200, vx: (Math.random() - 0.5) * 100, vy: 120 + Math.random() * 200, life: 4, age: 0, r: 3 + Math.random() * 4, rgb: cols[i % cols.length], kind: 'rect', g: 60, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8 });
    this._go();
  }
  _go() { if (!this.running) { this.running = true; this.t = performance.now(); requestAnimationFrame((t) => this._f(t)); } }
  _f(t) {
    const dt = Math.min(0.05, (t - this.t) / 1000); this.t = t; const x = this.x; x.setTransform(this.d, 0, 0, this.d, 0, 0); x.clearRect(0, 0, innerWidth, innerHeight);
    this.p = this.p.filter((q) => (q.age += dt) < q.life);
    for (const q of this.p) {
      q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; if (q.rot != null) q.rot += q.vr * dt;
      const a = Math.max(0, 1 - q.age / q.life); x.globalAlpha = Math.min(1, a * 1.6); x.fillStyle = x.strokeStyle = `rgb(${q.rgb})`;
      if (q.kind === 'dot') { x.beginPath(); x.arc(q.x, q.y, q.r * a + 0.5, 0, 7); x.fill(); }
      else if (q.kind === 'star') { x.lineWidth = 1.4; x.beginPath(); x.moveTo(q.x - q.r * 2, q.y); x.lineTo(q.x + q.r * 2, q.y); x.moveTo(q.x, q.y - q.r * 2); x.lineTo(q.x, q.y + q.r * 2); x.stroke(); }
      else if (q.kind === 'rect') { x.save(); x.translate(q.x, q.y); x.rotate(q.rot); x.fillRect(-q.r, -q.r / 2, q.r * 2, q.r); x.restore(); }
      else if (q.kind === 'heart') { x.save(); x.translate(q.x, q.y); const s = q.r; x.beginPath(); x.moveTo(0, s * 0.9); x.bezierCurveTo(-s * 1.6, -s * 0.1, -s * 1.2, -s * 1.6, 0, -s * 0.5); x.bezierCurveTo(s * 1.2, -s * 1.6, s * 1.6, -s * 0.1, 0, s * 0.9); x.fill(); x.restore(); }
    }
    x.globalAlpha = 1;
    if (this.p.length) requestAnimationFrame((tt) => this._f(tt)); else { this.running = false; x.clearRect(0, 0, innerWidth, innerHeight); }
  }
}

/* ---------- Ambient background: drifting bokeh, optional snow ---------- */
export class Ambient {
  constructor(canvas, reduced) {
    this.c = canvas; this.x = canvas.getContext('2d'); this.reduced = reduced; this.night = false; this.snow = false;
    this.mx = 0; this.dots = []; this.flakes = []; this.running = false;
    this.resize(); addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.start(); });
  }
  resize() {
    const d = Math.min(devicePixelRatio || 1, 2); this.d = d; this.w = innerWidth; this.h = innerHeight;
    this.c.width = this.w * d; this.c.height = this.h * d;
    this.dots = Array.from({ length: 26 }, () => ({ x: Math.random() * this.w, y: Math.random() * this.h, r: 8 + Math.random() * 34, v: 4 + Math.random() * 10, a: 0.05 + Math.random() * 0.09, ph: Math.random() * 6.28, z: 0.3 + Math.random() }));
    this.flakes = Array.from({ length: 70 }, () => ({ x: Math.random() * this.w, y: Math.random() * this.h, r: 1 + Math.random() * 2.6, v: 18 + Math.random() * 40, ph: Math.random() * 6.28 }));
    if (this.reduced) this.draw(0);
  }
  setTheme(night) { this.night = night; if (this.reduced) this.draw(0); }
  setSnow(on) { this.snow = on; this.start(); }
  tilt(t) { this.mx = t; }
  start() { if (this.reduced && !this.snow) return; if (!this.running) { this.running = true; this.t = performance.now(); requestAnimationFrame((t) => this.f(t)); } }
  f(t) {
    if (document.hidden) { this.running = false; return; }
    const dt = Math.min(0.06, (t - this.t) / 1000); this.t = t; this.draw(dt, t);
    requestAnimationFrame((tt) => this.f(tt));
  }
  draw(dt, t = 0) {
    const x = this.x; x.setTransform(this.d, 0, 0, this.d, 0, 0); x.clearRect(0, 0, this.w, this.h);
    const col = this.night ? '255,170,200' : '255,255,255';
    for (const o of this.dots) {
      o.y -= o.v * dt * o.z; o.x += Math.sin(t * 0.0004 + o.ph) * 6 * dt; if (o.y < -o.r) { o.y = this.h + o.r; o.x = Math.random() * this.w; }
      const px = o.x + this.mx * 26 * o.z;
      const g = x.createRadialGradient(px, o.y, 0, px, o.y, o.r); g.addColorStop(0, `rgba(${col},${o.a * (this.night ? 1.6 : 2.4)})`); g.addColorStop(1, `rgba(${col},0)`);
      x.fillStyle = g; x.beginPath(); x.arc(px, o.y, o.r, 0, 7); x.fill();
    }
    if (this.snow) {
      x.fillStyle = this.night ? 'rgba(255,255,255,.8)' : 'rgba(255,255,255,.95)';
      for (const f of this.flakes) {
        f.y += f.v * dt; f.x += Math.sin(t * 0.001 + f.ph) * 14 * dt; if (f.y > this.h + 4) { f.y = -4; f.x = Math.random() * this.w; }
        x.beginPath(); x.arc(f.x, f.y, f.r, 0, 7); x.fill();
      }
    }
  }
}
