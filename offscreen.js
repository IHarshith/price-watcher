// offscreen.js - Handles background DOM scraping for the service worker.

console.log("Price Watcher: Offscreen document script loaded.");

// ===================================================================================
//  NOTE: The scraping logic below is duplicated from content.js.
//  In a larger application, this would be moved to a shared module.
// ===================================================================================

// --- UTILITY FUNCTIONS ---
function querySelectorMultiple(doc, selectors) {
  for (const selector of selectors) {
    const element = doc.querySelector(selector);
    if (element) return element;
  }
  return null;
}

// --- SITE-SPECIFIC CONFIGURATIONS ---
const SITE_CONFIGS = {
  "www.amazon.com": {
    productPageMarker: ["#add-to-cart-button", "#buy-now-button"],
    name: ["#productTitle"],
    price: ["#corePrice_feature_div .a-offscreen", "#price_inside_buybox", "#priceblock_ourprice", "#priceblock_dealprice", ".priceToPay span.a-offscreen"],
    image: ["#landingImage", "#imgTagWrapperId img"]
  },
  "www.amazon.in": {
    productPageMarker: ["#add-to-cart-button", "#buy-now-button"],
    name: ["#productTitle"],
    price: ["#corePrice_feature_div .a-offscreen", "#price_inside_buybox", "#priceblock_ourprice", "#priceblock_dealprice", ".priceToPay span.a-offscreen"],
    image: ["#landingImage", "#imgTagWrapperId img"]
  },
  "www.flipkart.com": {
    productPageMarker: ["button._2KpZ6l._2U9uOA._3v1-ww", "button._2KpZ6l._2U9uOA.i_O-_d"],
    name: ["span.B_NuCI"],
    price: ["div._30jeq3._16Jk6d"],
    image: ["img._396cs4._2amPTt._3qGmMb", "img._2r_T1I"]
  }
};

// --- GENERIC HEURISTIC SCRAPING ---
const PRICE_CONTEXT_KEYWORDS = ["price", "total", "buy", "checkout"];
function findPriceCandidates(doc) {
  const candidates = [];
  const PRICE_REGEX = /([$€£₹])\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/;
  const elements = doc.querySelectorAll("h1, h2, h3, h4, span, div, p, strong");
  elements.forEach(el => {
    const text = el.innerText?.trim();
    if (!text || text.length > 100) return;
    const match = text.match(PRICE_REGEX);
    if (!match) return;
    const lowerText = text.toLowerCase();
    const hasContext = PRICE_CONTEXT_KEYWORDS.some(keyword => lowerText.includes(keyword));
    candidates.push({
      element: el,
      text,
      price: parseFloat(match[2].replace(/,/g, "")),
      currency: match[1],
      hasContext,
      fontSize: parseFloat(getComputedStyle(el).fontSize) || 0
    });
  });
  return candidates;
}

function chooseBestPrice(candidates) {
  if (candidates.length === 0) return null;
  const filtered = candidates.filter(c => c.price > 1 && c.price < 10000000);
  filtered.sort((a, b) => {
    if (a.hasContext !== b.hasContext) return a.hasContext ? -1 : 1;
    return b.fontSize - a.fontSize;
  });
  return filtered[0];
}

function detectGenericProductName(doc) {
  const h1 = doc.querySelector("h1");
  if (h1 && h1.innerText) return h1.innerText.trim();
  const ogTitle = doc.querySelector('meta[property="og:title"]');
  if (ogTitle && ogTitle.content) return ogTitle.content.trim();
  return doc.title.split('|')[0].split('-')[0].trim();
}

function detectGenericProductImage(doc) {
  const ogImage = doc.querySelector('meta[property="og:image"]');
  if (ogImage && ogImage.content) return ogImage.content;
  return null;
}

