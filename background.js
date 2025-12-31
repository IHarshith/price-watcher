// background.js - The Service Worker

console.log("Price Watcher background script loaded.");

const MAX_HISTORY_ENTRIES = 20; // Global constant for price history retention (used as a fallback)
const ALERT_CHECK_INTERVAL_MINUTES = 30; // How often to check alerts in background
const BACKGROUND_TRACKING_INTERVAL_MINUTES = 240; // Every 4 hours
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

/**
 * Generates a unique ID (UUID v4).
 * @returns {string} A new UUID string.
 */
function generateUUID() {
  return crypto.randomUUID();
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log("Price Watcher extension installed!");
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    chrome.tabs.create({ url: chrome.runtime.getURL('landing.html') }); // Open landing page on install
  }

  // Create an alarm for periodic alert checks
  chrome.alarms.create('priceWatcherAlertCheck', {
    periodInMinutes: ALERT_CHECK_INTERVAL_MINUTES,
  });
  console.log(`[Background] Alarm 'priceWatcherAlertCheck' set for every ${ALERT_CHECK_INTERVAL_MINUTES} minutes.`);

  // Create an alarm for periodic background price tracking
  chrome.alarms.create('backgroundPriceTracker', {
      delayInMinutes: 5, // Wait 5 mins after install/startup before first run
      periodInMinutes: BACKGROUND_TRACKING_INTERVAL_MINUTES
  });
  console.log(`[Background] Alarm 'backgroundPriceTracker' set for every ${BACKGROUND_TRACKING_INTERVAL_MINUTES} minutes.`);

});

/**
 * Creates a canonical URL by removing query parameters and hash fragments.
 * @param {string} urlString The full URL.
 * @returns {string} The canonical URL.
 */
const getCanonicalUrl = (urlString) => {
  try {
    const url = new URL(urlString);
    return url.origin + url.pathname;
  } catch (error) {
    console.warn(`[Background] Could not parse URL: ${urlString}`);
    return urlString; // Fallback to the original URL if it's invalid
  }
};

/**
 * Checks all active alerts against current product prices and sends notifications.
 * @param {string} [specificUrl] If provided, only check alerts for this canonical URL.
 */
async function checkAlerts(specificUrl = null) {
  console.log(`[Background] Running alert check for ${specificUrl || 'all active alerts'}...`);
  try {
    const { priceWatcherAlerts, priceWatcherSettings, ...allHostData } = await chrome.storage.local.get(null);
    const alerts = priceWatcherAlerts || [];
    const settings = priceWatcherSettings || {};
    
    // Check if global notifications are disabled
    if (settings.globalNotifications === false) {
      console.log("[Background] Global notifications are disabled. Skipping alert check.");
      return;
    }
    
    const activeAlerts = alerts.filter(alert => alert.status === 'active');

    if (activeAlerts.length === 0) {
      console.log("[Background] No active alerts to check.");
      return;
    }

    const updatedAlerts = [];
    for (const alert of activeAlerts) {
      if (specificUrl && alert.url !== specificUrl) {
        updatedAlerts.push(alert); // Keep non-matching alerts as is
        continue;
      }

      const productHostData = allHostData[alert.hostname];
      const product = productHostData ? productHostData[alert.url] : null;

      if (!product || !Array.isArray(product.history) || product.history.length === 0) {
        console.log(`[Background] Product data not found or empty history for alert ID: ${alert.id}`);
        updatedAlerts.push(alert);
        continue;
      }

      const sortedHistory = product.history.sort((a, b) => b.timestamp - a.timestamp);
      const latestPriceEntry = sortedHistory[0];
      const previousPriceEntry = sortedHistory.length > 1 ? sortedHistory[1] : latestPriceEntry;

      const latestPrice = latestPriceEntry.price;
      const latestCurrency = latestPriceEntry.currency;

      let trigger = false;
      let notificationMessage = '';

      if (alert.conditionType === 'priceBelow') {
        if (latestPrice < alert.targetValue) {
          trigger = true;
          notificationMessage = `${alert.productName} is now ${latestCurrency}${latestPrice.toFixed(2)}, which is below your target of ${latestCurrency}${alert.targetValue.toFixed(2)}!`;
        }
      } else if (alert.conditionType === 'percentageDrop') {
        if (previousPriceEntry.price > 0) { // Avoid division by zero
          const currentDropPercentage = ((previousPriceEntry.price - latestPrice) / previousPriceEntry.price) * 100;
          if (currentDropPercentage >= alert.targetValue) {
            trigger = true;
            notificationMessage = `${alert.productName} has dropped by ${currentDropPercentage.toFixed(2)}% to ${latestCurrency}${latestPrice.toFixed(2)}, meeting your ${alert.targetValue}% drop alert!`;
          }
        }
      }

      if (trigger) {
        console.log(`[Background] Alert triggered for product: ${alert.productName}`);
        alert.status = 'triggered'; // Mark as triggered to avoid repeated notifications
        alert.lastTriggered = Date.now();

        chrome.notifications.create(alert.id, {
          type: 'basic',
          iconUrl: product.imageUrl || 'icons/icon128.png',
          title: 'Price Watcher Alert!',
          message: notificationMessage,
          priority: 2 // High priority notification
        });

        // Open product URL on notification click
        chrome.notifications.onClicked.addListener((notificationId) => {
          if (notificationId === alert.id) {
            chrome.tabs.create({ url: alert.url });
            chrome.notifications.clear(notificationId); // Clear notification after click
          }
        });
      }
      updatedAlerts.push(alert);
    }
    await chrome.storage.local.set({ priceWatcherAlerts: updatedAlerts });
    if (chrome.runtime.lastError) {
      console.error(`[Background] Error updating alerts after check: ${chrome.runtime.lastError}`);
    }
  } catch (error) {
    console.error("[Background] Error checking alerts:", error);
  }
}

