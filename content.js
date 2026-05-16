let audioCtx = null;
let gainNode = null;
let filterNode = null;
let compressorNode = null;
let mediaSources = new WeakMap();
let applyInterval = null;

let currentSettings = {
    volume: 100,
    speed: 1.0,
    clearAudio: false,
    active: true
};

// ─── Audio Setup ──────────────────────────────────────────────────────────────

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        gainNode = audioCtx.createGain();
        gainNode.gain.value = 1.0;

        filterNode = audioCtx.createBiquadFilter();
        filterNode.type = 'peaking';
        filterNode.frequency.value = 2000;
        filterNode.Q.value = 0.8;
        filterNode.gain.value = 0;

        compressorNode = audioCtx.createDynamicsCompressor();
        compressorNode.threshold.value = -20;
        compressorNode.knee.value = 25;
        compressorNode.ratio.value = 10;
        compressorNode.attack.value = 0.005;
        compressorNode.release.value = 0.2;

        filterNode.connect(gainNode);
        gainNode.connect(compressorNode);
        compressorNode.connect(audioCtx.destination);
    }
}

function tryHookElement(el) {
    if (mediaSources.has(el)) return;
    try {
        initAudio();
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        const source = audioCtx.createMediaElementSource(el);
        source.connect(filterNode);
        mediaSources.set(el, source);
        el.volume = 1.0; // gain node controls level
    } catch (e) {
        mediaSources.set(el, 'failed');
    }
}

// ─── Apply Settings ───────────────────────────────────────────────────────────

function applyToElement(el) {
    const { active, volume, speed, clearAudio } = currentSettings;

    // Speed
    try {
        const targetSpeed = active ? speed : 1.0;
        if (Math.abs(el.playbackRate - targetSpeed) > 0.01) {
            el.playbackRate = targetSpeed;
        }
    } catch (e) {}

    if (!active) {
        try { el.volume = 1.0; } catch (e) {}
        return;
    }

    const isHooked = mediaSources.has(el) && mediaSources.get(el) !== 'failed';
    const isFailed = mediaSources.get(el) === 'failed';

    if (volume > 100 || clearAudio) {
        // Need Web Audio processing
        if (!isHooked && !isFailed) tryHookElement(el);

        if (mediaSources.has(el) && mediaSources.get(el) !== 'failed') {
            // Web Audio API controls everything; native volume stays at 1.0
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
            if (gainNode) gainNode.gain.setTargetAtTime(volume / 100, audioCtx.currentTime, 0.05);
            if (filterNode) filterNode.gain.setTargetAtTime(clearAudio ? 10 : 0, audioCtx.currentTime, 0.05);
            if (compressorNode) compressorNode.threshold.setTargetAtTime(clearAudio ? -30 : -20, audioCtx.currentTime, 0.05);
        } else {
            // CORS blocked – fall back to native volume (capped at 1.0)
            try { el.volume = Math.min(volume / 100, 1.0); } catch (e) {}
        }
    } else {
        // 0–100%: use native volume directly
        try {
            const target = Math.max(0, Math.min(volume / 100, 1.0));
            if (Math.abs(el.volume - target) > 0.01) el.volume = target;
        } catch (e) {}
    }
}

function applySettings() {
    document.querySelectorAll('video, audio').forEach(el => applyToElement(el));
}

function startEnforcement() {
    if (applyInterval) clearInterval(applyInterval);
    applyInterval = setInterval(applySettings, 800);
}

// ─── Load Settings Directly From Storage (bypasses suspended service worker) ──

function loadFromStorage() {
    const domain = window.location.hostname;

    chrome.storage.local.get(['tabSettings', 'domainSettings', 'globalSettings'], (data) => {
        if (chrome.runtime.lastError) return;

        let settings = { volume: 100, speed: 1.0, clearAudio: false, active: true };

        // Priority: global → domain (tab settings are popup-only, ephemeral)
        if (data.globalSettings) {
            settings = { ...settings, ...data.globalSettings };
        }
        if (domain && data.domainSettings && data.domainSettings[domain]) {
            settings = { ...settings, ...data.domainSettings[domain] };
        }

        currentSettings = settings;
        applySettings();
        startEnforcement();
    });
}

// ─── Storage Change Listener (instant cross-tab sync) ─────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    const domain = window.location.hostname;
    let updated = false;

    if (changes.globalSettings) {
        currentSettings = { ...currentSettings, ...changes.globalSettings.newValue };
        updated = true;
    }
    if (changes.domainSettings) {
        const newDomainSettings = changes.domainSettings.newValue || {};
        if (newDomainSettings[domain]) {
            currentSettings = { ...currentSettings, ...newDomainSettings[domain] };
            updated = true;
        }
    }

    if (updated) applySettings();
});

// ─── Live Message Listener (from popup for immediate response) ────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'applySettings') {
        currentSettings = { ...currentSettings, ...request.settings };
        applySettings();
        sendResponse({ success: true });
        return true;
    }
});

// ─── Resume AudioContext on User Interaction ──────────────────────────────────

function resumeCtx() {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
}
['click', 'keydown', 'mousedown', 'touchstart'].forEach(e =>
    window.addEventListener(e, resumeCtx, { passive: true })
);

// ─── MutationObserver for Dynamically Added Media ─────────────────────────────

const observer = new MutationObserver(() => applySettings());

function startObserver() {
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        startObserver();
        loadFromStorage();
    });
} else {
    startObserver();
    loadFromStorage();
}
