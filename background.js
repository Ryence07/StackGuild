// ============================================================
// background.js — Service Worker
//
// Handles:
// 1. Receiving price data from content.js
// 2. Saving price records to IndexedDB
// 3. Periodic background price checks (Chrome Alarms API)
// 4. Threshold comparison + push notifications
//
// (Thesis Specific Objectives 2, 3, 4)
// ============================================================

import {
  openDB,
  savePriceRecord,
  saveTrackedProduct,
  getAllTrackedProducts,
  getTrackedProduct,
  cleanOldRecords
} from "./database.js";

const ALARM_NAME     = "stackguild_price_check";
const CHECK_INTERVAL = 60; // minutes (default; user can change)

// ============================================================
// Extension install / startup
// ============================================================
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[StackGuild] Extension installed.");
  await openDB(); // Initialize IndexedDB
  scheduleAlarm(CHECK_INTERVAL);
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[StackGuild] Browser started.");
  scheduleAlarm(CHECK_INTERVAL);
});

// ============================================================
// Schedule periodic background price checks
// Uses Chrome Alarms API (Manifest V3 compliant)
// Note: Due to MV3 service worker lifecycle rules, exact
// timing may vary slightly (thesis delimitation #10)
// ============================================================
function scheduleAlarm(intervalMinutes) {
  chrome.alarms.clear(ALARM_NAME, () => {
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes:    intervalMinutes,
      periodInMinutes:   intervalMinutes
    });
    console.log(`[StackGuild] Alarm scheduled every ${intervalMinutes} minutes.`);
  });
}

// ============================================================
// Alarm fires → Run background price check
// ============================================================
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  console.log("[StackGuild] Alarm fired — running background price check.");
  await runBackgroundCheck();
});

// ============================================================
// Background price check for all tracked products
// ============================================================
async function runBackgroundCheck() {
  let products;
  try {
    products = await getAllTrackedProducts();
  } catch (e) {
    console.error("[StackGuild] Failed to load tracked products:", e);
    return;
  }

  if (!products || products.length === 0) {
    console.log("[StackGuild] No tracked products to check.");
    return;
  }

  console.log(`[StackGuild] Checking ${products.length} tracked product(s).`);

  // Clean up records older than 30 days
  try { await cleanOldRecords(); } catch (e) { /* non-critical */ }

  for (const product of products) {
    await checkProductInBackground(product);
  }
}

// ============================================================
// Fetch and check a single product in the background
// Uses chrome.scripting to inject into an existing tab,
// OR uses fetch for price re-checking (simplified approach)
// ============================================================
async function checkProductInBackground(product) {
  try {
    // Find if the product's page is open in any tab
    const tabs = await chrome.tabs.query({});
    const matchingTab = tabs.find(t => t.url && t.url.includes(product.url.split("?")[0]));

    if (matchingTab) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: matchingTab.id },
    func: extractPriceFromPage,
    args: [product.platform]
  });

      if (results && results[0] && results[0].result) {
        const { rawPrice, currentPrice } = results[0].result;
        await handleNewPrice(product, currentPrice, rawPrice);
      }
    } else {
      console.log(`[StackGuild] Tab not open for: ${product.title}. Skipping (user must visit page first).`);
    }
  } catch (e) {
    console.warn(`[StackGuild] Error checking product "${product.title}":`, e.message);
  }
}

// ============================================================
// Injected function — runs in the tab's context
// (Must be self-contained; cannot use imports)
// ============================================================
function extractPriceFromPage(platformKey) {
  const selectors = [
    ".IZPeQz",
    "[class*='price']",
    "[data-testid='price']",
    "span"
  ];

  for (const sel of selectors) {
    try {
      const elements = document.querySelectorAll(sel);

      for (const el of elements) {
        if (!el || !el.innerText) continue;

        const text = el.innerText.replace(/\s+/g, "").trim();

        // must look like PH price
        if (!/₱\d{2,}/.test(text)) continue;

        // skip hidden
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;

        // skip old price
        if (el.closest("del, [class*='old'], [class*='discount']")) continue;

        const cleaned = text.replace(/₱/g, "").replace(/,/g, "");
        const numbers = cleaned.match(/\d+(\.\d+)?/g);
        if (!numbers) continue;

        const price = Math.min(...numbers.map(n => parseFloat(n)));

        return {
          rawPrice: text,
          currentPrice: price
        };
      }
    } catch (e) {}
  }

  return null;
}

