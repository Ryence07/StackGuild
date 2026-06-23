export const PLATFORMS = {

  // ----------------------------------------------------------
  // SHOPEE PHILIPPINES
  // URL pattern: shopee.ph
  // ----------------------------------------------------------
  shopee: {
    name: "Shopee Philippines",
    urlPattern: /^https:\/\/shopee\.ph\/.+/,
    productPagePattern: /^https:\/\/shopee\.ph\/[^/]+-i\.\d+\.\d+/,
    color: "#EE4D2D",

    selectors: {
      // Primary price selector (main displayed price)
      price: [
        ".IZPeQz.B67UQ0",
        "._3n5NQx",
        ".pqTWkA",
        "[class*='price'] [class*='current']",
        "._1xk7ak",
        "section[class*='page-product'] [class*='price']"
      ],

      // Product title
      title: [
        "._44qnta",
        "[class*='page-product__title']",
        "h1[class*='title']",
        "._3i7PL5"
      ],

      // Product image
      image: [
        "._3zGUzy img",
        "[class*='image-slot'] img",
        "._3PvDPY img"
      ]
    },

    // How to detect if the page has fully loaded the price
    priceLoadedCheck: () => {
      return document.querySelector("._3n5NQx") !== null ||
             document.querySelector(".pqTWkA") !== null;
    },

    // Max wait time (ms) for dynamic content to load
    maxWaitMs: 5000
  },

  // ----------------------------------------------------------
  // LAZADA PHILIPPINES
  // URL pattern: lazada.com.ph
  // ----------------------------------------------------------
  lazada: {
    name: "Lazada Philippines",
    urlPattern: /^https:\/\/(www\.)?lazada\.com\.ph\/.+/,
    productPagePattern: /^https:\/\/(www\.)?lazada\.com\.ph\/products\//,
    color: "#F57224",

    selectors: {
      // Primary price selector
      price: [
        ".pdp-price_type_normal",
        ".pdp-price",
        "[class*='pdp-price']",
        ".ooOxS",
        "span[class*='price']"
      ],

      // Product title
      title: [
        ".pdp-mod-product-badge-title",
        "h1.pdp-mod-product-badge-title",
        "[class*='pdp-name']",
        ".title--wrap--UUHae_g h1"
      ],

      // Product image
      image: [
        ".pdp-mod-common-image img",
        "[class*='gallery'] img",
        ".item-gallery__image img"
      ]
    },

    priceLoadedCheck: () => {
      return document.querySelector(".pdp-price_type_normal") !== null ||
             document.querySelector(".pdp-price") !== null;
    },

    maxWaitMs: 5000
  }
};

// ============================================================
// ALGORITHM 1: URL Pattern Matching
// Detects which platform the user is currently on.
// Returns the matching platform config object, or null.
// ============================================================
export function detectPlatform(url = window.location.href) {
  for (const [key, platform] of Object.entries(PLATFORMS)) {
    if (platform.urlPattern.test(url)) {
      return { key, ...platform };
    }
  }
  return null; // Not a supported platform
}

// ============================================================
// Helper: Is this URL a product detail page?
// (vs. search results, homepage, etc.)
// ============================================================
export function isProductPage(url = window.location.href) {
  for (const platform of Object.values(PLATFORMS)) {
    if (platform.productPagePattern.test(url)) {
      return true;
    }
  }

  // Fallback heuristics for dynamic URLs
  const u = url.toLowerCase();
  const isShopee = u.includes("shopee.ph") && (u.includes("-i.") || u.match(/\/[^/]+-i\.\d/));
  const isLazada = u.includes("lazada.com.ph") && u.includes("/products/");

  return isShopee || isLazada;
}
