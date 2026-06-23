// ============================================================
// priceEngine.js — The Core Rule-Based Algorithms
//
// Algorithm 2: Tree-Based DOM Parsing (CSS Selectors)
// Algorithm 3: Price Normalization
// Algorithm 4: Threshold Comparison
// ============================================================

import { detectPlatform } from "./platforms.js";

// ============================================================
// ALGORITHM 2: Tree-Based DOM Parsing
// Tries each CSS selector in the platform's selector list
// until it finds a DOM element that contains a price.
// Returns the raw text (e.g. "₱1,299.00") or null.
// ============================================================
export function extractRawPrice(platform) {
  if (!platform || !platform.selectors) return null;

  for (const selector of platform.selectors.price) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.textContent.trim();
        // Basic check: must contain a digit to be a price
        if (text && /\d/.test(text)) {
          console.log(`[StackGuild] Price found via selector: "${selector}" → "${text}"`);
          return text;
        }
      }
    } catch (e) {
      // Invalid selector — skip it silently
      console.warn(`[StackGuild] Bad selector: "${selector}"`, e);
    }
  }

  console.warn("[StackGuild] No price element found on this page.");
  return null;
}

// ============================================================
// ALGORITHM 3: Price Normalization
// Takes raw price text like "₱1,299.00" or "₱ 1299"
// and converts it to a clean float: 1299.00
// ============================================================
export function normalizePrice(rawText) {
  if (!rawText || typeof rawText !== "string") return null;

  let cleaned = rawText;

  // Step 1: Remove the Philippine peso sign (₱) and any spaces around it
  cleaned = cleaned.replace(/₱/g, "");

  // Step 2: Remove thousands-separator commas (e.g. 1,299 → 1299)
  cleaned = cleaned.replace(/,/g, "");

  // Step 3: Remove any whitespace
  cleaned = cleaned.trim();

  // Step 4: Extract the first valid number from the string
  // (handles cases like "₱1,299.00 - ₱2,500.00" — takes the first)
  const match = cleaned.match(/(\d+(\.\d+)?)/);
  if (!match) {
    console.warn("[StackGuild] Could not parse a number from:", rawText);
    return null;
  }

  // Step 5: Convert to float using JavaScript's parseFloat
  const price = parseFloat(match[1]);

  if (isNaN(price) || price <= 0) {
    console.warn("[StackGuild] Invalid price value:", price);
    return null;
  }

  return price; // e.g. 1299.00
}

// ============================================================
// ALGORITHM 4: Threshold Comparison
// Compares the current price against the user's saved target.
// Returns true if an alert should be triggered.
// ============================================================
export function checkThreshold(currentPrice, targetPrice) {
  if (currentPrice === null || targetPrice === null) return false;
  if (typeof currentPrice !== "number" || typeof targetPrice !== "number") return false;

  // Alert when current price is AT or BELOW the user's target
  return currentPrice <= targetPrice;
}

// ============================================================
// Helper: Extract product title from the page
// ============================================================
export function extractTitle(platform) {
  if (!platform || !platform.selectors) return null;

  for (const selector of platform.selectors.title) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.textContent.trim();
        if (text && text.length > 2) return text;
      }
    } catch (e) {
      // skip
    }
  }
  return document.title || "Unknown Product";
}

// ============================================================
// Helper: Extract product image URL from the page
// ============================================================
export function extractImage(platform) {
  if (!platform || !platform.selectors) return null;

  for (const selector of platform.selectors.image) {
    try {
      const element = document.querySelector(selector);
      if (element && element.src) return element.src;
    } catch (e) {
      // skip
    }
  }
  return null;
}

// ============================================================
// Main extraction function — combines all algorithms
// Returns a full product data object or null on failure
// ============================================================
export function extractProductData() {
  const platform = detectPlatform();
  if (!platform) {
    console.log("[StackGuild] Not on a supported platform.");
    return null;
  }

  const rawPrice = extractRawPrice(platform);
  if (!rawPrice) return null;

  const currentPrice = normalizePrice(rawPrice);
  if (!currentPrice) return null;

  return {
    url:         window.location.href,
    platform:    platform.key,
    platformName: platform.name,
    title:       extractTitle(platform),
    image:       extractImage(platform),
    rawPrice,
    currentPrice,
    timestamp:   Date.now()
  };
}
