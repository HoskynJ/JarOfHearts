import { World } from './physics.js';

export const RARITY = {
  Pink:     { c: '#f6b8c7', d: '#e48aa3', l: '#ffe6ec', glow: '246,184,199' },
  Rose:     { c: '#e97b9a', d: '#c34e72', l: '#ffb6c9', glow: '233,123,154' },
  Ruby:     { c: '#b94261', d: '#85233e', l: '#ea7893', glow: '214,70,105' },
  Gold:     { c: '#e8bd58', d: '#b58528', l: '#fff3bf', glow: '255,210,90' },
  Platinum: { c: '#d8e3ea', d: '#8da2ae', l: '#ffffff', glow: '205,228,255' },
};

/* ---------- geometry (pure, testable) ---------- */
export function computeLayout(w, h) {
  const jarW = Math.min(w * 0.88, h * 0.8);
  const jarH = Math.min(h * 0.9, jarW * 1.28);
  const jx0 = (w - jarW) / 2, jy0 = h - jarH - 16;
  const lidH = jarH * 0.075;
  return {
    w, h, jarW, jarH, jx0, jy0, cx: w / 2, lidH,
    rimY: jy0 + lidH * 0.85, neckH: jarH * 0.04, shoulderH: jarH * 0.11,
    mw: jarW * 0.68, R: jarW * 0.2, bottom: jy0 + jarH,
  };
}

function cubic(p0, c1, c2, p1, n, out) {
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    });
  }
}

// Closed outline, clockwise from the left of the mouth. Last->first edge is the mouth (lid) line.
export function outline(L, inset = 0) {
  const left = L.jx0 + inset, right = L.jx0 + L.jarW - inset;
  const mL = L.cx - L.mw / 2 + inset, mR = L.cx + L.mw / 2 - inset;
  const nb = L.rimY + L.neckH, se = nb + L.shoulderH, bot = L.bottom - inset, R = L.R;
  const sh = L.shoulderH;
  const pts = [{ x: mL, y: L.rimY }, { x: mL, y: nb }];
  cubic({ x: mL, y: nb }, { x: mL, y: nb + sh * 0.55 }, { x: left, y: se - sh * 0.55 }, { x: left, y: se }, 10, pts);
  pts.push({ x: left, y: bot - R });
  for (let i = 1; i <= 10; i++) { const a = Math.PI - (i / 10) * (Math.PI / 2); pts.push({ x: left + R + R * Math.cos(a), y: bot - R + R * Math.sin(a) }); }
  for (let i = 1; i <= 10; i++) { const a = Math.PI / 2 - (i / 10) * (Math.PI / 2); pts.push({ x: right - R + R * Math.cos(a), y: bot - R + R * Math.sin(a) }); }
  pts.push({ x: right, y: se });
  cubic({ x: right, y: se }, { x: right, y: se - sh * 0.55 }, { x: mR, y: nb + sh * 0.55 }, { x: mR, y: nb }, 10, pts);
  pts.push({ x: mR, y: L.rimY });
  return pts;
}

