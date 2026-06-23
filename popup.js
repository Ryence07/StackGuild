// ============================================================
// popup.js — Extension Popup Controller
//
// Handles all UI interactions:
// - Detecting if user is on a product page
// - Displaying current price
// - Tracking / untracking products
// - Rendering price history chart (line graph)
// - Settings management
// ============================================================

import {
  saveTrackedProduct,
  getTrackedProduct,
  getAllTrackedProducts,
  removeTrackedProduct,
  updateTargetPrice,
  getPriceHistory,
  getPrefs,
  savePrefs,
  exportAllData
} from "./database.js";

// ---- DOM References ----
const panelCurrent  = document.getElementById("panel-current");
const panelNoPage   = document.getElementById("panel-nopage");
const panelList     = document.getElementById("panel-list");
const panelSettings = document.getElementById("panel-settings");

const productImage    = document.getElementById("product-image");
const productPlatform = document.getElementById("product-platform");
const productTitle    = document.getElementById("product-title");
const productPrice    = document.getElementById("product-price");
const inputTarget     = document.getElementById("input-target");
const btnTrack        = document.getElementById("btn-track");
const btnUntrack      = document.getElementById("btn-untrack");
const trackStatus     = document.getElementById("track-status");
const chartSection    = document.getElementById("chart-section");
const priceChart      = document.getElementById("price-chart");

const productsList    = document.getElementById("products-list");
const productCount    = document.getElementById("product-count");

const btnSettings     = document.getElementById("btn-settings");
const btnBack         = document.getElementById("btn-back");
const btnSaveSettings = document.getElementById("btn-save-settings");
const btnExport       = document.getElementById("btn-export");
const inputInterval   = document.getElementById("input-interval");
const toggleNotif     = document.getElementById("toggle-notif");
const settingsMsg     = document.getElementById("settings-msg");

// ---- State ----
let currentProduct = null; // Data from the active tab's product page
let isTracked      = false;

// ============================================================
// Initialize popup
// ============================================================
async function init() {
  loadSettings();
  await loadCurrentTab();
  await loadTrackedProductsList();
}

// ============================================================
// Load and display the product on the current tab (if any)
// ============================================================
async function loadCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) { showNoPage(); return; }

  const url = tab.url;
  const isShopee = url.includes("shopee.ph") && url.match(/[^/]+-i\.\d+\.\d+/);
  const isLazada = url.includes("lazada.com.ph") && url.includes("/products/");

  if (!isShopee && !isLazada) { showNoPage(); return; }

  // Try to get price data injected by content.js (stored in session)
  // We also attempt to scrape via scripting API
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func:   scrapeCurrentPage
    });

    if (results && results[0] && results[0].result) {
      currentProduct = results[0].result;
      currentProduct.url = url;
      await showCurrentProduct(currentProduct);
    } else {
      showNoPage("Couldn't read the price. Try refreshing the product page.");
    }
  } catch (e) {
    console.error("[StackGuild] Scripting error:", e);
    showNoPage("Permission error. Make sure you're on a product page.");
  }
}

// ---- Function injected into the active tab ----
function scrapeCurrentPage() {
  const platformKey = window.location.href.includes("shopee.ph") ? "shopee" : "lazada";
  const priceSelectors = platformKey === "shopee"
    ? ["._3n5NQx", ".pqTWkA", "[class*='price'] [class*='current']", "._1xk7ak"]
    : [".pdp-price_type_normal", ".pdp-price", "[class*='pdp-price']", ".ooOxS"];
  const titleSelectors = platformKey === "shopee"
    ? ["._44qnta", "[class*='page-product__title']", "h1"]
    : [".pdp-mod-product-badge-title", "h1"];
  const imageSelectors = platformKey === "shopee"
    ? ["._3zGUzy img", "[class*='image-slot'] img"]
    : [".pdp-mod-common-image img", "[class*='gallery'] img"];

  const normalize = (text) => {
    const cleaned = text.replace(/₱/g, "").replace(/,/g, "").trim();
    const match = cleaned.match(/(\d+(\.\d+)?)/);
    return match ? parseFloat(match[1]) : null;
  };

  let rawPrice = null, currentPrice = null;
  for (const sel of priceSelectors) {
    try {
      const el = document.querySelector(sel);
      if (el && /\d/.test(el.textContent)) {
        rawPrice = el.textContent.trim();
        currentPrice = normalize(rawPrice);
        if (currentPrice) break;
      }
    } catch (e) { /* skip */ }
  }

  if (!currentPrice) return null;

  let title = document.title || "Product";
  for (const sel of titleSelectors) {
    try {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 2) { title = el.textContent.trim(); break; }
    } catch (e) { /* skip */ }
  }

  let image = null;
  for (const sel of imageSelectors) {
    try {
      const el = document.querySelector(sel);
      if (el && el.src) { image = el.src; break; }
    } catch (e) { /* skip */ }
  }

  return {
    platform:     platformKey,
    platformName: platformKey === "shopee" ? "Shopee Philippines" : "Lazada Philippines",
    title,
    image,
    rawPrice,
    currentPrice,
    timestamp: Date.now()
  };
}

