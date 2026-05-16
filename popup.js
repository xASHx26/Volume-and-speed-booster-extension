document.addEventListener('DOMContentLoaded', async () => {
    const powerBtn = document.getElementById('power-toggle');
    const volumeSlider = document.getElementById('volume-slider');
    const speedSlider = document.getElementById('speed-slider');
    const clearAudioToggle = document.getElementById('clear-audio-toggle');
    const volumeVal = document.getElementById('volume-val');
    const speedVal = document.getElementById('speed-val');
    const scopeRadios = document.querySelectorAll('input[name="scope"]');
    const speedBtns = document.querySelectorAll('.speed-btn');

    let currentTabId = null;
    let currentDomain = null;
    let isActive = true;

    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
        currentTabId = tab.id;
        try {
            const url = new URL(tab.url);
            currentDomain = url.hostname;
        } catch (e) {
            console.error('Invalid URL:', tab.url);
        }
    }

    // Load initial settings
    async function loadSettings() {
        const response = await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: 'getSettings', tabId: currentTabId, domain: currentDomain }, resolve);
        });

        if (response) {
            volumeSlider.value = response.volume !== undefined ? response.volume : 100;
            speedSlider.value = response.speed !== undefined ? response.speed : 1.0;
            clearAudioToggle.checked = response.clearAudio || false;
            isActive = response.active !== false;

            updateUI();

            // Set scope radio — fallback to 'domain' if stored scope is invalid
            const validScopes = ['tab', 'domain', 'all'];
            const scope = validScopes.includes(response.scope) ? response.scope : 'domain';
            const scopeRadio = document.querySelector(`input[name="scope"][value="${scope}"]`);
            if (scopeRadio) scopeRadio.checked = true;
        }
    }

    function updateUI() {
        volumeVal.textContent = `${volumeSlider.value}%`;
        const speed = parseFloat(speedSlider.value);
        speedVal.textContent = `${speed % 1 === 0 ? speed.toFixed(0) : speed}x`;
        if (isActive) {
            powerBtn.classList.add('active');
        } else {
            powerBtn.classList.remove('active');
        }
        // Highlight matching preset button
        speedBtns.forEach(btn => {
            btn.classList.toggle('active', parseFloat(btn.dataset.speed) === speed);
        });
    }

    // Save and apply settings
    function applySettings() {
        updateUI();
        const scope = document.querySelector('input[name="scope"]:checked').value;
        const settings = {
            volume: parseInt(volumeSlider.value),
            speed: parseFloat(speedSlider.value),
            clearAudio: clearAudioToggle.checked,
            scope: scope,
            active: isActive
        };

        // Send to background to save
        chrome.runtime.sendMessage({
            action: 'saveSettings',
            tabId: currentTabId,
            domain: currentDomain,
            settings: settings
        });

        // Send to content script to apply immediately
        if (currentTabId) {
            chrome.tabs.sendMessage(currentTabId, {
                action: 'applySettings',
                settings: settings
            }).catch(err => console.log('Content script not ready or CORS issue:', err));
        }
    }

    // Event Listeners
    powerBtn.addEventListener('click', () => {
        isActive = !isActive;
        applySettings();
    });

    volumeSlider.addEventListener('input', applySettings);
    speedSlider.addEventListener('input', applySettings);
    clearAudioToggle.addEventListener('change', applySettings);
    
    scopeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            // When changing scope, we might want to reload settings for that scope
            // For now, we just save current settings to the new scope
            applySettings();
        });
    });

    // Speed preset buttons
    speedBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const speed = parseFloat(btn.dataset.speed);
            speedSlider.value = Math.min(speed, parseFloat(speedSlider.max));
            applySettings();
        });
    });

    // Initialize
    loadSettings();
});
