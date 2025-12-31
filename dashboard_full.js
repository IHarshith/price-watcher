// dashboard_full.js - The Full Dashboard and SPA Logic

document.addEventListener('DOMContentLoaded', () => {

    // --- Settings Configuration ---
    const SETTINGS_KEY = 'priceWatcherSettings';
    const settingsConfig = {
        theme: {
            defaultValue: 'dark',
            apply: (value) => {
                document.body.classList.toggle('light-mode', value === 'light');
            }
        },
        globalNotifications: {
            defaultValue: true,
        },
        alertEmail: {
            defaultValue: '',
        },
        historyRetention: {
            defaultValue: 20,
        }
    };
    let currentSettings = {};

    // --- Theme Application (run immediately) ---
    const applySavedTheme = async () => {
        const { [SETTINGS_KEY]: savedSettings } = await chrome.storage.local.get(SETTINGS_KEY);
        currentSettings = { ...Object.fromEntries(Object.entries(settingsConfig).map(([key, {defaultValue}]) => [key, defaultValue])), ...savedSettings };
        settingsConfig.theme.apply(currentSettings.theme);
    };
    applySavedTheme();

    // --- Element Cache ---
    const pageContentFullEl = document.getElementById('page-content-full');
    const navLinksFullEl = document.getElementById('navLinksFull');

    // --- Confirmation Modal Elements ---
    const confirmationModalEl = document.getElementById('confirmationModalFull');
    const modalMessageEl = document.getElementById('modalMessage');
    const modalConfirmBtn = document.getElementById('modalConfirmBtn');
    const modalCancelBtn = document.getElementById('modalCancelBtn');
    
    // --- State management ---
    let masterProductList = []; // Stores all tracked products for various pages
    const placeholderImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150' viewBox='0 0 150 150'%3E%3Crect width='150' height='150' fill='%234a627a'/%3E%3C/svg%3E";
    // This is a simulation. In a real app, never store passwords in the client.
    const pseudoHash = (password) => btoa(password + 'price-watcher-salt');

    // --- Generic Confirmation Modal Logic ---
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
    
    // --- Utility for showing temporary messages ---
    const showMessage = (elementId, message, type = 'info', duration = 4000) => {
      const messageEl = document.getElementById(elementId);
      if (messageEl) {
        messageEl.textContent = message;
        messageEl.className = `message alert ${type}`;
        messageEl.style.opacity = 1;
        if (duration > 0) {
            setTimeout(() => { messageEl.style.opacity = 0; }, duration);
        }
      }
    };

    // --- Navigation Logic ---
    const updateNavLinksFull = () => {
        document.querySelectorAll('.nav-links-full a').forEach(link => link.classList.remove('active'));
        const currentHash = window.location.hash || '#watchlist';
        const activeLink = document.querySelector(`.nav-links-full a[href="${currentHash}"]`);
        if (activeLink) {
            activeLink.classList.add('active');
        }
    };
    
    // --- Helper to get clean site names & format currency ---
    const getFriendlySiteName = (hostname) => {
        const trimmedHost = (hostname || '').trim();
        if (trimmedHost.includes('amazon')) return 'Amazon';
        if (trimmedHost.includes('flipkart')) return 'Flipkart';
        const name = trimmedHost.replace('www.', '').split('.')[0];
        return name.charAt(0).toUpperCase() + name.slice(1);
    };
    const formatCurrency = (price, currency) => {
        if (typeof price !== 'number' || isNaN(price)) return `${currency || '$'}0.00`;
        return `${currency || '$'}${price.toFixed(2)}`;
    };

    const applyFiltersAndSort = () => {
        const filterPriceChange = document.getElementById('filterPriceChange').value;
        const filterSite = document.getElementById('filterSite').value;
        const minPrice = parseFloat(document.getElementById('filterMinPrice').value);
        const maxPrice = parseFloat(document.getElementById('filterMaxPrice').value);
        const sortValue = document.getElementById('sortProducts').value;
        
        let processedList = [...masterProductList];

        if (filterPriceChange === 'drops') processedList = processedList.filter(p => p.priceChange < 0);
        else if (filterPriceChange === 'increases') processedList = processedList.filter(p => p.priceChange > 0);
        else if (filterPriceChange === 'unchanged') processedList = processedList.filter(p => p.priceChange === 0);
        if (!isNaN(minPrice)) processedList = processedList.filter(p => p.latestPrice >= minPrice);
        if (!isNaN(maxPrice)) processedList = processedList.filter(p => p.latestPrice <= maxPrice);
        if (filterSite !== 'all') processedList = processedList.filter(p => getFriendlySiteName(p.hostname) === filterSite);
        
        const [sortKey, sortDirection] = sortValue.split('-');
        processedList.sort((a, b) => {
            let valA, valB;
            switch(sortKey) {
                case 'price': valA = a.latestPrice; valB = b.latestPrice; break;
                case 'dropAbs': valA = a.priceChange; valB = b.priceChange; break;
                case 'dropPerc': valA = a.priceChangePercentage; valB = b.priceChangePercentage; break;
                case 'increaseAbs': valA = a.priceChange; valB = b.priceChange; break;
                case 'increasePerc': valA = a.priceChangePercentage; valB = b.priceChangePercentage; break;
                case 'name': valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); break;
                case 'added': valA = a.firstAddedTimestamp; valB = b.firstAddedTimestamp; break;
                case 'updated': valA = a.lastUpdatedTimestamp; valB = b.lastUpdatedTimestamp; break;
                default: return 0;
            }

            if (sortKey === 'increaseAbs' || sortKey === 'increasePerc' || sortDirection === 'desc') {
                return valA > valB ? -1 : (valA < valB ? 1 : 0);
            }
            return valA < valB ? -1 : (valA > valB ? 1 : 0);
        });

        renderWatchlistCards(processedList);
    };

    // --- Watchlist Rendering & Logic ---
    const renderWatchlistCards = (products) => {
        const watchlistGridEl = document.getElementById('watchlistGrid');
        const noProductsMessageEl = document.getElementById('noProductsMessage');
        watchlistGridEl.innerHTML = '';

        if (products.length === 0) {
            noProductsMessageEl.textContent = 'No products match your current filters.';
            noProductsMessageEl.style.display = 'block';
            return;
        }

        noProductsMessageEl.style.display = 'none';

        products.forEach(product => {
            const card = document.createElement('div');
            card.className = 'watchlist-card';
            card.title = `View product on ${getFriendlySiteName(product.hostname)}`;
            card.style.cursor = 'pointer';

            let priceChangeHtml = '';
            if (product.priceChange !== 0) {
                const changeIcon = product.priceChange > 0 ? '▲' : '▼';
                const changeClass = product.priceChange > 0 ? 'up' : 'down';
                priceChangeHtml = `<span class="price-change ${changeClass}"><span class="icon">${changeIcon}</span>${formatCurrency(Math.abs(product.priceChange), product.latestCurrency)} (${product.priceChangePercentage.toFixed(2)}%)</span>`;
            } else {
                 priceChangeHtml = `<span class="price-change" style="color: var(--secondary-text-color);">No change</span>`;
            }

            card.innerHTML = `
                <img src="${product.imageUrl || placeholderImage}" class="watchlist-image" alt="${product.name}">
                <div class="watchlist-info">
                    <h3 class="watchlist-name">${product.name}</h3>
                    <p class="watchlist-price">${formatCurrency(product.latestPrice, product.latestCurrency)}</p>
                    ${priceChangeHtml}
                    <a href="${product.url}" target="_blank" rel="noopener noreferrer" class="watchlist-link">${getFriendlySiteName(product.hostname)}</a>
                </div>
            `;
            card.addEventListener('click', (e) => {
                if (e.target.tagName !== 'A') { // Allow the link to be clicked, but make the card clickable too
                    chrome.tabs.create({ url: product.url });
                }
            });
            watchlistGridEl.appendChild(card);
        });
    };
    
    const renderWatchlistPage = async () => {
        pageContentFullEl.innerHTML = `
            <div class="controls-container" id="controlsContainer" style="display:none;">
                <div class="control-group"><label for="filterPriceChange">Price Change</label><select id="filterPriceChange"><option value="all">All </option><option value="drops">Show Only Price Drops</option><option value="increases">Show Only Price Increases</option><option value="unchanged">Show Unchanged</option></select></div>
                <div class="control-group"><label for="filterSite">Website</label><select id="filterSite"><option value="all">All Sites</option></select></div>
                <div class="control-group"><label>Price Range</label><div class="price-range-inputs"><input type="number" id="filterMinPrice" min="0" placeholder="Min"><span>-</span><input type="number" id="filterMaxPrice" min="0" placeholder="Max"></div></div>
                <div class="control-group"><label for="sortProducts">Sort By</label><select id="sortProducts"><optgroup label="Date"><option value="updated-desc">Last Updated (Newest)</option><option value="updated-asc">Last Updated (Oldest)</option><option value="added-desc">Most Recently Added</option><option value="added-asc">Least Recently Added</option></optgroup><optgroup label="Price"><option value="price-desc">Price (High to Low)</option><option value="price-asc">Price (Low to High)</option></optgroup><optgroup label="Price Change"><option value="dropPerc-asc">Biggest Drop (%)</option><option value="dropAbs-asc">Biggest Drop (Abs)</option><option value="increasePerc-desc">Biggest Increase (%)</option><option value="increaseAbs-desc">Biggest Increase (Abs)</option></optgroup><optgroup label="Name"><option value="name-asc">Product Name (A-Z)</option><option value="name-desc">Product Name (Z-A)</option></optgroup></select></div>
                <button id="resetControlsBtn" class="button-secondary">Reset</button>
            </div>
            <div class="loading-indicator" id="watchlistLoadingIndicator">Loading your watchlist...</div>
            <div class="watchlist-grid" id="watchlistGrid"></div>
            <div class="no-products" id="noProductsMessage" style="display:none;"></div>
            <div class="footer-buttons" id="dashboardFullFooter"><button id="resetAllButtonFull" class="button-danger">Reset All Data</button><button id="logoutButtonFull" class="button-secondary">Logout</button></div>`;

        try {
            const allStorageKeys = await chrome.storage.local.get(null);
            const allProducts = [];

            for (const hostname in allStorageKeys) {
                if (['isLoggedIn', 'userCredentials', 'priceWatcherAlerts', 'priceWatcherSettings'].includes(hostname)) continue;
                const hostData = allStorageKeys[hostname];
                for (const url in hostData) {
                    const product = hostData[url];
                    if (product && Array.isArray(product.history) && product.history.length > 0) {
                        const historyAsc = [...product.history].sort((a, b) => a.timestamp - b.timestamp);
                        const sortedHistory = [...product.history].sort((a, b) => b.timestamp - a.timestamp);
                        
                        const latestPrice = sortedHistory[0].price;
                        const previousPrice = sortedHistory.length > 1 ? sortedHistory[1].price : latestPrice;
                        const priceChange = latestPrice - previousPrice;
                        const priceChangePercentage = previousPrice > 0 ? (priceChange / previousPrice) * 100 : 0;

                        allProducts.push({
                            url, hostname,
                            name: product.name,
                            imageUrl: product.imageUrl,
                            latestPrice,
                            latestCurrency: sortedHistory[0].currency,
                            priceChange, priceChangePercentage,
                            firstAddedTimestamp: historyAsc[0].timestamp,
                            lastUpdatedTimestamp: sortedHistory[0].timestamp,
                        });
                    }
                }
            }
            masterProductList = allProducts;
            document.getElementById('watchlistLoadingIndicator').style.display = 'none';

            if (masterProductList.length === 0) {
                document.getElementById('noProductsMessage').textContent = 'No products on your watchlist yet. Start tracking some prices!';
                document.getElementById('noProductsMessage').style.display = 'block';
            } else {
                document.getElementById('controlsContainer').style.display = 'flex';
                const siteFilterEl = document.getElementById('filterSite');
                siteFilterEl.innerHTML = '<option value="all">All Sites</option>'; 
                const friendlyNames = [...new Set(masterProductList.map(p => getFriendlySiteName(p.hostname)))].sort();
                friendlyNames.forEach(name => {
                    const option = document.createElement('option');
                    option.value = name;
                    option.textContent = name;
                    siteFilterEl.appendChild(option);
                });
                applyFiltersAndSort();
            }

            ['filterPriceChange', 'filterSite', 'sortProducts'].forEach(id => document.getElementById(id).addEventListener('change', applyFiltersAndSort));
            ['filterMinPrice', 'filterMaxPrice'].forEach(id => document.getElementById(id).addEventListener('input', applyFiltersAndSort));
            document.getElementById('resetControlsBtn').addEventListener('click', () => {
                document.getElementById('filterPriceChange').value = 'all';
                document.getElementById('filterSite').value = 'all';
                document.getElementById('filterMinPrice').value = '';
                document.getElementById('filterMaxPrice').value = '';
                document.getElementById('sortProducts').value = 'updated-desc';
                applyFiltersAndSort();
            });
            document.getElementById('resetAllButtonFull').addEventListener('click', async () => {
                try {
                    await showConfirmationModal('Are you sure you want to delete ALL price history? This cannot be undone.');
                    await chrome.runtime.sendMessage({ action: "deleteAllHistory" });
                    masterProductList = [];
                    renderWatchlistPage();
                } catch (error) { /* User cancelled */ }
            });
            document.getElementById('logoutButtonFull').addEventListener('click', handleLogout);

        } catch (error) {
            console.error("[Full Dashboard] Error fetching watchlist:", error);
            document.getElementById('watchlistLoadingIndicator').style.display = 'none';
            document.getElementById('noProductsMessage').textContent = `Error loading watchlist: ${error.message}`;
            document.getElementById('noProductsMessage').style.display = 'block';
        }
    };

    // --- Alerts Page Renderer ---
    const renderAlertsPage = async () => {
        pageContentFullEl.innerHTML = `
            <div class="alerts-container">
                <div class="alert-form-card">
                    <h2>Create New Price Alert</h2>
                    <div id="alertFormMessage" class="message alert" style="opacity:0;"></div>
                    <form id="alertForm">
                        <div class="form-group"><label for="alertProductSelect">Select Product:</label><select id="alertProductSelect" required><option value="">-- Choose a product --</option></select></div>
                        <div class="form-group"><label for="alertConditionSelect">Condition:</label><select id="alertConditionSelect" required><option value="priceBelow">Price drops below...</option><option value="percentageDrop">Price drops by at least (%)</option></select></div>
                        <div class="form-group"><label for="alertValueInput" id="alertValueLabel">Target Price:</label><input type="number" id="alertValueInput" min="0.01" step="0.01" placeholder="e.g., 100.00" required></div>
                        <button type="submit" class="btn-primary">Save Alert</button>
                    </form>
                </div>
                <div class="alert-list-section">
                    <h2>Your Current Price Alerts</h2>
                    <div class="loading-indicator" id="alertsLoadingIndicator">Loading alerts...</div>
                    <div id="alertsListContainer"></div>
                    <div class="no-alerts-message" id="noAlertsMessage" style="display:none;"></div>
                </div>
            </div>`;

        const alertProductSelectEl = document.getElementById('alertProductSelect');
        const alertConditionSelectEl = document.getElementById('alertConditionSelect');
        const alertValueInputEl = document.getElementById('alertValueInput');
        const alertValueLabelEl = document.getElementById('alertValueLabel');
        const alertFormEl = document.getElementById('alertForm');

        if (masterProductList.length === 0) {
            const allStorageKeys = await chrome.storage.local.get(null);
            const allProducts = [];
            for (const hostname in allStorageKeys) {
                if (['isLoggedIn', 'userCredentials', 'priceWatcherAlerts', 'priceWatcherSettings'].includes(hostname)) continue;
                const hostData = allStorageKeys[hostname];
                for (const url in hostData) {
                    const product = hostData[url];
                    if (product && Array.isArray(product.history) && product.history.length > 0) {
                        const sortedHistory = product.history.sort((a, b) => b.timestamp - a.timestamp);
                        allProducts.push({ url, hostname, name: product.name, imageUrl: product.imageUrl, latestPrice: sortedHistory[0].price, latestCurrency: sortedHistory[0].currency });
                    }
                }
            }
            masterProductList = allProducts;
        }

        alertProductSelectEl.innerHTML = '<option value="">-- Choose a product --</option>';
        if (masterProductList.length === 0) {
            alertProductSelectEl.innerHTML = '<option value="">-- No products tracked yet --</option>';
            alertProductSelectEl.disabled = true;
            document.querySelector('#alertForm button').disabled = true;
            showMessage('alertFormMessage', 'Please track some products on the Watchlist page before creating alerts.', 'error', 0);
        } else {
            alertProductSelectEl.disabled = false;
            document.querySelector('#alertForm button').disabled = false;
            masterProductList.sort((a,b) => a.name.localeCompare(b.name)).forEach(product => {
                const option = document.createElement('option');
                option.value = product.url;
                option.textContent = `${product.name} (${getFriendlySiteName(product.hostname)}) - ${formatCurrency(product.latestPrice, product.latestCurrency)}`;
                alertProductSelectEl.appendChild(option);
            });
        }

        const updateAlertValueInput = () => {
            if (alertConditionSelectEl.value === 'priceBelow') {
                alertValueLabelEl.textContent = 'Target Price:'; alertValueInputEl.placeholder = 'e.g., 100.00'; alertValueInputEl.min = '0.01'; alertValueInputEl.step = '0.01';
            } else if (alertConditionSelectEl.value === 'percentageDrop') {
                alertValueLabelEl.textContent = 'Target Percentage Drop (%):'; alertValueInputEl.placeholder = 'e.g., 10 (for 10%)'; alertValueInputEl.min = '1'; alertValueInputEl.step = '1';
            }
        };
        alertConditionSelectEl.addEventListener('change', updateAlertValueInput);
        updateAlertValueInput();
        
        const renderAlertsGrid = async () => {
            const alertsListContainerEl = document.getElementById('alertsListContainer');
            const alertsLoadingIndicatorEl = document.getElementById('alertsLoadingIndicator');
            const noAlertsMessageEl = document.getElementById('noAlertsMessage');

            alertsLoadingIndicatorEl.style.display = 'block';
            alertsListContainerEl.innerHTML = '';
            noAlertsMessageEl.style.display = 'none';

            const { alerts = [] } = await chrome.runtime.sendMessage({ action: "getAlerts" });
            
            if (alerts.length === 0) {
                noAlertsMessageEl.textContent = 'No price alerts set yet. Create one above!';
                noAlertsMessageEl.style.display = 'block';
                alertsLoadingIndicatorEl.style.display = 'none';
                return;
            }
            
            alertsListContainerEl.className = 'alerts-grid';
            
            const pauseIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
            const playIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path d="M8 5v14l11-7z"/></svg>`;
            const deleteIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;

            alerts.sort((a,b) => b.created - a.created).forEach(alert => {
                const product = masterProductList.find(p => p.url === alert.url);
                const card = document.createElement('div');
                card.className = 'alert-card';

                const productName = product ? product.name : alert.productName || 'Unknown Product';
                const productCurrency = product ? product.latestCurrency : '$';
                const latestPrice = product ? product.latestPrice : NaN;
                const conditionText = alert.conditionType === 'priceBelow' 
                    ? `Drops below ${formatCurrency(alert.targetValue, productCurrency)}` 
                    : `Drops by ${alert.targetValue}%`;
                
                const toggleIcon = alert.status === 'active' ? pauseIcon : playIcon;
                const toggleTitle = alert.status === 'active' ? 'Pause Alert' : 'Activate Alert';

                card.innerHTML = `
                    <div class="alert-card-main">
                        <img src="${product?.imageUrl || placeholderImage}" class="alert-card-image" alt="${productName}">
                        <div class="alert-card-details">
                            <p class="alert-card-name" title="${productName}">${productName}</p>
                            <p class="alert-card-condition">${conditionText}</p>
                            ${!isNaN(latestPrice) ? `<p class="alert-card-current-price">Current: ${formatCurrency(latestPrice, productCurrency)}</p>` : ''}
                        </div>
                    </div>
                    <div class="alert-card-footer">
                        <span class="alert-status-indicator ${alert.status}">${alert.status}</span>
                        <div class="alert-card-actions">
                            <button class="action-btn toggle-status-btn" data-id="${alert.id}" data-status="${alert.status}" title="${toggleTitle}">
                                ${toggleIcon}
                            </button>
                            <button class="action-btn delete-alert-btn" data-id="${alert.id}" title="Delete Alert">
                                ${deleteIcon}
                            </button>
                        </div>
                    </div>
                `;
                alertsListContainerEl.appendChild(card);
            });
            
            alertsLoadingIndicatorEl.style.display = 'none';

            alertsListContainerEl.querySelectorAll('.toggle-status-btn').forEach(button => button.addEventListener('click', async (e) => {
                const id = e.currentTarget.dataset.id, currentStatus = e.currentTarget.dataset.status, newStatus = currentStatus === 'active' ? 'paused' : 'active';
                try {
                    if(await showConfirmationModal(`Are you sure you want to ${newStatus === 'paused' ? 'pause' : 'activate'} this alert?`)) {
                        const res = await chrome.runtime.sendMessage({ action: "toggleAlertStatus", id, status: newStatus });
                        if (res.success) { showMessage('alertFormMessage', `Alert status updated to '${newStatus}'.`, 'success'); renderAlertsGrid(); }
                        else { showMessage('alertFormMessage', `Error updating alert status: ${res.error}`, 'error'); }
                    }
                } catch(err) { console.error("Toggle alert cancelled or failed:", err); }
            }));
            alertsListContainerEl.querySelectorAll('.delete-alert-btn').forEach(button => button.addEventListener('click', async (e) => {
                const id = e.currentTarget.dataset.id;
                try {
                    if (await showConfirmationModal('Are you sure you want to delete this alert? This cannot be undone.')) {
                        const res = await chrome.runtime.sendMessage({ action: "deleteAlert", id });
                        if (res.success) { showMessage('alertFormMessage', 'Alert deleted successfully!', 'success'); renderAlertsGrid(); }
                        else { showMessage('alertFormMessage', `Error deleting alert: ${res.error}`, 'error'); }
                    }
                } catch(err) { console.error("Delete alert cancelled or failed:", err); }
            }));
        };

        alertFormEl.addEventListener('submit', async (e) => {
            e.preventDefault();
            const selectedUrl = alertProductSelectEl.value, conditionType = alertConditionSelectEl.value, targetValue = parseFloat(alertValueInputEl.value);
            if (!selectedUrl || isNaN(targetValue) || targetValue <= 0) { showMessage('alertFormMessage', 'Please fill in all alert details correctly.', 'error'); return; }
            const product = masterProductList.find(p => p.url === selectedUrl);
            if (!product) { showMessage('alertFormMessage', 'Selected product not found.', 'error'); return; }
            const alert = { url: product.url, hostname: product.hostname, productName: product.name, targetValue, conditionType };
            try {
                const res = await chrome.runtime.sendMessage({ action: "saveAlert", alert });
                if (res.success) { showMessage('alertFormMessage', 'Alert created successfully!', 'success'); alertFormEl.reset(); updateAlertValueInput(); renderAlertsGrid(); }
                else { showMessage('alertFormMessage', `Error saving alert: ${res.error}`, 'error'); }
            } catch (err) { console.error("Error saving alert:", err); showMessage('alertFormMessage', 'An unexpected error occurred.', 'error'); }
        });

        renderAlertsGrid();
    };

    // --- Settings Page Renderer ---
    const renderSettingsPage = async () => {
        await applySavedTheme();
        pageContentFullEl.innerHTML = `
            <div class="settings-container">
                <div id="settings-message-container"></div>
                 <div class="settings-section">
                    <h2>UI / Theme</h2>
                    <div class="setting-item">
                        <div class="setting-label">
                            <p>Theme</p>
                            <small>Switch between light and dark mode.</small>
                        </div>
                        <div class="setting-control">
                            <label class="switch">
                                <input type="checkbox" id="themeToggle" ${currentSettings.theme === 'light' ? 'checked' : ''}>
                                <span class="slider">
                                    <svg class="theme-icon moon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12.01,2.02c-5.52,0-9.99,4.47-9.99,9.99c0,5.52,4.47,9.99,9.99,9.99c5.52,0,9.99-4.47,9.99-9.99C22,6.49,17.53,2.02,12.01,2.02z M12.01,19.5c-4.14,0-7.5-3.36-7.5-7.5c0-4.14,3.36-7.5,7.5-7.5c0.88,0,1.73,0.15,2.53,0.44c-0.69,0.99-1.09,2.18-1.09,3.46c0,3.31,2.69,6,6,6c1.28,0,2.47-0.4,3.46-1.09c0.29,0.8,0.44,1.65,0.44,2.53C19.5,16.14,16.14,19.5,12.01,19.5z"/></svg>
                                    <svg class="theme-icon sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12,5c-3.86,0-7,3.14-7,7s3.14,7,7,7s7-3.14,7-7S15.86,5,12,5z M12,15c-1.66,0-3-1.34-3-3s1.34-3,3-3s3,1.34,3,3S13.66,15,12,15z M2,12c0,0.55,0.45,1,1,1h1c0.55,0,1-0.45,1-1s-0.45-1-1-1H3C2.45,11,2,11.45,2,12z M19,12c0,0.55,0.45,1,1,1h1c0.55,0,1-0.45,1-1s-0.45-1-1-1h-1C19.45,11,19,11.45,19,12z M11,2c-0.55,0-1,0.45-1,1v1c0,0.55,0.45,1,1,1s1-0.45,1-1V3C13,2.45,12.55,2,11,2z M11,19c-0.55,0-1,0.45-1,1v1c0,0.55,0.45,1,1,1s1-0.45,1-1v-1C13,19.45,12.55,19,11,19z M5.93,5.93c-0.39-0.39-1.02-0.39-1.41,0s-0.39,1.02,0,1.41l0.71,0.71c0.39,0.39,1.02,0.39,1.41,0s0.39-1.02,0-1.41L5.93,5.93z M16.95,16.95c-0.39-0.39-1.02-0.39-1.41,0s-0.39,1.02,0,1.41l0.71,0.71c0.39,0.39,1.02,0.39,1.41,0s0.39-1.02,0-1.41L16.95,16.95z M18.07,5.93c0.39-0.39,0.39-1.02,0-1.41s-1.02-0.39-1.41,0l-0.71,0.71c-0.39,0.39-0.39,1.02,0,1.41s1.02,0.39,1.41,0L18.07,5.93z M7.05,16.95c0.39-0.39,0.39-1.02,0-1.41s-1.02-0.39-1.41,0l-0.71,0.71c-0.39,0.39-0.39,1.02,0,1.41s1.02,0.39,1.41,0L7.05,16.95z"/></svg>
                                </span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="settings-section">
                    <h2>Notifications</h2>
                    <div class="setting-item">
                        <div class="setting-label">
                            <p>Enable Browser Notifications</p>
                            <small>Toggle all price drop notifications.</small>
                        </div>
                        <div class="setting-control">
                            <label class="switch">
                                <input type="checkbox" id="globalNotificationsToggle" ${currentSettings.globalNotifications ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                     <div class="setting-item">
                        <div class="setting-label">
                            <p>Email for Alerts (Future Feature)</p>
                            <small>Specify an email for receiving alerts.</small>
                        </div>
                        <div class="setting-control">
                            <input type="email" id="alertEmailInput" placeholder="your.email@example.com" value="${currentSettings.alertEmail || ''}">
                        </div>
                    </div>
                </div>
                <div class="settings-section">
                    <h2>Data Management</h2>
                    <div class="setting-item">
                        <div class="setting-label">
                            <p>History Retention</p>
                            <small>Max number of price entries per product.</small>
                        </div>
                        <div class="setting-control">
                             <select id="historyRetentionSelect">
                                <option value="10" ${currentSettings.historyRetention == 10 ? 'selected' : ''}>10 Entries</option>
                                <option value="20" ${currentSettings.historyRetention == 20 ? 'selected' : ''}>20 Entries</option>
                                <option value="50" ${currentSettings.historyRetention == 50 ? 'selected' : ''}>50 Entries</option>
                             </select>
                        </div>
                    </div>
                     <div class="setting-item">
                        <div class="setting-label">
                            <p>Export Data</p>
                            <small>Download all your tracked data as a JSON file.</small>
                        </div>
                        <div class="setting-control">
                            <button id="exportDataBtn" class="button-secondary">Export</button>
                        </div>
                    </div>
                     <div class="setting-item">
                        <div class="setting-label">
                            <p>Import Data</p>
                            <small>Import data from a previously exported file.</small>
                        </div>
                        <div class="setting-control">
                            <button id="importDataBtn" class="button-secondary">Import</button>
                            <input type="file" id="importFileInput" accept=".json" style="display: none;">
                        </div>
                    </div>
                </div>
            </div>`;
        
        const saveSetting = async (key, value) => {
            currentSettings[key] = value;
            await chrome.storage.local.set({ [SETTINGS_KEY]: currentSettings });
            if (settingsConfig[key]?.apply) {
                settingsConfig[key].apply(value);
            }
            showMessage('settings-message-container', 'Setting saved!', 'success', 2000);
        };
        
        document.getElementById('themeToggle').addEventListener('change', (e) => saveSetting('theme', e.target.checked ? 'light' : 'dark'));
        document.getElementById('globalNotificationsToggle').addEventListener('change', (e) => saveSetting('globalNotifications', e.target.checked));
        document.getElementById('alertEmailInput').addEventListener('blur', (e) => saveSetting('alertEmail', e.target.value));
        document.getElementById('historyRetentionSelect').addEventListener('change', (e) => saveSetting('historyRetention', parseInt(e.target.value, 10)));
        document.getElementById('exportDataBtn').addEventListener('click', handleExportData);
        document.getElementById('importDataBtn').addEventListener('click', () => document.getElementById('importFileInput').click());
        document.getElementById('importFileInput').addEventListener('change', handleImportData);
    };

    const handleExportData = async () => {
        try {
            const allData = await chrome.storage.local.get(null);
            const exportableData = {};
            for (const key in allData) {
                if (!['isLoggedIn', 'userCredentials'].includes(key)) {
                    exportableData[key] = allData[key];
                }
            }
            const dataStr = JSON.stringify(exportableData, null, 2);
            const blob = new Blob([dataStr], {type: "application/json"});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `price_watcher_backup_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showMessage('settings-message-container', 'Data exported successfully!', 'success');
        } catch (error) {
            console.error("Export failed:", error);
            showMessage('settings-message-container', 'Error exporting data.', 'error');
        }
    };
    
    const handleImportData = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const importedData = JSON.parse(e.target.result);
                if (typeof importedData !== 'object' || importedData === null) {
                   throw new Error("Invalid file format.");
                }
                await showConfirmationModal("Are you sure you want to import this data? This will overwrite your existing tracking data, alerts, and settings.");
                const { isLoggedIn, userCredentials } = await chrome.storage.local.get(['isLoggedIn', 'userCredentials']);
                await chrome.storage.local.clear();
                await chrome.storage.local.set({ isLoggedIn, userCredentials, ...importedData });
                showMessage('settings-message-container', 'Import successful! The app will now reload.', 'success', 0);
                setTimeout(() => window.location.reload(), 2000);
            } catch (error) {
                 if (error === false) { 
                    showMessage('settings-message-container', 'Import cancelled.', 'error');
                 } else {
                    console.error("Import failed:", error);
                    showMessage('settings-message-container', `Import failed: ${error.message}`, 'error');
                 }
            } finally {
                event.target.value = '';
            }
        };
        reader.readAsText(file);
    };

    // --- User Page Renderer ---
    const renderUserPage = async () => {
        const { userCredentials } = await chrome.storage.local.get('userCredentials');
        const userEmail = userCredentials ? userCredentials.email : 'N/A';
        
        pageContentFullEl.innerHTML = `
            <div class="user-page-container">
                 <div id="user-message-container"></div>
                 <div class="settings-section">
                    <h2>Account Information</h2>
                    <div class="setting-item">
                        <div class="setting-label"><p>Username / Email</p></div>
                        <div class="setting-control"><p class="info-value">${userEmail}</p></div>
                    </div>
                     <div class="setting-item">
                        <div class="setting-label"><p>Membership Status</p></div>
                        <div class="setting-control"><p class="info-value">Free Tier</p></div>
                    </div>
                 </div>

                 <div class="settings-section">
                    <h2>Security</h2>
                    <form id="changePasswordForm">
                        <div class="form-group">
                            <label for="currentPassword">Current Password</label>
                            <input type="password" id="currentPassword" required>
                        </div>
                        <div class="form-group">
                            <label for="newPassword">New Password</label>
                            <input type="password" id="newPassword" required>
                        </div>
                        <div class="form-group">
                            <label for="confirmNewPassword">Confirm New Password</label>
                            <input type="password" id="confirmNewPassword" required>
                        </div>
                        <button type="submit" class="btn-primary">Update Password</button>
                    </form>
                 </div>

                 <div class="settings-section danger-zone">
                    <h2>Danger Zone</h2>
                     <div class="setting-item">
                        <div class="setting-label">
                            <p>Logout</p>
                            <small>Log out of your account on this device.</small>
                        </div>
                        <div class="setting-control">
                           <button id="logoutUserBtn" class="button-secondary">Logout</button>
                        </div>
                    </div>
                    <div class="setting-item">
                        <div class="setting-label">
                            <p>Delete Account</p>
                            <small>Permanently delete your account and all data.</small>
                        </div>
                        <div class="setting-control">
                           <button id="deleteAccountBtn" class="button-danger">Delete Account</button>
                        </div>
                    </div>
                 </div>
            </div>`;
            
        document.getElementById('changePasswordForm').addEventListener('submit', handleChangePassword);
        document.getElementById('logoutUserBtn').addEventListener('click', handleLogout);
        document.getElementById('deleteAccountBtn').addEventListener('click', handleDeleteAccount);
    };

    const handleChangePassword = async (event) => {
        event.preventDefault();
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmNewPassword = document.getElementById('confirmNewPassword').value;

        if (!currentPassword || !newPassword || !confirmNewPassword) {
            showMessage('user-message-container', 'All password fields are required.', 'error'); return;
        }
        if (newPassword.length < 6) {
            showMessage('user-message-container', 'New password must be at least 6 characters.', 'error'); return;
        }
        if (newPassword !== confirmNewPassword) {
            showMessage('user-message-container', 'New passwords do not match.', 'error'); return;
        }

        const { userCredentials } = await chrome.storage.local.get('userCredentials');
        if (!userCredentials || pseudoHash(currentPassword) !== userCredentials.hashedPassword) {
            showMessage('user-message-container', 'Incorrect current password.', 'error'); return;
        }

        userCredentials.hashedPassword = pseudoHash(newPassword);
        await chrome.storage.local.set({ userCredentials });
        showMessage('user-message-container', 'Password updated successfully!', 'success');
        event.target.reset();
    };
    
    const handleDeleteAccount = async () => {
        try {
            await showConfirmationModal("ARE YOU ABSOLUTELY SURE? This will permanently delete your account and all tracked product data. This action cannot be undone.");
            const response = await chrome.runtime.sendMessage({ action: "deleteAccount" });
            if (response.success) {
                // We can't show a message on the current page as it will be closed.
                // The user will be redirected to the login page.
                chrome.tabs.create({ url: 'login.html' });
                window.close();
            } else {
                showMessage('user-message-container', `Error deleting account: ${response.error}`, 'error');
            }
        } catch (error) {
            // User cancelled
            showMessage('user-message-container', 'Account deletion cancelled.', 'error');
        }
    };
    
    const handleLogout = async () => {
        try { 
            await showConfirmationModal('Are you sure you want to log out?'); 
            await chrome.storage.local.set({ isLoggedIn: false }); 
            window.location.href = 'login.html'; // Redirect to login
        }
        catch (error) { /* User cancelled logout */ }
    };

    // --- Main Router ---
    const routerFull = async () => {
        let hash = window.location.hash || '#watchlist';
        window.location.hash = hash;
        updateNavLinksFull();
        switch (hash) {
            case '#watchlist': await renderWatchlistPage(); break;
            case '#settings': await renderSettingsPage(); break;
            case '#user': await renderUserPage(); break;
            case '#alerts': await renderAlertsPage(); break;
            case '#logout': await handleLogout(); break;
            default: pageContentFullEl.innerHTML = `<h2>Page Not Found</h2>`; break;
        }
    };

    window.addEventListener('hashchange', routerFull);
    routerFull(); // Initial route
});