function isGenericProductPage(doc) {
  const addToCartSelectors = [
    '[data-test*="add-to-cart"]', '[data-testid*="add-to-cart"]',
    'button[class*="add-to-cart"]', 'button[id*="add-to-cart"]',
    'button[class*="addtocart"]', 'button[id*="addtocart"]'
  ];
  for (const selector of addToCartSelectors) {
    if (doc.querySelector(selector)) return true;
  }
  return false;
}

// --- MAIN SCRAPING LOGIC ---
function scrapeFromJsonLd(doc) {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const jsonData = JSON.parse(script.textContent);
      const graph = jsonData['@graph'] || (Array.isArray(jsonData) ? jsonData : [jsonData]);
      for (const item of graph) {
        if (item['@type'] === 'Product' || item['@type'] === 'Book') {
          const offer = item.offers && (Array.isArray(item.offers) ? item.offers[0] : item.offers);
          if (offer && (offer.price || offer.lowPrice)) {
            const price = offer.price || offer.lowPrice;
            const currency = offer.priceCurrency;
            const name = item.name;
            const image = item.image && (Array.isArray(item.image) ? item.image[0] : item.image);
            const currencySymbolMap = { 'USD': '$', 'INR': '₹', 'EUR': '€', 'GBP': '£', 'CAD': '$' };
            const symbol = currencySymbolMap[currency] || '$';
            if (price && name) return { price: parseFloat(price), currency: symbol, productName: name, productImageUrl: image };
          }
        }
      }
    } catch (error) { continue; }
  }
  return null;
}

function scrapeWithConfig(doc, config) {
  try {
    const marker = querySelectorMultiple(doc, config.productPageMarker);
    if (!marker) return null;
    const nameEl = querySelectorMultiple(doc, config.name);
    const priceEl = querySelectorMultiple(doc, config.price);
    const imageEl = querySelectorMultiple(doc, config.image);
    if (!nameEl || !priceEl) return null;
    const name = nameEl.innerText.trim();
    const priceText = priceEl.innerText.trim();
    const priceMatch = priceText.replace(/,/g, '').match(/(\d+(\.\d{1,2})?)/);
    const currencyMatch = priceText.match(/[$€£₹]/);
    if (!priceMatch) return null;
    return {
      price: parseFloat(priceMatch[0]),
      currency: currencyMatch ? currencyMatch[0] : '₹',
      productName: name,
      productImageUrl: imageEl ? imageEl.src : null
    };
  } catch (error) { return null; }
}

function scrapeWithHeuristics(doc) {
  if (!isGenericProductPage(doc)) return null;
  const candidates = findPriceCandidates(doc);
  const best = chooseBestPrice(candidates);
  if (!best) return null;
  return {
    price: best.price,
    currency: best.currency,
    productName: detectGenericProductName(doc),
    productImageUrl: detectGenericProductImage(doc)
  };
}

// --- MESSAGE LISTENER ---
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.action === "scrapeProduct") {
    const { url } = request;
    console.log(`[Offscreen] Received request to scrape: ${url}`);
    
    try {
      // Fetch the page content
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const htmlText = await response.text();
      
      // Parse the HTML
      const doc = new DOMParser().parseFromString(htmlText, "text/html");
      const hostname = new URL(url).hostname;
      
      let productData = null;

      // Run through the scraping strategies
      productData = scrapeFromJsonLd(doc);
      if (!productData) {
        const config = SITE_CONFIGS[hostname];
        if (config) productData = scrapeWithConfig(doc, config);
      }
      if (!productData) {
        if (!SITE_CONFIGS[hostname]) productData = scrapeWithHeuristics(doc);
      }

      console.log(`[Offscreen] Scraping result for ${url}:`, productData);
      chrome.runtime.sendMessage({ action: "scrapeResult", data: productData, url: url });

    } catch (error) {
      console.error(`[Offscreen] Error scraping ${url}:`, error);
      chrome.runtime.sendMessage({ action: "scrapeResult", data: null, url: url, error: error.message });
    }
    return true; // Indicates async response
  }
});