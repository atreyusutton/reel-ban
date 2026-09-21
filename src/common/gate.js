import { get, set, KEYS, mergeFixed } from './store.js';
import { verifyPin, isValidPin } from './crypto.js';

export const PHASE = {
  LOCKED: 'locked',       // PIN required
  CHALLENGE: 'challenge', // PIN accepted, sentence required
  COOLDOWN: 'cooldown',   // sentence accepted, waiting out the timer
  UNLOCKED: 'unlocked',   // settings editable
};

// Applied after the Nth consecutive wrong PIN. The last entry is the cap.
export const BACKOFF_MS = [
  5 * 1000,
  15 * 1000,
  60 * 1000,
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
];

export const IDLE_RELOCK_MS = 10 * 60 * 1000;
const ACTIVITY_WRITE_THROTTLE_MS = 15 * 1000;

const EMPTY_GATE = { phase: PHASE.LOCKED, cooldownEndsAt: 0, cooldownStartedAt: 0, lastActivityAt: 0 };
const EMPTY_ATTEMPTS = { fails: 0, lockedUntil: 0 };

function normaliseGate(g) {
  const s = g && typeof g === 'object' ? g : {};
  return {
    phase: Object.values(PHASE).includes(s.phase) ? s.phase : PHASE.LOCKED,
    cooldownEndsAt: Number(s.cooldownEndsAt) || 0,
    cooldownStartedAt: Number(s.cooldownStartedAt) || 0,
    lastActivityAt: Number(s.lastActivityAt) || 0,
  };
}

function normaliseAttempts(a) {
  const s = a && typeof a === 'object' ? a : {};
  return {
    fails: Math.max(0, Number(s.fails) || 0),
    lockedUntil: Number(s.lockedUntil) || 0,
  };
}

function backoffFor(fails) {
  return BACKOFF_MS[Math.min(fails, BACKOFF_MS.length) - 1];
}

// Resolves the stored gate against the wall clock. Every timestamp is absolute,
// so quitting the browser mid-cooldown does not pause or skip the wait.
export async function readGate(now = Date.now()) {
  const r = await get([KEYS.gate, KEYS.attempts, KEYS.fixed]);
  const fixed = mergeFixed(r[KEYS.fixed]);
  const attempts = normaliseAttempts(r[KEYS.attempts]);
  let gate = normaliseGate(r[KEYS.gate]);
  let dirty = false;

  if (gate.phase === PHASE.COOLDOWN && now >= gate.cooldownEndsAt) {
    gate = { ...gate, phase: PHASE.UNLOCKED, lastActivityAt: now };
    dirty = true;
  } else if (gate.phase === PHASE.UNLOCKED && now - gate.lastActivityAt > IDLE_RELOCK_MS) {
    gate = { ...EMPTY_GATE };
    dirty = true;
  }

  if (dirty) await set({ [KEYS.gate]: gate });

  return {
    phase: gate.phase,
    cooldownEndsAt: gate.cooldownEndsAt,
    cooldownStartedAt: gate.cooldownStartedAt,
    relocksAt: gate.phase === PHASE.UNLOCKED ? gate.lastActivityAt + IDLE_RELOCK_MS : 0,
    lockedUntil: attempts.lockedUntil,
    fails: attempts.fails,
    fixed,
  };
}

// Returns { ok } or { ok: false, reason, lockedUntil }.
export async function submitPin(pin, now = Date.now()) {
  const r = await get([KEYS.attempts, KEYS.auth]);
  const attempts = normaliseAttempts(r[KEYS.attempts]);
  const auth = r[KEYS.auth];

  if (attempts.lockedUntil > now) {
    return { ok: false, reason: 'locked-out', lockedUntil: attempts.lockedUntil };
  }
  if (!isValidPin(pin)) {
    // Not a real attempt; no penalty, no derivation.
    return { ok: false, reason: 'malformed', lockedUntil: 0 };
  }

  const ok = await verifyPin(pin, auth);

  if (!ok) {
    const fails = attempts.fails + 1;
    const lockedUntil = now + backoffFor(fails);
    await set({ [KEYS.attempts]: { fails, lockedUntil } });
    return { ok: false, reason: 'wrong', lockedUntil };
  }

  await set({
    [KEYS.attempts]: { ...EMPTY_ATTEMPTS },
    [KEYS.gate]: { ...EMPTY_GATE, phase: PHASE.CHALLENGE },
  });
  return { ok: true };
}

// The typing challenge sits between the PIN and the countdown: correct PIN
// alone never starts the clock.
export async function submitChallenge(text, now = Date.now()) {
  const r = await get([KEYS.gate, KEYS.fixed]);
  const gate = normaliseGate(r[KEYS.gate]);
  const fixed = mergeFixed(r[KEYS.fixed]);

  if (gate.phase !== PHASE.CHALLENGE) return { ok: false, reason: 'wrong-phase' };
  if (text !== fixed.challenge) return { ok: false, reason: 'mismatch' };

  const cooldownMs = fixed.cooldownMinutes * 60 * 1000;
  const next = {
    ...EMPTY_GATE,
    phase: cooldownMs > 0 ? PHASE.COOLDOWN : PHASE.UNLOCKED,
    cooldownStartedAt: now,
    cooldownEndsAt: now + cooldownMs,
    lastActivityAt: now,
  };
  await set({ [KEYS.gate]: next });
  return { ok: true, phase: next.phase, cooldownEndsAt: next.cooldownEndsAt };
}

export async function relock() {
  await set({ [KEYS.gate]: { ...EMPTY_GATE } });
}

let lastActivityWrite = 0;

export async function touchActivity(now = Date.now()) {
  if (now - lastActivityWrite < ACTIVITY_WRITE_THROTTLE_MS) return;
  const r = await get(KEYS.gate);
  const gate = normaliseGate(r[KEYS.gate]);
  if (gate.phase !== PHASE.UNLOCKED) return;
  lastActivityWrite = now;
  await set({ [KEYS.gate]: { ...gate, lastActivityAt: now } });
}

export function formatDuration(ms) {
  if (ms <= 0) return '0s';
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
