# Reel Ban

A cross-browser MV3 extension that strips short-form video out of YouTube and
Facebook, gated behind a 4-digit PIN that somebody else sets.

The goal is friction, not security. Anyone determined enough can open devtools
or uninstall the extension. What this stops is the reflex — the twenty seconds
between "I'll just turn it off" and being back in the feed.

---

## What it does

**YouTube**

- `youtube.com/shorts/<id>` is rewritten to `youtube.com/watch?v=<id>`. Same
  video, normal player, no swipe feed. A `t=` parameter is carried over.
  Optionally it bounces to the home page instead.
- Hides the Shorts sidebar item, Shorts shelves on home / subscriptions /
  search, individual Shorts thumbnails in recommendations, and the Shorts tab
  on channel pages.

**Facebook**

- `facebook.com/reel/*` and `facebook.com/reels/*` bounce to the main feed.
  A page's own `facebook.com/<page>/reels` tab is deliberately left alone.
- Hides the Reels link in the navigation, and (separately switchable) Reels
  posts in the feed.

**X** — not included. See [Adding X later](#adding-x-later).

Blocking is done entirely with content scripts at `document_start`, no
`declarativeNetRequest`, so one codebase behaves the same in both browsers.
All three sites are SPAs, so `history.pushState`, `history.replaceState`,
`popstate` and a 400 ms polling fallback are all hooked. Every entry point is
wrapped in `try`/`catch`: this runs on sites you use daily and must never be
able to break them.

CSS selectors key off `href` attributes (`a[href^="/shorts/"]`) and use
`:has()` to reach the containing card. Generated class names are never used —
they churn weekly. The Facebook rules are deliberately narrow and prefer
under-hiding; if part of your feed ever looks missing, turn off
**Hide Reels posts in the feed** first.

---

## The lock

1. **PIN** — 4 digits, stored as PBKDF2-SHA256, 600,000 iterations, 32-byte
   key, 16-byte random salt, in `chrome.storage.local`. Never in plaintext,
   never logged.
2. **Backoff** — 4 digits is only 10,000 combinations, so each wrong PIN locks
   attempts out for longer: 5s, 15s, 60s, 5m, 30m, 2h, then 24h from there on.
   The lockout is a stored timestamp, so quitting the browser does not clear
   it. The 600k iterations alone already cap a brute force at roughly one
   guess per half-second.
3. **Typing challenge** — a sentence chosen at setup, typed by hand.
   Paste and drag-drop are blocked.
4. **Cooldown** — the correct PIN does *not* unlock anything. It starts a
   countdown (default 30 minutes). The countdown is an absolute timestamp, so
   closing the browser, quitting, or restarting the Mac does not skip it.
5. **Unlocked** — settings become editable, and re-lock after 10 minutes of
   inactivity.

The cooldown length, the challenge sentence and the PIN are fixed at setup.
Changing any of them means a fresh install. There is no forgot-PIN flow;
recovery is asking the person who set it.

---

## Build

Needs Node 18+. The first build downloads esbuild via `npx` and needs network
access once; after that it is cached.

```
node build.js
```

Output:

```
dist/chrome/                       load this unpacked in Chrome
dist/firefox/                      the Firefox build
dist/safari/                       synced into safari/ automatically
dist/reel-ban-chrome-1.0.0.zip
dist/reel-ban-firefox-1.0.0.zip    upload this to AMO for signing
```

The installed copy is bundled and minified on purpose. Changing what is
blocked means editing `src/` and rebuilding, not opening a file in a text
editor and flipping a boolean.

Run the logic tests (gate state machine, backoff schedule, URL rules) with:

```
node test.js
```

### `build.config.json`

| key | meaning |
| --- | --- |
| `version` | extension version |
| `geckoId` | the add-on id Firefox signs against; keep it stable across versions |
| `uninstallUrl` | see [Uninstall page](#uninstall-page); leave empty to disable |

---

## Install — Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `dist/chrome` folder.
4. The setup page opens automatically. Hand the machine to whoever is holding
   the PIN.

Keep the `dist/chrome` folder where it is — Chrome loads it from that path on
every start. Putting it somewhere you will not casually delete is part of the
point.

Chrome will show a "Disable developer mode extensions" prompt on each start.
Dismiss it; it does not remove anything.

## Install — Safari

Safari extensions have to live inside a macOS app, so `xcrun
safari-web-extension-converter` has already been run and the project is at
`safari/`. `node build.js` syncs the built files into it, so run that first.

1. `node build.js`
2. Open `safari/Reel Ban/Reel Ban.xcodeproj`.
3. **Sign in with an Apple ID**: Xcode → Settings → Accounts → **+** → Apple
   ID. A free account is enough; no paid developer program needed.
4. Select the **Reel Ban** target → *Signing & Capabilities* → set **Team** to
   your personal team. Do the same for the **Reel Ban Extension** target.
5. Product → **Run** once. The app launches and registers the extension.
6. Move the built app to `/Applications` and keep it there — Safari only keeps
   the extension for as long as the containing app exists.
7. Safari → Settings → **Extensions** → tick **Reel Ban**.
8. Still in Extensions, set site access to **Always Allow on Every Website**
   (or Always Allow for youtube.com and facebook.com individually). Safari
   defaults to Ask, which means no blocking until you click through a prompt.
9. Tick **Allow in Private Browsing** on the same panel.

Step 3 is not optional. Without an Apple ID the app is unsigned, and Safari
then requires Develop → **Allow Unsigned Extensions**, which resets every time
Safari restarts — which defeats the entire point of this extension.

Safari ignores `options_ui.open_in_tab`, so settings are reached through the
toolbar button instead. That button is in all three builds.

To regenerate the project from scratch after a manifest change:

```
xcrun safari-web-extension-converter dist/safari --macos-only \
  --project-location safari --app-name "Reel Ban" \
  --bundle-identifier local.reelban --copy-resources --force
```

## Install — Firefox

A temporary add-on (`about:debugging` → **Load Temporary Add-on**) is fine for
a five-minute test, but it disappears when Firefox restarts. For a permanent
install, the add-on has to be signed by Mozilla. Self-distribution signing is
free and does not put anything in the public directory.

1. Run `node build.js` to produce `dist/reel-ban-firefox-1.0.0.zip`.
2. Create a free account at <https://addons.mozilla.org>.
3. Go to <https://addons.mozilla.org/developers/addon/submit/distribution>.
4. Choose **On your own** — this is the self-distribution / unlisted channel.
   The add-on is signed but never listed or reviewed publicly.
5. Upload the zip. `browser_specific_settings.gecko.id` is already set from
   `build.config.json`, which is what lets Mozilla sign successive versions as
   the same add-on.
   If AMO rejects the upload with *The "data_collection_permissions" property
   is missing*, you are on an older build — that key is generated into the
   Firefox manifest by `build.js`, declared as `none` because the extension
   stores everything locally and transmits nothing. Rebuild and re-upload.
6. Signing takes a minute or two. Download the resulting `.xpi`.
7. In Firefox: `about:addons` → the gear icon → **Install Add-on From File**
   → choose the `.xpi`.
8. Firefox will ask to confirm the permissions. Accept.

If blocking does not happen in Firefox, check `about:addons` → **Reel Ban** →
**Permissions** and make sure site access for youtube.com and facebook.com is
granted. Firefox treats MV3 host permissions as opt-in, unlike Chrome.

Bumping `version` in `build.config.json` and repeating steps 1 and 5–7 is how
you update.

---

## For the person setting the PIN

You do not need to know anything about browsers for this part. Someone will
have already installed the extension and handed you the keyboard.

A page titled **Reel Ban setup** should be open. If it is not, ask them to
open it for you.

1. **Choose a 4-digit PIN** and type it into both boxes. Pick something they
   will not guess and will not see you type. Do not use a birthday.
2. **Cooldown** — leave it at 30 minutes. This is the number that does the
   real work: when they ask to turn the blocking off, nothing happens for 30
   minutes, and the urge usually passes in that time. You can make it longer.
   Do not make it zero.
3. **Typing challenge** — a sentence they have to type out by hand, exactly,
   before the 30 minutes even starts. The default is fine, or write your own.
4. Click **Save and lock**.

That is it. Keep the PIN somewhere you will still have it in a year — a note
in your phone is fine. **There is no way to recover it.** If it is lost, the
only way to change the settings is deleting the extension and starting over.

If they ask you to unlock it, you are not obliged to do it immediately. That
is the point of the arrangement.

---

## Test checklist

Work through this after installing, in each browser.

**YouTube**

- [ ] Paste `youtube.com/shorts/<id>` into the address bar → lands on
      `watch?v=<id>`, normal player.
- [ ] Same, with the extension set to **Bounce to home page** → lands on
      `youtube.com`.
- [ ] Click a Short from a search result or a channel page → same rewrite, no
      swipe feed appears first.
- [ ] Press browser Back after being redirected → returns to where you came
      from, not into a redirect loop.
- [ ] Hard reload (Cmd-Shift-R) on a `/shorts/` URL → still redirects.
- [ ] Home page, subscriptions and search results show no Shorts shelf and no
      Shorts thumbnails.
- [ ] Left sidebar has no Shorts entry, in both the wide and the icon-only
      rail.
- [ ] A normal video plays, seeks and fullscreens as usual.

**Facebook**

- [ ] Paste `facebook.com/reel/<id>` → lands on the main feed.
- [ ] Click a reel from the feed → bounces back to the feed.
- [ ] Back button behaves.
- [ ] Nothing else in the feed is blanked out. Scroll a few screens and check
      for empty gaps. If you find any, turn off **Hide Reels posts in the
      feed** and re-check.
- [ ] Messenger, Marketplace, groups, notifications all still work.

**The lock**

- [ ] Wrong PIN once → "Wrong PIN", 5-second lockout counting down.
- [ ] Wrong PIN four times in a row → the lockout is visibly minutes, not
      seconds.
- [ ] Quit the browser during a lockout and reopen → the lockout is still
      running, not reset.
- [ ] Correct PIN → the typing challenge appears, *not* the settings.
- [ ] Try to paste the sentence → refused.
- [ ] Type the sentence correctly → the countdown starts.
- [ ] Quit the browser mid-countdown, reopen the options page → the countdown
      has kept running and shows the correct remaining time.
- [ ] Wait it out → settings become editable.
- [ ] Leave the page alone for 10 minutes → it re-locks.
- [ ] Change a setting, save, reload a YouTube tab → the change took effect.
- [ ] In Firefox only: `about:addons` → Reel Ban → Permissions shows site
      access granted for both sites.

---

## What this does and does not cover

This is a per-browser, per-profile block. There is no device-wide equivalent
on macOS that can see URL paths, because a system-level filter cannot read
inside HTTPS — which is exactly what distinguishing `/shorts/abc` from
`/watch?v=abc` requires. Anything that works at the OS or DNS layer can only
block `youtube.com` entirely.

So full coverage means installing in each browser:

| | covered | how |
| --- | --- | --- |
| Firefox | yes | signed `.xpi` |
| Safari | yes | Xcode app wrapper |
| Chrome / Edge / Brave / Arc | yes | `dist/chrome`, load unpacked |
| A browser installed next week | **no** | install it there too |
| Private / Incognito windows | **only if explicitly allowed** | see below |
| Other user accounts or Firefox profiles | **no** | separate install each |
| iPhone, iPad, any other device | **no** | — |
| The YouTube and Facebook *apps* | **no** | websites only |

**Private windows are off by default in every browser.** This is the single
most likely way for the block to quietly not apply:

- Firefox: `about:addons` → Reel Ban → Details → **Run in Private Windows: Allow**
- Safari: Settings → Extensions → Reel Ban → **Allow in Private Browsing**
- Chrome: `chrome://extensions` → Reel Ban → Details → **Allow in Incognito**

Do all of these before handing the machine over for PIN setup.

**Mobile-layout pages are partly covered.** `m.youtube.com` and
`m.facebook.com` match the content script, so the redirects work, but the
hiding CSS targets desktop element names — Shorts shelves will still be
visible there even though tapping one lands in the normal player.

## Known limits

**The uninstall page cannot be a local file.** `chrome.runtime.setUninstallURL`
requires an `http:` or `https:` URL — it rejects `chrome-extension://`,
`file://` and `data:` — and the extension's own pages no longer exist once it
has been removed. So `docs/uninstalled.html` ships in this repo unused by
default. To turn it on, publish it somewhere (GitHub Pages on this repo is the
one-click option: Settings → Pages → deploy from `/docs`), then put the
resulting URL in `build.config.json` as `uninstallUrl` and rebuild. Left empty,
the call is skipped rather than opening a broken tab.

**Firefox does not implement `setUninstallURL` at all.** The Chrome build gets
the uninstall page; the Firefox build silently does without it.

**Moving the system clock forward skips the cooldown.** The countdown is wall
clock, which is what makes it survive a restart. Detecting a deliberate clock
change would need a background timer that a suspended service worker cannot be
relied on to keep. This is squarely on the "not defending against a debugger"
side of the line.

**A brief flash of over-hiding is possible.** The content script applies the
default hiding CSS synchronously at `document_start` and corrects it a few
milliseconds later once storage has been read — waiting for storage first
would let a Shorts shelf paint. If you have hiding turned *off*, you may see a
shelf appear a beat late.

**Chrome's developer-mode install is not update-managed.** If you move or
delete `dist/chrome`, the extension disappears on next start.

---

## Adding X later

X was left out because its vertical video feed path is not fixed and has moved
more than once. To add it:

1. Open X, click the **Video** tab, and read the address bar.
2. Add a matcher to `src/content/rules.js` alongside `facebookTarget`,
   following the same shape — a path regex and an origin-relative target.
   Keep it as an array of paths rather than a single hardcoded one.
3. Add `*://*.x.com/*` to `host_permissions` and to the content script
   `matches` in `build.js`, and a site branch in `src/content/blocker.js`.
4. Bump `version`, rebuild, reinstall.

---

## Layout

```
src/common/api.js       browser/chrome namespace shim
src/common/crypto.js    PBKDF2 hashing and PIN verification
src/common/store.js     storage keys, defaults, config merging
src/common/gate.js      lock/challenge/cooldown/unlock state machine
src/content/rules.js    URL matchers and the hiding CSS
src/content/blocker.js  document_start content script
src/background.js       first-run setup page, uninstall URL
src/pages/              setup, options and toolbar popup pages
safari/                 Xcode project wrapping the extension for Safari
docs/uninstalled.html   the page shown after uninstall, if published
build.js                bundles, generates manifests and icons, zips
test.js                 runs test/logic.test.cjs
```
