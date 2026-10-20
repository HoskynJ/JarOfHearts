// Tiny circle physics for the jar: no dependencies, no DOM.
// Units are CSS pixels and seconds. y points down.

export class World {
  constructor() {
    this.bodies = [];
    this.segs = [];
    this.g = { x: 0, y: 1 };
    this.G = 2400;            // gravity strength, px/s^2
    this.maxSpeed = 1500;
    this.lidSeg = -1;         // index of the closing segment across the mouth
    this.lidOn = false;
  }

  // points: closed polygon, in order. The last->first edge is the "lid" line.
  setPolygon(points) {
    let cx = 0, cy = 0;
    for (const p of points) { cx += p.x; cy += p.y; }
    cx /= points.length; cy /= points.length;
    this.segs = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const a = points[i], b = points[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      let nx = -dy / len, ny = dx / len;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (nx * (cx - mx) + ny * (cy - my) < 0) { nx = -nx; ny = -ny; }
      this.segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, dx, dy, len2: len * len || 1, nx, ny });
    }
    this.lidSeg = n - 1;
  }

  add(body) {
    body.vx = body.vx || 0; body.vy = body.vy || 0;
    body.a = body.a || 0; body.w = body.w || 0;
    this.bodies.push(body);
    return body;
  }

  clear() { this.bodies.length = 0; }

  step(dt, sub = 3) {
    if (this.allAsleep()) return;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) this._sub(h);
  }

  allAsleep() { const B = this.bodies; for (let i = 0; i < B.length; i++) if (!B[i].sleep) return false; return true; }
  wake(b) { b.sleep = false; b.still = 0; }
  wakeAll() { for (const b of this.bodies) { b.sleep = false; b.still = 0; } }

  _sub(h) {
    const B = this.bodies, n = B.length;
    const gx = this.g.x * this.G, gy = this.g.y * this.G;
    const damp = Math.pow(0.9992, h * 1000); // light air drag
    for (let i = 0; i < n; i++) {
      const b = B[i]; b.t = false;
      if (b.sleep) continue;
      b.vx = (b.vx + gx * h) * damp;
      b.vy = (b.vy + gy * h) * damp;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > this.maxSpeed) { b.vx *= this.maxSpeed / sp; b.vy *= this.maxSpeed / sp; }
      b.x += b.vx * h; b.y += b.vy * h;
      b.a += b.w * h;
      b.w *= Math.pow(0.985, h * 1000 / 4);
    }
    for (let it = 0; it < 5; it++) {
      // body vs body
      for (let i = 0; i < n; i++) {
        const p = B[i];
        for (let j = i + 1; j < n; j++) {
          const q = B[j];
          if (p.sleep && q.sleep) continue;
          const dx = q.x - p.x, dy = q.y - p.y;
          const rr = p.r + q.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          const rvx = q.vx - p.vx, rvy = q.vy - p.vy;
          const vn = rvx * nx + rvy * ny;
          // a hard hit wakes a sleeping neighbour
          if ((p.sleep || q.sleep) && vn * (p.sleep ? 1 : -1) < -70) { if (p.sleep) this.wake(p); else this.wake(q); }
          const ip = p.sleep ? 0 : 1, iq = q.sleep ? 0 : 1, sum = ip + iq;
          const pen = rr - d;
          p.x -= nx * pen * ip / sum; p.y -= ny * pen * ip / sum;
          q.x += nx * pen * iq / sum; q.y += ny * pen * iq / sum;
          p.t = q.t = true;
          if (vn < 0) {
            const e = vn < -220 ? 0.25 : 0;
            const jn = -(1 + e) * vn / sum;
            p.vx -= jn * nx * ip; p.vy -= jn * ny * ip;
            q.vx += jn * nx * iq; q.vy += jn * ny * iq;
            const tx = -ny, ty = nx;
            const vt = rvx * tx + rvy * ty;
            const jt = Math.max(-Math.abs(jn) * 0.4, Math.min(Math.abs(jn) * 0.4, -vt * 0.25)) / sum;
            p.vx -= jt * tx * ip; p.vy -= jt * ty * ip;
            q.vx += jt * tx * iq; q.vy += jt * ty * iq;
            p.w += (vt * 0.5) / p.r * 0.2 * ip; q.w += (vt * 0.5) / q.r * 0.2 * iq;
          }
        }
      }
      // body vs walls
      for (let i = 0; i < n; i++) if (!B[i].sleep) this._wall(B[i]);
    }
    // settle: spin dies quickly in contact, and bodies that stay still fall asleep
    for (let i = 0; i < n; i++) {
      const b = B[i];
      if (b.sleep) continue;
      if (b.t) { b.w *= 0.55; b.vx *= 0.997; b.vy *= 0.997; }
      const slow = b.vx * b.vx + b.vy * b.vy < 900 && Math.abs(b.w) < 3;
      if (b.t && slow) { if (++b.still > 45) { b.sleep = true; b.vx = b.vy = b.w = 0; } } else b.still = 0;
    }
  }

  _wall(b) {
    const S = this.segs;
    for (let k = 0; k < S.length; k++) {
      if (k === this.lidSeg && !this.lidOn) continue;
      const s = S[k];
      const px = b.x - s.ax, py = b.y - s.ay;
      const t = (px * s.dx + py * s.dy) / s.len2;
      let nx, ny, pen;
      if (t > 0 && t < 1) {
        const signed = px * s.nx + py * s.ny;       // distance along inward normal
        pen = b.r - signed;
        if (pen <= 0) continue;
        nx = s.nx; ny = s.ny;
      } else {
        const cx = t <= 0 ? s.ax : s.bx, cy = t <= 0 ? s.ay : s.by;
        const ddx = b.x - cx, ddy = b.y - cy;
        const d = Math.hypot(ddx, ddy);
        if (d >= b.r || d === 0) continue;
        pen = b.r - d; nx = ddx / d; ny = ddy / d;
      }
      b.x += nx * pen; b.y += ny * pen; b.t = true;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        const e = vn < -220 ? 0.3 : 0;
        b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
        const tx = -ny, ty = nx;
        const vt = b.vx * tx + b.vy * ty;
        const f = Math.max(-Math.abs(vn) * 0.5, Math.min(Math.abs(vn) * 0.5, -vt * 0.15));
        b.vx += f * tx; b.vy += f * ty;
        b.w += vt / b.r * 0.08;
      }
    }
  }

  // Throw everything around. intensity ~0.3 (gentle) to 1.5 (hard).
  shake(intensity = 1) {
    this.wakeAll();
    for (const b of this.bodies) {
      b.vx += (Math.random() - 0.5) * 900 * intensity;
      b.vy -= (200 + Math.random() * 700) * intensity;
      b.w += (Math.random() - 0.5) * 18 * intensity;
    }
  }

  // A small nudge, for tilt jitters and walking.
  jostle(k = 1) {
    this.wakeAll();
    for (const b of this.bodies) {
      b.vx += (Math.random() - 0.5) * 120 * k;
      b.vy -= Math.random() * 160 * k;
    }
  }

  // Finger dragging through the hearts.
  stir(x, y, vx, vy, radius = 38) {
    const r2 = radius * radius;
    for (const b of this.bodies) {
      const dx = b.x - x, dy = b.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const f = 1 - Math.sqrt(d2) / radius;
      this.wakeAll();
      b.vx += vx * f * 0.9 + dx * f * 1.5;
      b.vy += vy * f * 0.9 + dy * f * 1.5;
      b.w += (vx - vy) * 0.002 * f;
    }
  }
}
