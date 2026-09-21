// Firefox exposes `browser` (promise-based); Chrome exposes `chrome`.
// Chrome MV3 returns promises from chrome.storage too, so one namespace works.
export const api = globalThis.browser ?? globalThis.chrome;
