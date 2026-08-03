/**
 * Isolated-world content script.
 *
 * Removes ad slots, click traps and full-screen ad interstitials that the page
 * injects at runtime. Everything that needs access to the page's own JS realm
 * (window.open, iframe injection) lives in page-script.js, which runs in the
 * MAIN world - no injection, no remote code.
 *
 * Wrapped in an IIFE because this file is registered both statically (for the
 * known hosts) and dynamically (for hosts the user grants at runtime); the two
 * can overlap, and top-level const declarations would collide on the second
 * run.
 */
(() => {
    const ext = globalThis.browser ?? globalThis.chrome;

    if (window.__popupBlockerContentActive__) {
        return;
    }

    window.__popupBlockerContentActive__ = true;

    const HOSTNAME = window.location.hostname;
    const IS_TOP = window.top === window;
    const IS_VIDMOLY = HOSTNAME === "vidmoly.biz" || HOSTNAME.endsWith(".vidmoly.biz");

    /**
     * Containers that are unambiguously ad slots. Deliberately narrow:
     * substring matches such as [id*='ads'] also hit ids like "downloads".
     */
    const AD_SELECTORS = [
        ".adsbox",
        ".adsbygoogle",
        "[id^='div-gpt-ad']",
        "[class*='ad-slot']",
        "[class*='popunder']",
        "iframe[src*='doubleclick.net']",
        "iframe[src*='googlesyndication.com']",
        "iframe[src*='adservice']",
        "iframe[src*='videocdnmetrika']",
        "iframe[src*='f.php?sid=']"
    ];

    /** Ad and click-trap containers the vidmoly player wraps around the video. */
    const VIDMOLY_SELECTORS = ["#mg_vd", "#vj_vs", ".video_ad", ".adblock-overlay"];

    const REMOVE_SELECTORS = IS_VIDMOLY ? [...AD_SELECTORS, ...VIDMOLY_SELECTORS] : AD_SELECTORS;

    /** Wording used by "click here to continue" style interstitials. */
    const OVERLAY_TEXTS = [
        "close ad",
        "continue to site",
        "click allow",
        "allow notifications",
        "reklam"
    ];

    const OVERLAY_NAME = /popunder|pop-?up|interstitial|ad-?block|adsbox|ad-?overlay/i;

    /** Never remove the page shell or anything wrapping the actual player. */
    const PROTECTED_SELF = "html, head, body, main, article, video";
    const PLAYER_CONTENT = "video, #vplayer, iframe[allowfullscreen]";

    /** Full-viewport coverage thresholds for the overlay heuristic. */
    const OVERLAY_WIDTH_RATIO = 0.5;
    const OVERLAY_HEIGHT_RATIO = 0.4;

    const SCAN_THROTTLE_MS = 200;
    const FRAME_REPORT_MS = 2000;
    const ANNOUNCE_MS = 5000;

    /** Reported by the MAIN-world script; detail is "kind|info" (Xray-safe string). */
    const BLOCK_EVENT = "popup-blocker:blocked";

    /**
     * Independently switchable subsystems.
     *
     * The two heuristic ones default to off. They judge page elements by shape
     * and naming rather than by an exact selector, which means they can and do
     * hit real page furniture; the narrow rules do not. Defaulting them off
     * keeps a first install harmless and makes each subsystem bisectable when
     * a site does break.
     */
    const MODULE_DEFAULTS = {
        ads: true,        // exact ad-container selectors
        open: true,       // window.open guard
        overlays: false,  // full-screen interstitial heuristic
        clicks: false     // click traps and synthetic navigation
    };

    let modules = { ...MODULE_DEFAULTS };
    let disabled = false;
    let debugEnabled = false;

    /**
     * Elements already proven not to be overlays. getComputedStyle plus
     * getBoundingClientRect force layout, so each element is measured once and
     * only elements that are actually fixed/sticky stay eligible for re-checks.
     */
    const settled = new WeakSet();

    // -----------------------------------------------------------------------
    // Reporting
    // -----------------------------------------------------------------------

    function log(...args) {
        if (debugEnabled) {
            console.log("%c[popup-blocker]", "color:#c0392b;font-weight:bold", ...args);
        }
    }

    function send(message) {
        try {
            ext.runtime.sendMessage(message)?.catch?.(() => {});
        } catch {
            // No receiver (extension reloading) - reporting is cosmetic.
        }
    }

    function reportBlocked(count) {
        if (count > 0) {
            send({ type: "blocked", count });
        }
    }

    /** Describes a node compactly enough to identify it in the console. */
    function describe(node) {
        const id = node.id ? `#${node.id}` : "";
        const cls = typeof node.className === "string" && node.className
            ? `.${node.className.trim().split(/\s+/).slice(0, 3).join(".")}`
            : "";
        const src = node.getAttribute?.("src");

        return `${node.tagName.toLowerCase()}${id}${cls}${src ? ` src=${src.slice(0, 80)}` : ""}`;
    }

    /**
     * Reports the third-party frames embedded here. The player hosts rotate, so
     * the popup offers whatever is actually loaded rather than a hardcoded list.
     * Only the src attribute is read - no cross-origin access is involved.
     *
     * This runs in every frame, not just the top one: a player frame embeds the
     * ad network in a further nested frame, and a popunder fired from there is
     * invisible to us until that host is granted too.
     */
    /** Below this an iframe is a share widget or a tracking pixel, not a player. */
    const PLAYER_MIN_WIDTH = 300;
    const PLAYER_MIN_HEIGHT = 150;

    /** Video embeds ask for these; share buttons and tracking pixels never do. */
    const PLAYER_ALLOW = /fullscreen|autoplay|encrypted-media|picture-in-picture/i;

    /**
     * Size alone is not enough. A player nested inside another frame is often
     * measured before its container has been laid out, and it then reads as a
     * widget forever. The permission attributes are declared in the markup, so
     * they are true regardless of when the measurement happens.
     */
    function looksLikePlayer(frame, rect) {
        if (frame.hasAttribute("allowfullscreen") || PLAYER_ALLOW.test(frame.getAttribute("allow") || "")) {
            return true;
        }

        if (rect.width >= PLAYER_MIN_WIDTH && rect.height >= PLAYER_MIN_HEIGHT) {
            return true;
        }

        // Fills its own document, whatever that document's size happens to be.
        return rect.width >= window.innerWidth * 0.5 && rect.height >= window.innerHeight * 0.3;
    }

    function collectFrames() {
        const found = new Map();

        for (const frame of document.querySelectorAll("iframe[src]")) {
            try {
                const url = new URL(frame.getAttribute("src"), window.location.href);

                if ((url.protocol !== "https:" && url.protocol !== "http:") || url.hostname === HOSTNAME) {
                    continue;
                }

                const major = looksLikePlayer(frame, frame.getBoundingClientRect());

                found.set(url.hostname, found.get(url.hostname) || major);
            } catch {
                // Relative or malformed src - nothing to offer.
            }
        }

        return [...found].map(([host, major]) => ({ host, major }));
    }

    let lastAnnounce = 0;

    /**
     * Tells the background which frame this is and what it embeds.
     *
     * Repeated on a timer rather than sent once: the background is an event
     * page, so Firefox unloads it when idle and its per-tab map goes with it.
     * Without re-announcing, the popup shows every frame as inactive a minute
     * after the page loaded, which is exactly when it gets opened.
     */
    function announce(force = false) {
        if (!force && performance.now() - lastAnnounce < FRAME_REPORT_MS) {
            return;
        }

        lastAnnounce = performance.now();

        const frames = collectFrames();

        if (frames.length > 0) {
            log("frames detected", frames.map(({ host, major }) => `${host}${major ? " (player)" : ""}`).join(", "));
        }

        send({ type: "announce", host: HOSTNAME, top: IS_TOP, frames });
    }

    // -----------------------------------------------------------------------
    // Removal
    // -----------------------------------------------------------------------

    function isProtected(node) {
        return node.matches(PROTECTED_SELF) || node.querySelector(PLAYER_CONTENT) !== null;
    }

    function normalizeText(value) {
        return value.replace(/\s+/g, " ").trim().toLowerCase();
    }

    function eachMatch(roots, selector, callback) {
        for (const root of roots) {
            if (root instanceof Element && root.matches(selector)) {
                callback(root);
            }

            root.querySelectorAll?.(selector).forEach(callback);
        }
    }

    function removeAdContainers(roots) {
        let removed = 0;

        for (const selector of REMOVE_SELECTORS) {
            eachMatch(roots, selector, (node) => {
                if (!node.isConnected || isProtected(node)) {
                    return;
                }

                log("removed ad container", describe(node), `(matched ${selector})`);
                node.remove();
                removed += 1;
            });
        }

        return removed;
    }

    /**
     * A blocking overlay is fixed or sticky, covers most of the viewport, sits
     * on a high stacking layer, and names or describes itself as an ad.
     *
     * The z-index signal is mandatory rather than one of three: an interstitial
     * has to outrank the page to block it, while a site's own large fixed
     * element that merely happens to be called something like "popup-menu" does
     * not. Treating those as interchangeable removed real page furniture.
     */
    function isBlockingOverlay(node) {
        const style = window.getComputedStyle(node);

        if (style.position !== "fixed" && style.position !== "sticky") {
            settled.add(node);
            return false;
        }

        if (style.display === "none" || style.visibility === "hidden") {
            return false;
        }

        const rect = node.getBoundingClientRect();
        const coversViewport =
            rect.width >= window.innerWidth * OVERLAY_WIDTH_RATIO &&
            rect.height >= window.innerHeight * OVERLAY_HEIGHT_RATIO;

        if (!coversViewport) {
            return false;
        }

        const zIndex = Number.parseInt(style.zIndex, 10);

        if (!Number.isFinite(zIndex) || zIndex < 1000) {
            return false;
        }

        const name = `${node.id} ${node.className}`;
        const text = normalizeText(node.textContent || "");

        return OVERLAY_NAME.test(name) || OVERLAY_TEXTS.some((pattern) => text.includes(pattern));
    }

    function removeOverlays(roots) {
        let removed = 0;

        for (const root of roots) {
            const candidates = [];

            if (root instanceof HTMLElement) {
                candidates.push(root);
            }

            if (root instanceof Element || root === document) {
                candidates.push(...root.querySelectorAll("*"));
            }

            for (const node of candidates) {
                if (!(node instanceof HTMLElement) || !node.isConnected || settled.has(node)) {
                    continue;
                }

                if (isProtected(node)) {
                    settled.add(node);
                    continue;
                }

                if (isBlockingOverlay(node)) {
                    log("removed overlay", describe(node));
                    node.remove();
                    removed += 1;
                }
            }
        }

        return removed;
    }

    /** Interstitials lock the page by pinning overflow on html/body. */
    function unlockScroll() {
        document.documentElement.style.removeProperty("overflow");
        document.body?.style.removeProperty("overflow");
    }

    // -----------------------------------------------------------------------
    // Scheduling
    // -----------------------------------------------------------------------

    let pendingRoots = [];
    let pendingFullScan = false;
    let scanTimer = 0;
    let lastScan = 0;

    function runScan() {
        scanTimer = 0;
        lastScan = performance.now();

        const roots = pendingFullScan ? [document] : pendingRoots;
        pendingRoots = [];
        pendingFullScan = false;

        if (disabled || roots.length === 0) {
            return;
        }

        const removed =
            (modules.ads ? removeAdContainers(roots) : 0) +
            (modules.overlays ? removeOverlays(roots) : 0);

        if (removed > 0) {
            unlockScroll();
            reportBlocked(removed);
        }

        announce();
    }

    function requestScan({ full = false, root = null } = {}) {
        if (disabled) {
            return;
        }

        if (full) {
            pendingFullScan = true;
        } else if (root) {
            pendingRoots.push(root);
        }

        if (scanTimer) {
            return;
        }

        const wait = Math.max(0, SCAN_THROTTLE_MS - (performance.now() - lastScan));
        scanTimer = window.setTimeout(runScan, wait);
    }

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    /**
     * The MAIN-world script and style.css both read this attribute, so the
     * toggle reaches CSS, DOM cleanup and the window.open guard through one
     * flag.
     */
    function applyState(isDisabled) {
        disabled = isDisabled;
        document.documentElement.dataset.popupBlocker = isDisabled ? "off" : "on";

        if (!isDisabled) {
            requestScan({ full: true });
        }
    }

    function applyDebug(isDebug) {
        debugEnabled = isDebug;
        document.documentElement.dataset.popupBlockerDebug = isDebug ? "on" : "off";
    }

    /** Mirrored onto <html> so the MAIN-world script reads the same switches. */
    function applyModules(next) {
        modules = { ...MODULE_DEFAULTS, ...(next || {}) };
        document.documentElement.dataset.popupBlockerModules = Object.entries(modules)
            .filter(([, on]) => on)
            .map(([name]) => name)
            .join(",");
    }

    async function readSettings() {
        try {
            return await ext.storage.local.get(["enabled", "debug", "modules"]);
        } catch {
            // Treat an unreadable preference as the default: blocking on, quiet.
            return {};
        }
    }

    // Start enabled so there is no unblocked window while storage resolves.
    applyState(false);
    applyDebug(false);
    applyModules(null);

    if (IS_TOP) {
        send({ type: "reset", host: HOSTNAME });
    }

    readSettings().then(({ enabled, debug, modules: stored }) => {
        applyDebug(debug === true);
        applyModules(stored);
        applyState(enabled === false);
        log(`ready on ${HOSTNAME}${IS_TOP ? "" : " (subframe)"}`);
        announce(true);
    });

    window.setInterval(() => announce(true), ANNOUNCE_MS);

    ext?.storage?.onChanged?.addListener((changes, area) => {
        if (area !== "local") {
            return;
        }

        if ("debug" in changes) {
            applyDebug(changes.debug.newValue === true);
        }

        if ("modules" in changes) {
            applyModules(changes.modules.newValue);
        }

        if ("enabled" in changes) {
            applyState(changes.enabled.newValue === false);
        }
    });

    // The MAIN-world script cannot reach runtime.sendMessage, so it reports
    // each block through a DOM event that this script forwards to the badge.
    document.addEventListener(BLOCK_EVENT, (event) => {
        const [kind, info = ""] = String(event.detail || "").split("|");

        log(`blocked ${kind}`, info);
        reportBlocked(1);
    });

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === "childList") {
                for (const node of mutation.addedNodes) {
                    if (node instanceof Element) {
                        requestScan({ root: node });
                    }
                }
            } else if (mutation.target instanceof Element) {
                requestScan({ root: mutation.target });
            }
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "id", "src"]
    });

    // Popunder overlays sometimes appear on the first click without a DOM
    // change the observer would catch; the throttle keeps this cheap.
    document.addEventListener("click", () => requestScan({ full: true }), true);
    window.addEventListener("load", () => requestScan({ full: true }), { once: true });
})();
