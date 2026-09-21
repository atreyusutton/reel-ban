import { api } from './common/api.js';
import { isSetUp } from './common/store.js';

// Replaced at build time from build.config.json.
const UNINSTALL_URL = __UNINSTALL_URL__;

// Chrome only, and only for http(s): the API rejects other schemes, and the
// extension's own pages no longer exist once it has been removed. Firefox does
// not implement this at all, hence the feature check.
try {
  if (UNINSTALL_URL && typeof api.runtime.setUninstallURL === 'function') {
    api.runtime.setUninstallURL(UNINSTALL_URL);
  }
} catch (_) { /* not fatal */ }

api.runtime.onInstalled.addListener(async (details) => {
  try {
    if (details.reason !== 'install') return;
    if (await isSetUp()) return;
    await api.tabs.create({ url: api.runtime.getURL('setup.html') });
  } catch (_) { /* not fatal */ }
});
