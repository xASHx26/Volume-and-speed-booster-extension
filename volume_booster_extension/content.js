let audioCtx = null;
let gainNode = null;
let filterNode = null;
let compressorNode = null;
let mediaSources = new WeakMap();

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
        
        // Volume
        gainNode = audioCtx.createGain();
        
        // Clear Audio / Dialogue Enhancement (Boost mid-frequencies)
        filterNode = audioCtx.createBiquadFilter();
        filterNode.type = 'peaking';
        filterNode.frequency.value = 1500; // Vocals/dialogue range
        filterNode.Q.value = 1.0;
        filterNode.gain.value = 0; // Will be set to ~6-10 if enabled
        
        // Compressor (Prevent clipping when boosting volume)
        compressorNode = audioCtx.createDynamicsCompressor();
        compressorNode.threshold.value = -24;
        compressorNode.knee.value = 30;
        compressorNode.ratio.value = 12;
        compressorNode.attack.value = 0.003;
        compressorNode.release.value = 0.25;

        // Routing: Source -> Filter -> Gain -> Compressor -> Destination
        filterNode.connect(gainNode);
        gainNode.connect(compressorNode);
        compressorNode.connect(audioCtx.destination);
    }
}

// Hook media element
function hookMediaElement(mediaElement) {
    // Cannot hook cross-origin media without CORS headers, 
    // try/catch handles elements that block MediaElementAudioSourceNode
    try {
        if (!mediaSources.has(mediaElement)) {
            initAudio();
            const source = audioCtx.createMediaElementSource(mediaElement);
            source.connect(filterNode);
            mediaSources.set(mediaElement, source);
        }
    } catch (e) {
        console.warn('MediaBooster: Could not hook audio element (likely CORS restriction).', e);
    }
}

// Apply settings to elements
function applySettings() {
    const active = currentSettings.active;
    const needsAudioProcessing = active && (currentSettings.volume !== 100 || currentSettings.clearAudio);
    
    // Apply Speed and optionally hook audio
    const mediaElements = document.querySelectorAll('video, audio');
    mediaElements.forEach(media => {
        if (active) {
            media.playbackRate = currentSettings.speed;
        } else {
            media.playbackRate = 1.0;
        }
        
        // Only hook audio if we are actually applying a volume boost or EQ
        if (needsAudioProcessing) {
            hookMediaElement(media);
        }
    });

    // Apply Audio Processing
    if (audioCtx) {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }

        if (active) {
            // Volume: 100% = 1.0, 500% = 5.0
            gainNode.gain.setTargetAtTime(currentSettings.volume / 100, audioCtx.currentTime, 0.1);
            
            // Clear Audio
            if (currentSettings.clearAudio) {
                filterNode.gain.setTargetAtTime(10, audioCtx.currentTime, 0.1); // Boost vocals by 10dB
                compressorNode.threshold.setTargetAtTime(-30, audioCtx.currentTime, 0.1); // Stronger compression
            } else {
                filterNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
                compressorNode.threshold.setTargetAtTime(-10, audioCtx.currentTime, 0.1); // Lighter compression
            }
        } else {
            gainNode.gain.setTargetAtTime(1.0, audioCtx.currentTime, 0.1);
            filterNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        }
    }
}

// Ensure AudioContext resumes on first user interaction with the page
function resumeAudioContext() {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
}

['click', 'keydown', 'mousedown', 'touchstart'].forEach(evt => {
    window.addEventListener(evt, resumeAudioContext, { passive: true });
});

// Observe DOM for dynamically added media elements
const observer = new MutationObserver((mutations) => {
    let hasNewMedia = false;
    for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
            mutation.addedNodes.forEach(node => {
                if (node.nodeName === 'VIDEO' || node.nodeName === 'AUDIO') {
                    hasNewMedia = true;
                } else if (node.querySelectorAll) {
                    const media = node.querySelectorAll('video, audio');
                    if (media.length > 0) hasNewMedia = true;
                }
            });
        }
    }
    if (hasNewMedia) {
        applySettings();
    }
});

observer.observe(document.body, { childList: true, subtree: true });

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'applySettings') {
        currentSettings = { ...currentSettings, ...request.settings };
        applySettings();
        sendResponse({ success: true });
    }
});

// Fetch initial settings on load
chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
    if (response) {
        currentSettings = { ...currentSettings, ...response };
        applySettings();
    }
});
