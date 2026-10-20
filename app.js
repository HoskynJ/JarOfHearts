import { Jar, RARITY } from './jar.js';
import { Sound, Haptics, Particles, Ambient } from './fx.js';
import { b64, importAes, tryUnlock, openVault, decryptBytes } from './vault.js';

/* ---------- small helpers ---------- */
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(Array.isArray(r) ? r[0] : r || 0, w / 2, h / 2);
    this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath();
  };
}
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem('jar.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('jar.' + k, JSON.stringify(v)); } catch {} },
};
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const dateKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- state ---------- */
const S = {
  content: null, hearts: [], byId: new Map(), moods: [], mood: 'surprise',
  read: new Set(store.get('read', [])), favs: new Set(store.get('favs', [])),
  screen: 'jar', noteOpen: false, welcomeOpen: false, current: null, busy: false, motionOn: false, key: null,
};
let jar, fx, ambient;

/* ---------- theme & toggles ---------- */
const mq = matchMedia('(prefers-color-scheme: dark)');
const ICON = {
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
};
function theme() { return store.get('theme', null) || (mq.matches ? 'night' : 'day'); }
function applyTheme() {
  const t = theme(), night = t === 'night';
  document.documentElement.dataset.theme = t;
  $('#themeColor').content = night ? '#1b1022' : '#fff4ee';
  $('#btnTheme').innerHTML = night ? ICON.sun : ICON.moon;
  jar?.setTheme(night); ambient?.setTheme(night);
}
function applySound() {
  Sound.enabled = store.get('sound', true);
  const b = $('#btnSound'); b.innerHTML = Sound.enabled ? ICON.soundOn : ICON.soundOff;
  b.setAttribute('aria-pressed', String(Sound.enabled)); b.setAttribute('aria-label', Sound.enabled ? 'Sound on' : 'Sound off');
}
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------- vault: everything private is encrypted ---------- */
async function fetchVault() {
  try {
    const r = await fetch('vault.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const text = await r.text(); store.set('vaultCache', text); // still encrypted
    return JSON.parse(text);
  } catch (e) {
    const t = store.get('vaultCache', null); return t ? JSON.parse(t) : null;
  }
}
async function loadContent() {
  const v = await fetchVault(); if (!v) return null;
  try { return await openVault(v, S.key); } catch { return null; }
}
async function unlock() {
  const vault = await fetchVault();
  if (!vault) return { error: 'missing' };
  const saved = store.get('key', null);
  if (saved) {
    try { const key = await importAes(b64.from(saved)); return { key, content: await openVault(vault, key) }; }
    catch { store.set('key', null); }
  }
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('k');
  if (fromLink) {
    history.replaceState(null, '', location.pathname + location.search);
    const res = await tryUnlock(vault, '', fromLink);
    if (res) { store.set('key', b64.to(res.raw)); return res; }
  }
  return promptUnlock(vault);
}
function promptUnlock(vault) {
  return new Promise((resolve) => {
    const ov = $('#lock'), code = $('#lockCode'), err = $('#lockErr'), btn = $('#lockGo');
    ov.classList.add('show');
    const go = async () => {
      Sound.unlock(); err.textContent = ''; btn.disabled = true; btn.textContent = 'Opening…';
      await wait(40);
      const res = code.value.trim() ? await tryUnlock(vault, '', code.value) : null;
      btn.disabled = false; btn.textContent = 'Open the jar';
      if (!res) {
        err.textContent = code.value.trim() ? 'That code doesn’t match. Check it and try again.' : 'Paste the setup code first.';
        ov.classList.remove('wobble'); void ov.offsetWidth; ov.classList.add('wobble'); Haptics.pattern(2, 80); return;
      }
      store.set('key', b64.to(res.raw));
      ov.classList.remove('show'); code.value = ''; resolve(res);
    };
    btn.onclick = go;
    code.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    setTimeout(() => code.focus({ preventScroll: true }), 350);
  });
}

/* encrypted photos & videos -> temporary blob URLs */
const blobs = new Map(); const liveUrls = [];
function mediaURL(path, mime, keep = true) {
  if (keep && blobs.has(path)) return blobs.get(path);
  const job = (async () => {
    const r = await fetch(path); if (!r.ok) throw new Error(r.status);
    const bytes = await decryptBytes(S.key, await r.arrayBuffer());
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  })();
  if (keep) { blobs.set(path, job); job.catch(() => blobs.delete(path)); }
  return job;
}
const daysSince = (iso) => (Date.now() - new Date(iso).getTime()) / 864e5;
const isNew = (h) => !!h.added && daysSince(h.added) <= 30 && !S.read.has(h.id);

function applyContent(data) {
  S.content = data;
  S.hearts = (data.hearts || []).map((h) => ({ type: 'text', ...h }));
  S.byId = new Map(S.hearts.map((h) => [h.id, h]));
  const hasType = (t) => S.hearts.some((h) => h.type === t);
  S.moods = (data.moods || []).filter((m) => !m.types || m.types.some(hasType));
  if (!S.moods.find((m) => m.id === S.mood)) S.mood = 'surprise';
  // forget reads/favourites for hearts that no longer exist
  S.read = new Set([...S.read].filter((id) => S.byId.has(id)));
  S.favs = new Set([...S.favs].filter((id) => S.byId.has(id)));
  renderHeader(); renderMoods(); renderPills(); renderMemories(); renderSaved(); renderProgress();
  const items = S.hearts.map((h) => ({ id: h.id, rarity: h.rarity, locket: h.type === 'media', read: S.read.has(h.id), isNew: isNew(h) }));
  jar.setHearts(items); updateHighlight();
}

/* ---------- header, pills, moods ---------- */
function greeting() {
  const n = S.content?.settings?.name || 'you', h = new Date().getHours();
  if (h < 5) return `Hello, night owl`;
  return `${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}, ${n}`;
}
function renderHeader() {
  const st = S.content.settings || {};
  $('#greeting').textContent = greeting();
  $('#tagline').textContent = st.tagline || '';
  $('#welcomeTag').textContent = st.tagline || '';
  $('#welcomeIntro').textContent = (st.intro || '').replace('{count}', S.hearts.length);
}

function todaysHeart() {
  const pool = S.hearts.filter((h) => h.type !== 'media');
  return pool.length ? pool[hash(dateKey()) % pool.length] : null;
}
function todaysOccasion() {
  const md = dateKey().slice(5);
  return (S.content.occasions || []).find((o) => (o.dates || []).includes(md)) || null;
}
function renderPills() {
  const box = $('#pills'); box.replaceChildren();
  const fresh = S.hearts.filter(isNew);
  if (fresh.length) {
    const b = el('button', 'pill glow', `✨ ${fresh.length} new from your Bear`);
    b.onclick = () => { const h = fresh[Math.random() * fresh.length | 0]; Sound.unlock(); S.screen === 'jar' ? reveal(h) : openNote(h); };
    box.append(b);
  }
  const t = todaysHeart();
  if (t) {
    const done = store.get('todayOpened', '') === dateKey();
    const b = el('button', 'pill' + (done ? ' done' : ''), (done ? '✓ ' : '💌 ') + 'Today’s heart');
    b.onclick = () => { Sound.unlock(); store.set('todayOpened', dateKey()); S.screen === 'jar' ? reveal(t) : openNote(t); };
    box.append(b);
  }
  const o = todaysOccasion();
  if (o) {
    const b = el('button', 'pill', `${o.emoji || '🎉'} ${o.title}`);
    b.onclick = () => { Sound.unlock(); openNote({ id: 'occasion', synthetic: true, type: 'text', rarity: 'Gold', category: 'Occasion', heading: o.title, message: o.message }); };
    box.append(b);
  }
  $('#memDot').hidden = !S.hearts.some((h) => h.type === 'media' && isNew(h));
}

function renderMoods() {
  const box = $('#moods'); box.replaceChildren();
  for (const m of S.moods) {
    const b = el('button', 'mood'); b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(m.id === S.mood));
    b.append(el('span', '', m.emoji || ''), el('span', '', m.label));
    b.onclick = () => { S.mood = m.id; $$('.mood', box).forEach((x) => x.setAttribute('aria-checked', String(x === b))); updateHighlight(); Sound.unlock(); Sound.tick(); Haptics.tick(); b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); };
    box.append(b);
  }
}
const moodById = (id) => S.moods.find((m) => m.id === id) || S.moods[0] || { id: 'surprise' };
function matchesMood(h, m = moodById(S.mood)) {
  if (m.types && !m.types.includes(h.type)) return false;
  if (m.categories && !m.categories.includes(h.category)) return false;
  return true;
}
function updateHighlight() {
  const m = moodById(S.mood);
  if (!m.types && !m.categories) { jar.setHighlight(null); return; }
  let ids = S.hearts.filter((h) => matchesMood(h, m) && !S.read.has(h.id)).map((h) => h.id);
  if (!ids.length) ids = S.hearts.filter((h) => matchesMood(h, m)).map((h) => h.id);
  jar.setHighlight(new Set(ids));
}
function renderProgress() {
  $('#progress').textContent = `${S.read.size} of ${S.hearts.length} hearts opened`;
}

