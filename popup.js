const POKI_ORIGINS = [
    "https://poki.com",
    "https://www.poki.com"
];

const btnCache   = document.getElementById("clearCacheBtn");
const btnCookies = document.getElementById("clearCookiesBtn");
const btnAll     = document.getElementById("clearAllBtn");
const status     = document.getElementById("status");

const browsingData = globalThis.chrome?.browsingData || globalThis.browser?.browsingData;

const allBtns = [btnCache, btnCookies, btnAll];

if (!browsingData) {
    allBtns.forEach(b => b.disabled = true);
    showStatus("browsingData API not available.", true);
}

btnCache.addEventListener("click", () => {
    run(
        (cb) => browsingData.removeCache({ origins: POKI_ORIGINS }, cb),
        "Cache cleared for poki.com."
    );
});

btnCookies.addEventListener("click", () => {
    run(
        (cb) => browsingData.removeCookies({ origins: POKI_ORIGINS }, cb),
        "Cookies cleared for poki.com."
    );
});

btnAll.addEventListener("click", () => {
    run(
        (cb) => browsingData.remove(
            { origins: POKI_ORIGINS },
            { cache: true, cookies: true },
            cb
        ),
        "Cache + cookies cleared for poki.com."
    );
});

function run(action, successMsg) {
    allBtns.forEach(b => b.disabled = true);
    status.textContent = "";
    status.className = "";

    action(() => {
        const err = globalThis.chrome?.runtime?.lastError;
        if (err) {
            showStatus("Error: " + err.message, true);
        } else {
            showStatus(successMsg);
        }
        allBtns.forEach(b => b.disabled = false);
    });
}

function showStatus(msg, isError = false) {
    status.textContent = msg;
    status.className = isError ? "error" : "";
}
