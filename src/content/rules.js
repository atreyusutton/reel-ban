// Everything here keys off href attributes or stable custom-element names.
// Generated class names churn weekly on all three sites and are never used.

// --- YouTube -----------------------------------------------------------

const YT_SHORTS_PATH = /^\/shorts\/([A-Za-z0-9_-]{5,})/;

export function youtubeTarget(url, cfg) {
  const m = url.pathname.match(YT_SHORTS_PATH);
  if (!m) return null;
  if (cfg.mode === 'home') return `${url.origin}/`;
  const t = url.searchParams.get('t');
  const base = `${url.origin}/watch?v=${m[1]}`;
  return t ? `${base}&t=${encodeURIComponent(t)}` : base;
}

export const YT_CSS = `
/* Sidebar entries (full and mini rails) */
ytd-guide-entry-renderer:has(a[href="/shorts"]),
ytd-mini-guide-entry-renderer:has(a[href="/shorts"]),

/* Shorts shelves: home, subscriptions, search results */
ytd-rich-shelf-renderer[is-shorts],
ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
ytd-reel-shelf-renderer,
ytd-item-section-renderer:has(> #contents > ytd-reel-shelf-renderer),
ytd-shelf-renderer:has(ytd-reel-shelf-renderer),
grid-shelf-view-model:has(a[href^="/shorts/"]),

/* Individual Shorts cards wherever they are recommended */
ytd-rich-item-renderer:has(a[href^="/shorts/"]),
ytd-video-renderer:has(a[href^="/shorts/"]),
ytd-compact-video-renderer:has(a[href^="/shorts/"]),
ytd-grid-video-renderer:has(a[href^="/shorts/"]),
ytd-playlist-video-renderer:has(a[href^="/shorts/"]),
yt-lockup-view-model:has(a[href^="/shorts/"]),

/* Channel page "Shorts" tab */
tp-yt-paper-tab:has(a[href$="/shorts"]),
yt-tab-group-shape yt-tab-shape:has(a[href$="/shorts"]) {
  display: none !important;
}
`;

// --- Facebook ----------------------------------------------------------

// Anchored at the start of the path on purpose: /<page>/reels is a page's own
// video tab, and bouncing that would break ordinary browsing.
const FB_REEL_PATH = /^\/reels?(\/|$)/;

export function facebookTarget(url) {
  return FB_REEL_PATH.test(url.pathname) ? `${url.origin}/` : null;
}

// Deliberately narrow. An over-broad :has() here blanks out chunks of the
// feed, so these two rule sets are separately switchable and both under-hide
// rather than over-hide.
export const FB_NAV_CSS = `
div[role="navigation"] a[href^="/reel/"],
div[role="navigation"] a[href^="/reels/"],
div[role="navigation"] li:has(> div > a[href^="/reels/"]),
div[role="navigation"] li:has(> div > a[href^="/reel/"]) {
  display: none !important;
}
`;

export const FB_TRAY_CSS = `
div[role="main"] div[role="article"]:has(a[href^="/reel/"]) {
  display: none !important;
}
`;
