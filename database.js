// ============================================================
// database.js — Client-Side Dual Storage Architecture
//
// IndexedDB  → Historical price records (time-series data)
// LocalStorage → User preferences, tracking lists, configs
//
// All data stays on the user's device. No external server.
// (Thesis Specific Objective 2)
// ============================================================

const DB_NAME    = "StackGuildDB";
const DB_VERSION = 1;
const STORE_PRICES   = "priceHistory";
const STORE_PRODUCTS = "trackedProducts";

// ============================================================
// IndexedDB — Open/Initialize
// ============================================================
export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // Called when DB is first created or upgraded
    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Store 1: Price history records
      // Key: auto-increment id
      // Index: by productUrl (to query all prices for a product)
      if (!db.objectStoreNames.contains(STORE_PRICES)) {
        const priceStore = db.createObjectStore(STORE_PRICES, {
          keyPath: "id",
          autoIncrement: true
        });
        priceStore.createIndex("byUrl", "url", { unique: false });
        priceStore.createIndex("byTimestamp", "timestamp", { unique: false });
        priceStore.createIndex("byUrlAndTime", ["url", "timestamp"], { unique: false });
      }

      // Store 2: Tracked products list
      // Key: product URL (unique per product)
      if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
        const productStore = db.createObjectStore(STORE_PRODUCTS, {
          keyPath: "url"
        });
        productStore.createIndex("byPlatform", "platform", { unique: false });
      }
    };

    request.onsuccess  = (e) => resolve(e.target.result);
    request.onerror    = (e) => reject(e.target.error);
  });
}

// ============================================================
// IndexedDB — Save a new price reading
// ============================================================
export async function savePriceRecord(productData) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_PRICES, "readwrite");
    const store = tx.objectStore(STORE_PRICES);

    const record = {
      url:          productData.url,
      platform:     productData.platform,
      currentPrice: productData.currentPrice,
      rawPrice:     productData.rawPrice,
      timestamp:    productData.timestamp || Date.now()
    };

    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ============================================================
// IndexedDB — Get price history for a specific product URL
// Returns array sorted by timestamp ascending (oldest first)
// Limits to last 30 days per thesis spec
// ============================================================
export async function getPriceHistory(url) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx      = db.transaction(STORE_PRICES, "readonly");
    const store   = tx.objectStore(STORE_PRICES);
    const index   = store.index("byUrl");
    const results = [];

    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const range = IDBKeyRange.only(url);
    const cursor = index.openCursor(range);

    cursor.onsuccess = (e) => {
      const c = e.target.result;
      if (c) {
        // Only include records from the last 30 days
        if (c.value.timestamp >= thirtyDaysAgo) {
          results.push(c.value);
        }
        c.continue();
      } else {
        // Sort by timestamp ascending
        results.sort((a, b) => a.timestamp - b.timestamp);
        resolve(results);
      }
    };
    cursor.onerror = (e) => reject(e.target.error);
  });
}

// ============================================================
// IndexedDB — Delete price records older than 30 days
// Called periodically to keep storage clean
// ============================================================
export async function cleanOldRecords() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx      = db.transaction(STORE_PRICES, "readwrite");
    const store   = tx.objectStore(STORE_PRICES);
    const index   = store.index("byTimestamp");
    const cutoff  = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const range   = IDBKeyRange.upperBound(cutoff);
    const cursor  = index.openCursor(range);

    cursor.onsuccess = (e) => {
      const c = e.target.result;
      if (c) {
        c.delete();
        c.continue();
      } else {
        resolve();
      }
    };
    cursor.onerror = (e) => reject(e.target.error);
  });
}

// ============================================================
// IndexedDB — Tracked Products CRUD
// ============================================================

// Add or update a tracked product
export async function saveTrackedProduct(productData) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_PRODUCTS, "readwrite");
    const store = tx.objectStore(STORE_PRODUCTS);

    const product = {
      url:          productData.url,
      platform:     productData.platform,
      platformName: productData.platformName,
      title:        productData.title,
      image:        productData.image,
      currentPrice: productData.currentPrice,
      targetPrice:  productData.targetPrice || null,
      addedAt:      productData.addedAt || Date.now(),
      lastChecked:  Date.now()
    };

    const req = store.put(product); // put = insert or update
    req.onsuccess = () => resolve(product);
    req.onerror   = (e) => reject(e.target.error);
  });
}

// Get all tracked products
export async function getAllTrackedProducts() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_PRODUCTS, "readonly");
    const store = tx.objectStore(STORE_PRODUCTS);
    const req   = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

// Get one tracked product by URL
export async function getTrackedProduct(url) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_PRODUCTS, "readonly");
    const store = tx.objectStore(STORE_PRODUCTS);
    const req   = store.get(url);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror   = (e) => reject(e.target.error);
  });
}

// Delete a tracked product and its price history
export async function removeTrackedProduct(url) {
  const db = await openDB();

  // Delete from products store
  await new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_PRODUCTS, "readwrite");
    const store = tx.objectStore(STORE_PRODUCTS);
    const req   = store.delete(url);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });

  // Delete all price history for this URL
  await new Promise((resolve, reject) => {
    const tx     = db.transaction(STORE_PRICES, "readwrite");
    const store  = tx.objectStore(STORE_PRICES);
    const index  = store.index("byUrl");
    const range  = IDBKeyRange.only(url);
    const cursor = index.openCursor(range);

    cursor.onsuccess = (e) => {
      const c = e.target.result;
      if (c) { c.delete(); c.continue(); }
      else resolve();
    };
    cursor.onerror = (e) => reject(e.target.error);
  });
}

// Update the target price for a tracked product
export async function updateTargetPrice(url, targetPrice) {
  const db      = await openDB();
  const product = await getTrackedProduct(url);
  if (!product) return null;

  product.targetPrice = targetPrice;
  return saveTrackedProduct(product);
}

// ============================================================
// LocalStorage — User Preferences
// Used for fast-access settings (no async needed)
// ============================================================

const PREFS_KEY = "stackguild_prefs";

export function getPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : getDefaultPrefs();
  } catch {
    return getDefaultPrefs();
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

function getDefaultPrefs() {
  return {
    checkIntervalMinutes: 60,   // Background check interval
    notificationsEnabled: true,
    theme: "light"
  };
}

// ============================================================
// Export / Import — for data portability across devices
// (Addresses delimitation #5 in the thesis)
// ============================================================

export async function exportAllData() {
  const products = await getAllTrackedProducts();
  const allHistory = [];

  for (const product of products) {
    const history = await getPriceHistory(product.url);
    allHistory.push({ url: product.url, history });
  }

  return {
    exportedAt: new Date().toISOString(),
    version: "1.0",
    products,
    priceHistory: allHistory,
    prefs: getPrefs()
  };
}

export async function importData(jsonData) {
  try {
    const data = typeof jsonData === "string" ? JSON.parse(jsonData) : jsonData;

    for (const product of (data.products || [])) {
      await saveTrackedProduct(product);
    }

    for (const entry of (data.priceHistory || [])) {
      for (const record of entry.history) {
        await savePriceRecord(record);
      }
    }

    if (data.prefs) savePrefs(data.prefs);

    return { success: true, productsImported: data.products?.length || 0 };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
