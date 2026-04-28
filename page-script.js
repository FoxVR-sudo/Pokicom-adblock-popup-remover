(() => {
    const installFlag = "__popupBlockerInstalled__";
    const hostname = window.location.hostname;
    const isFilmizip = hostname === "filmizip.com" || hostname.endsWith(".filmizip.com");
    const isVidmoly = hostname === "vidmoly.biz" || hostname.endsWith(".vidmoly.biz");

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

        if (isVidmoly) {
            const iframe = element.closest("iframe");
            if (iframe instanceof HTMLIFrameElement) {
                const src = iframe.getAttribute("src") || "";
                if (src.includes("videocdnmetrika") || src.includes("f.php?sid=")) {
                    return true;
                }
            }
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

    if (isVidmoly) {
        const originalAppendChild = Element.prototype.appendChild;
        const originalInsertBefore = Element.prototype.insertBefore;

        function shouldBlockNode(node) {
            if (!(node instanceof HTMLIFrameElement)) {
                return false;
            }

            const src = node.getAttribute("src") || "";
            const style = node.getAttribute("style") || "";
            const looksLikeTracker = src.includes("videocdnmetrika") || src.includes("f.php?sid=");
            const looksTinyFixed = /position:\s*fixed/i.test(style) && /width:\s*1px/i.test(style) && /height:\s*1px/i.test(style);

            return looksLikeTracker || looksTinyFixed;
        }

        Element.prototype.appendChild = function appendChildPatched(node) {
            if (shouldBlockNode(node)) {
                return node;
            }

            return originalAppendChild.call(this, node);
        };

        Element.prototype.insertBefore = function insertBeforePatched(node, child) {
            if (shouldBlockNode(node)) {
                return node;
            }

            return originalInsertBefore.call(this, node, child);
        };
    }

    document.addEventListener("click", blockClick, true);
    document.addEventListener("auxclick", blockClick, true);
})();