// PBKDF2 over a 4-digit PIN. The iteration count is doing real work here:
// it is what makes each of the 10,000 candidates cost ~half a second even
// before the lockout schedule in gate.js applies.
export const ITERATIONS = 600000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

export function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function toHex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function derive(pin, salt, iterations) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function createAuth(pin) {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(pin, salt, ITERATIONS);
  return { v: 1, salt: toHex(salt), hash: toHex(hash), iterations: ITERATIONS };
}

export async function verifyPin(pin, auth) {
  if (!auth || typeof auth.salt !== 'string' || typeof auth.hash !== 'string') return false;
  const iterations = Number(auth.iterations) || ITERATIONS;
  const hash = await derive(pin, fromHex(auth.salt), iterations);
  return equalConstantTime(toHex(hash), auth.hash);
}

function equalConstantTime(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isValidPin(pin) {
  return typeof pin === 'string' && /^[0-9]{4}$/.test(pin);
}
