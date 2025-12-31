// login.js - Handles authentication logic for the external login.html page

document.addEventListener('DOMContentLoaded', () => {
    // --- Element Caching ---
    const loginSection = document.getElementById('loginSection');
    const signupSection = document.getElementById('signupSection');
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const showSignupLink = document.getElementById('showSignup');
    const showLoginLink = document.getElementById('showLogin');
    const authMessageEl = document.getElementById('authMessage');

    // Login Form Inputs
    const loginEmailInput = document.getElementById('loginEmail');
    const loginPasswordInput = document.getElementById('loginPassword');

    // Signup Form Inputs
    const signupEmailInput = document.getElementById('signupEmail');
    const signupPasswordInput = document.getElementById('signupPassword');
    const confirmPasswordInput = document.getElementById('confirmPassword');

    let currentView = 'login'; // 'login' or 'signup'

    // --- Utility for showing temporary messages ---
    const showMessage = (message, type = 'info') => {
        if (authMessageEl) {
            authMessageEl.textContent = message;
            authMessageEl.className = `message ${type}`; // Add type for styling
            authMessageEl.style.opacity = 1;
            setTimeout(() => {
                authMessageEl.style.opacity = 0;
            }, 4000); // Hide after 4 seconds
        }
    };

    // --- Simple (Non-cryptographic) Hashing for Simulation ---
    // IMPORTANT: This is NOT secure for real-world applications.
    // In a real app, passwords would be cryptographically hashed server-side.
    const pseudoHash = (password) => {
        return btoa(password + 'price-watcher-salt'); // Base64 encode with a simple salt
    };

    // --- View Toggling ---
    const toggleView = (view) => {
        currentView = view;
        if (view === 'login') {
            loginSection.classList.add('active');
            signupSection.classList.remove('active');
        } else {
            signupSection.classList.add('active');
            loginSection.classList.remove('active');
        }
        authMessageEl.style.opacity = 0; // Clear any previous messages
    };

    // --- Handle Signup ---
    signupForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = signupEmailInput.value.trim();
        const password = signupPasswordInput.value.trim();
        const confirmPassword = confirmPasswordInput.value.trim();

        if (!email || !password || !confirmPassword) {
            showMessage('All fields are required.', 'error');
            return;
        }

        if (password.length < 6) {
            showMessage('Password must be at least 6 characters long.', 'error');
            return;
        }

        if (password !== confirmPassword) {
            showMessage('Passwords do not match.', 'error');
            return;
        }

        // Simulate checking if user exists
        const storedCredentials = await chrome.storage.local.get('userCredentials');
        if (storedCredentials.userCredentials && storedCredentials.userCredentials.email === email) {
            showMessage('An account with this email/username already exists. Please log in.', 'error');
            return;
        }

        console.log(`Simulating signup for: ${email}`);
        await new Promise(resolve => setTimeout(resolve, 800)); // Simulate network delay

        // Simulate storing credentials (with pseudo-hash)
        const hashedPassword = pseudoHash(password);
        await chrome.storage.local.set({ userCredentials: { email, hashedPassword } });

        try {
            const response = await chrome.runtime.sendMessage({ action: "setLoggedIn" });
            if (response.success) {
                showMessage('Account created and logged in successfully!', 'success');
                setTimeout(() => {
                    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard_full.html') }); // Redirect to dashboard
                    window.close(); // Close the login tab
                }, 1500);
            } else {
                showMessage('An error occurred during signup.', 'error');
            }
        } catch (error) {
            console.error("Error sending signup status to background script:", error);
            showMessage('Could not complete signup. Please try again.', 'error');
        }
    });

    // --- Handle Login ---
    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = loginEmailInput.value.trim();
        const password = loginPasswordInput.value.trim();

        if (!email || !password) {
            showMessage('Please enter both email/username and password.', 'error');
            return;
        }

        console.log(`Simulating login for: ${email}`);
        await new Promise(resolve => setTimeout(resolve, 800)); // Simulate network delay

        const storedCredentials = await chrome.storage.local.get('userCredentials');
        if (!storedCredentials.userCredentials || storedCredentials.userCredentials.email !== email) {
            showMessage('Invalid email or username.', 'error');
            return;
        }

        const hashedPassword = pseudoHash(password);
        if (storedCredentials.userCredentials.hashedPassword !== hashedPassword) {
            showMessage('Invalid password.', 'error');
            return;
        }

        try {
            const response = await chrome.runtime.sendMessage({ action: "setLoggedIn" });
            if (response.success) {
                showMessage('Logged in successfully!', 'success');
                setTimeout(() => {
                    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard_full.html') }); // Redirect to dashboard
                    window.close(); // Close the login tab
                }, 1500);
            } else {
                showMessage('An error occurred during login.', 'error');
            }
        } catch (error) {
            console.error("Error sending login status to background script:", error);
            showMessage('Could not complete login. Please try again.', 'error');
        }
    });

    // --- Event Listeners for Toggling Views ---
    showSignupLink.addEventListener('click', (event) => {
        event.preventDefault();
        toggleView('signup');
    });

    showLoginLink.addEventListener('click', (event) => {
        event.preventDefault();
        toggleView('login');
    });

    // Initial view setup
    toggleView(currentView);
});