// ============================================================
// content.js — FINAL ROBUST VERSION (Shopee + Lazada)
// ============================================================

(async () => {
  const url = window.location.href;

  const isShopeeProduct =
    url.includes("shopee.ph") && url.match(/[^/]+-i\.\d+\.\d+/);

  const isLazadaProduct =
    url.includes("lazada.com.ph") && url.includes("/products/");

  if (!isShopeeProduct && !isLazadaProduct) return;

  console.log("[StackGuild] Product page detected:", url);

  // ---- Platform detection ----
  let platformKey = null;
  let priceSelectors = [];
  let titleSelectors = [];
  let imageSelectors = [];

  if (isShopeeProduct) {
    platformKey = "shopee";
    priceSelectors = [
      ".IZPeQz",
      "[class*='IZPeQz']",
      "[data-testid='price']",
      "[class*='price']",
      "span"
    ];
    titleSelectors = [
      "._44qnta",
      "[class*='page-product__title']",
      "h1"
    ];
    imageSelectors = ["img"];
  } else {
    platformKey = "lazada";
    priceSelectors = [
      ".pdp-price_type_normal",
      ".pdp-price",
      "[class*='pdp-price']",
      "[class*='price']",
      "span"
    ];
    titleSelectors = [
      ".pdp-mod-product-badge-title",
      "h1"
    ];
    imageSelectors = ["img"];
  }

  // ---- Wait for price ----
  const waitForPrice = (selectors, maxWait = 8000) => {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const check = () => {
        let fallbackCandidates = [];

        for (const sel of selectors) {
          try {
            const elements = document.querySelectorAll(sel);

            for (const el of elements) {
              if (!el || !el.innerText) continue;

              const text = el.innerText.replace(/\s+/g, "").trim();

              console.log("[StackGuild] Testing:", sel, text);

              // RULE 1: valid PH price format
              if (!/₱\d{2,}/.test(text)) continue;

              // RULE 2: ignore vouchers / promos
              if (/OFF|voucher|Shipping|Coins/i.test(text)) continue;

              // RULE 3: must be visible
              const style = window.getComputedStyle(el);
              if (style.display === "none" || style.visibility === "hidden") continue;

              // RULE 4: ignore old/discount prices
              if (el.closest("del, [class*='old'], [class*='discount']")) continue;

              // RULE 5: HIGH CONFIDENCE SELECTOR
              if (sel.includes("IZPeQz") || sel.includes("data-testid")) {
                console.log("[StackGuild] ✅ Primary selector match:", text);
                resolve(text);
                return;
              }

              // store fallback candidates
              fallbackCandidates.push(text);
            }

          } catch (e) {
            console.error("[StackGuild] Error:", e);
          }
        }

        // ---- fallback: choose best candidate (deterministic) ----
        if (fallbackCandidates.length > 0) {
          const best = fallbackCandidates.sort((a, b) => {
            const aVals = a.match(/\d+/g) || [];
            const bVals = b.match(/\d+/g) || [];

            const aMin = Math.min(...aVals.map(Number));
            const bMin = Math.min(...bVals.map(Number));

            return bMin - aMin;
          })[0];

          console.log("[StackGuild] ⚠️ Fallback selected:", best);
          resolve(best);
          return;
        }

        if (Date.now() - startTime < maxWait) {
          setTimeout(check, 300);
        } else {
          console.warn("[StackGuild] Selector failed, trying fallback...");

          const match = document.body.innerText.match(/₱\s?\d{2,}(,\d{3})*(\.\d+)?/);

          if (match) {
            console.log("[StackGuild] ⚠️ Fallback price:", match[0]);
            resolve(match[0]);
          } else {
            resolve(null);
          }
        }
      };

      check();
    });
  };

  const rawPrice = await waitForPrice(priceSelectors);

  if (!rawPrice) {
    console.warn("[StackGuild] Price not found.");
    return;
  }

  // ---- Normalize price (handles ranges) ----
  const normalizePrice = (text) => {
    if (!text) return null;

    let cleaned = text.replace(/₱/g, "").replace(/,/g, "").trim();

    const matches = cleaned.match(/\d+(\.\d+)?/g);
    if (!matches) return null;

    const numbers = matches.map(n => parseFloat(n)).filter(n => !isNaN(n));

    if (numbers.length === 0) return null;

    // choose minimum (for ranges)
    const minPrice = Math.min(...numbers);

    return minPrice > 0 ? minPrice : null;
  };

  const currentPrice = normalizePrice(rawPrice);

  if (!currentPrice) {
    console.warn("[StackGuild] Could not normalize price:", rawPrice);
    return;
  }

  // ---- Extract title ----
  let title = document.title || "Unknown Product";

  for (const sel of titleSelectors) {
    try {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 2) {
        title = el.innerText.trim();
        break;
      }
    } catch (e) {}
  }

  // ---- Extract image ----
  let image = null;

  for (const sel of imageSelectors) {
    try {
      const el = document.querySelector(sel);
      if (el && el.src && el.src.startsWith("http")) {
        image = el.src;
        break;
      }
    } catch (e) {}
  }

  // ---- Build product object ----
  const productData = {
    url,
    platform: platformKey,
    platformName:
      platformKey === "shopee"
        ? "Shopee Philippines"
        : "Lazada Philippines",
    title,
    image,
    rawPrice,
    currentPrice,
    timestamp: Date.now()
  };

  console.log("[StackGuild] ✅ Extracted product:", productData);

  // ---- Send to background ----
  chrome.runtime.sendMessage({
    type: "PRICE_EXTRACTED",
    payload: productData
  });

})();