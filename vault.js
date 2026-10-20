/* The vault: everything private (messages, photos, videos) is encrypted with AES-256-GCM.
   The key comes from PBKDF2 over a long random setup code (~100 bits), so the public files
   can't be brute-forced. No DOM in here, so it works in the app, the admin page and Node. */

const enc = new TextEncoder(), dec = new TextDecoder();
export const ITER = 600000;

export const b64 = {
  to(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); },
  from(str) { const s = atob(str.replace(/\s/g, '')); const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; },
};

export const normPassword = (p) => String(p || '').trim().toLowerCase();
export const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// 32 raw key bytes
export async function deriveRaw(password, code, salt, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(normPassword(password) + '\u0000' + normCode(code)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, 256));
}
export const importAes = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

export async function encryptBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
}
export async function decryptBytes(key, buf) {
  const u = new Uint8Array(buf);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, key, u.slice(12)));
}

/* vault.json = { v, salt, iter, data } where data = base64(iv + AES-GCM(JSON of the content)) */
export async function openVault(vault, key) {
  return JSON.parse(dec.decode(await decryptBytes(key, b64.from(vault.data))));
}
export async function sealVault(content, key, head) {
  const data = b64.to(await encryptBytes(key, enc.encode(JSON.stringify(content))));
  return { v: 1, salt: head.salt, iter: head.iter, data };
}
export async function createVault(content, password, code) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const raw = await deriveRaw(password, code, salt, ITER);
  const key = await importAes(raw);
  return { vault: await sealVault(content, key, { salt: b64.to(salt), iter: ITER }), raw };
}
// Try a password + code against a vault. Returns { content, raw, key } or null.
export async function tryUnlock(vault, password, code) {
  try {
    const raw = await deriveRaw(password, code, b64.from(vault.salt), vault.iter);
    const key = await importAes(raw);
    return { content: await openVault(vault, key), raw, key };
  } catch { return null; }
}

export function makeCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; const r = crypto.getRandomValues(new Uint8Array(20));
  const s = [...r].map((x) => A[x % A.length]).join('');
  return s.match(/.{4}/g).join('-');
}
export const randName = () => [...crypto.getRandomValues(new Uint8Array(12))].map((x) => x.toString(16).padStart(2, '0')).join('');
