// Default settings
const DEFAULT_SETTINGS = {
    volume: 100,
    speed: 1.0,
    clearAudio: false,
    scope: 'domain',   // matches the default-checked radio in popup.html
    active: true
};

// Handle messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getSettings') {
        const tabId = request.tabId || (sender.tab ? sender.tab.id : null);
        let domain = request.domain;

        if (!domain && sender.tab && sender.tab.url) {
            try { domain = new URL(sender.tab.url).hostname; } catch (e) {}
        }

        chrome.storage.local.get(['tabSettings', 'domainSettings', 'globalSettings'], (data) => {
            let settings = { ...DEFAULT_SETTINGS };
            let resolvedScope = 'domain'; // Default radio value

            // Priority: global < domain < tab
            if (data.globalSettings) {
                settings = { ...settings, ...data.globalSettings };
                resolvedScope = 'all';
            }
            if (domain && data.domainSettings && data.domainSettings[domain]) {
                settings = { ...settings, ...data.domainSettings[domain] };
                resolvedScope = 'domain';
            }
            if (tabId && data.tabSettings && data.tabSettings[String(tabId)]) {
                settings = { ...settings, ...data.tabSettings[String(tabId)] };
                resolvedScope = 'tab';
            }

            // Always return a valid scope matching the radio buttons (tab/domain/all)
            settings.scope = resolvedScope;
            sendResponse(settings);
        });
        return true; // async
    }

    if (request.action === 'saveSettings') {
        const { tabId, domain, settings } = request;
        const scope = settings.scope;

        chrome.storage.local.get(['tabSettings', 'domainSettings', 'globalSettings'], (data) => {
            let updates = {};

            if (scope === 'tab' && tabId) {
                let tabSettings = data.tabSettings || {};
                tabSettings[String(tabId)] = settings;
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
        return true; // async
    }
});

// Clean up tab-specific settings when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.local.get('tabSettings', (data) => {
        if (data.tabSettings && data.tabSettings[String(tabId)]) {
            delete data.tabSettings[String(tabId)];
            chrome.storage.local.set({ tabSettings: data.tabSettings });
        }
    });
});
