/**
 * Owns three things the content scripts cannot do themselves:
 *
 * - the per-tab badge count, so it is visible whether anything was blocked
 * - the list of third-party player frames seen on each tab, which is what the
 *   popup offers the user to enable
 * - registering content scripts on hosts the user has granted at runtime
 *
 * Filmizip embeds its players from short-lived, rotating domains, so a static
 * match list in the manifest goes stale within weeks. Instead the manifest
 * ships with no broad host access at all and the user grants a player host
 * from the popup when they meet it.
 */

const ext = globalThis.browser ?? globalThis.chrome;

/** Hosts already covered by the static content_scripts in the manifest. */
const STATIC_HOSTS = ["filmizip.com", "vidmoly.biz"];

const ISOLATED_ID = "dynamic-isolated";
const MAIN_ID = "dynamic-main";

/** tabId -> { host, frames: Map<host, major>, active: Set<string>, blocked: number } */
const tabs = new Map();

function stateFor(tabId) {
    let state = tabs.get(tabId);

    if (!state) {
        state = { host: "", frames: new Map(), active: new Set(), blocked: 0 };
        tabs.set(tabId, state);
    }

    return state;
}

function isCovered(host) {
    return STATIC_HOSTS.some((base) => host === base || host.endsWith(`.${base}`));
}

function originFor(host) {
    return `*://${host}/*`;
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function renderBadge(tabId) {
    const { blocked } = stateFor(tabId);

    ext.action.setBadgeText({ tabId, text: blocked > 0 ? String(blocked) : "" });
    ext.action.setBadgeBackgroundColor({ tabId, color: "#c0392b" });
}

// ---------------------------------------------------------------------------
// Dynamic content scripts
// ---------------------------------------------------------------------------

async function grantedOrigins() {
    const { origins = [] } = await ext.permissions.getAll();

    // "*://*/*" is only ever the optional declaration, never something we ask
    // for as a whole; registering it would defeat the point of this design.
    return origins.filter((origin) => origin !== "*://*/*" && origin !== "<all_urls>");
}

/**
 * Rebuilds the dynamic registrations from scratch. Re-registering an existing
 * id throws, and registrations persist across restarts, so the previous set is
 * always removed first.
 */
async function syncDynamicScripts() {
    try {
        const existing = await ext.scripting.getRegisteredContentScripts({ ids: [ISOLATED_ID, MAIN_ID] });

        if (existing.length > 0) {
            await ext.scripting.unregisterContentScripts({ ids: existing.map((script) => script.id) });
        }
    } catch {
        // Nothing registered yet.
    }

    const matches = await grantedOrigins();

    if (matches.length === 0) {
        return;
    }

    await ext.scripting.registerContentScripts([
        {
            id: ISOLATED_ID,
            matches,
            js: ["content.js"],
            css: ["style.css"],
            runAt: "document_start",
            allFrames: true,
            persistAcrossSessions: true
        },
        {
            id: MAIN_ID,
            matches,
            js: ["page-script.js"],
            world: "MAIN",
            runAt: "document_start",
            allFrames: true,
            persistAcrossSessions: true
        }
    ]);
}

ext.permissions.onAdded.addListener(syncDynamicScripts);
ext.permissions.onRemoved.addListener(syncDynamicScripts);
ext.runtime.onInstalled.addListener(syncDynamicScripts);
ext.runtime.onStartup?.addListener(syncDynamicScripts);

syncDynamicScripts();

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

async function describeTab(tabId) {
    const state = stateFor(tabId);
    const entries = new Map(state.frames);

    if (state.host) {
        entries.set(state.host, true);
    }

    const frames = [];

    for (const [host, major] of entries) {
        frames.push({
            host,
            major,
            covered: isCovered(host),
            granted: await ext.permissions.contains({ origins: [originFor(host)] }),
            active: state.active.has(host),
            page: host === state.host
        });
    }

    // The page itself first, then players, then widgets alphabetically.
    frames.sort(
        (a, b) =>
            Number(b.page) - Number(a.page) ||
            Number(b.major) - Number(a.major) ||
            a.host.localeCompare(b.host)
    );

    return { host: state.host, blocked: state.blocked, frames };
}

ext.runtime.onMessage.addListener((message, sender) => {
    if (!message) {
        return undefined;
    }

    // Only the popup asks for state, and it has no sender.tab.
    if (message.type === "getState") {
        return describeTab(message.tabId);
    }

    const tabId = sender.tab?.id;

    if (tabId === undefined) {
        return undefined;
    }

    const state = stateFor(tabId);

    if (message.type === "reset") {
        state.blocked = 0;
        state.frames.clear();
        state.active.clear();
        state.host = message.host || "";
    } else if (message.type === "blocked") {
        state.blocked += Number(message.count) || 1;
    } else if (message.type === "announce") {
        // Rebuilds everything except the block count, so a restarted event page
        // recovers within one announce interval.
        state.active.add(message.host);

        if (message.top) {
            state.host = message.host;
        }

        for (const { host, major } of message.frames || []) {
            state.frames.set(host, state.frames.get(host) || major);
        }

        return undefined;
    } else {
        return undefined;
    }

    renderBadge(tabId);
    return undefined;
});

ext.tabs.onRemoved.addListener((tabId) => tabs.delete(tabId));
