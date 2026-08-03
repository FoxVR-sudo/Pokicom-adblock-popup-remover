# Popup & Overlay Blocker

## [⬇ Download for Firefox](https://github.com/FoxVR-sudo/filmizip-adblock-popup-remover/releases/latest/download/popup-overlay-blocker.xpi)

Open the downloaded file in Firefox to install it - drag it onto a Firefox
window, or press `Ctrl+O` and pick it. It is signed by Mozilla, so it installs
in ordinary Firefox and updates itself from then on.

That link always serves the newest release, so it stays valid across versions
and is safe to share.

Browser extension for Firefox, Chrome, Edge and other Chromium-based browsers.

Current release: `2.1.0`

## What it does

- blocks popunder windows opened through `window.open` on `filmizip.com`
- blocks click traps: invisible new-tab anchors laid over the page, and links
  carrying affiliate click ids
- blocks synthetic navigation via `anchor.click()` and `form.submit()`, the
  paths a popunder falls back to once `window.open` is taken away
- removes ad slots and full-screen ad interstitials injected at runtime
- stops the tracker iframes that the `vidmoly.biz` player injects around the video before playback
- toolbar toggle to turn blocking off when a page misbehaves
- badge counter showing how many items were blocked on the current tab
- optional console logging of every blocked item, for diagnosing a leak

## Supported sites

Built in:

- `filmizip.com`
- `vidmoly.biz` (one of the video embeds loaded by Filmizip)

Filmizip serves its other players from short-lived, rotating domains
(`q8y5z.com`, `vidstream.uns.bio`, `vidz.playerp2p.com`, ...), so a fixed match
list in the manifest goes stale within weeks. Instead the extension ships with
**no broad host access**: the content script on `filmizip.com` reports which
third-party frames the page actually loaded, the popup lists them, and each one
can be granted with a single click. Firefox asks for permission once per host
and the grant is remembered.

Poki support was removed in `2.0.0`; the project now targets Filmizip only.

## How it works

Two content scripts run at `document_start`:

- `content.js` (isolated world) removes ad containers and overlays. It scans only
  the subtrees a `MutationObserver` reports as added, throttled to one pass per
  200 ms, so no layout-forcing full-document sweep runs on every mutation.
- `page-script.js` runs in the **MAIN world** via the manifest's `"world": "MAIN"`,
  which is how it reaches the page's own `window.open` and `Node.prototype`.
  Nothing is injected at runtime and no code is fetched, so `web_accessible_resources`
  is not needed.

`window.open` is not blanket-disabled. A call is allowed only when it is
same-origin, happens within one second of a trusted user gesture, and is the
first open for that gesture. Every popunder fails at least one of those checks,
while ordinary `<a target="_blank">` links are untouched because they never go
through `window.open`.

The toolbar toggle writes `enabled` to `storage.local`. The content script
mirrors it onto `<html data-popup-blocker="on|off">`, which `style.css` and the
MAIN-world script both read - one flag reaching CSS, DOM cleanup and the
`window.open` guard. Blocking is the default, so nothing flashes while storage
resolves.

## Diagnosing whether it worked

Ad networks rotate creatives and cap how often a popunder is shown per visitor,
so the same page can be ad-free on one load and not on the next **regardless of
this extension**. Two things make the difference observable:

- **The badge.** A number on the toolbar icon means the extension blocked that
  many things on this tab. An empty badge means it blocked nothing - either the
  page served no ads, or something got through.
- **Console logging.** Turn on "Log to console" in the popup and reload. Blocked
  items are logged in red; anything the guard deliberately *allowed*
  (`ALLOWED window.open`, `ALLOWED new-tab click`) is logged in orange by the
  MAIN-world script. An orange line right before an unwanted tab opens
  identifies the leak exactly.

To compare fairly, always test the same URL in a fresh profile (`web-ext run`
creates one per launch) or clear cookies and localStorage between runs -
otherwise frequency capping, not the extension, decides what you see.

## Privacy

No data is collected, stored or transmitted. The extension makes no network
requests of its own. It ships with no broad host access; any additional host is
granted explicitly by the user from the popup and can be revoked there or from
`about:addons`.

The host list shown in the popup comes from reading the `src` attribute of
iframes on the page - an attribute read, not cross-origin access - and is kept
in memory per tab, never stored or sent anywhere.

## Development

```sh
npm install
npm run lint          # web-ext lint - run this before every AMO upload
npm start             # launches Firefox with the extension loaded
npm run build         # dist/popup_overlay_blocker-<version>.zip        (Firefox)
npm run build:chrome  # dist/popup_overlay_blocker-<version>-chrome.zip (Chrome/Edge)
```

