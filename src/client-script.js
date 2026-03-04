// Client-side JavaScript for the status page
// This module exports a string containing all client-side JS code

const { faviconScript } = require('./client-favicon');
const { autoRefreshScript } = require('./client-auto-refresh');
const { monitorScript } = require('./client-monitor');

const clientScript = faviconScript + `
    // Theme management
    function initTheme() {
      const savedTheme = localStorage.getItem('theme') || 'dark';
      if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
        updateThemeButton(true);
      } else {
        updateThemeButton(false);
      }
    }

    function toggleTheme() {
      const isLight = document.body.classList.toggle('light-mode');
      localStorage.setItem('theme', isLight ? 'light' : 'dark');
      updateThemeButton(isLight);
    }

    function updateThemeButton(isLight) {
      const icon = document.getElementById('theme-icon');
      const text = document.getElementById('theme-text');
      if (isLight) {
        icon.textContent = '🌙';
        text.textContent = 'Dark';
      } else {
        icon.textContent = '☀️';
        text.textContent = 'Light';
      }
    }

    // Initialize theme on page load
    initTheme();

    // ===== Auto-Refresh Configuration =====
    // Frontend auto-refresh is controlled by backend settings fetched from /config
    // These are fallback defaults if the backend config cannot be fetched
    const autoRefreshConfig = {
      enabled: true,       // Will be overridden by backend config
      interval: 60000      // Will be overridden by backend config (in milliseconds)
    };

    // Auto-refresh timer reference
    let autoRefreshTimer = null;

    // ===== Background Monitor Feature =====
    // Monitoring is ALWAYS ON - "Automatic" tracks highest usage, "Manual" pins a specific metric

    // State management (declared early for use in auto-refresh)
    let pinnedMetric = null; // null = automatic mode (track highest), object = manual/pinned mode
    let trackedMetric = null; // Currently tracked metric (either highest or pinned)
    let notificationSent = false;
    let originalFavicon = null;

    function setButtonLoading(btn, loading) {
      btn.disabled = loading;
      if (loading) {
        btn.dataset.originalText = btn.innerHTML;
        // Check if this is the refresh-all-btn with sync icon
        if (btn.classList.contains('refresh-all-btn')) {
          btn.classList.add('syncing');
          const textSpan = btn.querySelector('.btn-text');
          if (textSpan) {
            textSpan.textContent = 'Syncing...';
          }
        } else {
          btn.innerHTML = '<span class="spinner"></span>Refreshing...';
        }
      } else {
        if (btn.classList.contains('refresh-all-btn')) {
          btn.classList.remove('syncing');
          const textSpan = btn.querySelector('.btn-text');
          if (textSpan) {
            textSpan.textContent = 'Refresh All';
          }
        } else {
          btn.innerHTML = btn.dataset.originalText || 'Refresh';
        }
      }
    }
    function setRefreshIconLoading(btn, loading) {
      btn.disabled = loading;
      if (loading) {
        btn.classList.add('spinning');
      } else {
        btn.classList.remove('spinning');
      }
    }
    async function refresh(agent, event) {
      // Handle clicks on the refresh icon button (may be SVG or button)
      const btn = event.target.closest('button');
      if (!btn) return;

      // Check if it's a refresh-icon-btn (inline icon) or regular button
      const isIconBtn = btn.classList.contains('refresh-icon-btn');

      if (isIconBtn) {
        setRefreshIconLoading(btn, true);
      } else {
        setButtonLoading(btn, true);
      }

      try {
        await fetch('/refresh/' + agent, { method: 'POST' });
        // Use XHR update instead of page reload
        await performAutoRefresh();
        if (isIconBtn) {
          setRefreshIconLoading(btn, false);
        } else {
          setButtonLoading(btn, false);
        }
      } catch (e) {
        if (isIconBtn) {
          setRefreshIconLoading(btn, false);
        } else {
          setButtonLoading(btn, false);
        }
        alert('Failed to refresh: ' + e.message);
      }
    }
    async function refreshAll(event) {
      const btn = event.target.closest('button');
      const refreshAllBtn = document.querySelector('.refresh-all-btn');
      const allIconBtns = document.querySelectorAll('.refresh-icon-btn');
      if (refreshAllBtn) setButtonLoading(refreshAllBtn, true);
      allIconBtns.forEach(b => setRefreshIconLoading(b, true));
      try {
        await fetch('/refresh', { method: 'POST' });
        // Use XHR update instead of page reload
        await performAutoRefresh();
        if (refreshAllBtn) setButtonLoading(refreshAllBtn, false);
        allIconBtns.forEach(b => setRefreshIconLoading(b, false));
      } catch (e) {
        if (refreshAllBtn) setButtonLoading(refreshAllBtn, false);
        allIconBtns.forEach(b => setRefreshIconLoading(b, false));
        alert('Failed to refresh: ' + e.message);
      }
    }
` + autoRefreshScript + monitorScript;

module.exports = { clientScript };