export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}
export function inPoly(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

export function heartRadius(L, count) {
  const A = polyArea(outline(L, 5));
  const r = Math.sqrt((0.95 * 0.82 * A) / (Math.max(1, count) * Math.PI));
  return Math.max(6.5, Math.min(18, r));
}

/* ---------- drawing helpers ---------- */
function heartPath(x, s) {
  x.beginPath();
  x.moveTo(0, s * 0.95);
  x.bezierCurveTo(-s * 1.7, -s * 0.05, -s * 1.25, -s * 1.75, 0, -s * 0.5);
  x.bezierCurveTo(s * 1.25, -s * 1.75, s * 1.7, -s * 0.05, 0, s * 0.95);
  x.closePath();
}

function makeSprite(dpr, s, rarity, read, locket) {
  const size = Math.ceil(s * 2.5 + 6);
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.ceil(size * dpr);
  const x = cv.getContext('2d');
  x.scale(dpr, dpr); x.translate(size / 2, size / 2 + s * 0.04);
  const col = RARITY[rarity] || RARITY.Pink;
  heartPath(x, s);
  const g = x.createLinearGradient(-s, -s, s, s);
  g.addColorStop(0, col.l); g.addColorStop(0.45, col.c); g.addColorStop(1, col.d);
  x.globalAlpha = read ? 0.5 : 1;
  x.fillStyle = g; x.fill();
  x.lineWidth = Math.max(1, s * 0.09); x.strokeStyle = read ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.6)'; x.stroke();
  if (!read) {
    x.save(); heartPath(x, s); x.clip();
    x.fillStyle = 'rgba(255,255,255,.38)';
    x.beginPath(); x.ellipse(-s * 0.5, -s * 0.5, s * 0.38, s * 0.2, -0.7, 0, 7); x.fill();
    x.restore();
  }
  if (locket) {
    x.save(); x.scale(0.56, 0.56); x.translate(0, -s * 0.12); heartPath(x, s);
    x.lineWidth = s * 0.2; x.strokeStyle = 'rgba(255,255,255,.92)'; x.stroke(); x.restore();
  }
  return { cv, size };
}

function makeHalo(rgb) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const x = cv.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, `rgba(${rgb},.9)`); g.addColorStop(0.35, `rgba(${rgb},.4)`); g.addColorStop(1, `rgba(${rgb},0)`);
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return cv;
}

const easeOutBounce = (t) => {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};

/* ---------- the Jar ---------- */
export class Jar {
  constructor(canvas, opts = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.opts = opts; this.world = new World();
    this.items = new Map(); this.night = false; this.reduced = !!opts.reducedMotion;
    this.sprites = new Map(); this.halos = new Map();
    this.highlight = null; this.popId = null; this.popUntil = 0;
    this.tilt = 0; this.tiltSmooth = 0; this.running = false; this.paused = false;
    this.phase = 'idle'; this.lidOffset = 0; this._pending = null;
    this._bind();
    this._ro = new ResizeObserver(() => { clearTimeout(this._rt); this._rt = setTimeout(() => this.resize(), 120); });
    this._ro.observe(canvas.parentElement);
    this.resize(true);
  }

  /* layout & static layers */
  resize(first) {
    const p = this.canvas.parentElement;
    const w = Math.max(200, Math.round(p.clientWidth)), h = Math.max(220, Math.round(p.clientHeight));
    if (!first && w === this.L?.w && h === this.L?.h) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.L = computeLayout(w, h);
    this.outerPath = this._path(outline(this.L, 0));
    this._buildLayers();
    if (this._pending) this._rebuild(this.phase === 'ready' || this.reduced);
  }

