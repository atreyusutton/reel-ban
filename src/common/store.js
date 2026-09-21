import { api } from './api.js';

export const KEYS = {
  setup: 'setupComplete',
  auth: 'auth',
  attempts: 'attempts',
  gate: 'gate',
  config: 'config',
  fixed: 'fixed',
};

// Editable after setup, behind the PIN + challenge + cooldown gate.
export const DEFAULT_CONFIG = {
  youtube: {
    enabled: true,
    mode: 'redirect', // 'redirect' -> /watch?v=<id>, 'home' -> youtube.com
    hideEntryPoints: true,
  },
  facebook: {
    enabled: true,
    hideNav: true,
    hideFeedTray: true, // the more aggressive of the two; separate switch on purpose
  },
};

// Chosen once during setup and immutable afterwards.
export const DEFAULT_FIXED = {
  cooldownMinutes: 30,
  challenge: 'I agreed to wait, and the urge to watch this will pass before the timer does.',
};

export function get(keys) {
  return api.storage.local.get(keys);
}

export function set(obj) {
  return api.storage.local.set(obj);
}

// Storage may hold a config written by an older build, so fill gaps rather
// than trusting the shape.
export function mergeConfig(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  return {
    youtube: { ...DEFAULT_CONFIG.youtube, ...(s.youtube || {}) },
    facebook: { ...DEFAULT_CONFIG.facebook, ...(s.facebook || {}) },
  };
}

export function mergeFixed(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const minutes = Number(s.cooldownMinutes);
  return {
    cooldownMinutes: Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_FIXED.cooldownMinutes,
    challenge: typeof s.challenge === 'string' && s.challenge.trim() ? s.challenge : DEFAULT_FIXED.challenge,
  };
}

export async function getConfig() {
  const r = await get(KEYS.config);
  return mergeConfig(r[KEYS.config]);
}

export async function getFixed() {
  const r = await get(KEYS.fixed);
  return mergeFixed(r[KEYS.fixed]);
}

export async function isSetUp() {
  const r = await get([KEYS.setup, KEYS.auth]);
  return Boolean(r[KEYS.setup] && r[KEYS.auth] && r[KEYS.auth].hash);
}