/* ---------- picking ---------- */
function refill() {
  S.read.clear(); store.set('read', []);
  for (const h of S.hearts) jar.setRead(h.id, false);
  toast('You’ve opened every heart! The jar’s been topped up ✨', 4200);
  renderProgress(); renderPills();
}
function pick(moodId = S.mood) {
  const m = moodById(moodId);
  let pool = S.hearts.filter((h) => matchesMood(h, m) && !S.read.has(h.id));
  if (!pool.length) {
    if (S.hearts.length && S.hearts.every((h) => S.read.has(h.id))) refill();
    pool = S.hearts.filter((h) => matchesMood(h, m));
    if (!pool.length) pool = S.hearts;
  }
  const fresh = pool.filter(isNew);
  if (fresh.length && Math.random() < 0.6) pool = fresh;
  return pool[Math.random() * pool.length | 0];
}

/* ---------- reveal: pop a heart out of the jar, then open its note ---------- */
async function reveal(h) {
  if (S.busy || S.noteOpen || S.welcomeOpen || !S.hearts.length) return;
  S.busy = true;
  h = h || pick();
  Sound.unlock();
  const from = jar.pop(h.id);
  Sound.rattle(1.4); Haptics.tick();
  await wait(reduced ? 0 : 640);
  S.busy = false;
  openNote(h, { from });
}

