const runtime = globalThis.chrome?.runtime || globalThis.browser?.runtime;

const siteRules = [
    {
        host: "poki.com",
        texts: [
            "watch a short ad",
            "not enough hints",
            "get more hints",
            "rewarded ad",
            "continue with ads"
        ],
        selectors: [
            "[data-testid*='modal']",
            "[class*='modal']",
            "[class*='popup']",
            "[class*='overlay']"
        ]
    },
    {
        host: "filmizip.com",
        texts: [
            "close ad",
            "continue to site",
            "click allow",
            "notification",
            "reklam",
            "advertisement"
        ],
        selectors: [
            ".adsbox",
            ".adsbygoogle",
            "[id*='ads']",
            "[class*='ads']",
            "[class*='banner']",
            "[class*='popunder']"
        ]
    }
];

const genericSelectors = [
    "dialog",
    "[role='dialog']",
    "[aria-modal='true']",
    ".modal",
    ".modal-backdrop",
    ".popup",
    ".pop-up",
    ".overlay",
    "iframe[src*='doubleclick.net']",
    "iframe[src*='googlesyndication.com']",
    "iframe[src*='adservice']"
];

const hostname = window.location.hostname;
const activeRules = siteRules.filter(({ host }) => hostname === host || hostname.endsWith(`.${host}`));
const blockedTexts = activeRules.flatMap(({ texts }) => texts).map((text) => text.toLowerCase());
const blockedSelectors = [...new Set([...genericSelectors, ...activeRules.flatMap(({ selectors }) => selectors)])];

function injectPageScript() {
    if (!runtime?.getURL || document.documentElement.dataset.popupBlockerInjected === "true") {
        return;
    }

    const script = document.createElement("script");
    script.src = runtime.getURL("page-script.js");
    script.async = false;
    script.onload = () => script.remove();
    script.onerror = () => script.remove();

    document.documentElement.dataset.popupBlockerInjected = "true";
    (document.head || document.documentElement).appendChild(script);
}

function normalizeText(value) {
    return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function removeNode(node) {
    if (!(node instanceof Element) || !node.isConnected) {
        return;
    }

    node.remove();
}

function unlockScroll() {
    if (!document.querySelector("dialog, [role='dialog'], [aria-modal='true'], .modal, .popup, .overlay")) {
        document.documentElement.style.removeProperty("overflow");
        document.body?.style.removeProperty("overflow");
    }
}

function removeBySelectors() {
    blockedSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach(removeNode);
    });
}

function removeByText() {
    if (blockedTexts.length === 0) {
        return;
    }

    const candidates = document.querySelectorAll("div, section, aside, dialog, article");

    candidates.forEach((node) => {
        const text = normalizeText(node.textContent || "");

        if (!text || !blockedTexts.some((pattern) => text.includes(pattern))) {
            return;
        }

        const blockingParent = node.closest("dialog, [role='dialog'], [aria-modal='true'], .modal, .popup, .pop-up, .overlay");
        removeNode(blockingParent || node);
    });
}

function removeBlockingLayers() {
    const elements = document.body?.querySelectorAll("body *") || [];

    elements.forEach((node) => {
        if (!(node instanceof HTMLElement)) {
            return;
        }

        const computedStyle = window.getComputedStyle(node);
        if (computedStyle.position !== "fixed" && computedStyle.position !== "sticky") {
            return;
        }

        const rect = node.getBoundingClientRect();
        const zIndex = Number.parseInt(computedStyle.zIndex, 10);
        const classOrId = `${node.id} ${node.className}`.toLowerCase();
        const text = normalizeText(node.textContent || "");
        const looksLikeOverlay = rect.width >= window.innerWidth * 0.3 && rect.height >= window.innerHeight * 0.15;
        const suspiciousName = /ad|ads|popup|popunder|overlay|modal|banner/.test(classOrId);
        const suspiciousText = blockedTexts.some((pattern) => text.includes(pattern));

        if (looksLikeOverlay && (zIndex >= 999 || suspiciousName || suspiciousText)) {
            removeNode(node);
        }
    });
}

function runCleanup() {
    removeBySelectors();
    removeByText();
    removeBlockingLayers();
    unlockScroll();
}

let cleanupQueued = false;

function scheduleCleanup() {
    if (cleanupQueued) {
        return;
    }

    cleanupQueued = true;
    window.requestAnimationFrame(() => {
        cleanupQueued = false;
        runCleanup();
    });
}

injectPageScript();
scheduleCleanup();

document.addEventListener("click", scheduleCleanup, true);
window.addEventListener("load", scheduleCleanup, { once: true });

const observer = new MutationObserver(scheduleCleanup);

observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "id", "src"]
});