`manifest.json` is the **Firefox** source of truth. Chrome needs a different
background key and ignores the gecko settings, and each browser warns about the
other's keys, so `scripts/build-chrome.mjs` derives the Chrome manifest at build
time instead: it swaps `background.scripts` for `background.service_worker`,
drops `browser_specific_settings` and adds `minimum_chrome_version`. Edit only
`manifest.json`; the Chrome variant regenerates from it.

## Signing for permanent installation

A temporary add-on (`about:debugging` → Load Temporary Add-on, and everything
`web-ext run` loads) is removed when Firefox restarts, **and its optional host
permissions go with it**. For an install that survives a restart the package has
to be signed.

Put the credentials in a `.env` file next to `package.json`:

```sh
cp .env.example .env      # then edit .env
npm run sign
```

`.env` is gitignored, and `scripts/sign.mjs` passes the values to `web-ext`
through the environment rather than as arguments - command-line arguments show
up in shell history and in the process list, environment variables do not.
Anything already exported in the shell wins over the file, which is what a CI
job wants.

Keys come from <https://addons.mozilla.org/developers/addon/api/key/>. Treat the
secret like a password: anyone holding it can upload and sign add-ons under this
account. If it is ever pasted somewhere it should not be, revoke it on that page
and generate a new pair - revoking is instant and costs nothing.

`npm run sign` uses the **unlisted** channel: AMO signs the package and returns
it, without publishing it in the store or putting it through review. The signed
`.xpi` lands in `dist/` and installs permanently by opening it in Firefox.
`npm run sign:listed` is the same call for a public store listing.

Bump `version` in `manifest.json` before every signing run - AMO refuses a
version it has already seen. `npm run sign` regenerates `updates.json` from
that version first, and renames the signed file from AMO's internal upload id
to `popup-overlay-blocker-<version>.xpi`, which is the name the update manifest
points at.

Releasing a new version, in order:

1. Bump `version` in `manifest.json` and `package.json`
2. `npm run lint && npm run sign`
3. Commit and push the regenerated `updates.json` to `main`
4. Publish a GitHub release tagged `v<version>` with `dist/popup-overlay-blocker-<version>.xpi` attached

The tag and the asset filename have to match what `updates.json` says, or
Firefox will poll a URL that 404s and silently stay on the old version.

`npm run lint` passes `--self-hosted`, because `update_url` is only allowed for
self-hosted add-ons. `npm run lint:listed` is the stricter check to use if this
is ever submitted for a public AMO listing - that route needs `update_url`
removed, since AMO then serves updates itself.

## Install (users)

Grab the signed `.xpi` from the
[Releases page](https://github.com/FoxVR-sudo/filmizip-adblock-popup-remover/releases)
and open it in Firefox - drag it onto a Firefox window, or `Ctrl+O`, or
☰ → Add-ons and themes → gear icon → *Install Add-on From File…*

It is signed by Mozilla, so ordinary Firefox installs it without any config
changes, and it survives a restart.

After installing, click the toolbar icon while a film is open and press
**Enable** next to the player's domain. Filmizip serves its players from
rotating domains, so each new one is granted once, by you, and remembered.

Updates are automatic. `browser_specific_settings.gecko.update_url` points at
`updates.json` on the default branch, Firefox polls it, and installs whatever
release it names.

## Install for testing

Firefox:

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on`
3. Select `manifest.json`

Chrome or Edge:

1. Run `npm run build:chrome`
2. Open the extensions page
3. Enable `Developer mode`
4. Click `Load unpacked`
5. Select `build/chrome` (not the repository root - that holds the Firefox manifest)

## Browser requirements

- Firefox 128+ (and Firefox for Android 128+) - `"world": "MAIN"` in content scripts
- Chrome / Edge 111+ - same reason

## Publishing to addons.mozilla.org

1. Bump `version` in `manifest.json` and `package.json` - AMO rejects duplicate versions
2. `npm run lint`, then `npm run build`
3. Upload the `dist/*.zip` at <https://addons.mozilla.org/developers/addon/submit/distribution>
4. Answer "no" to the minified/bundled code question - no source upload is required
5. In the notes to reviewers, state that the MAIN-world script is loaded by the
   manifest, no remote code is used, and no data is collected
6. Expect a question about `optional_host_permissions: ["*://*/*"]`. Answer that
   nothing is requested at install time, that each host is granted individually
   by the user from the popup, and that a fixed match list cannot work because
   the player domains rotate

`browser_specific_settings.gecko` carries the add-on id, the minimum version and
`data_collection_permissions: { required: ["none"] }`, which AMO requires as an
explicit no-data-collection declaration.

Upload the artifact from `npm run build`, not the one from `npm run build:chrome`.
`npm run lint` must report zero errors **and zero warnings** - Firefox rejects
unknown manifest keys, including `_`-prefixed comment keys that Chrome tolerates.