  _path(pts) { const p = new Path2D(); pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y))); p.closePath(); return p; }

  setTheme(night) { this.night = night; if (this.L) this._buildLayers(); }

  _layer() { const c = document.createElement('canvas'); c.width = this.canvas.width; c.height = this.canvas.height; const x = c.getContext('2d'); x.scale(this.dpr, this.dpr); return [c, x]; }

  _buildLayers() {
    const L = this.L, n = this.night;
    // back glass
    let [c, x] = this._layer(); this.back = c;
    // soft ground shadow
    x.save(); x.translate(L.cx, L.bottom + 5); x.scale(1, 0.13);
    const sg = x.createRadialGradient(0, 0, 0, 0, 0, L.jarW * 0.52);
    sg.addColorStop(0, n ? 'rgba(0,0,0,.55)' : 'rgba(140,80,101,.32)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = sg; x.beginPath(); x.arc(0, 0, L.jarW * 0.52, 0, 7); x.fill(); x.restore();
    const g = x.createLinearGradient(0, L.jy0, 0, L.bottom);
    g.addColorStop(0, n ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.5)');
    g.addColorStop(1, n ? 'rgba(255,120,170,.16)' : 'rgba(246,184,199,.5)');
    x.fillStyle = g; x.fill(this.outerPath);
    // front glass
    [c, x] = this._layer(); this.front = c;
    x.lineJoin = 'round';
    x.lineWidth = 4; x.strokeStyle = n ? 'rgba(255,255,255,.5)' : 'rgba(255,255,255,.95)'; x.stroke(this.outerPath);
    x.save(); x.clip(this.outerPath);
    x.lineWidth = 10; x.strokeStyle = n ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.55)'; x.stroke(this.outerPath);
    // thick glass at the bottom
    const bg = x.createLinearGradient(0, L.bottom - L.R * 0.9, 0, L.bottom);
    bg.addColorStop(0, 'rgba(255,255,255,0)'); bg.addColorStop(1, n ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.6)');
    x.fillStyle = bg; x.fillRect(L.jx0, L.bottom - L.R * 0.9, L.jarW, L.R * 0.9);
    // vertical highlights
    const hl = (px, wd, a) => { const gg = x.createLinearGradient(0, L.jy0 + L.shoulderH, 0, L.bottom - L.R); gg.addColorStop(0, `rgba(255,255,255,${a})`); gg.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gg; x.beginPath(); x.roundRect(px, L.jy0 + L.shoulderH + L.neckH + 18, wd, L.jarH * 0.52, wd / 2); x.fill(); };
    hl(L.jx0 + L.jarW * 0.075, 9, n ? 0.28 : 0.7); hl(L.jx0 + L.jarW * 0.075 + 14, 3, n ? 0.18 : 0.45);
    hl(L.jx0 + L.jarW * 0.9, 5, n ? 0.14 : 0.4);
    x.restore();
    // glass lip
    x.fillStyle = n ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.85)';
    x.beginPath(); x.roundRect(L.cx - L.mw / 2 - 4, L.rimY - 2, L.mw + 8, L.neckH * 0.55 + 4, 5); x.fill();
    this._ribbon(x);
    // lid sprite
    const lw = L.mw + 30, lh = L.lidH * 1.25;
    const lc = document.createElement('canvas'); lc.width = Math.ceil(lw * this.dpr); lc.height = Math.ceil(lh * this.dpr);
    const lx = lc.getContext('2d'); lx.scale(this.dpr, this.dpr);
    const lg = lx.createLinearGradient(0, 0, 0, lh); lg.addColorStop(0, '#fbe6a2'); lg.addColorStop(0.5, '#e8bd58'); lg.addColorStop(1, '#b98a2c');
    lx.fillStyle = lg; lx.beginPath(); lx.roundRect(0, 0, lw, lh, 9); lx.fill();
    lx.strokeStyle = 'rgba(120,80,10,.22)'; lx.lineWidth = 1.4;
    for (let i = 8; i < lw - 6; i += 6) { lx.beginPath(); lx.moveTo(i, lh * 0.2); lx.lineTo(i, lh * 0.85); lx.stroke(); }
    lx.fillStyle = 'rgba(255,255,255,.55)'; lx.beginPath(); lx.roundRect(8, 3, lw - 16, 3, 2); lx.fill();
    this.lid = { cv: lc, w: lw, h: lh };
    // sprites depend on heart radius
    this.sprites.clear();
  }

  _ribbon(x) {
    const L = this.L, y = L.rimY + L.neckH * 0.28, h = Math.max(14, L.neckH * 0.9), x0 = L.cx - L.mw / 2 - 5, w = L.mw + 10;
    x.fillStyle = '#b95f78'; x.beginPath(); x.roundRect(x0, y, w, h, 4); x.fill();
    x.fillStyle = 'rgba(255,255,255,.28)'; x.fillRect(x0 + 2, y + 2, w - 4, 2);
    // bow
    const bx = L.cx - L.mw * 0.18, by = y + h / 2;
    x.fillStyle = '#c96f89';
    for (const s of [-1, 1]) { x.beginPath(); x.moveTo(bx, by); x.bezierCurveTo(bx + s * 26, by - 22, bx + s * 36, by + 14, bx, by); x.fill(); }
    x.fillStyle = '#a24c66'; x.beginPath(); x.arc(bx, by, 4.5, 0, 7); x.fill();
    // tails + tag
    x.strokeStyle = '#c96f89'; x.lineWidth = 3; x.lineCap = 'round';
    x.beginPath(); x.moveTo(bx, by); x.quadraticCurveTo(bx + 8, by + 26, bx + 2, by + 40); x.stroke();
    x.beginPath(); x.moveTo(bx, by); x.quadraticCurveTo(bx - 10, by + 22, bx - 14, by + 34); x.stroke();
    x.save(); x.translate(bx + 4, by + 42); x.rotate(0.12);
    x.fillStyle = '#fffaf2'; x.strokeStyle = '#d8b4be'; x.lineWidth = 1.2;
    x.beginPath(); x.roundRect(-24, 0, 48, 20, 4); x.fill(); x.stroke();
    x.fillStyle = '#563c46'; x.font = '13px "Bradley Hand","Noteworthy","Segoe Print",cursive'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('Niamh', 0, 11); x.restore();
  }

  _sprite(rarity, read, locket) {
    const key = `${rarity}|${read ? 1 : 0}|${locket ? 1 : 0}`;
    let s = this.sprites.get(key);
    if (!s) { s = makeSprite(this.dpr, this.sizeS, rarity, read, locket); this.sprites.set(key, s); }
    return s;
  }
  _halo(rgb) { let h = this.halos.get(rgb); if (!h) { h = makeHalo(rgb); this.halos.set(rgb, h); } return h; }

  /* hearts */
  setHearts(list) {
    this._pending = list;
    if (this.L) this._rebuild(this.reduced || this.phase === 'ready');
  }

  _rebuild(instant) {
    const list = this._pending; if (!list || !this.L) return;
    const L = this.L, w = this.world;
    w.clear(); this.items.clear();
    const r = heartRadius(L, list.length);
    this.bodyR = r * 0.92; this.sizeS = r; this.sprites.clear();
    w.setPolygon(outline(L, 5));
    w.lidOn = false;
    list.forEach((it) => this.items.set(it.id, { ...it, body: null }));
    const order = list.map((it) => it.id).sort(() => Math.random() - 0.5);
    if (instant) {
      this._prefill(order);
      this._closeLid();
      this.phase = 'ready';
      this._ensureLoop();
    } else {
      this.phase = 'pour'; this._queue = order.slice(); this._pourWait = 0; this._lidT = 0;
      this._ensureLoop();
    }
  }

  _spawn(id, x, y, vy = 0) {
    const it = this.items.get(id);
    const b = this.world.add({ id, x, y, r: this.bodyR, vx: (Math.random() - 0.5) * 80, vy, a: (Math.random() - 0.5) * 2, w: (Math.random() - 0.5) * 6, ph: Math.random() * 6.28 });
    it.body = b; return b;
  }

  _prefill(order) {
    const L = this.L, r = this.bodyR, poly = outline(L, 5 + r);
    const step = r * 2.05, pts = [];
    for (let y = L.bottom - r - 6; y > L.rimY + r; y -= step * 0.9) {
      const off = (Math.round((L.bottom - y) / step) % 2) * r;
      for (let x = L.jx0 + r + 6 + off; x < L.jx0 + L.jarW - r; x += step) if (inPoly(poly, x, y)) pts.push([x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2]);
    }
    order.forEach((id, i) => { const p = pts[i] || [L.cx + (Math.random() - 0.5) * L.mw * 0.5, L.rimY + L.neckH + r + (i % 8) * 2]; this._spawn(id, p[0], p[1]); });
    for (let i = 0; i < 360; i++) this.world.step(1 / 60, 2);
  }

  _closeLid() {
    const L = this.L; this.world.lidOn = true; this.lidOffset = 0;
    for (const b of this.world.bodies) if (b.y < L.rimY + b.r) { b.y = L.rimY + b.r + 2; b.vy = 0; }
  }

  setRead(id, v = true) { const it = this.items.get(id); if (it) it.read = v; }
  setNew(id, v) { const it = this.items.get(id); if (it) it.isNew = v; }
  setHighlight(set) { this.highlight = set; }

  /* motion */
  setTilt(gammaDeg) {
    const g = Math.max(-70, Math.min(70, gammaDeg || 0)) * Math.PI / 180;
    const t = Math.sin(g);
    if (Math.abs(t - this.tilt) < 0.03 && Math.abs(t) > 0.001) return; // ignore hand tremor
    this.tilt = t;
  }
  shake(i = 1) { if (this.phase === 'ready') this.world.shake(i); }
  jostle(k = 1) { if (this.phase === 'ready') this.world.jostle(k); }

  pop(id) {
    const it = this.items.get(id); if (!it || !it.body) return null;
    this.world.wakeAll(); it.body.vy = -1100; it.body.vx = (Math.random() - 0.5) * 120; it.body.w = (Math.random() - 0.5) * 14;
    this.popId = id; this.popUntil = performance.now() + 900;
    return this.screenPos(id);
  }
  screenPos(id) {
    const it = this.items.get(id); if (!it || !it.body) return null;
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + it.body.x, y: r.top + it.body.y };
  }

  /* input */
  _bind() {
    const c = this.canvas; let down = null;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() }; };
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture?.(e.pointerId); down = { ...pos(e), moved: 0, lx: 0, ly: 0, last: pos(e) }; this.opts.onTouch?.(); });
    c.addEventListener('pointermove', (e) => {
      if (!down) return; const p = pos(e); const dx = p.x - down.last.x, dy = p.y - down.last.y, dt = Math.max(8, p.t - down.last.t);
      down.moved += Math.hypot(dx, dy);
      if (down.moved > 9 && this.phase === 'ready') { this.world.stir(p.x, p.y, (dx / dt) * 16 * 12, (dy / dt) * 16 * 12); this.opts.onStir?.(Math.hypot(dx, dy) / dt); }
      down.last = p;
    });
    const up = (e) => {
      if (!down) return; const p = pos(e); const quick = p.t - down.t < 650; const wasTap = down.moved <= 9 && quick; down = null;
      if (wasTap) this.opts.onTap?.(this._hit(p.x, p.y));
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', () => { down = null; });
  }
  _hit(x, y) {
    let best = null, bd = Infinity; const lim = Math.max(this.bodyR * 1.45, 15);
    for (const b of this.world.bodies) { const d = Math.hypot(b.x - x, b.y - y); if (d < lim && d < bd) { bd = d; best = b.id; } }
    return best;
  }

  /* loop */
  pause() { this.paused = true; }
  resume() { this.paused = false; this._ensureLoop(); }
  _ensureLoop() { if (this.running || this.paused) return; this.running = true; this.last = performance.now(); this.acc = 0; requestAnimationFrame((t) => this._frame(t)); }

  _frame(t) {
    if (this.paused || document.hidden) { this.running = false; return; }
    const dt = Math.min(64, t - this.last); this.last = t; this.acc += dt;
    const STEP = 1000 / 60;
    let n = 0;
    this.tiltSmooth += (this.tilt - this.tiltSmooth) * 0.12;
    const tl = this.tiltSmooth;
    const ngx = tl * 1.1, ngy = Math.max(0.3, Math.sqrt(Math.max(0, 1 - tl * tl)));
    if (Math.abs(ngx - this.world.g.x) > 0.004) this.world.wakeAll();
    this.world.g.x = ngx; this.world.g.y = ngy;
    while (this.acc >= STEP && n < 4) { this._advance(STEP / 1000); this.acc -= STEP; n++; }
    if (n === 4) this.acc = 0;
    this._guard();
    this.render(t);
    requestAnimationFrame((tt) => this._frame(tt));
  }

  _advance(dt) {
    const L = this.L;
    if (this.phase === 'pour') {
      const per = Math.max(1, Math.ceil(this.items.size / 100));
      for (let i = 0; i < per && this._queue.length; i++) {
        const id = this._queue.pop(), r = this.bodyR;
        this._spawn(id, L.cx + (Math.random() - 0.5) * (L.mw - r * 3), -r * 2 - Math.random() * 30, 380);
      }
      if (!this._queue.length) { this._pourWait += dt; if (this._pourWait > 0.9) { this.phase = 'lid'; this._lidT = 0; } }
    } else if (this.phase === 'lid') {
      this._lidT += dt / 0.7;
      const e = easeOutBounce(Math.min(1, this._lidT));
      this.lidOffset = -(1 - e) * L.jarH * 0.3;
      if (this._lidT >= 1) { this._closeLid(); this.phase = 'ready'; this.opts.onReady?.(); }
    }
    this.world.step(dt, 3);
  }

  _guard() {
    const L = this.L, W = this.world;
    for (const b of W.bodies) {
      if (!isFinite(b.x) || !isFinite(b.y) || b.x < L.jx0 - 40 || b.x > L.jx0 + L.jarW + 40 || b.y > L.bottom + 40 || (W.lidOn && b.y < L.rimY - 10)) {
        b.x = L.cx; b.y = L.bottom - L.R - 30; b.vx = b.vy = 0;
      }
    }
  }

  render(t) {
    const x = this.ctx, L = this.L;
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    x.clearRect(0, 0, L.w, L.h);
    x.drawImage(this.back, 0, 0, L.w, L.h);
    const hl = this.highlight, night = this.night;
    const pulse = 0.55 + 0.45 * Math.sin(t * 0.005);
    for (const b of this.world.bodies) {
      const it = this.items.get(b.id); if (!it) continue;
      const rar = RARITY[it.rarity] || RARITY.Pink;
      const isPop = this.popId === b.id && t < this.popUntil;
      let dim = 1;
      if (hl) dim = hl.has(b.id) ? 1 : 0.32;
      // glow
      let glow = 0, rgb = rar.glow;
      if (isPop) { glow = 0.95; rgb = '255,236,170'; }
      else if (it.isNew && !it.read) { glow = 0.55 + 0.4 * pulse; rgb = '255,225,130'; }
      else if (hl && hl.has(b.id)) glow = 0.35 * pulse + 0.2;
      else if (night && !it.read) glow = 0.2;
      if (glow > 0) {
        const h = this._halo(rgb), s = this.sizeS * (isPop ? 5.5 : (it.isNew && !it.read) ? 5 : 3.6);
        x.globalAlpha = glow * dim; x.drawImage(h, b.x - s / 2, b.y - s / 2, s, s);
      }
      const sp = this._sprite(it.rarity, it.read, it.locket);
      const k = isPop ? 1.3 : 1;
      x.globalAlpha = dim;
      x.save(); x.translate(b.x, b.y); x.rotate(b.a); if (k !== 1) x.scale(k, k);
      x.drawImage(sp.cv, -sp.size / 2, -sp.size / 2, sp.size, sp.size);
      x.restore();
      if (!it.read && (it.rarity === 'Gold' || it.rarity === 'Platinum')) {
        const a = Math.pow(Math.max(0, Math.sin(t * 0.0032 + b.ph)), 8);
        if (a > 0.05) { x.globalAlpha = a * dim; x.strokeStyle = '#fff'; x.lineWidth = 1.4; const q = this.sizeS * 0.7; const cx = b.x + q * 0.2, cy = b.y - q * 0.5; x.beginPath(); x.moveTo(cx - q, cy); x.lineTo(cx + q, cy); x.moveTo(cx, cy - q); x.lineTo(cx, cy + q); x.stroke(); }
      }
    }
    x.globalAlpha = 1;
    x.drawImage(this.front, 0, 0, L.w, L.h);
    // moving glare
    x.save(); x.clip(this.outerPath);
    const gx = L.cx + this.tiltSmooth * L.jarW * 0.42 + L.jarW * 0.12;
    const gg = x.createLinearGradient(gx - 36, 0, gx + 36, 0);
    gg.addColorStop(0, 'rgba(255,255,255,0)'); gg.addColorStop(0.5, night ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.2)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gg; x.fillRect(gx - 36, L.jy0, 72, L.jarH);
    x.restore();
    // lid
    if (this.lid && this.phase !== 'pour' && this.phase !== 'idle') {
      x.drawImage(this.lid.cv, L.cx - this.lid.w / 2, L.jy0 + this.lidOffset - 2, this.lid.w, this.lid.h);
    }
  }
}
