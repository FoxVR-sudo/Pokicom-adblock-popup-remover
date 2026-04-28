# Pokicom-adblock-popup-remover

Browser extension for Firefox, Chrome, Edge and other Chromium-based browsers.

What it does:

- blocks Poki in-game overlays such as hint or rewarded-ad dialogs
- blocks popup/ad windows triggered on Filmizip clicks by neutralizing `window.open`
- removes common modal, overlay and ad iframe elements on both sites

Supported sites:

- `poki.com`
- `filmizip.com`

Install in Firefox:

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on`
3. Select `manifest.json`

Install in Chrome or Edge:

1. Open the extensions page
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder
