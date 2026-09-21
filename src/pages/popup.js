import { api } from '../common/api.js';
import { isSetUp } from '../common/store.js';
import { PHASE, readGate, formatDuration } from '../common/gate.js';

// Safari does not honour options_ui.open_in_tab, so without a toolbar button
// there is no way to reach the settings page there at all.

const status = document.getElementById('status');
const button = document.getElementById('open');

let target = 'options.html';

(async function init() {
  try {
    if (!(await isSetUp())) {
      target = 'setup.html';
      status.textContent = 'No PIN set yet — blocking is on defaults.';
      button.textContent = 'Run setup';
      return;
    }

    const now = Date.now();
    const state = await readGate(now);

    if (state.lockedUntil > now) {
      status.textContent = `Locked out for ${formatDuration(state.lockedUntil - now)}.`;
    } else if (state.phase === PHASE.COOLDOWN) {
      status.textContent = `Unlocks in ${formatDuration(state.cooldownEndsAt - now)}.`;
    } else if (state.phase === PHASE.UNLOCKED) {
      status.textContent = `Settings unlocked for ${formatDuration(state.relocksAt - now)}.`;
    } else if (state.phase === PHASE.CHALLENGE) {
      status.textContent = 'Waiting for the typing challenge.';
    } else {
      status.textContent = 'Blocking Shorts and Reels. Settings locked.';
    }
  } catch (err) {
    status.textContent = 'Could not read settings.';
  }
})();

button.addEventListener('click', async () => {
  try {
    if (target === 'options.html' && typeof api.runtime.openOptionsPage === 'function') {
      await api.runtime.openOptionsPage();
    } else {
      await api.tabs.create({ url: api.runtime.getURL(target) });
    }
    window.close();
  } catch (err) {
    status.textContent = 'Could not open settings.';
  }
});
