// popup.js - The Simplified Popup View

document.addEventListener('DOMContentLoaded', () => {
  // --- Apply Theme ---
  // Immediately check for and apply the saved theme to avoid a flash of the wrong theme.
  (async () => {
      const { priceWatcherSettings } = await chrome.storage.local.get('priceWatcherSettings');
      if (priceWatcherSettings && priceWatcherSettings.theme === 'light') {
          document.body.classList.add('light-mode');
      }
  })();
  
  // --- Element Cache ---
  const openFullDashboardBtn = document.getElementById('openFullDashboardBtn');

  // --- Modal Elements (with unique IDs for popup) ---
  const confirmationModalEl = document.getElementById('confirmationModalPopup');
  const modalMessageEl = document.getElementById('modalMessagePopup');
  const modalConfirmBtn = document.getElementById('modalConfirmBtnPopup');
  const modalCancelBtn = document.getElementById('modalCancelBtnPopup');

  // Dashboard-specific elements
  const currentSiteHostnameEl = document.getElementById('currentSiteHostname');
  const siteFaviconEl = document.getElementById('siteFavicon');
  const loadingIndicatorEl = document.getElementById('loadingIndicator');
  const productHistoryContainerEl = document.getElementById('productHistoryContainer');
  const noHistoryMessageEl = document.getElementById('noHistoryMessage');
  const filterControlsEl = document.getElementById('filterControls');
  const filterCurrentBtn = document.getElementById('filterCurrentBtn');
  const filterRecentBtn = document.getElementById('filterRecentBtn');

  // --- State management ---
  let activeFilter = 'current'; // 'current' or 'recent'
  let currentTabUrl = '';
  let fullHistoryForHost = {}; // History for the current hostname
  let currentHostname = '';
  let isLoggedIn = false;

  const placeholderImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' fill='%23969BA1'/%3E%3C/svg%3E";

  const getCanonicalUrl = (urlString) => {
    try {
      const url = new URL(urlString);
      return url.origin + url.pathname;
    } catch (error) {
      return urlString;
    }
  };

  // --- Custom Confirmation Modal Logic ---
  const showConfirmationModal = (message) => {
    modalMessageEl.textContent = message;
    confirmationModalEl.classList.add('visible');

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        confirmationModalEl.classList.remove('visible');
        modalConfirmBtn.removeEventListener('click', onConfirm);
        modalCancelBtn.removeEventListener('click', onCancel);
      };

      const onConfirm = () => { cleanup(); resolve(true); };
      const onCancel = () => { cleanup(); reject(false); };

      modalConfirmBtn.addEventListener('click', onConfirm);
      modalCancelBtn.addEventListener('click', onCancel);
    });
  };

  // --- Dashboard Card Rendering Logic ---
  const renderProductCards = (historyData, hostname) => {
    loadingIndicatorEl.style.display = 'none';
    productHistoryContainerEl.innerHTML = ''; // Clear previous content

    const productUrls = Object.keys(historyData);

    if (productUrls.length === 0) {
      if (activeFilter === 'current') {
        noHistoryMessageEl.textContent = `No price history found for the current product.`;
      } else {
        noHistoryMessageEl.textContent = `No price history found for ${hostname} yet.`;
      }
      noHistoryMessageEl.style.display = 'block';
    } else {
      noHistoryMessageEl.style.display = 'none';
      
      productUrls.forEach(url => {
        const product = historyData[url];
        if (!product || !Array.isArray(product.history) || product.history.length === 0) return;

        const productCard = document.createElement('div');
        productCard.className = 'product-card';

        const productName = product.name || 'Unnamed Product';
        const imageUrl = product.imageUrl || placeholderImage;
        const sortedHistory = product.history.sort((a, b) => b.timestamp - a.timestamp);
        const latestEntry = sortedHistory[0];

        productCard.innerHTML = `
          <div class="product-info-top">
            <img src="${imageUrl}" class="product-image" alt="Product Image">
            <h3 class="product-name" title="${productName}">${productName}</h3>
            <button class="reset-product-button" data-url="${url}" title="Reset history for this product">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M0 0h24v24H0V0z" fill="none"/><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
            </button>
          </div>
          <div class="product-info-bottom">
            <div class="product-price">${latestEntry.currency || '₹'}${latestEntry.price.toFixed(2)}</div>
            <div class="product-timestamp">${new Date(latestEntry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        `;
        productHistoryContainerEl.appendChild(productCard);
      });

      document.querySelectorAll('.reset-product-button').forEach(button => {
        button.addEventListener('click', async (event) => {
          event.stopPropagation();
          const urlToDelete = event.currentTarget.getAttribute('data-url');
          try {
            await showConfirmationModal('Are you sure you want to delete the history for this product?');
            await chrome.runtime.sendMessage({ action: "deleteProductHistory", hostname: currentHostname, url: urlToDelete });
            refreshPopupDashboard();
          } catch (error) {
            // User clicked cancel, do nothing.
          }
        });
      });
    }
  };
  
  const updateDashboardView = () => {
    let dataToRender = {};
    if (activeFilter === 'current') {
      if (fullHistoryForHost[currentTabUrl]) {
        dataToRender[currentTabUrl] = fullHistoryForHost[currentTabUrl];
      }
    } else { // 'recent'
      const sortedProducts = Object.entries(fullHistoryForHost)
        .map(([url, productData]) => {
          const lastTimestamp = Array.isArray(productData.history) && productData.history.length > 0
            ? Math.max(...productData.history.map(h => h.timestamp))
            : 0;
          return { url, productData, lastTimestamp };
        })
        .sort((a, b) => b.lastTimestamp - a.lastTimestamp)
        .slice(0, 5);

      sortedProducts.forEach(({ url, productData }) => {
        dataToRender[url] = productData;
      });
    }
    renderProductCards(dataToRender, currentHostname);
  };

  const refreshPopupDashboard = async () => {
    try {
      loadingIndicatorEl.style.display = 'block';
      noHistoryMessageEl.style.display = 'none';
      productHistoryContainerEl.innerHTML = '';

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || !tab.url.startsWith('http')) {
        currentSiteHostnameEl.textContent = 'N/A';
        siteFaviconEl.style.display = 'none';
        noHistoryMessageEl.textContent = 'Please open this on a valid webpage.';
        noHistoryMessageEl.style.display = 'block';
        loadingIndicatorEl.style.display = 'none';
        filterControlsEl.style.display = 'none';
        return;
      }

      const url = new URL(tab.url);
      currentHostname = url.hostname;
      currentTabUrl = getCanonicalUrl(tab.url);
      currentSiteHostnameEl.textContent = currentHostname;

      if (tab.favIconUrl) {
        siteFaviconEl.src = tab.favIconUrl;
        siteFaviconEl.style.display = 'inline-block';
      } else {
        siteFaviconEl.style.display = 'none';
      }

      const response = await chrome.runtime.sendMessage({ action: "getPriceHistory", hostname: currentHostname });
      fullHistoryForHost = response.history || {};
      
      if(Object.keys(fullHistoryForHost).length > 0) {
        filterControlsEl.style.display = 'flex';
      } else {
        filterControlsEl.style.display = 'none';
      }

      updateDashboardView();

    } catch (error) {
      console.error(`[Price Watcher Popup] Error:`, error);
      loadingIndicatorEl.style.display = 'none';
      noHistoryMessageEl.textContent = `Error: ${error.message}`;
      noHistoryMessageEl.style.display = 'block';
    }
  };

  // --- Initializer for Popup Dashboard ---
  const initPopupDashboard = () => {
    filterCurrentBtn.addEventListener('click', () => {
      if (activeFilter === 'current') return;
      activeFilter = 'current';
      filterCurrentBtn.classList.add('active');
      filterRecentBtn.classList.remove('active');
      updateDashboardView();
    });

    filterRecentBtn.addEventListener('click', () => {
      if (activeFilter === 'recent') return;
      activeFilter = 'recent';
      filterRecentBtn.classList.add('active');
      filterCurrentBtn.classList.remove('active');
      updateDashboardView();
    });
    
    refreshPopupDashboard();
  };

  const initPopup = async () => {
    const storage = await chrome.storage.local.get('isLoggedIn');
    isLoggedIn = storage.isLoggedIn === true;

    if (!isLoggedIn) {
      chrome.tabs.create({ url: chrome.runtime.getURL('login.html') });
      window.close();
      return;
    }
    
    initPopupDashboard();
  };

  openFullDashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard_full.html') });
  });

  initPopup();
});