// ============================================================
// Show the current product panel
// ============================================================
async function showCurrentProduct(data) {
  // Update UI
  productImage.src = data.image || "icons/icon48.png";
  productImage.onerror = () => { productImage.src = "icons/icon48.png"; };

  productPlatform.textContent = data.platformName;
  productPlatform.className = "platform-badge" + (data.platform === "lazada" ? " lazada" : "");

  productTitle.textContent = data.title;
  productPrice.textContent = `₱${data.currentPrice.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

  // Check if already tracked
  const tracked = await getTrackedProduct(data.url);
  isTracked = !!tracked;

  if (isTracked) {
    inputTarget.value = tracked.targetPrice || "";
    btnTrack.classList.add("hidden");
    btnUntrack.classList.remove("hidden");
    await renderPriceChart(data.url);
  } else {
    btnTrack.classList.remove("hidden");
    btnUntrack.classList.add("hidden");
    chartSection.classList.add("hidden");
  }

  panelNoPage.classList.add("hidden");
  panelCurrent.classList.remove("hidden");
}

function showNoPage(msg = null) {
  panelCurrent.classList.add("hidden");
  panelNoPage.classList.remove("hidden");
  if (msg) {
    const sub = panelNoPage.querySelector(".empty-sub");
    if (sub) sub.textContent = msg;
  }
}

// ============================================================
// Track button
// ============================================================
btnTrack.addEventListener("click", async () => {
  if (!currentProduct) return;

  const targetPrice = parseFloat(inputTarget.value) || null;
  if (targetPrice !== null && targetPrice <= 0) {
    showStatus(trackStatus, "Target price must be a positive number.", "error");
    return;
  }

  try {
    await saveTrackedProduct({
      ...currentProduct,
      targetPrice,
      addedAt: Date.now()
    });

    isTracked = true;
    btnTrack.classList.add("hidden");
    btnUntrack.classList.remove("hidden");
    showStatus(trackStatus, "✅ Product is now being tracked!");
    await loadTrackedProductsList();
    await renderPriceChart(currentProduct.url);
  } catch (e) {
    showStatus(trackStatus, "Error saving product: " + e.message, "error");
  }
});

// ============================================================
// Untrack button
// ============================================================
btnUntrack.addEventListener("click", async () => {
  if (!currentProduct) return;
  if (!confirm("Stop tracking this product and delete its price history?")) return;

  try {
    await removeTrackedProduct(currentProduct.url);
    isTracked = false;
    btnTrack.classList.remove("hidden");
    btnUntrack.classList.add("hidden");
    chartSection.classList.add("hidden");
    showStatus(trackStatus, "Product removed from tracking.");
    await loadTrackedProductsList();
  } catch (e) {
    showStatus(trackStatus, "Error: " + e.message, "error");
  }
});

// ============================================================
// Price History Chart (Line Graph)
// Built without external libraries — pure Canvas API
// ============================================================
async function renderPriceChart(url) {
  const history = await getPriceHistory(url);
  if (!history || history.length < 2) {
    chartSection.classList.add("hidden");
    return;
  }

  chartSection.classList.remove("hidden");

  const ctx    = priceChart.getContext("2d");
  const W      = priceChart.width;
  const H      = priceChart.height;
  const padL   = 52, padR = 10, padT = 16, padB = 28;
  const plotW  = W - padL - padR;
  const plotH  = H - padT - padB;

  // Data
  const prices = history.map(r => r.currentPrice);
  const times  = history.map(r => r.timestamp);
  const minP   = Math.min(...prices) * 0.97;
  const maxP   = Math.max(...prices) * 1.03;
  const minT   = times[0];
  const maxT   = times[times.length - 1];

  const xPos = (t) => padL + ((t - minT) / (maxT - minT || 1)) * plotW;
  const yPos = (p) => padT + plotH - ((p - minP) / (maxP - minP || 1)) * plotH;

  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = "#e0e0e0";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (plotH / 4) * i;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    const val = maxP - ((maxP - minP) / 4) * i;
    ctx.fillStyle = "#757575";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("₱" + Math.round(val).toLocaleString(), padL - 3, y + 3);
  }

  // Line
  ctx.beginPath();
  ctx.strokeStyle = "#EE4D2D";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  history.forEach((r, i) => {
    const x = xPos(r.timestamp), y = yPos(r.currentPrice);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Area fill
  ctx.beginPath();
  history.forEach((r, i) => {
    const x = xPos(r.timestamp), y = yPos(r.currentPrice);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineTo(xPos(times[times.length - 1]), padT + plotH);
  ctx.lineTo(xPos(times[0]), padT + plotH);
  ctx.closePath();
  ctx.fillStyle = "rgba(238, 77, 45, 0.08)";
  ctx.fill();

  // Dots
  history.forEach((r) => {
    const x = xPos(r.timestamp), y = yPos(r.currentPrice);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#EE4D2D";
    ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
  });

  // X-axis dates
  ctx.fillStyle = "#757575"; ctx.font = "9px sans-serif"; ctx.textAlign = "center";
  [0, Math.floor(history.length / 2), history.length - 1].forEach(i => {
    if (!history[i]) return;
    const x = xPos(history[i].timestamp);
    const d = new Date(history[i].timestamp);
    ctx.fillText(`${d.getMonth() + 1}/${d.getDate()}`, x, H - 6);
  });
}

// ============================================================
// Load tracked products list
// ============================================================
async function loadTrackedProductsList() {
  const products = await getAllTrackedProducts();
  productCount.textContent = products.length;

  if (products.length === 0) {
    productsList.innerHTML = `
      <div class="empty-state">
        <p class="empty-icon">📦</p>
        <p class="empty-title">No tracked products yet</p>
        <p class="empty-sub">Visit a Shopee or Lazada product page and click Track.</p>
      </div>`;
    return;
  }

  productsList.innerHTML = "";
  for (const p of products) {
    const item = document.createElement("div");
    item.className = "product-list-item";
    item.innerHTML = `
      <img class="product-list-thumb"
           src="${p.image || "icons/icon48.png"}"
           onerror="this.src='icons/icon48.png'" />
      <div class="product-list-info">
        <p class="product-list-name">${p.title}</p>
        <p class="product-list-price">₱${p.currentPrice?.toLocaleString("en-PH", { minimumFractionDigits: 2 }) || "—"}</p>
        ${p.targetPrice ? `<p class="product-list-target">🎯 Target: ₱${p.targetPrice.toLocaleString()}</p>` : ""}
      </div>
      <div class="product-list-actions">
        <button class="btn-sm" data-url="${p.url}" data-action="open">🔗</button>
        <button class="btn-sm danger" data-url="${p.url}" data-action="remove">🗑</button>
      </div>`;
    productsList.appendChild(item);
  }

  productsList.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const url    = btn.dataset.url;
      const action = btn.dataset.action;
      if (action === "open") {
        chrome.tabs.create({ url });
      } else if (action === "remove") {
        if (confirm("Remove this product and its history?")) {
          await removeTrackedProduct(url);
          await loadTrackedProductsList();
        }
      }
    });
  });
}

// ============================================================
// Settings
// ============================================================
function loadSettings() {
  const prefs = getPrefs();
  inputInterval.value = prefs.checkIntervalMinutes || 60;
  toggleNotif.checked = prefs.notificationsEnabled !== false;
}

btnSettings.addEventListener("click", () => {
  panelCurrent.classList.add("hidden");
  panelNoPage.classList.add("hidden");
  panelList.classList.add("hidden");
  panelSettings.classList.remove("hidden");
});

btnBack.addEventListener("click", () => {
  panelSettings.classList.add("hidden");
  panelList.classList.remove("hidden");
  if (currentProduct) panelCurrent.classList.remove("hidden");
  else panelNoPage.classList.remove("hidden");
});

btnSaveSettings.addEventListener("click", () => {
  const interval = parseInt(inputInterval.value) || 60;
  savePrefs({ checkIntervalMinutes: interval, notificationsEnabled: toggleNotif.checked });
  chrome.runtime.sendMessage({ type: "UPDATE_INTERVAL", intervalMinutes: interval });
  showStatus(settingsMsg, "✅ Settings saved!");
});

btnExport.addEventListener("click", async () => {
  const data = await exportAllData();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `stackguild-export-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showStatus(settingsMsg, "✅ Data exported!");
});

// ============================================================
// Utility: show a status message
// ============================================================
function showStatus(el, msg, type = "success") {
  el.textContent = msg;
  el.className   = "status-msg" + (type === "error" ? " error" : "");
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3500);
}

// ---- Boot ----
init();
