import { b64, importAes, tryUnlock, openVault, sealVault, encryptBytes, decryptBytes, randName } from './vault.js';
/* Jar admin: edits content.json and uploads media straight to the GitHub repo via the API.
   Nothing here runs on Niamh's side. The token lives only in this browser's localStorage. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const KEY = 'jaradmin.cfg', KEYK = 'jaradmin.key';
  const RARITIES = ['Pink', 'Rose', 'Ruby', 'Gold', 'Platinum'];
  const RCOL = { Pink: '#f6b8c7', Rose: '#e97b9a', Ruby: '#b94261', Gold: '#e8bd58', Platinum: '#d8e3ea' };
  let cfg = null, content = null, baseJSON = '', sha = null, files = [], aes = null, vhead = null, vault = null;

  const today = () => new Date().toISOString().slice(0, 10);
  const el = (t, props = {}, ...kids) => { const e = Object.assign(document.createElement(t), props); kids.flat().forEach((k) => e.append(k)); return e; };
  const log = (msg, cls) => { const l = $('#log'); l.hidden = false; l.append(document.createTextNode(msg + '\n')); l.scrollTop = 1e9; if (cls) console[cls](msg); };
  const loadCfg = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };

  /* ---------- GitHub API ---------- */
  async function gh(method, path, body) {
    const r = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/${path}`, {
      method,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${cfg.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch {}
    if (!r.ok) { const e = new Error(`${r.status} ${data?.message || text.slice(0, 160)}`); e.status = r.status; throw e; }
    return data;
  }
  const utf8ToB64 = (s) => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(bin); };
  const b64ToUtf8 = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
  const blobToB64 = (blob) => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1]); f.onerror = rej; f.readAsDataURL(blob); });

  async function fetchContent() {
    const f = await gh('GET', `contents/vault.json?ref=${encodeURIComponent(cfg.branch)}`);
    sha = f.sha; vault = JSON.parse(b64ToUtf8(f.content)); vhead = { salt: vault.salt, iter: vault.iter };
    if (!aes) { const stored = localStorage.getItem(KEYK); if (stored) { try { aes = await importAes(b64.from(stored)); } catch {} } }
    if (aes) { try { content = await openVault(vault, aes); } catch { aes = null; localStorage.removeItem(KEYK); } }
    if (!aes) throw Object.assign(new Error('LOCKED'), { locked: true });
    baseJSON = JSON.stringify(content);
  }
  async function putContent(message) {
    content.updated = today();
    const sealed = await sealVault(content, aes, vhead);
    const body = { message, branch: cfg.branch, content: utf8ToB64(JSON.stringify(sealed)), sha };
    let r;
    try { r = await gh('PUT', 'contents/vault.json', body); }
    catch (e) {
      if (e.status === 409 || e.status === 422) { const f = await gh('GET', `contents/vault.json?ref=${encodeURIComponent(cfg.branch)}`); body.sha = f.sha; r = await gh('PUT', 'contents/vault.json', body); }
      else throw e;
    }
    sha = r.content.sha; baseJSON = JSON.stringify(content); markDirty();
  }
  async function adminBlob(path) {
    const r = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`, { headers: { Accept: 'application/vnd.github.raw+json', Authorization: `Bearer ${cfg.token}` } });
    if (!r.ok) throw new Error(r.status);
    return URL.createObjectURL(new Blob([await decryptBytes(aes, await r.arrayBuffer())], { type: 'image/jpeg' }));
  }
  async function putFile(path, b64, message) {
    return gh('PUT', `contents/${path}`, { message, branch: cfg.branch, content: b64 });
  }

  /* ---------- connect ---------- */
  function prefill() {
    const m = location.hostname.match(/^(.+)\.github\.io$/);
    if (m) { $('#owner').value = m[1]; const p = location.pathname.split('/').filter(Boolean)[0]; if (p && !p.endsWith('.html')) $('#repo').value = p; else $('#repo').value = `${m[1]}.github.io`; }
    const c = loadCfg(); if (c) { $('#owner').value = c.owner; $('#repo').value = c.repo; $('#branch').value = c.branch; $('#token').value = c.token; }
  }
  async function connect() {
    cfg = { owner: $('#owner').value.trim(), repo: $('#repo').value.trim(), branch: $('#branch').value.trim() || 'main', token: $('#token').value.trim() };
    const msg = $('#connMsg'); msg.textContent = 'Connecting…'; msg.className = '';
    try {
      await fetchContent();
      localStorage.setItem(KEY, JSON.stringify(cfg));
      msg.textContent = ''; show();
    } catch (e) {
      if (e.locked) { localStorage.setItem(KEY, JSON.stringify(cfg)); msg.textContent = ''; $('#connect').hidden = true; $('#unlock').hidden = false; return; }
      msg.className = 'err';
      msg.textContent = e.status === 404 ? 'Couldn’t find vault.json. Check the username, repo name and branch, and that the token has access to that repo.' : e.status === 401 ? 'GitHub rejected the token.' : e.message;
    }
  }
  function show() {
    $('#connect').hidden = true; $('#unlock').hidden = true; $('#app').hidden = false; $('#chip').textContent = `${cfg.owner}/${cfg.repo}`;
    $('#sName').value = content.settings?.name || ''; $('#sTag').value = content.settings?.tagline || ''; $('#sIntro').value = content.settings?.intro || '';
    renderOcc(); renderList(); refreshCats();
  }

  /* ---------- tabs & dirty state ---------- */
  document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    ['memories', 'hearts', 'settings'].forEach((t) => ($(`#t-${t}`).hidden = t !== b.dataset.t));
  }));
  function markDirty() {
    const dirty = JSON.stringify(content) !== baseJSON;
    $('#savebar').classList.toggle('show', dirty);
  }
  $('#btnDiscard').onclick = () => { content = JSON.parse(baseJSON); show(); markDirty(); };
  $('#btnSave').onclick = async () => {
    const b = $('#btnSave'); b.disabled = true; b.textContent = 'Publishing…';
    try { await putContent('Update hearts'); $('#saveTxt').textContent = 'Published ✓'; setTimeout(() => ($('#saveTxt').textContent = 'Unsaved changes'), 2500); }
    catch (e) { alert('Couldn’t publish: ' + e.message); }
    b.disabled = false; b.textContent = 'Publish'; renderList();
  };

  /* ---------- memories: add ---------- */
  const fileInput = $('#files');
  fileInput.onchange = () => { files = files.concat([...fileInput.files]); fileInput.value = ''; renderPreviews(); };
  function renderPreviews() {
    const box = $('#previews'); box.replaceChildren();
    files.forEach((f, i) => {
      const url = URL.createObjectURL(f), isV = f.type.startsWith('video');
      const m = isV ? el('video', { src: url + '#t=0.1', muted: true, playsInline: true, preload: 'metadata' }) : el('img', { src: url });
      box.append(el('div', { className: 'pv' }, m, el('b', { textContent: '✕', onclick: () => { files.splice(i, 1); renderPreviews(); } }), el('i', { textContent: isV ? `video · ${(f.size / 1048576).toFixed(1)}MB` : 'photo' })));
    });
  }

  async function shrinkImage(file, max, q) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight, k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob(res, 'image/jpeg', q));
  }
  async function videoPoster(file) {
    return new Promise((res) => {
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = URL.createObjectURL(file);
      const done = (b) => { URL.revokeObjectURL(v.src); res(b); }; const t = setTimeout(() => done(null), 7000);
      v.onerror = () => { clearTimeout(t); done(null); };
      v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 3); };
      v.onseeked = () => {
        clearTimeout(t); const k = Math.min(1, 900 / Math.max(v.videoWidth, v.videoHeight, 1));
        const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * k) || 600; c.height = Math.round(v.videoHeight * k) || 600;
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); c.toBlob((b) => done(b), 'image/jpeg', 0.8);
      };
    });
  }
  const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6);

  $('#btnAdd').onclick = async () => {
    if (!files.length) { alert('Pick at least one photo or video first.'); return; }
    const btn = $('#btnAdd'); btn.disabled = true; $('#log').textContent = '';
    try {
      const encBlob = async (blob) => b64.to(await encryptBytes(aes, new Uint8Array(await blob.arrayBuffer())));
      const media = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i]; log(`(${i + 1}/${files.length}) ${f.name}`);
        if (f.type.startsWith('video')) {
          if (f.size > 60 * 1048576) throw new Error(`${f.name} is over 60MB. GitHub can’t take it. Trim or compress it first.`);
          log('  making a cover image…'); const poster = await videoPoster(f); let posterPath;
          if (poster) { posterPath = `media/${randName()}.bin`; await putFile(posterPath, await encBlob(poster), 'Add file'); }
          log('  locking & uploading video…'); const vp = `media/${randName()}.bin`; await putFile(vp, await encBlob(f), 'Add file');
          media.push({ type: 'video', src: vp, mime: f.type || 'video/mp4', ...(posterPath ? { poster: posterPath } : {}) });
        } else {
          log('  shrinking photo…'); const full = await shrinkImage(f, 1800, 0.85), thumb = await shrinkImage(f, 560, 0.8);
          log(`  locking & uploading (${(full.size / 1024).toFixed(0)}KB)…`);
          const p1 = `media/${randName()}.bin`, p2 = `media/${randName()}.bin`;
          await putFile(p1, await encBlob(full), 'Add file'); await putFile(p2, await encBlob(thumb), 'Add file');
          media.push({ type: 'image', src: p1, thumb: p2 });
        }
      }
      const n = 1 + Math.max(0, ...content.hearts.filter((h) => /^M-\d+$/.test(h.id)).map((h) => +h.id.slice(2)));
      const heart = {
        id: 'M-' + String(n).padStart(3, '0'), type: 'media', rarity: $('#mRar').value, category: $('#mCat').value.trim() || 'Memories',
        heading: $('#mHead').value.trim() || 'A little memory', message: $('#mMsg').value.trim(), ...($('#mNew').checked ? { added: today() } : {}), media,
      };
      content.hearts.push(heart); log('Publishing to the jar…'); await putContent('Add memory ' + heart.id);
      log('✓ Done! It can take a minute or so for GitHub to publish. Next time she opens the jar it will glow as new.');
      files = []; renderPreviews(); $('#mMsg').value = ''; renderList(); refreshCats();
    } catch (e) { log('✗ ' + e.message, 'error'); alert('Something went wrong: ' + e.message); }
    btn.disabled = false;
  };

  /* ---------- hearts editor ---------- */
  function refreshCats() {
    const cats = [...new Set(content.hearts.map((h) => h.category).filter(Boolean))].sort();
    $('#cats').replaceChildren(...cats.map((c) => el('option', { value: c })));
  }
  function renderList() {
    const q = $('#q').value.toLowerCase(), f = $('#filter').value, box = $('#list'); box.replaceChildren();
    const orig = JSON.parse(baseJSON || '{"hearts":[]}').hearts, om = new Map(orig.map((h) => [h.id, JSON.stringify(h)]));
    const hs = content.hearts.map((h, i) => [h, i]).filter(([h]) => (f === 'all' || (f === 'media') === (h.type === 'media')) && (!q || `${h.heading} ${h.message} ${h.category} ${h.id}`.toLowerCase().includes(q)));
    $('#count').textContent = `${hs.length} of ${content.hearts.length}`;
    for (const [h] of hs.slice().reverse()) {
      const card = el('div', { className: 'card heart' }); card.style.setProperty('--c', RCOL[h.rarity] || '#ccc');
      if (om.get(h.id) !== JSON.stringify(h)) card.classList.add('changed');
      const upd = (k, v) => { if (v === '' && k === 'added') delete h[k]; else h[k] = v; markDirty(); card.classList.toggle('changed', om.get(h.id) !== JSON.stringify(h)); };
      const head = el('input', { value: h.heading || '', oninput: (e) => upd('heading', e.target.value) });
      const msg = el('textarea', { value: h.message || '', oninput: (e) => upd('message', e.target.value) });
      const rar = el('select', { onchange: (e) => { upd('rarity', e.target.value); card.style.setProperty('--c', RCOL[e.target.value]); } }, RARITIES.map((r) => el('option', { value: r, textContent: r, selected: r === h.rarity })));
      const cat = el('input', { value: h.category || '', oninput: (e) => upd('category', e.target.value) }); cat.setAttribute('list', 'cats');
      const isNew = el('input', { type: 'checkbox', checked: !!h.added && (Date.now() - new Date(h.added)) / 864e5 <= 30, onchange: (e) => upd('added', e.target.checked ? today() : '') });
      const del = el('button', { className: 'danger', textContent: 'Delete', onclick: () => { if (confirm('Delete this heart?')) { content.hearts.splice(content.hearts.indexOf(h), 1); markDirty(); renderList(); } } });
      card.append(
        el('div', { className: 'top' }, el('span', { className: 'id', textContent: `${h.id} · ${h.type === 'media' ? '📸 memory' : 'message'}` }), del),
        el('label', { textContent: 'Heading' }), head,
        ...(h.media?.length ? [el('div', { className: 'thumbs' }, h.media.map((m) => { const i = el('img', { alt: '' }); const p = m.thumb || m.poster || (m.type === 'image' ? m.src : null); if (p) adminBlob(p).then((u) => { i.src = u; }).catch(() => {}); return i; }))] : []),
        el('label', { textContent: 'Message' }), msg,
        el('div', { className: 'row' }, el('div', {}, el('label', { textContent: 'Colour' }), rar), el('div', {}, el('label', { textContent: 'Category' }), cat)),
        el('label', {}, isNew, ' Mark as new (glows in the jar for a few weeks)'),
      );
      box.append(card);
    }
  }
  $('#q').oninput = renderList; $('#filter').onchange = renderList;
  $('#btnNew').onclick = () => {
    const n = 1 + Math.max(0, ...content.hearts.filter((h) => /^HJ-\d+$/.test(h.id)).map((h) => +h.id.slice(3)));
    content.hearts.push({ id: 'HJ-' + String(n).padStart(3, '0'), type: 'text', rarity: 'Pink', category: 'Reminder', heading: 'Tiny reminder', message: '', added: today() });
    markDirty(); $('#q').value = ''; $('#filter').value = 'all'; renderList(); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /* ---------- settings ---------- */
  for (const [id, k] of [['#sName', 'name'], ['#sTag', 'tagline'], ['#sIntro', 'intro']]) $(id).oninput = (e) => { content.settings = content.settings || {}; content.settings[k] = e.target.value; markDirty(); };
  function renderOcc() {
    const box = $('#occList'); box.replaceChildren(); content.occasions = content.occasions || [];
    content.occasions.forEach((o, i) => {
      const set = (k, v) => { o[k] = v; markDirty(); };
      box.append(el('div', { className: 'card', style: 'background:#fcf6f4' },
        el('div', { className: 'row' },
          el('div', {}, el('label', { textContent: 'Dates (MM-DD, …)' }), el('input', { value: (o.dates || []).join(', '), oninput: (e) => set('dates', e.target.value.split(',').map((s) => s.trim()).filter(Boolean)) })),
          el('div', {}, el('label', { textContent: 'Emoji' }), el('input', { value: o.emoji || '', oninput: (e) => set('emoji', e.target.value) }))),
        el('label', { textContent: 'Title' }), el('input', { value: o.title || '', oninput: (e) => set('title', e.target.value) }),
        el('label', { textContent: 'Message' }), el('textarea', { value: o.message || '', oninput: (e) => set('message', e.target.value) }),
        el('label', { textContent: 'Effect' }), el('select', { onchange: (e) => set('effect', e.target.value) }, ['', 'snow', 'confetti'].map((v) => el('option', { value: v, textContent: v || 'none', selected: (o.effect || '') === v }))),
        el('p', {}, el('button', { className: 'danger', textContent: 'Remove', onclick: () => { content.occasions.splice(i, 1); markDirty(); renderOcc(); } }))));
    });
  }
  $('#btnOcc').onclick = () => { content.occasions.push({ dates: [], emoji: '🎉', title: '', message: '', effect: '' }); markDirty(); renderOcc(); };
  $('#btnBackup').onclick = () => { const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(content, null, 1)], { type: 'application/json' })), download: `jar-content-${today()}.json` }); a.click(); };
  $('#btnDisc').onclick = () => { if (confirm('Remove the saved token from this browser?')) { localStorage.removeItem(KEY); localStorage.removeItem(KEYK); location.reload(); } };

  /* ---------- go ---------- */
  $('#btnConnect').onclick = connect;
  $('#btnUnlock').onclick = async () => {
    const m = $('#unlockMsg'); m.className = 'muted'; m.textContent = 'Checking…'; await new Promise((r) => setTimeout(r, 30));
    const res = await tryUnlock(vault, '', $('#uCode').value);
    if (!res) { m.className = 'err'; m.textContent = 'That code doesn’t match the vault. Check it and try again.'; return; }
    aes = res.key; content = res.content; baseJSON = JSON.stringify(content); localStorage.setItem(KEYK, b64.to(res.raw)); m.textContent = ''; show();
  };
  prefill();
  if (loadCfg()) connect();
})();
