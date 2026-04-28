# Pokicom-adblock-popup-remover

Browser extension for Firefox, Chrome, Edge and other Chromium-based browsers.

Current release: `1.1.0`

What it does:

- blocks Poki in-game overlays such as hint or rewarded-ad dialogs
- blocks popup/ad windows triggered on Filmizip clicks by neutralizing `window.open`
- removes common modal, overlay and ad iframe elements on both sites
- includes packaged release assets with extension icons

Supported sites:

- `poki.com`
- `filmizip.com`

Files included in the release:

- `manifest.json`
- `content.js`
- `page-script.js`
- `style.css`
- `icons/`

Install in Firefox:

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on`
3. Select `manifest.json`

For a distributable Firefox package, use the generated `.zip` file and rename it to `.xpi` if needed for manual testing.

Install in Chrome or Edge:

1. Open the extensions page
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder

Package output:

- `dist/popup-blocker-poki-filmizip-v1.1.0.zip`

Publishing notes:

- Firefox metadata is included through `browser_specific_settings.gecko`
- Chrome and Edge use the same Manifest V3 package
- update the version in `manifest.json` before creating the next release archive