// ===================================================================================
//  AUTOMATED BACKGROUND TRACKING LOGIC
// ===================================================================================
let hasOffscreenDocument = false;

async function scrapeUrlInBackground(url) {
    // Create offscreen document if it doesn't exist.
    if (!hasOffscreenDocument) {
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['DOM_PARSER'],
            justification: 'To scrape product pages in the background for price tracking.',
        });
        hasOffscreenDocument = true;
    }

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Timeout scraping ${url}`));
        }, 30000); // 30-second timeout

        const listener = (message) => {
            if (message.action === "scrapeResult" && message.url === url) {
                clearTimeout(timeout);
                chrome.runtime.onMessage.removeListener(listener);
                if (message.error) {
                    reject(new Error(message.error));
                } else {
                    resolve(message.data);
                }
            }
        };
        chrome.runtime.onMessage.addListener(listener);

        // Send the message to the offscreen document to start scraping
        chrome.runtime.sendMessage({ action: 'scrapeProduct', url });
    });
}

async function runBackgroundTracking() {
    console.log('[Background] Starting automated background tracking cycle...');
    const allStorageKeys = await chrome.storage.local.get(null);
    const allProducts = [];

    for (const hostname in allStorageKeys) {
        if (hostname === 'isLoggedIn' || hostname === 'userCredentials' || hostname === 'priceWatcherAlerts' || hostname === 'priceWatcherSettings') continue;
        const hostData = allStorageKeys[hostname];
        for (const url in hostData) {
            allProducts.push({ url, hostname });
        }
    }

    if (allProducts.length === 0) {
        console.log('[Background] No products to track. Ending cycle.');
        return;
    }
    
    console.log(`[Background] Found ${allProducts.length} products to track.`);

    for (const product of allProducts) {
        try {
            console.log(`[Background] Scraping: ${product.url}`);
            const scrapedData = await scrapeUrlInBackground(product.url);

            if (scrapedData) {
                // Use the savePrice message handler's logic to store the new price
                await chrome.runtime.sendMessage({
                    action: "savePrice",
                    ...scrapedData, // Contains price, currency, productName, productImageUrl
                    url: product.url,
                    hostname: product.hostname,
                    timestamp: Date.now()
                });
            } else {
                console.log(`[Background] No data scraped for ${product.url}`);
            }
        } catch (error) {
            console.error(`[Background] Error tracking product ${product.url}:`, error);
        }
        // Small delay to be polite to servers
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // Close the offscreen document after the tracking cycle is complete
    if (hasOffscreenDocument) {
        await chrome.offscreen.closeDocument();
        hasOffscreenDocument = false;
    }
    console.log('[Background] Background tracking cycle finished.');
}


// Listen for alarms (for periodic background checks)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'priceWatcherAlertCheck') {
    checkAlerts();
  } else if (alarm.name === 'backgroundPriceTracker') {
    runBackgroundTracking();
  }
});


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Use a switch statement for clarity
  switch (request.action) {
    case "savePrice": {
      const { url, hostname, price, currency, productName, productImageUrl, timestamp } = request;
      const canonicalUrl = getCanonicalUrl(url);

      chrome.storage.local.get([hostname, 'priceWatcherSettings'], async (result) => {
        const hostData = result[hostname] || {};
        const settings = result.priceWatcherSettings || {};
        const productData = hostData[canonicalUrl] || { name: productName, imageUrl: productImageUrl, history: [] };

        productData.name = productName;
        productData.imageUrl = productImageUrl;
        
        const lastEntry = productData.history.length > 0 ? productData.history.sort((a,b) => b.timestamp - a.timestamp)[0] : null;

        let priceChanged = false;
        if (!lastEntry || lastEntry.price !== price || lastEntry.currency !== currency) {
          productData.history.push({ price, currency, timestamp });
          console.log(`[Background] Stored new price for "${productName}".`);
          priceChanged = true;
        } else {
          console.log(`[Background] Price for "${productName}" is same as last, not storing.`);
        }
        
        // Use history retention setting, with fallback to the constant
        const retentionLimit = settings.historyRetention || MAX_HISTORY_ENTRIES;
        if (productData.history.length > retentionLimit) {
          productData.history = productData.history.slice(productData.history.length - retentionLimit);
        }
        
        hostData[canonicalUrl] = productData;

        await chrome.storage.local.set({ [hostname]: hostData });
        if (chrome.runtime.lastError) {
          console.error(`[Background] Error saving price: ${chrome.runtime.lastError}`);
        } else if (priceChanged) {
          checkAlerts(canonicalUrl);
        }
      });
      return true; // Indicates async response
    }

    case "getPriceHistory": {
      const { hostname } = request;
      chrome.storage.local.get([hostname], (result) => {
        sendResponse({ history: result[hostname] || {} });
      });
      return true;
    }

    case "deleteProductHistory": {
      const { hostname, url } = request;
      chrome.storage.local.get([hostname], async (result) => {
        const hostData = result[hostname] || {};
        if (hostData[url]) {
          delete hostData[url];
          await chrome.storage.local.set({ [hostname]: hostData });
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message }); return;
          }
          const { priceWatcherAlerts } = await chrome.storage.local.get('priceWatcherAlerts');
          const updatedAlerts = (priceWatcherAlerts || []).filter(alert => alert.url !== url);
          await chrome.storage.local.set({ priceWatcherAlerts: updatedAlerts });
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message }); return;
          }
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: "Product not found" });
        }
      });
      return true;
    }

    case "deleteAllHistory": {
      chrome.storage.local.clear(async () => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message }); return;
        }
        await chrome.storage.local.set({ isLoggedIn: true });
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message }); return;
        }
        sendResponse({ success: true });
      });
      return true;
    }
    
    case "deleteAccount": {
      chrome.storage.local.clear(() => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ success: true });
      });
      return true;
    }

    case "setLoggedIn": {
      chrome.storage.local.set({ isLoggedIn: true }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message }); return;
        }
        sendResponse({ success: true });
      });
      return true;
    }

    case "saveAlert": {
      const newAlert = { ...request.alert, id: request.alert.id || generateUUID(), created: Date.now(), status: 'active' };
      chrome.storage.local.get('priceWatcherAlerts', async (result) => {
        let alerts = result.priceWatcherAlerts || [];
        const existingIndex = alerts.findIndex(a => a.id === newAlert.id);
        if (existingIndex !== -1) {
          alerts[existingIndex] = newAlert;
        } else {
          alerts.push(newAlert);
        }
        await chrome.storage.local.set({ priceWatcherAlerts: alerts });
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message }); return;
        }
        sendResponse({ success: true, alertId: newAlert.id });
      });
      return true;
    }

    case "getAlerts": {
      chrome.storage.local.get('priceWatcherAlerts', (result) => {
        sendResponse({ alerts: result.priceWatcherAlerts || [] });
      });
      return true;
    }

    case "deleteAlert": {
      const { id } = request;
      chrome.storage.local.get('priceWatcherAlerts', async (result) => {
        let alerts = result.priceWatcherAlerts || [];
        const updatedAlerts = alerts.filter(alert => alert.id !== id);
        await chrome.storage.local.set({ priceWatcherAlerts: updatedAlerts });
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message }); return;
        }
        sendResponse({ success: true });
      });
      return true;
    }

    case "toggleAlertStatus": {
      const { id, status } = request;
      chrome.storage.local.get('priceWatcherAlerts', async (result) => {
        let alerts = result.priceWatcherAlerts || [];
        const alertIndex = alerts.findIndex(a => a.id === id);
        if (alertIndex !== -1) {
          alerts[alertIndex].status = status;
          await chrome.storage.local.set({ priceWatcherAlerts: alerts });
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message }); return;
          }
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: "Alert not found" });
        }
      });
      return true;
    }
  }
});