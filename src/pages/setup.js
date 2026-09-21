import { api } from '../common/api.js';
import { KEYS, DEFAULT_CONFIG, DEFAULT_FIXED, set, isSetUp } from '../common/store.js';
import { createAuth, isValidPin } from '../common/crypto.js';

const $ = (id) => document.getElementById(id);

const form = $('form');
const already = $('already');
const msg = $('msg');

function fail(text) {
  msg.textContent = text;
  msg.className = 'msg error';
}

(async function init() {
  try {
    if (await isSetUp()) {
      already.classList.remove('hidden');
      $('to-options').addEventListener('click', () => {
        location.href = api.runtime.getURL('options.html');
      });
      return;
    }
  } catch (err) {
    fail('Could not read extension storage. Reload this page.');
    return;
  }

  $('challenge').value = DEFAULT_FIXED.challenge;
  form.classList.remove('hidden');
  $('pin1').focus();

  for (const id of ['pin1', 'pin2']) {
    $(id).addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    });
  }

  form.addEventListener('submit', onSubmit);
})();

async function onSubmit(event) {
  event.preventDefault();
  msg.className = 'msg';
  msg.textContent = '';

  const pin = $('pin1').value;
  const repeat = $('pin2').value;
  const minutes = Number($('cooldown').value);
  const challenge = $('challenge').value.trim();

  if (!isValidPin(pin)) return fail('The PIN must be exactly 4 digits.');
  if (pin !== repeat) return fail('The two PINs do not match.');
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
    return fail('Cooldown must be a whole number of minutes between 0 and 1440.');
  }
  if (challenge.length < 10) return fail('The sentence needs to be at least 10 characters.');

  $('save').disabled = true;
  msg.textContent = 'Hashing…';

  try {
    // Re-check: another tab may have completed setup while this one sat open.
    if (await isSetUp()) return fail('Setup was already completed in another tab.');

    const auth = await createAuth(pin);
    await set({
      [KEYS.auth]: auth,
      [KEYS.fixed]: { cooldownMinutes: minutes, challenge },
      [KEYS.config]: DEFAULT_CONFIG,
      [KEYS.attempts]: { fails: 0, lockedUntil: 0 },
      [KEYS.gate]: { phase: 'locked', cooldownEndsAt: 0, cooldownStartedAt: 0, lastActivityAt: 0 },
    });
    // Written last so a failure part-way through does not leave a half-locked
    // extension that cannot be set up again.
    await set({ [KEYS.setup]: true });
  } catch (err) {
    $('save').disabled = false;
    return fail('Could not save. Nothing was changed.');
  } finally {
    $('pin1').value = '';
    $('pin2').value = '';
  }

  msg.className = 'msg ok';
  msg.textContent = 'Saved. Locking…';
  setTimeout(() => { location.href = api.runtime.getURL('options.html'); }, 700);
}
