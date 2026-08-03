/**
 * MAIN-world script.
 *
 * Neutralises popunders and click traps that can only be reached from the
 * page's own JS realm. The manifest loads this file with "world": "MAIN", so
 * nothing is injected at runtime and no code is fetched.
 */
(() => {
    const INSTALL_FLAG = "__popupBlockerInstalled__";

    if (window[INSTALL_FLAG]) {
        return;
    }

    Object.defineProperty(window, INSTALL_FLAG, {
        value: true,
        configurable: true,
        enumerable: false,
        writable: false
    });

    const HOSTNAME = window.location.hostname;
    const IS_VIDMOLY = HOSTNAME === "vidmoly.biz" || HOSTNAME.endsWith(".vidmoly.biz");

    /** All three flags are mirrored onto <html> by the isolated content script. */
    const isDisabled = () => document.documentElement?.dataset.popupBlocker === "off";
    const isDebug = () => document.documentElement?.dataset.popupBlockerDebug === "on";

    /**
     * Read lazily rather than captured once: this script runs at
     * document_start, possibly before the content script has written the
     * attribute, and the user can flip a switch while the page is open.
     */
    const MODULE_FALLBACK = "ads,open";

    function hasModule(name) {
        const value = document.documentElement?.dataset.popupBlockerModules ?? MODULE_FALLBACK;

        return value.split(",").includes(name);
    }

    const isActive = (name) => !isDisabled() && hasModule(name);

    const BLOCK_EVENT = "popup-blocker:blocked";

    /**
     * Reports a block to the isolated content script, which owns the badge and
     * the console output. The detail is a plain string so it survives Xray
     * vision between the page realm and the extension realm.
     */
    function reportBlocked(kind, info = "") {
        try {
            document.dispatchEvent(new CustomEvent(BLOCK_EVENT, { detail: `${kind}|${info}` }));
        } catch {
            // Reporting is diagnostics only - never let it break blocking.
        }
    }

    /**
     * Logs what got through. The content script only sees blocks, so this is
     * the one place a leaking popunder becomes visible.
     */
    function reportAllowed(kind, info) {
        if (isDebug()) {
            console.warn("%c[popup-blocker]", "color:#e67e22;font-weight:bold", `ALLOWED ${kind}`, info);
        }
    }

    const TRACKER_SRC = /videocdnmetrika|f\.php\?sid=/i;

    /**
     * Known ad/popunder hosts. Kept short on purpose - a domain list is
     * whack-a-mole and a real blocklist extension does it better. The
     * structural checks below are what catch an unknown network.
     */
    const AD_URL = /doubleclick|googlesyndication|adservice|popunder|popads|propeller|onclick(ads|per)|webls\.net/i;

    /**
     * Affiliate tracking parameters. A link carrying a click id is a paid
     * redirect, whatever the host is called.
     */
    const TRACKING_PARAM = /[?&](click_?id|zone_?id|sub_?id|spot_?id|campaign_?id|aff_?id|pub_?id)=/i;

    function isCrossOrigin(url) {
        try {
            return new URL(String(url), window.location.href).origin !== window.location.origin;
        } catch {
            return false;
        }
    }

    // ---------------------------------------------------------------------
    // window.open
    // ---------------------------------------------------------------------

    const GESTURE_WINDOW_MS = 1000;

    let lastGesture = 0;
    let opensSinceGesture = 0;

    function noteGesture(event) {
        if (!event.isTrusted) {
            return;
        }

        lastGesture = performance.now();
        opensSinceGesture = 0;
    }

    for (const type of ["pointerdown", "mousedown", "keydown"]) {
        window.addEventListener(type, noteGesture, true);
    }

    const nativeOpen = window.open;

    /**
     * Allows only a same-origin window opened by a real user gesture, one per
     * gesture. Every popunder here is cross-origin, fires without a gesture,
     * or stacks several windows onto one click, so all three are refused.
     * Plain <a target="_blank"> links do not go through window.open and keep
     * working.
     */
    function guardedOpen(url = "", target, features) {
        if (!isActive("open")) {
            return nativeOpen.call(window, url, target, features);
        }

        const withinGesture = performance.now() - lastGesture < GESTURE_WINDOW_MS;

        let target_url = null;
        try {
            target_url = new URL(String(url), window.location.href);
        } catch {
            target_url = null;
        }

        const sameOrigin = target_url?.origin === window.location.origin;

        /**
         * A tab-under opens *this* page in a new tab and then navigates the
         * original one to the ad, which turns the same-origin allowance into a
         * hole. Reopening the page you are already on is never a real feature,
         * and neither is window.open("") - both are the same trick.
         */
        const stripHash = (href) => href.split("#")[0];
        const reopensSelf =
            !target_url || stripHash(target_url.href) === stripHash(window.location.href);

        const reason =
            (AD_URL.test(String(url)) && "ad url") ||
            (reopensSelf && "tab-under (reopens this page)") ||
            (!withinGesture && "no user gesture") ||
            (!sameOrigin && "cross-origin") ||
            (opensSinceGesture > 0 && "second window for one gesture");

        if (reason) {
            reportBlocked("window.open", `${String(url).slice(0, 120)} (${reason})`);
            return null;
        }

        opensSinceGesture += 1;
        reportAllowed("window.open", String(url).slice(0, 120));
        return nativeOpen.call(window, url, target, features);
    }

    try {
        Object.defineProperty(window, "open", {
            configurable: true,
            enumerable: true,
            get() {
                return guardedOpen;
            },
            set() {
                // Swallow the assignment so ad scripts cannot restore the
                // native window.open, but stay configurable so the property
                // can still be cleaned up.
                return true;
            }
        });
    } catch {
        window.open = guardedOpen;
    }

    // ---------------------------------------------------------------------
    // Click traps
    // ---------------------------------------------------------------------

    function describeTarget(element) {
        const anchor = element.closest("a");

        if (anchor instanceof HTMLAnchorElement) {
            return (anchor.getAttribute("href") || "").slice(0, 120);
        }

        return element.tagName.toLowerCase();
    }

    /** Returns { anchor, reason, trap? } when the click should be cancelled. */
    function blockReasonFor(element) {
        if (!(element instanceof Element)) {
            return null;
        }

        if (IS_VIDMOLY) {
            const iframe = element.closest("iframe");

            if (iframe instanceof HTMLIFrameElement && TRACKER_SRC.test(iframe.getAttribute("src") || "")) {
                return { anchor: null, reason: "tracker iframe" };
            }
        }

        const anchor = element.closest("a");

        if (!(anchor instanceof HTMLAnchorElement)) {
            return null;
        }

        const href = anchor.getAttribute("href") || "";
        const inlineHandler = [
            anchor.getAttribute("onclick") || "",
            anchor.getAttribute("onmouseup") || "",
            anchor.getAttribute("onmousedown") || ""
        ].join(" ");

        // "popup" on its own is not a signal: sites name their own lightboxes
        // openPopup(), showPopup() and so on, and matching those cancels the
        // page's real buttons.
        if (/window\.open|popunder/i.test(inlineHandler)) {
            return { anchor, reason: "inline popup handler" };
        }

        const newTab = anchor.getAttribute("target") === "_blank";

        if (newTab && (AD_URL.test(href) || TRACKING_PARAM.test(href))) {
            return { anchor, reason: "ad destination" };
        }

        if (isClickTrap(anchor, href, newTab)) {
            return { anchor, reason: "click trap", trap: true };
        }

        return null;
    }

    /**
     * A click trap is an anchor stretched over the content so any click lands
     * on it. "No text" alone is not enough: icon links draw themselves with a
     * CSS background and are labelled for screen readers, so the size check is
     * what separates a trap from a legitimate button.
     */
    function isClickTrap(anchor, href, newTab) {
        if (!newTab || !isCrossOrigin(href)) {
            return false;
        }

        if (anchor.textContent.trim() || anchor.querySelector("img, svg, picture, video")) {
            return false;
        }

        if (anchor.getAttribute("aria-label") || anchor.getAttribute("title")) {
            return false;
        }

        const rect = anchor.getBoundingClientRect();

        return rect.width >= window.innerWidth * 0.5 && rect.height >= window.innerHeight * 0.3;
    }

    /**
     * Programmatic navigation to a new tab. Only refused when the destination
     * itself looks like an ad: sites legitimately build an anchor and call
     * .click() on it for downloads and mirror links, and blocking those on the
     * strength of "cross-origin _blank" alone breaks real features.
     */
    function shouldBlockSynthetic(href) {
        return AD_URL.test(String(href)) || TRACKING_PARAM.test(String(href));
    }

    /**
     * Circuit breaker.
     *
     * Cancelling a click is invisible to the user: if the guard starts matching
     * something it should not, the page simply stops responding and there is no
     * way to tell why. A burst of blocks is never legitimate - a popunder fires
     * once or twice - so past this rate the guard stands down for the rest of
     * the page and says so.
     */
    const BLOCK_BURST_LIMIT = 8;
    const BLOCK_BURST_WINDOW_MS = 10000;

    let blockTimes = [];
    let clickGuardTripped = false;

    function withinBudget() {
        const now = performance.now();

        blockTimes = blockTimes.filter((time) => now - time < BLOCK_BURST_WINDOW_MS);
        blockTimes.push(now);

        if (blockTimes.length <= BLOCK_BURST_LIMIT) {
            return true;
        }

        clickGuardTripped = true;
        reportBlocked("click guard stood down", `over ${BLOCK_BURST_LIMIT} blocked clicks in ${BLOCK_BURST_WINDOW_MS / 1000}s`);
        return false;
    }

    /**
     * Cancelling the click leaves the trap sitting on top of the page, so every
     * following click hits it too and nothing underneath is reachable. Killing
     * its pointer events hands the page back to the user.
     */
    function defuseTrap(anchor) {
        anchor.style.setProperty("pointer-events", "none", "important");
    }

    function blockClick(event) {
        if (clickGuardTripped || !isActive("clicks") || !(event.target instanceof Element)) {
            return;
        }

        const match = blockReasonFor(event.target);

        if (!match) {
            // A new-tab anchor that survived the checks is the most likely way
            // a popunder still gets through; surface it in debug mode.
            const anchor = event.target.closest('a[target="_blank"]');

            if (anchor) {
                reportAllowed("new-tab click", anchor.getAttribute("href") || "");
            }

            return;
        }

        if (!withinBudget()) {
            return;
        }

        if (match.trap && match.anchor) {
            defuseTrap(match.anchor);
        }

        reportBlocked(match.reason, describeTarget(event.target));

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    document.addEventListener("click", blockClick, true);
    document.addEventListener("auxclick", blockClick, true);

    // ---------------------------------------------------------------------
    // Synthetic navigation
    //
    // A capture-phase click listener never sees anchor.click() or
    // form.submit(), because neither dispatches a trusted event the guard
    // above can cancel. These are the paths a popunder uses once window.open
    // is taken away from it.
    // ---------------------------------------------------------------------

    const nativeAnchorClick = HTMLAnchorElement.prototype.click;

    HTMLAnchorElement.prototype.click = function anchorClickPatched(...args) {
        const href = this.getAttribute("href") || "";

        if (isActive("clicks") && shouldBlockSynthetic(href)) {
            reportBlocked("synthetic anchor click", href.slice(0, 120));
            return undefined;
        }

        return nativeAnchorClick.apply(this, args);
    };

    const nativeFormSubmit = HTMLFormElement.prototype.submit;

    HTMLFormElement.prototype.submit = function formSubmitPatched(...args) {
        const action = this.getAttribute("action") || "";

        if (isActive("clicks") && shouldBlockSynthetic(action)) {
            reportBlocked("form popunder", action.slice(0, 120));
            return undefined;
        }

        return nativeFormSubmit.apply(this, args);
    };

    // ---------------------------------------------------------------------
    // Injected tracker iframes (vidmoly)
    // ---------------------------------------------------------------------

    if (!IS_VIDMOLY) {
        return;
    }

    /**
     * Keeps the node in the DOM - page code often reads back what it just
     * inserted - but stops it from loading and from receiving clicks.
     */
    function neutralize(node) {
        if (!isActive("ads") || !(node instanceof HTMLIFrameElement)) {
            return;
        }

        const src = node.getAttribute("src") || "";
        const style = node.getAttribute("style") || "";
        const isTracker = TRACKER_SRC.test(src);
        const isTinyFixed =
            /position:\s*fixed/i.test(style) &&
            /width:\s*[01](px)?\b/i.test(style) &&
            /height:\s*[01](px)?\b/i.test(style);

        if (!isTracker && !isTinyFixed) {
            return;
        }

        reportBlocked("injected iframe", src.slice(0, 120) || "(tiny fixed frame)");

        node.setAttribute("src", "about:blank");
        node.setAttribute("aria-hidden", "true");
        node.style.setProperty("display", "none", "important");
        node.style.setProperty("pointer-events", "none", "important");
    }

    const nativeAppendChild = Node.prototype.appendChild;
    const nativeInsertBefore = Node.prototype.insertBefore;

    Node.prototype.appendChild = function appendChildPatched(node) {
        neutralize(node);
        return nativeAppendChild.call(this, node);
    };

    Node.prototype.insertBefore = function insertBeforePatched(node, child) {
        neutralize(node);
        return nativeInsertBefore.call(this, node, child);
    };
})();
