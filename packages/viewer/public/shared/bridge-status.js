export function createBridgeStatus(element, options = {}) {
    const settleDelayMs = options.settleDelayMs ?? 220;
    let resetTimer = null;

    function set(text, state = "open") {
        clearResetTimer();
        element.textContent = text;
        element.dataset.state = state;
        element.title = text;
    }

    function begin(text = "Writing") {
        set(text, "writing");
    }

    function finish(options = {}) {
        clearResetTimer();
        resetTimer = window.setTimeout(() => {
            resetTimer = null;
            if (options.paused) {
                set("Paused", "off");
                return;
            }

            set("Open", "open");
        }, settleDelayMs);
    }

    function open(text = "Open") {
        set(text, "open");
    }

    function off(text = "Paused") {
        set(text, "off");
    }

    function disconnected(text = "Disconnected") {
        set(text, "disconnected");
    }

    function clearResetTimer() {
        if (!resetTimer) {
            return;
        }

        window.clearTimeout(resetTimer);
        resetTimer = null;
    }

    return {
        begin,
        disconnected,
        finish,
        off,
        open,
        set,
    };
}