function linkify(parent, text) {
  const re = /(\+?\d[\d ]{8,}\d)/g; let last = 0, m;
  while ((m = re.exec(text))) {
    const digits = m[1].replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) continue;
    parent.append(text.slice(last, m.index));
    const a = el('a', '', m[1]); a.href = 'tel:' + m[1].replace(/\s/g, ''); parent.append(a); last = m.index + m[1].length;
  }
  parent.append(text.slice(last));
}

function buildMedia(h) {
  const box = $('#noteMedia'); box.replaceChildren(); $('.dots')?.remove();
  const media = h.media || [];
  if (!media.length) { box.hidden = true; return; }
  box.hidden = false;
  for (const m of media) {
    const s = el('div', 'slide');
    if (m.type === 'video') {
      const v = document.createElement('video');
      v.controls = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.preload = 'metadata';
      const note = el('div', 'mediaLoading', 'Loading video…'); s.append(v, note);
      if (m.poster) mediaURL(m.poster, 'image/jpeg').then((u) => { v.poster = u; }).catch(() => {});
      mediaURL(m.src, m.mime || 'video/mp4', false).then((u) => { liveUrls.push(u); v.src = u; note.remove(); }).catch(() => { note.textContent = 'Couldn’t load this video'; });
    } else {
      const i = document.createElement('img'); i.alt = h.heading || 'A memory'; i.decoding = 'async'; s.append(i); mediaURL(m.src, 'image/jpeg').then((u) => { i.src = u; }).catch(() => {});
    }
    box.append(s);
  }
  if (media.length > 1) {
    const dots = el('div', 'dots'); media.forEach((_, i) => dots.append(el('i', i === 0 ? 'on' : '')));
    box.after(dots);
    box.onscroll = () => { const i = Math.round(box.scrollLeft / box.clientWidth); [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i)); };
  }
}

