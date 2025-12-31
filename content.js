
// content.js — Upgraded with a 3-Step Scraping Strategy

console.log("Price Watcher: content script running (v3)");

// ===================================================================================
//  UTILITY FUNCTIONS
// ===================================================================================

/**
 * Finds the first element that matches any of the given selectors.
 * @param {string[]} selectors - An array of CSS selectors.
 * @returns {Element|null} - The found element or null.
 */
function querySelectorMultiple(selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }
  return null;
}


/**
 * ===================================================================================
 *  SITE-SPECIFIC CONFIGURATIONS (METHOD 2)
 * ===================================================================================
 * This object holds precise CSS selectors for popular e-commerce sites.
 * This is used as the second-best method if JSON-LD data isn't available.
 */
const SITE_CONFIGS = {
  // --- Amazon ---
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

  // --- Flipkart ---
  "www.flipkart.com": {
    productPageMarker: ["button._2KpZ6l._2U9uOA._3v1-ww", "button._2KpZ6l._2U9uOA.i_O-_d"], // Buy Now, Add to Cart
    name: ["span.B_NuCI"],
    price: ["div._30jeq3._16Jk6d"],
    image: ["img._396cs4._2amPTt._3qGmMb", "img._2r_T1I"]
  }
};


/**
 * ===================================================================================
 *  GENERIC HEURISTIC SCRAPING (METHOD 3 - FALLBACK)
 * ===================================================================================
 */

const PRICE_CONTEXT_KEYWORDS = ["price", "total", "buy", "checkout"];

function findPriceCandidates() {
  const candidates = [];
  const PRICE_REGEX = /([$€£₹])\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/;
  const elements = document.querySelectorAll("h1, h2, h3, h4, span, div, p, strong");

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

function detectGenericProductName() {
  const h1 = document.querySelector("h1");
  if (h1 && h1.innerText) return h1.innerText.trim();
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle && ogTitle.content) return ogTitle.content.trim();
  return document.title.split('|')[0].split('-')[0].trim();
}

function detectGenericProductImage() {
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage && ogImage.content) return ogImage.content;
  return null;
}

function isGenericProductPage() {
  const addToCartSelectors = [
    '[data-test*="add-to-cart"]',
    '[data-testid*="add-to-cart"]',
    'button[class*="add-to-cart"]',
    'button[id*="add-to-cart"]',
    'button[class*="addtocart"]',
    'button[id*="addtocart"]'
  ];
  for (const selector of addToCartSelectors) {
    if (document.querySelector(selector)) return true;
  }
  return false;
}


/**
 * ===================================================================================
 *  MAIN SCRAPING LOGIC
 * ===================================================================================
 */

// METHOD 1: Scrape from JSON-LD Schema.org data (Most Reliable)
function scrapeFromJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
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

            if (price && name) {
              console.log("Price Watcher [JSON-LD]: Found product via Schema.org data.");
              return {
                price: parseFloat(price),
                currency: symbol,
                productName: name,
                productImageUrl: image
              };
            }
          }
        }
      }
    } catch (error) {
      continue;
    }
  }
  console.log("Price Watcher [JSON-LD]: No valid Product schema found.");
  return null;
}


// METHOD 2: Use site-specific CSS selectors (Reliable)
function scrapeWithConfig(config) {
  try {
    const marker = querySelectorMultiple(config.productPageMarker);
    if (!marker) {
      console.log("Price Watcher [Config]: Product page marker not found.");
      return null;
    }

    const nameEl = querySelectorMultiple(config.name);
    const priceEl = querySelectorMultiple(config.price);
    const imageEl = querySelectorMultiple(config.image);

    if (!nameEl || !priceEl) {
      console.log("Price Watcher [Config]: Name or Price element not found.");
      return null;
    }

    const name = nameEl.innerText.trim();
    const priceText = priceEl.innerText.trim();
    
    const priceMatch = priceText.replace(/,/g, '').match(/(\d+(\.\d{1,2})?)/);
    const currencyMatch = priceText.match(/[$€£₹]/);

    if (!priceMatch) {
      console.log(`Price Watcher [Config]: Price regex failed on text: "${priceText}"`);
      return null;
    }

    return {
      price: parseFloat(priceMatch[0]),
      currency: currencyMatch ? currencyMatch[0] : '₹', // Default to ₹ if no symbol, common for .in sites
      productName: name,
      productImageUrl: imageEl ? imageEl.src : null
    };
  } catch (error) {
    console.error("Price Watcher [Config]: Error during scraping.", error);
    return null;
  }
}

// METHOD 3: Fallback to heuristics (Best Effort)
function scrapeWithHeuristics() {
  if (!isGenericProductPage()) {
    console.log("Price Watcher [Heuristic]: Not detected as a generic product page.");
    return null;
  }

  const candidates = findPriceCandidates();
  const best = chooseBestPrice(candidates);

  if (!best) {
    console.log("Price Watcher [Heuristic]: Could not determine the best price from candidates.");
    return null;
  }

  return {
    price: best.price,
    currency: best.currency,
    productName: detectGenericProductName(),
    productImageUrl: detectGenericProductImage()
  };
}


/**
 * ===================================================================================
 *  EXECUTION AND OBSERVER LOGIC
 * ===================================================================================
 */
let debounceTimer;
let priceSent = false;
let observer;

const runDetection = () => {
  if (priceSent) {
    if (observer) observer.disconnect();
    return;
  }

  let productData = null;

  // Attempt 1: JSON-LD (Highest Priority)
  productData = scrapeFromJsonLd();

  // Attempt 2: Site Config (If JSON-LD fails)
  if (!productData) {
    const config = SITE_CONFIGS[window.location.hostname];
    if (config) {
      console.log(`Price Watcher: Trying config for ${window.location.hostname}`);
      productData = scrapeWithConfig(config);
    }
  }

  // Attempt 3: Heuristics (Last Resort)
  if (!productData) {
    const config = SITE_CONFIGS[window.location.hostname];
    if (!config) { // Only run heuristics if there wasn't a config to try
        console.log("Price Watcher: No specific config found, falling back to heuristics.");
        productData = scrapeWithHeuristics();
    }
  }

  if (productData) {
    priceSent = true;
    if (observer) observer.disconnect(); // Stop observing once we've succeeded.

    console.log(
      `Price Watcher: Success! Detected price ${productData.currency}${productData.price} for product "${productData.productName}"`
    );

    chrome.runtime.sendMessage({
      action: "savePrice",
      url: window.location.href,
      hostname: window.location.hostname,
      price: productData.price,
      currency: productData.currency,
      productName: productData.productName,
      productImageUrl: productData.productImageUrl,
      timestamp: Date.now()
    });
  } else {
    console.log("Price Watcher: Conditions not met. Waiting for dynamic content...");
  }
};

// --- Execution ---
// 1. Initial attempt after a short delay for initial page render
setTimeout(runDetection, 500);

// 2. Fallback to MutationObserver for dynamic pages (Single Page Apps)
observer = new MutationObserver((mutations) => {
  if (priceSent) {
    observer.disconnect();
    return;
  }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runDetection, 1000);
});

// Start observing the entire document body for changes.
observer.observe(document.body, {
  childList: true,
  subtree: true
});
