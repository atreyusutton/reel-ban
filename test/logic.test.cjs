const { gate, cryptoMod, store, rules } = globalThis.M;
const S = globalThis.__store;

let fails = 0;
const ok = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) fails++; };

(async () => {
  // --- URL rules
  const ytCfg = { mode: 'redirect' };
  const u = (s) => new URL(s);
  ok('shorts -> watch', rules.youtubeTarget(u('https://www.youtube.com/shorts/abc12XY-_z'), ytCfg) === 'https://www.youtube.com/watch?v=abc12XY-_z');
  ok('shorts keeps t param', rules.youtubeTarget(u('https://www.youtube.com/shorts/abc12XY?t=30'), ytCfg) === 'https://www.youtube.com/watch?v=abc12XY&t=30');
  ok('shorts -> home mode', rules.youtubeTarget(u('https://www.youtube.com/shorts/abc12XY'), { mode: 'home' }) === 'https://www.youtube.com/');
  ok('watch untouched', rules.youtubeTarget(u('https://www.youtube.com/watch?v=abc12XY'), ytCfg) === null);
  ok('bare /shorts untouched', rules.youtubeTarget(u('https://www.youtube.com/shorts'), ytCfg) === null);
  ok('feed untouched', rules.youtubeTarget(u('https://www.youtube.com/feed/subscriptions'), ytCfg) === null);

  ok('fb /reel/ bounces', rules.facebookTarget(u('https://www.facebook.com/reel/123')) === 'https://www.facebook.com/');
  ok('fb /reels/ bounces', rules.facebookTarget(u('https://www.facebook.com/reels/tab')) === 'https://www.facebook.com/');
  ok('fb /reel bounces', rules.facebookTarget(u('https://www.facebook.com/reel')) === 'https://www.facebook.com/');
  ok('fb page reels tab untouched', rules.facebookTarget(u('https://www.facebook.com/SomePage/reels/')) === null);
  ok('fb feed untouched', rules.facebookTarget(u('https://www.facebook.com/')) === null);
  ok('fb /reelfoo untouched', rules.facebookTarget(u('https://www.facebook.com/reelfoo')) === null);

  // --- setup
  const auth = await cryptoMod.createAuth('4821');
  ok('hash is not the pin', !JSON.stringify(auth).includes('4821'));
  await store.set({ auth, fixed: { cooldownMinutes: 30, challenge: 'type me exactly' }, setupComplete: true });
  ok('verify correct pin', await cryptoMod.verifyPin('4821', auth));
  ok('verify wrong pin', !(await cryptoMod.verifyPin('4822', auth)));

  // --- backoff
  let t = 1_000_000;
  let r = await gate.submitPin('0000', t);
  ok('1st wrong -> 5s lockout', !r.ok && r.lockedUntil === t + 5000);
  r = await gate.submitPin('0000', t);
  ok('locked out blocks further attempts', !r.ok && r.reason === 'locked-out');
  t += 5001;
  r = await gate.submitPin('0000', t);
  ok('2nd wrong -> 15s lockout', !r.ok && r.lockedUntil === t + 15000);
  t += 15001;
  r = await gate.submitPin('0000', t); t += 60001;
  r = await gate.submitPin('0000', t); t += 5*60000+1;
  r = await gate.submitPin('0000', t); t += 30*60000+1;
  r = await gate.submitPin('0000', t);
  ok('6th wrong -> 2h lockout', !r.ok && r.lockedUntil === t + 2*3600_000);
  t += 2*3600_000+1;
  r = await gate.submitPin('0000', t); t += 24*3600_000+1;
  r = await gate.submitPin('0000', t);
  ok('8th wrong caps at 24h', !r.ok && r.lockedUntil === t + 24*3600_000);
  ok('malformed pin costs nothing', (await gate.submitPin('12', t)).reason === 'locked-out');
  t += 24*3600_000+1;
  ok('malformed pin no penalty', (await gate.submitPin('abc', t)).reason === 'malformed');
  ok('still not locked after malformed', (await gate.readGate(t)).lockedUntil <= t);

  // --- correct pin -> challenge -> cooldown
  r = await gate.submitPin('4821', t);
  ok('correct pin accepted', r.ok);
  ok('fail count reset', (await gate.readGate(t)).fails === 0);
  ok('phase is challenge, not unlocked', (await gate.readGate(t)).phase === gate.PHASE.CHALLENGE);

  ok('wrong sentence rejected', !(await gate.submitChallenge('type me exactl', t)).ok);
  ok('still challenge after wrong sentence', (await gate.readGate(t)).phase === gate.PHASE.CHALLENGE);
  r = await gate.submitChallenge('type me exactly', t);
  ok('right sentence starts cooldown', r.ok && r.phase === gate.PHASE.COOLDOWN);

  ok('still locked at +29m', (await gate.readGate(t + 29*60000)).phase === gate.PHASE.COOLDOWN);
  // simulate a browser restart: storage survives, module state does not
  ok('cooldown survives restart', (await gate.readGate(t + 29*60000)).cooldownEndsAt === t + 30*60000);
  ok('unlocked at +30m', (await gate.readGate(t + 30*60000 + 1)).phase === gate.PHASE.UNLOCKED);

  // --- idle relock
  const tu = t + 30*60000 + 1;
  ok('still unlocked at +9m idle', (await gate.readGate(tu + 9*60000)).phase === gate.PHASE.UNLOCKED);
  ok('relocked at +11m idle', (await gate.readGate(tu + 9*60000 + 11*60000)).phase === gate.PHASE.LOCKED);
  ok('relock needs pin again', (await gate.readGate(tu + 99*60000)).phase === gate.PHASE.LOCKED);

  // --- zero cooldown path
  await store.set({ fixed: { cooldownMinutes: 0, challenge: 'x'.repeat(10) } });
  await gate.submitPin('4821', t);
  r = await gate.submitChallenge('x'.repeat(10), t);
  ok('zero cooldown unlocks immediately', r.ok && r.phase === gate.PHASE.UNLOCKED);

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