function openNote(h, { from } = {}) {
  if (!h) return;
  if (S.noteOpen) closeNote(true);
  S.current = h; S.noteOpen = true;
  const note = $('#note'), ov = $('#overlay'), rar = RARITY[h.rarity] || RARITY.Pink;
  const wasNew = isNew(h);
  $('#noteHeading').textContent = h.heading || '';
  const msg = $('#noteMessage'); msg.replaceChildren(); linkify(msg, h.message || '');
  $('#noteRarity').replaceChildren(el('i'), document.createTextNode(h.synthetic ? 'A little occasion' : `${h.rarity} heart`));
  $('#noteNew').hidden = !wasNew;
  note.style.setProperty('--accent-note', rar.c);
  note.classList.toggle('platinum', h.rarity === 'Platinum'); note.classList.toggle('gold', h.rarity === 'Gold');
  buildMedia(h);
  setSaveState();
  $('#noteSave').hidden = !!h.synthetic;
  note.scrollTop = 0;

  const cx = innerWidth / 2, cy = innerHeight / 2;
  note.style.transition = 'none';
  note.style.setProperty('--fx', (from ? from.x - cx : 0) + 'px'); note.style.setProperty('--fy', (from ? from.y - cy : 40) + 'px');
  void note.offsetWidth; note.style.transition = '';
  ov.classList.add('show');
  jar?.pause();

  // celebrate
  const x = from?.x ?? cx, y = from?.y ?? cy;
  Sound.chime(h.rarity); Haptics.rarity(h.rarity);
  const n = { Pink: 10, Rose: 16, Ruby: 24, Gold: 40, Platinum: 70 }[h.rarity] || 10;
  fx.burst(x, y, rar.glow, n, h.rarity === 'Platinum' ? 1.5 : 1);
  if (h.rarity === 'Ruby' || h.rarity === 'Rose') fx.hearts(x, y, rar.glow, 8);
  if (h.rarity === 'Gold' || h.rarity === 'Platinum') setTimeout(() => fx.burst(cx, cy * 0.7, rar.glow, 34, 1.1), 260);
  setTimeout(() => $('#noteClose').focus({ preventScroll: true }), 650);

  if (S.byId.has(h.id)) markRead(h);
}

function markRead(h) {
  if (!S.read.has(h.id)) { S.read.add(h.id); store.set('read', [...S.read]); }
  jar.setRead(h.id, true); jar.setNew(h.id, false);
  renderProgress(); renderPills(); updateHighlight();
}

function closeNote(silent) {
  if (!S.noteOpen) return;
  S.noteOpen = false;
  $('#overlay').classList.remove('show');
  $$('#noteMedia video').forEach((v) => v.pause());
  setTimeout(() => liveUrls.splice(0).forEach((u) => URL.revokeObjectURL(u)), 400);
  S.current = null;
  if (S.screen === 'jar') jar?.resume();
  if (!silent) Haptics.tick();
}

