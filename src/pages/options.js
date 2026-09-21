import { api } from '../common/api.js';
import { KEYS, getConfig, set, isSetUp, mergeConfig } from '../common/store.js';
import { PHASE, readGate, submitPin, submitChallenge, relock, touchActivity, formatDuration } from '../common/gate.js';

const $ = (id) => document.getElementById(id);
const TICK_MS = 500;

const panels = {
  setup: $('panel-setup'),
  locked: $('panel-locked'),
  lockout: $('panel-lockout'),
  challenge: $('panel-challenge'),
  cooldown: $('panel-cooldown'),
  unlocked: $('panel-unlocked'),
};

let setUp = false;
let state = null;
let dirty = false;
let busy = false;

(async function init() {
  try {
    setUp = await isSetUp();
    await loadConfigIntoForm();
  } catch (err) {
    $('settings-msg').textContent = 'Could not read extension storage.';
    $('settings-msg').className = 'msg error';
    return;
  }

  wireGate();
  wireSettings();
  await tick();
  setInterval(tick, TICK_MS);
})();

// --- gate --------------------------------------------------------------

function wireGate() {
  $('go-setup').addEventListener('click', () => {
    location.href = api.runtime.getURL('setup.html');
  });

  $('pin').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
  });
  $('pin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onSubmitPin(); }
  });
  $('submit-pin').addEventListener('click', onSubmitPin);

  const challengeInput = $('challenge-input');
  for (const type of ['paste', 'drop']) {
    challengeInput.addEventListener(type, (e) => {
      e.preventDefault();
      setMsg('challenge-msg', 'Pasting is disabled. Type it out.', 'error');
    });
  }
  challengeInput.addEventListener('beforeinput', (e) => {
    // Backstop for paths that do not fire a paste event (menu bar, drag).
    if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop' ||
        e.inputType === 'insertFromYank' || e.inputType === 'insertFromPasteAsQuotation') {
      e.preventDefault();
      setMsg('challenge-msg', 'Pasting is disabled. Type it out.', 'error');
    }
  });
  $('submit-challenge').addEventListener('click', onSubmitChallenge);
  $('cancel-challenge').addEventListener('click', onRelock);
  $('cancel-cooldown').addEventListener('click', onRelock);
  $('lock-now').addEventListener('click', onRelock);
}

async function onSubmitPin() {
  if (busy) return;
  const input = $('pin');
  const pin = input.value;
  busy = true;
  $('submit-pin').disabled = true;
  setMsg('locked-msg', 'Checking…', '');
  try {
    const result = await submitPin(pin);
    input.value = '';
    if (result.ok) {
      setMsg('locked-msg', '', '');
    } else if (result.reason === 'malformed') {
      setMsg('locked-msg', 'Enter 4 digits.', 'error');
    } else if (result.reason === 'locked-out') {
      setMsg('locked-msg', '', '');
    } else {
      setMsg('locked-msg', 'Wrong PIN.', 'error');
    }
  } catch (err) {
    setMsg('locked-msg', 'Something went wrong. Try again.', 'error');
  } finally {
    busy = false;
    $('submit-pin').disabled = false;
    await tick();
  }
}

async function onSubmitChallenge() {
  if (busy) return;
  busy = true;
  try {
    const result = await submitChallenge($('challenge-input').value);
    if (result.ok) {
      $('challenge-input').value = '';
      setMsg('challenge-msg', '', '');
    } else {
      setMsg('challenge-msg', 'That does not match. Every character has to be right.', 'error');
    }
  } catch (err) {
    setMsg('challenge-msg', 'Something went wrong. Try again.', 'error');
  } finally {
    busy = false;
    await tick();
  }
}

async function onRelock() {
  try {
    await relock();
    $('challenge-input').value = '';
    $('pin').value = '';
    dirty = false;
    await loadConfigIntoForm();
  } catch (_) { /* next tick re-reads anyway */ }
  await tick();
}

