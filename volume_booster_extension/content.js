let audioCtx = null;
let gainNode = null;
let filterNode = null;
let compressorNode = null;
let mediaSources = new WeakMap(); // tracks hooked elements
let applyInterval = null;

let currentSettings = {
    volume: 100,
    speed: 1.0,
    clearAudio: false,
    active: true
};

// Initialize audio context and nodes
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        gainNode = audioCtx.createGain();

        // Dialogue/vocal clarity filter
        filterNode = audioCtx.createBiquadFilter();
        filterNode.type = 'peaking';
        filterNode.frequency.value = 2000;
        filterNode.Q.value = 0.8;
        filterNode.gain.value = 0;

        // Compressor to prevent clipping
        compressorNode = audioCtx.createDynamicsCompressor();
        compressorNode.threshold.value = -20;
        compressorNode.knee.value = 25;
        compressorNode.ratio.value = 10;
        compressorNode.attack.value = 0.005;
        compressorNode.release.value = 0.2;

        // Chain: Source -> EQ Filter -> Gain -> Compressor -> Output
        filterNode.connect(gainNode);
        gainNode.connect(compressorNode);
        compressorNode.connect(audioCtx.destination);
    }
}

// Try to hook element via Web Audio API (for >100% boost & EQ)
function tryHookElement(el) {
    if (mediaSources.has(el)) return; // already hooked
    try {
        initAudio();
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        const source = audioCtx.createMediaElementSource(el);
        source.connect(filterNode);
        mediaSources.set(el, source);
        // Once hooked, native volume must be 1.0 - gain node controls level
        el.volume = 1.0;
    } catch (e) {
        // CORS or already connected - mark as failed so we don't retry
        mediaSources.set(el, 'failed');
        console.warn('MediaBooster: Cannot hook element (CORS or unsupported). Using native volume.', e.message);
    }
}

// Apply all settings to a single media element
function applyToElement(el) {
    const active = currentSettings.active;
    const vol = currentSettings.volume;
    const speed = currentSettings.speed;

    // --- SPEED ---
    try {
        const targetSpeed = active ? speed : 1.0;
        if (Math.abs(el.playbackRate - targetSpeed) > 0.01) {
            el.playbackRate = targetSpeed;
        }
    } catch (e) {}

    // --- VOLUME ---
    if (!active) {
        // Disabled: restore native volume and bypass audio graph
        try { el.volume = 1.0; } catch (e) {}
        return;
    }

    const isHooked = mediaSources.has(el) && mediaSources.get(el) !== 'failed';
    const isFailed = mediaSources.get(el) === 'failed';

    if (vol > 100 || currentSettings.clearAudio) {
        // Need Web Audio API processing
        if (!isHooked && !isFailed) {
            tryHookElement(el);
        }

        if (mediaSources.has(el) && mediaSources.get(el) !== 'failed') {
            // Web Audio API controls volume — native volume stays at 1.0
            if (gainNode) {
                gainNode.gain.setTargetAtTime(vol / 100, audioCtx.currentTime, 0.05);
            }
            if (filterNode) {
                filterNode.gain.setTargetAtTime(
                    currentSettings.clearAudio ? 10 : 0,
                    audioCtx.currentTime, 0.05
                );
            }
            if (compressorNode) {
                compressorNode.threshold.setTargetAtTime(
                    currentSettings.clearAudio ? -30 : -20,
                    audioCtx.currentTime, 0.05
                );
            }
        } else {
            // Fallback: clamp to 100% using native volume
            try { el.volume = Math.min(vol / 100, 1.0); } catch (e) {}
        }
    } else {
        // 0-100%: use native volume directly, no Web Audio needed
        try {
            const targetVol = Math.max(0, Math.min(vol / 100, 1.0));
            if (Math.abs(el.volume - targetVol) > 0.01) {
                el.volume = targetVol;
            }
        } catch (e) {}
    }
}

// Apply to all current media elements
function applySettings() {
    const mediaElements = document.querySelectorAll('video, audio');
    mediaElements.forEach(el => applyToElement(el));

    // Update shared Audio API nodes once (not per-element)
    if (audioCtx && currentSettings.active) {
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        if (gainNode) gainNode.gain.setTargetAtTime(currentSettings.volume / 100, audioCtx.currentTime, 0.05);
        if (filterNode) filterNode.gain.setTargetAtTime(currentSettings.clearAudio ? 10 : 0, audioCtx.currentTime, 0.05);
    }
}

// Periodic enforcement — fights sites that reset playbackRate/volume
function startEnforcement() {
    if (applyInterval) clearInterval(applyInterval);
    applyInterval = setInterval(() => {
        applySettings();
    }, 800);
}

// Resume AudioContext on user interaction
function resumeCtx() {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
}
['click', 'keydown', 'mousedown', 'touchstart'].forEach(e =>
    window.addEventListener(e, resumeCtx, { passive: true })
);

// Watch for dynamically added media elements
const observer = new MutationObserver(() => {
    applySettings();
});

if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
} else {
    document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
    });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'applySettings') {
        currentSettings = { ...currentSettings, ...request.settings };
        applySettings();
        sendResponse({ success: true });
        return true;
    }
});

// Load settings on page load, then start enforcement loop
chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
    if (chrome.runtime.lastError) return; // Extension reloaded etc.
    if (response) {
        currentSettings = { ...currentSettings, ...response };
    }
    applySettings();
    startEnforcement();
});
