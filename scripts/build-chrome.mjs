/**
 * Produces a Chrome/Edge source tree from the Firefox manifest.
 *
 * manifest.json is the Firefox source of truth: it declares an MV3 event page
 * ("background.scripts") and gecko settings. Chrome needs a service worker and
 * ignores gecko settings, and each browser warns loudly about the other's
 * keys - so instead of shipping one manifest with both, the Chrome variant is
 * derived here at build time.
 */

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build", "chrome");

/** Everything that ships in the package; README, LICENSE etc. stay out. */
const SOURCES = ["icons", "popup", "background.js", "content.js", "page-script.js", "style.css"];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const entry of SOURCES) {
    cpSync(join(root, entry), join(out, entry), { recursive: true });
}

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

manifest.background = { service_worker: "background.js" };
// "world": "MAIN" in content scripts requires Chrome 111.
manifest.minimum_chrome_version = "111";
delete manifest.browser_specific_settings;

writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Chrome source tree written to ${out}`);
