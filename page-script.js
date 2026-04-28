(() => {
    const installFlag = "__popupBlockerInstalled__";

    if (window[installFlag]) {
        return;
    }

    Object.defineProperty(window, installFlag, {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
    });

    const blockedOpen = () => null;

    try {
        Object.defineProperty(window, "open", {
            configurable: false,
            enumerable: true,
            get() {
                return blockedOpen;
            },
            set() {
                return true;
            }
        });
    } catch {
        window.open = blockedOpen;
    }

    function shouldBlockClick(element) {
        if (!(element instanceof Element)) {
            return false;
        }

        const clickable = element.closest("a");
        if (!(clickable instanceof HTMLAnchorElement)) {
            return false;
        }

        const href = clickable.getAttribute("href") || "";
        const inlineHandler = [
            clickable.getAttribute("onclick") || "",
            clickable.getAttribute("onmouseup") || "",
            clickable.getAttribute("onmousedown") || ""
        ].join(" ");

        const opensPopup = /window\.open|popup|popunder|popunder/i.test(inlineHandler);
        const suspiciousHref = /doubleclick|googlesyndication|adservice|popup|popunder|ads?\./i.test(href);
        const blankTarget = clickable.getAttribute("target") === "_blank" && suspiciousHref;

        return opensPopup || blankTarget;
    }

    function blockClick(event) {
        const target = event.target;

        if (!(target instanceof Element) || !shouldBlockClick(target)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    document.addEventListener("click", blockClick, true);
    document.addEventListener("auxclick", blockClick, true);
})();