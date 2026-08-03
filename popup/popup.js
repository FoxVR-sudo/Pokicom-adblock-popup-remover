const ext = globalThis.browser ?? globalThis.chrome;

/** Must match MODULE_DEFAULTS in content.js. */
const MODULE_DEFAULTS = { ads: true, open: true, overlays: false, clicks: false };

const HINT_ON = "Active on filmizip.com and its embeds. The badge counts blocked items on the current tab.";
const HINT_OFF = "Disabled. Reload open tabs to restore removed elements.";

/**
 * Firefox closes the popup as soon as it shows the permission doorhanger, so a
 * grant looks like nothing happened. The result is only visible on reopen.
 */
const REOPEN_NOTE = "Firefox closes this popup while it asks for permission. Reopen it to see the result.";

/**
 * Firefox reports the manifest's content_script matches from
 * permissions.getAll() alongside real grants. Listing those as things the user
 * enabled is wrong twice over: they were never asked, and permissions.remove()
 * cannot revoke them, so the button next to them does nothing.
 */
const MANIFEST_ORIGINS = new Set(
    (ext.runtime.getManifest().content_scripts || []).flatMap((script) => script.matches || [])
);

const enabledBox = document.getElementById("enabled");
const debugBox = document.getElementById("debug");
const hint = document.getElementById("hint");
const framesList = document.getElementById("frames");
const framesHint = document.getElementById("frames-hint");
const enableAllButton = document.getElementById("enable-all");
const grantedHeading = document.getElementById("granted-heading");
const grantedList = document.getElementById("granted");
const grantedHint = document.getElementById("granted-hint");

function renderEnabled(enabled) {
    enabledBox.checked = enabled;
    hint.textContent = enabled ? HINT_ON : HINT_OFF;
}

/**
 * tabs.query returns the tab id without the "tabs" permission; only url,
 * title and favIconUrl are withheld, and none of those are needed here.
 */
async function activeTabId() {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });

    return tab?.id;
}

function originFor(host) {
    return `*://${host}/*`;
}

/** "*://abstream.to/*" -> "abstream.to" */
function hostFromOrigin(origin) {
    return origin.replace(/^\*:\/\//, "").replace(/\/\*$/, "");
}

function row(host, label, ok) {
    const item = document.createElement("li");
    const name = document.createElement("span");

    name.className = "host";
    name.textContent = host;
    item.append(name);

    const state = document.createElement("span");

    state.className = ok ? "state ok" : "state";
    state.textContent = label;
    item.append(state);

    return item;
}

function button(text, onClick) {
    const element = document.createElement("button");

    element.type = "button";
    element.textContent = text;
    element.addEventListener("click", onClick);

    return element;
}

/**
 * Players are embedded from short-lived domains, so the page reports whatever
 * it actually loaded and each host is granted individually here. Host strings
 * come from the page, so they are only ever written with textContent.
 */
function renderFrames(frames) {
    framesList.replaceChildren();

    const pending = frames.filter((frame) => !frame.covered && !frame.granted);
    const covered = frames.filter((frame) => frame.covered || frame.granted);

    // Only the player-sized frames are offered in bulk. Share buttons and
    // tracking pixels never fire popunders, and granting access to them just
    // widens what the extension can read for nothing.
    const players = pending.filter((frame) => frame.major);

    enableAllButton.hidden = players.length === 0;
    enableAllButton.textContent = `Enable ${players.length} player${players.length === 1 ? "" : "s"}`;
    enableAllButton.onclick = () => grant(players.map((frame) => originFor(frame.host)));

    if (frames.length <= 1) {
        framesHint.textContent =
            "No player frames seen yet. Open a film, wait for the player to appear, then reopen this popup.";
    }

    for (const frame of frames) {
        let label = "off";

        if (frame.active) {
            label = frame.covered ? "built in" : "on";
        } else if (frame.covered) {
            label = "built in - reload";
        } else if (frame.granted) {
            label = "on - reload";
        }

        // Only worth flagging where it changes what the user should do; for a
        // built-in host the classification is irrelevant.
        if (!frame.page && !frame.major && !frame.covered) {
            label = `widget - ${label}`;
        }

        const item = row(frame.host, label, frame.active);

        if (!frame.covered) {
            item.append(
                frame.granted
                    ? button("Disable", () => revoke([originFor(frame.host)]))
                    : button("Enable", () => grant([originFor(frame.host)]))
            );
        }

        framesList.append(item);
    }

    if (frames.length > 1) {
        framesHint.textContent = `${covered.length} of ${frames.length} covered. ${REOPEN_NOTE}`;
    }
}

/**
 * Every host granted so far, not just the ones on this page - the popup is the
 * only place these can be reviewed, and "what did I actually enable?" is not
 * answerable from the per-page list alone.
 */
function renderGranted(origins) {
    grantedList.replaceChildren();
    grantedHeading.textContent = `Enabled hosts (${origins.length})`;

    if (origins.length === 0) {
        grantedHint.textContent = "None yet. Enable a player above to let the blocker run inside it.";
        return;
    }

    grantedHint.textContent = "Granted by you. Revoking takes effect on the next page load.";

    for (const origin of origins) {
        const item = row(hostFromOrigin(origin), "", false);

        item.append(button("Remove", () => revoke([origin])));
        grantedList.append(item);
    }
}

async function grant(origins) {
    try {
        await ext.permissions.request({ origins });
    } catch {
        // The user dismissed the prompt, or the popup closed underneath it.
    }

    refresh();
}

async function revoke(origins) {
    try {
        await ext.permissions.remove({ origins });
    } catch {
        // Nothing to revoke.
    }

    refresh();
}

async function refresh() {
    const { origins = [] } = await ext.permissions.getAll();

    const userGranted = origins
        .filter((origin) => !MANIFEST_ORIGINS.has(origin))
        .filter((origin) => origin !== "*://*/*" && origin !== "<all_urls>")
        .sort();

    renderGranted(userGranted);

    const tabId = await activeTabId();

    if (tabId === undefined) {
        renderFrames([]);
        return;
    }

    const state = await ext.runtime.sendMessage({ type: "getState", tabId });

    renderFrames(state?.frames || []);
}

const moduleBoxes = Object.fromEntries(
    Object.keys(MODULE_DEFAULTS).map((name) => [name, document.getElementById(`mod-${name}`)])
);

function renderModules(stored) {
    const modules = { ...MODULE_DEFAULTS, ...(stored || {}) };

    for (const [name, box] of Object.entries(moduleBoxes)) {
        box.checked = modules[name];
    }

    return modules;
}

let modules = renderModules(null);

for (const [name, box] of Object.entries(moduleBoxes)) {
    box.addEventListener("change", () => {
        modules = { ...modules, [name]: box.checked };
        ext.storage.local.set({ modules });
    });
}

ext.storage.local
    .get(["enabled", "debug", "modules"])
    .then(({ enabled, debug, modules: stored }) => {
        renderEnabled(enabled !== false);
        debugBox.checked = debug === true;
        modules = renderModules(stored);
    })
    .catch(() => renderEnabled(true));

enabledBox.addEventListener("change", () => {
    renderEnabled(enabledBox.checked);
    ext.storage.local.set({ enabled: enabledBox.checked });
});

debugBox.addEventListener("change", () => {
    ext.storage.local.set({ debug: debugBox.checked });
});

refresh();
