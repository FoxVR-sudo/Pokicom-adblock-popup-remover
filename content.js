function removePopups() {
    const elements = document.querySelectorAll("div, section");

    elements.forEach(el => {
        const text = el.innerText || "";

        if (
            text.includes("Watch a short ad") ||
            text.includes("Not enough hints") ||
            text.includes("get more hints")
        ) {
            el.remove();
            console.log("Popup removed:", text);
        }
    });
}

// стартиране веднага
removePopups();

// следене за нови popup-и (важно!)
const observer = new MutationObserver(() => {
    removePopups();
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});