function setSaveState() {
  const h = S.current, on = !!h && S.favs.has(h.id), b = $('#noteSave');
  b.setAttribute('aria-pressed', String(on)); b.innerHTML = `<span class="h">${on ? '♥' : '♡'}</span> ${on ? 'Kept' : 'Keep'}`;
}
function toggleFav() {
  const h = S.current; if (!h || h.synthetic) return;
  S.favs.has(h.id) ? S.favs.delete(h.id) : S.favs.add(h.id);
  store.set('favs', [...S.favs]); setSaveState(); renderSaved();
  if (S.favs.has(h.id)) { Sound.save(); Haptics.pattern(2, 60); const r = $('#noteSave').getBoundingClientRect(); fx.hearts(r.left + 30, r.top, '233,123,154', 8); }
}
function another() {
  const jarScreen = S.screen === 'jar';
  closeNote(true);
  if (jarScreen) setTimeout(() => { shakeJar(0.8); setTimeout(() => reveal(), 380); }, 260);
  else setTimeout(() => openNote(pick()), 200);
}

/* ---------- gallery & saved ---------- */
function renderMemories() {
  const grid = $('#memGrid'); grid.replaceChildren();
  const mems = S.hearts.filter((h) => h.type === 'media' && h.media?.length)
    .sort((a, b) => (b.added || '').localeCompare(a.added || '') || b.id.localeCompare(a.id));
  $('#memEmpty').hidden = mems.length > 0;
  for (const h of mems) {
    const b = el('button', 'tile'); b.style.setProperty('--rot', ((hash(h.id) % 50) / 10 - 2.5).toFixed(1) + 'deg');
    const ph = el('div', 'ph'), m = h.media[0];
    if (m.type === 'video') {
      if (m.poster) { const i = document.createElement('img'); i.alt = ''; ph.append(i); mediaURL(m.poster, 'image/jpeg').then((u) => { i.src = u; }).catch(() => {}); }
      const pl = el('div', 'play'); pl.append(el('i', '', '▶')); ph.append(pl);
    } else { const i = document.createElement('img'); i.alt = ''; ph.append(i); mediaURL(m.thumb || m.src, 'image/jpeg').then((u) => { i.src = u; }).catch(() => {}); }
    b.append(ph, el('div', 'cap', h.heading || h.message || ''));
    if (isNew(h)) b.append(el('span', 'badge', 'NEW'));
    b.onclick = () => { Sound.unlock(); openNote(h); };
    grid.append(b);
  }
}
function renderSaved() {
  const list = $('#savedList'); list.replaceChildren();
  const hs = [...S.favs].map((id) => S.byId.get(id)).filter(Boolean);
  $('#savedEmpty').hidden = hs.length > 0;
  $('#savedCount').textContent = hs.length ? `${hs.length} kept for the days you need them.` : '';
  for (const h of hs) {
    const b = el('button', 'keep'); b.style.setProperty('--c', (RARITY[h.rarity] || RARITY.Pink).c);
    b.append(el('b', '', h.heading || ''), el('span', '', h.message || ''));
    b.onclick = () => openNote(h); list.append(b);
  }
}

/* ---------- breathing ---------- */
let breathing = false, breathTimer;
function breathStep(i = 0) {
  if (!breathing) return;
  const steps = [['Breathe in…', 4000, 1.55], ['Hold…', 4000, 1.55], ['Breathe out…', 6000, 1]];
  const [txt, ms, scale] = steps[i % 3], b = $('#breath');
  $('#breathText').textContent = txt; b.style.setProperty('--dur', (i % 3 === 1 ? 0 : ms) / 1000 + 's'); b.style.transform = `scale(${scale})`;
  if (i % 3 === 0) Haptics.tick();
  breathTimer = setTimeout(() => breathStep(i + 1), ms);
}
function toggleBreath() {
  breathing = !breathing; const b = $('#breath');
  $('#breathBtn').textContent = breathing ? 'Stop' : 'Begin';
  clearTimeout(breathTimer);
  if (breathing) breathStep(0); else { b.style.setProperty('--dur', '1.2s'); b.style.transform = 'scale(1)'; $('#breathText').textContent = 'Well done'; }
}

