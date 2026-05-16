// Default settings
const DEFAULT_SETTINGS = {
    volume: 100,
    speed: 1.0,
    clearAudio: false,
    scope: 'domain',
    active: true
};

// Handle messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getSettings') {
        const tabId = request.tabId || (sender.tab ? sender.tab.id : null);
        let domain = request.domain;
        
        if (!domain && sender.tab && sender.tab.url) {
            try {
                domain = new URL(sender.tab.url).hostname;
            } catch (e) {}
        }

        chrome.storage.local.get(['tabSettings', 'domainSettings', 'globalSettings'], (data) => {
            let settings = { ...DEFAULT_SETTINGS };
            let scope = 'global';

            // Check global first
            if (data.globalSettings) {
                settings = { ...settings, ...data.globalSettings };
            }

            // Check domain
            if (domain && data.domainSettings && data.domainSettings[domain]) {
                settings = { ...settings, ...data.domainSettings[domain] };
                scope = 'domain';
            }

            // Check tab
            if (tabId && data.tabSettings && data.tabSettings[tabId]) {
                settings = { ...settings, ...data.tabSettings[tabId] };
                scope = 'tab';
            }

            settings.scope = scope; // ensure popup knows which scope we loaded
            sendResponse(settings);
        });

        return true; // Indicates asynchronous response
    }

    if (request.action === 'saveSettings') {
        const { tabId, domain, settings } = request;
        const scope = settings.scope;

        chrome.storage.local.get(['tabSettings', 'domainSettings', 'globalSettings'], (data) => {
            let updates = {};

            if (scope === 'tab' && tabId) {
                let tabSettings = data.tabSettings || {};
                tabSettings[tabId] = settings;
                updates.tabSettings = tabSettings;
            } else if (scope === 'domain' && domain) {
                let domainSettings = data.domainSettings || {};
                domainSettings[domain] = settings;
                updates.domainSettings = domainSettings;
            } else if (scope === 'all') {
                updates.globalSettings = settings;
            }

            chrome.storage.local.set(updates, () => {
                sendResponse({ success: true });
            });
        });
        return true;
    }
});

// Clean up tab settings when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.local.get('tabSettings', (data) => {
        if (data.tabSettings && data.tabSettings[tabId]) {
            delete data.tabSettings[tabId];
            chrome.storage.local.set({ tabSettings: data.tabSettings });
        }
    });
});
