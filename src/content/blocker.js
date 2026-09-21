import { KEYS, mergeConfig, DEFAULT_CONFIG, get } from '../common/store.js';
import { api } from '../common/api.js';
import { youtubeTarget, facebookTarget, YT_CSS, FB_NAV_CSS, FB_TRAY_CSS } from './rules.js';

// This runs at document_start on sites used every day. Nothing below is
// allowed to throw into the page, so every entry point is wrapped.

const STYLE_ID = 'reel-ban-style';
const POLL_MS = 400;
const NAV_GUARD_MS = 2000;

const site = detectSite(location.hostname);
if (site) start();

function detectSite(hostname) {
  if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) return 'youtube';
  if (hostname === 'facebook.com' || hostname.endsWith('.facebook.com')) return 'facebook';
  return null;
}

function start() {
  let config = DEFAULT_CONFIG;
  let lastHref = location.href;
  let lastTarget = '';
  let lastTargetAt = 0;

  // Paint-blocking work first, with defaults: waiting for storage would let a
  // Shorts shelf render. Corrected a few milliseconds later if the real config
  // differs.
  applyStyles(config);

  get(KEYS.config)
    .then((r) => {
      config = mergeConfig(r[KEYS.config]);
      applyStyles(config);
      check();
    })
    .catch(() => {
      // Storage unavailable (extension updating, profile locked): keep the
      // defaults already applied rather than unblocking.
      check();
    });

  try {
    api.storage.onChanged.addListener((changes, area) => {
      try {
        if (area !== 'local' || !changes[KEYS.config]) return;
        config = mergeConfig(changes[KEYS.config].newValue);
        applyStyles(config);
        check();
      } catch (_) { /* never surface into the page */ }
    });
  } catch (_) { /* onChanged missing: polling still covers navigation */ }

  hookHistory(check);
  addEventListener('popstate', check, true);
  addEventListener('yt-navigate-finish', check, true);
  setInterval(() => {
    if (location.href !== lastHref) check();
  }, POLL_MS);

  check();

  function check() {
    try {
      lastHref = location.href;
      const url = new URL(location.href);
      const target = site === 'youtube'
        ? (config.youtube.enabled ? youtubeTarget(url, config.youtube) : null)
        : (config.facebook.enabled ? facebookTarget(url) : null);
      if (!target || target === location.href) return;

      // Guard against a redirect loop if a site ever routes the target back.
      const now = Date.now();
      if (target === lastTarget && now - lastTargetAt < NAV_GUARD_MS) return;
      lastTarget = target;
      lastTargetAt = now;

      location.replace(target);
    } catch (_) { /* never surface into the page */ }
  }
}

function hookHistory(onChange) {
  try {
    for (const name of ['pushState', 'replaceState']) {
      const original = history[name];
      if (typeof original !== 'function') continue;
      history[name] = function patched(...args) {
        const result = original.apply(this, args);
        try { onChange(); } catch (_) { /* ignore */ }
        return result;
      };
    }
  } catch (_) { /* leave history untouched if the site froze it */ }
}

function applyStyles(config) {
  try {
    const parts = [];
    if (config.youtube.enabled && config.youtube.hideEntryPoints && site === 'youtube') parts.push(YT_CSS);
    if (site === 'facebook' && config.facebook.enabled) {
      if (config.facebook.hideNav) parts.push(FB_NAV_CSS);
      if (config.facebook.hideFeedTray) parts.push(FB_TRAY_CSS);
    }

    const root = document.head || document.documentElement;
    if (!root) return;

    let el = document.getElementById(STYLE_ID);
    if (!parts.length) {
      if (el) el.textContent = '';
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
    }
    el.textContent = parts.join('\n');
    if (el.parentNode !== root) root.appendChild(el);
  } catch (_) { /* never surface into the page */ }
}
