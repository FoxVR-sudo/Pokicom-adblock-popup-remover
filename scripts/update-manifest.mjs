/**
 * Regenerates updates.json from the version in manifest.json.
 *
 * Firefox polls the file named by browser_specific_settings.gecko.update_url
 * and installs the build it points at. Keeping it generated means the version
 * in the update manifest can never drift from the version actually signed.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const REPO = "FoxVR-sudo/filmizip-adblock-popup-remover";
const ASSET = "popup-overlay-blocker";

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const { id, strict_min_version: minVersion } = manifest.browser_specific_settings.gecko;
const { version } = manifest;

const updates = {
    addons: {
        [id]: {
            updates: [
                {
                    version,
                    update_link: `https://github.com/${REPO}/releases/download/v${version}/${ASSET}-${version}.xpi`,
                    applications: { gecko: { strict_min_version: minVersion } }
                }
            ]
        }
    }
};

writeFileSync(join(root, "updates.json"), `${JSON.stringify(updates, null, 2)}\n`);

console.log(`updates.json now points at v${version}`);
console.log("Commit and push it to main, then publish the release with that exact asset name.");
