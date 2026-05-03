const POKI_ORIGINS = ["https://poki.com", "https://www.poki.com"];

const btnCache   = document.getElementById("clearCacheBtn");
const btnCookies = document.getElementById("clearCookiesBtn");
const btnAll     = document.getElementById("clearAllBtn");
const statusEl   = document.getElementById("status");
const allBtns    = [btnCache, btnCookies, btnAll];

// Firefox: browser.browsingData returns Promises, doesn't support origins for removeCache
// Chrome:  chrome.browsingData uses callbacks, supports origins for removeCache since v74
const isFirefox = typeof globalThis.browser?.browsingData !== "undefined";
const bd = isFirefox ? globalThis.browser.browsingData : globalThis.chrome?.browsingData;

if (!bd) {
    allBtns.forEach(b => b.disabled = true);
    showStatus("browsingData API not available.", true);
}

// Unified Promise-based caller
function bdCall(method, ...args) {
    if (isFirefox) {
        return bd[method](...args); // already returns a Promise
    }
    return new Promise((resolve, reject) => {
        bd[method](...args, () => {
            const err = globalThis.chrome?.runtime?.lastError;
            if (err) reject(new Error(err.message));
            else resolve();
        });
    });
}

async function run(action, successMsg) {
    allBtns.forEach(b => b.disabled = true);
    statusEl.textContent = "";
    statusEl.className = "";
    try {
        await action();
        showStatus(successMsg);
    } catch (e) {
        showStatus("Error: " + (e.message || e), true);
    } finally {
        allBtns.forEach(b => b.disabled = false);
    }
}

btnCache.addEventListener("click", () => {
    if (isFirefox) {
        showStatus("Firefox: изчистване на кеш по домейн не се поддържа. Само cookies.", true);
        return;
    }
    run(
        () => bdCall("removeCache", { origins: POKI_ORIGINS }),
        "Cache cleared for poki.com."
    );
});

btnCookies.addEventListener("click", () => run(
    () => bdCall("removeCookies", { origins: POKI_ORIGINS }),
    "Cookies cleared for poki.com."
));

btnAll.addEventListener("click", () => {
    if (isFirefox) {
        // Firefox supports origins only for removeCookies, not removeCache
        run(
            () => bdCall("removeCookies", { origins: POKI_ORIGINS }),
            "Cookies cleared for poki.com. (Firefox: кешът не може да се изчисти само за един домейн)"
        );
        return;
    }
    run(
        () => bdCall("remove", { origins: POKI_ORIGINS }, { cache: true, cookies: true }),
        "Cache + cookies cleared for poki.com."
    );
});

function showStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.className = isError ? "error" : "";
}
