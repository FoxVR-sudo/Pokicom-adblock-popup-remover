/**
 * Runs `web-ext sign` with the AMO credentials taken from a gitignored .env
 * file, falling back to whatever is already in the environment.
 *
 * The point is that the secret never appears on a command line: arguments are
 * visible in shell history and in the process list, environment variables are
 * not. Nothing here prints the key or the secret.
 */

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const channel = process.argv[2] === "listed" ? "listed" : "unlisted";

const ASSET = "popup-overlay-blocker";

function loadEnvFile(path) {
    if (!existsSync(path)) {
        return {};
    }

    const values = {};

    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);

        if (!match || line.trimStart().startsWith("#")) {
            continue;
        }

        values[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }

    return values;
}

/**
 * AMO names the signed file after an internal upload id, which is meaningless
 * to anyone downloading it and, more importantly, is not the name the update
 * manifest points at. Rename it to the name a release asset must carry.
 */
function renameArtifact(version) {
    const wanted = `${ASSET}-${version}.xpi`;
    const candidates = readdirSync(dist)
        .filter((name) => name.endsWith(".xpi") && name !== wanted)
        .map((name) => ({ name, time: statSync(join(dist, name)).mtimeMs }))
        .sort((a, b) => b.time - a.time);

    if (candidates.length === 0) {
        return;
    }

    renameSync(join(dist, candidates[0].name), join(dist, wanted));

    /**
     * A copy at the repository root, committed alongside the source.
     *
     * This is what both the README button and updates.json point at, through
     * raw.githubusercontent.com. Publishing a GitHub release works too, but it
     * puts the download behind a tag and an asset name that have to match
     * updates.json exactly - and when they do not, Firefox polls a URL that
     * 404s and silently stays on the old version. Committing the file removes
     * that failure mode: the binary and the manifest that describes it move in
     * the same commit and cannot drift.
     *
     * The cost is a ~32 KB binary in git history per release, which for this
     * project is not worth optimising away.
     */
    copyFileSync(join(dist, wanted), join(root, `${ASSET}.xpi`));

    console.log(`\nSigned package: dist/${wanted}`);
    console.log(`Committable copy: ${ASSET}.xpi`);
    console.log("Commit it together with updates.json and push to main.");
}

const manifestVersion = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).version;
const env = { ...loadEnvFile(join(root, ".env")), ...process.env };
const missing = ["WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"].filter((name) => !env[name]);

if (missing.length > 0) {
    console.error(`Missing ${missing.join(" and ")}.`);
    console.error("Copy .env.example to .env and fill in the values from");
    console.error("https://addons.mozilla.org/developers/addon/api/key/");
    process.exit(1);
}

console.log(`Signing on the ${channel} channel...`);

const child = spawn(
    process.execPath,
    [
        join(root, "node_modules", "web-ext", "bin", "web-ext.js"),
        "sign",
        "--channel",
        channel,
        "--artifacts-dir",
        join(root, "dist")
    ],
    { cwd: root, env, stdio: "inherit" }
);

// Setting exitCode rather than calling process.exit lets the inherited stdio
// streams close on their own; forcing the exit mid-flush makes libuv assert on
// Windows and print a crash after the real error message.
child.on("exit", (code) => {
    if (code === 0) {
        renameArtifact(manifestVersion);
    }

    process.exitCode = code ?? 1;
});