// ============================================================
// Handle a newly extracted price:
// 1. Save to IndexedDB
// 2. Update product's lastChecked + currentPrice
// 3. Run threshold comparison
// 4. Send notification if threshold met
// ============================================================
async function handleNewPrice(product, currentPrice, rawPrice) {
  if (!currentPrice) return;

  console.log(`[StackGuild] "${product.title}" — new price: ₱${currentPrice}`);

  // Save price record to IndexedDB
  await savePriceRecord({
    url:          product.url,
    platform:     product.platform,
    currentPrice,
    rawPrice:     rawPrice || `₱${currentPrice}`,
    timestamp:    Date.now()
  });

  // Update the product's current price and last-checked time
  await saveTrackedProduct({
    ...product,
    currentPrice,
    lastChecked: Date.now()
  });

  // ---- ALGORITHM 4: Threshold Comparison ----
  if (product.targetPrice !== null && product.targetPrice !== undefined) {
    if (currentPrice <= product.targetPrice) {
      console.log(`[StackGuild] ✅ Threshold met! ₱${currentPrice} ≤ ₱${product.targetPrice}`);
      sendPriceAlert(product, currentPrice);
    }
  }
}

// ============================================================
// Send a browser push notification
// (Chrome Notifications API)
// ============================================================
function sendPriceAlert(product, currentPrice) {
  const title   = "💰 Price Drop Alert — StackGuild";
  const message = `"${product.title}" is now ₱${currentPrice.toLocaleString()}!\nYour target: ₱${product.targetPrice.toLocaleString()}`;

  chrome.notifications.create(`alert_${Date.now()}`, {
    type:     "basic",
    iconUrl:  "icons/icon48.png",
    title,
    message,
    priority: 2
  });
}

// ============================================================
// Listen for messages from content.js and popup.js
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "PRICE_EXTRACTED") {
    // A content script extracted a price from a page the user visited
    handlePriceExtracted(message.payload).then(sendResponse);
    return true; // Keeps the message channel open for async response
  }

  if (message.type === "GET_ALL_PRODUCTS") {
    getAllTrackedProducts().then(sendResponse);
    return true;
  }

  if (message.type === "RUN_CHECK_NOW") {
    runBackgroundCheck().then(() => sendResponse({ done: true }));
    return true;
  }

  if (message.type === "UPDATE_INTERVAL") {
    scheduleAlarm(message.intervalMinutes);
    sendResponse({ done: true });
  }
});

// ============================================================
// Handle a price extracted from a page visit
// ============================================================
async function handlePriceExtracted(productData) {
  try {
    // Check if this product is already being tracked
    const existing = await getTrackedProduct(productData.url);

    // Save price history record
    if (!productData.currentPrice) return { success: false };

    if (existing) {
      // Product already tracked — update price
      await saveTrackedProduct({ ...existing, currentPrice: productData.currentPrice, lastChecked: Date.now() });

      // Threshold check
      if (
  existing.targetPrice !== null &&
  existing.targetPrice !== undefined &&
  productData.currentPrice <= existing.targetPrice
)
 {
        sendPriceAlert(existing, productData.currentPrice);
      }
    }
    // If not tracked yet, user must click "Track" in the popup

    return { success: true };
  } catch (e) {
    console.error("[StackGuild] handlePriceExtracted error:", e);
    return { success: false, error: e.message };
  }
}