async function tick() {
  try {
    if (!setUp) {
      setUp = await isSetUp();
      if (!setUp) return show('setup');
    }

    const now = Date.now();
    const previousPhase = state && state.phase;
    state = await readGate(now);

    $('fixed-cooldown').textContent = state.fixed.cooldownMinutes === 0
      ? 'disabled'
      : `${state.fixed.cooldownMinutes} minute${state.fixed.cooldownMinutes === 1 ? '' : 's'}`;

    if (state.lockedUntil > now) {
      $('lockout-countdown').textContent = formatDuration(state.lockedUntil - now);
      $('pin').value = '';
      return show('lockout');
    }

    if (state.phase === PHASE.LOCKED) return show('locked');

    if (state.phase === PHASE.CHALLENGE) {
      $('challenge-text').textContent = state.fixed.challenge;
      if (previousPhase !== PHASE.CHALLENGE) $('challenge-input').focus();
      return show('challenge');
    }

    if (state.phase === PHASE.COOLDOWN) {
      $('cooldown-countdown').textContent = formatDuration(state.cooldownEndsAt - now);
      return show('cooldown');
    }

    // Unlocked. Re-read config from storage on the transition so the form is
    // not showing a stale copy from before the wait.
    if (previousPhase !== PHASE.UNLOCKED && !dirty) await loadConfigIntoForm();
    $('relock-in').textContent = formatDuration(state.relocksAt - now);
    show('unlocked');
  } catch (err) {
    // A broken tick must not freeze the page on a stale panel.
    show('locked');
  }
}

function show(name) {
  for (const [key, el] of Object.entries(panels)) el.classList.toggle('hidden', key !== name);
  const unlocked = name === 'unlocked';
  $('settings-fields').disabled = !unlocked;
  $('sub').textContent = unlocked
    ? 'Settings are editable until the re-lock timer runs out.'
    : 'Settings are read-only until the PIN, the sentence and the wait are all done.';
}

function setMsg(id, text, kind) {
  const el = $(id);
  el.textContent = text;
  el.className = kind ? `msg ${kind}` : 'msg';
}

// --- settings ----------------------------------------------------------

const FIELDS = {
  'yt-enabled': ['youtube', 'enabled'],
  'yt-mode': ['youtube', 'mode'],
  'yt-hide': ['youtube', 'hideEntryPoints'],
  'fb-enabled': ['facebook', 'enabled'],
  'fb-nav': ['facebook', 'hideNav'],
  'fb-tray': ['facebook', 'hideFeedTray'],
};

async function loadConfigIntoForm() {
  const config = await getConfig();
  for (const [id, [section, key]] of Object.entries(FIELDS)) {
    const el = $(id);
    if (el.type === 'checkbox') el.checked = Boolean(config[section][key]);
    else el.value = config[section][key];
  }
  dirty = false;
}

function readForm() {
  const config = mergeConfig({});
  for (const [id, [section, key]] of Object.entries(FIELDS)) {
    const el = $(id);
    config[section][key] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return config;
}

function wireSettings() {
  const form = $('settings');

  for (const id of Object.keys(FIELDS)) {
    $(id).addEventListener('change', () => {
      dirty = true;
      setMsg('settings-msg', 'Unsaved changes.', '');
    });
  }

  for (const type of ['keydown', 'pointerdown']) {
    document.addEventListener(type, () => { touchActivity().catch(() => {}); }, true);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    // The disabled fieldset already blocks this, but the gate is re-checked
    // against storage rather than the DOM before anything is written.
    const current = await readGate();
    if (current.phase !== PHASE.UNLOCKED) {
      setMsg('settings-msg', 'Locked. Nothing was saved.', 'error');
      await tick();
      return;
    }
    try {
      await set({ [KEYS.config]: readForm() });
      dirty = false;
      setMsg('settings-msg', 'Saved. Reload any open YouTube or Facebook tabs.', 'ok');
    } catch (err) {
      setMsg('settings-msg', 'Could not save.', 'error');
    }
    await touchActivity(Date.now());
  });
}