/* ---------- tabs ---------- */
function showTab(name) {
  if (S.screen === name) { if (name !== 'jar') $(`#screen-${name}`).scrollTo?.({ top: 0, behavior: 'smooth' }); return; }
  S.screen = name; $('#app').dataset.screen = name;
  for (const sec of $$('.screen')) sec.hidden = sec.id !== `screen-${name}`;
  for (const b of $$('.tabbar button')) { if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  if (name === 'jar') { jar.resume(); } else jar.pause();
  if (name !== 'breathe' && breathing) toggleBreath();
  Sound.unlock(); Haptics.tick();
}

/* ---------- motion: tilt & shake ---------- */
const needsPermission = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
let lax = null, lay = 0, laz = 0, energy = 0, lastShake = 0, lastJostle = 0;
function onMotion(e) {
  const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
  if (!S.motionOn) { S.motionOn = true; $('#enableMotion').hidden = true; }
  if (lax === null) { lax = a.x; lay = a.y; laz = a.z; return; }
  const d = Math.abs(a.x - lax) + Math.abs(a.y - lay) + Math.abs(a.z - laz); lax = a.x; lay = a.y; laz = a.z;
  energy = energy * 0.82 + d;
  const now = performance.now();
  if (S.screen === 'jar' && !S.noteOpen && !S.welcomeOpen && d > 16 && now - lastJostle > 140) { lastJostle = now; jar.jostle(Math.min(d / 35, 1.1)); Sound.rattle(Math.min(d / 25, 1.5)); }
  if (energy > 95 && now - lastShake > 2200) { lastShake = now; energy = 0; onShake(); }
}
function onOrient(e) {
  if (e.gamma == null) return;
  if (!S.motionOn) { S.motionOn = true; $('#enableMotion').hidden = true; }
  const g = S.screen === 'jar' && !S.noteOpen ? e.gamma : 0;
  jar.setTilt(g); ambient.tilt(Math.sin((g || 0) * Math.PI / 180));
}
function onShake() {
  if (S.welcomeOpen || S.busy) return;
  if (S.noteOpen) { another(); return; }
  if (S.screen !== 'jar') return;
  shakeJar(1.3); setTimeout(() => reveal(), 520);
}
function shakeJar(k = 1) { jar.shake(k); Sound.rattle(2); Haptics.pattern(3, 55); }
async function enableMotion() {
  Sound.unlock();
  try {
    const reqs = [];
    if (needsPermission) reqs.push(DeviceMotionEvent.requestPermission());
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') reqs.push(DeviceOrientationEvent.requestPermission());
    const res = await Promise.all(reqs);
    if (res.length && !res.some((r) => r === 'granted')) { toast('Shake & tilt were turned off. You can still tap the jar 💗', 3800); return false; }
  } catch { return false; }
  $('#enableMotion').hidden = true; S.motionOn = true;
  toast('Shake & tilt are on 📳');
  return true;
}

/* ---------- welcome / about ---------- */
function showWelcome(first) {
  S.welcomeOpen = true;
  $('#installCoach').hidden = !(isIOS && !standalone);
  $('#welcomeGo').textContent = first ? 'Open the jar' : 'Back to the jar';
  $('#welcome').classList.add('show'); jar?.pause();
}
async function closeWelcome() {
  Sound.unlock();
  $('#welcome').classList.remove('show'); S.welcomeOpen = false;
  store.set('welcomed', true);
  if (needsPermission && !S.motionOn) await enableMotion();
  refreshMotionPill();
  if (S.screen === 'jar') jar.resume();
}
function refreshMotionPill() { $('#enableMotion').hidden = !(needsPermission && !S.motionOn && !S.welcomeOpen); }

/* ---------- init ---------- */
async function init() {
  $('#app').insertAdjacentHTML('afterbegin', '<div class="scrim"></div>');
  ambient = new Ambient($('#ambient'), reduced); fx = new Particles($('#fx'));
  const st = document.createElement('style'); st.textContent = '.scrim{position:fixed;top:0;left:0;right:0;height:var(--sat);background:#2f1b33;z-index:100;pointer-events:none}'; document.head.append(st);

  const first = !store.get('welcomed', false);
  jar = new Jar($('#jarCanvas'), {
    reducedMotion: reduced,
    onTap: (id) => { Sound.unlock(); if (S.busy || S.noteOpen || S.welcomeOpen) return; if (id) reveal(S.byId.get(id)); else { shakeJar(0.7); setTimeout(() => reveal(), 420); } },
    onStir: () => { Sound.rattle(0.7); },
    onReady: () => { Sound.clink(); Haptics.tick(); },
  });
  if (first) jar.pause();
  applyTheme(); applySound();
  mq.addEventListener?.('change', () => { if (!store.get('theme', null)) applyTheme(); });

  const un = await unlock();
  if (!un.content) {
    $('#greeting').textContent = 'The jar needs the internet once';
    $('#tagline').textContent = 'Open it while you’re online and it will work offline after that.';
    return;
  }
  S.key = un.key;
  applyContent(un.content);
  ambient.start();

  // wire up
  $('#btnTheme').onclick = () => { store.set('theme', theme() === 'night' ? 'day' : 'night'); applyTheme(); Haptics.tick(); };
  $('#btnSound').onclick = () => { store.set('sound', !Sound.enabled); applySound(); Sound.unlock(); Sound.tick(); };
  $('#btnAbout').onclick = () => showWelcome(false);
  $('#welcomeGo').onclick = closeWelcome;
  $('#openBtn').onclick = () => { Sound.unlock(); if (S.busy || S.noteOpen) return; shakeJar(0.9); setTimeout(() => reveal(), 480); };
  $('#enableMotion').onclick = enableMotion;
  $('#noteClose').onclick = () => closeNote();
  $('#noteSave').onclick = toggleFav;
  $('#noteAgain').onclick = another;
  $('#overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeNote(); });
  $('#breathBtn').onclick = toggleBreath;
  $('#gentleBtn').onclick = () => { Sound.unlock(); openNote(pick('reassure')); };
  $$('.tabbar button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (S.noteOpen) closeNote(); else if (S.welcomeOpen && store.get('welcomed', false)) closeWelcome(); }
    if (e.key === 's' && !e.metaKey && !e.ctrlKey && document.activeElement?.tagName !== 'INPUT') onShake();
  });

  addEventListener('devicemotion', onMotion); addEventListener('deviceorientation', onOrient);
  if (needsPermission) setTimeout(refreshMotionPill, 900);

  if (first) showWelcome(true);

  // occasions
  const occ = todaysOccasion();
  if (occ?.effect === 'snow') ambient.setSnow(true);
  if (occ?.effect === 'confetti' && store.get('confetti', '') !== dateKey()) { store.set('confetti', dateKey()); setTimeout(() => fx.confetti(), 1800); }

  // keep things fresh
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    $('#greeting').textContent = greeting(); renderPills();
    if (S.screen === 'jar' && !S.noteOpen && !S.welcomeOpen) jar.resume();
    const d = await loadContent(); if (!d) return;
    const sig = (c) => (c.hearts || []).map((h) => h.id + '|' + (h.message || '').length + '|' + (h.rarity || '')).join(',');
    if (sig(d) !== sig(S.content)) {
      const before = new Set(S.hearts.map((h) => h.id));
      applyContent(d);
      const added = S.hearts.filter((h) => !before.has(h.id)).length;
      if (added) toast(`✨ ${added} new ${added === 1 ? 'heart' : 'hearts'} from your Bear`, 4000);
    }
  });

  // service worker
  if ('serviceWorker' in navigator) {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then((r) => r.update()).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !S.noteOpen) location.reload(); });
  }
  window.__jar = { S, jar, reveal, openNote, onShake, pick, applyContent, showTab, enableMotion };
}
init();
