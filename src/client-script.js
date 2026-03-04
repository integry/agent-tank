// Client-side JavaScript for the status page
// This module exports a string containing all client-side JS code

const { faviconScript } = require('./client-favicon');

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
        location.reload();
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
        location.reload();
      } catch (e) {
        if (refreshAllBtn) setButtonLoading(refreshAllBtn, false);
        allIconBtns.forEach(b => setRefreshIconLoading(b, false));
        alert('Failed to refresh: ' + e.message);
      }
    }
    // Auto-refresh every 5 minutes
    setTimeout(() => location.reload(), 5 * 60 * 1000);

    // ===== Background Monitor Feature =====

    // State management
    let monitorEnabled = false;
    let trackedMetric = null;
    let notificationSent = false;
    let originalFavicon = null;

    // Initialize monitor on page load
    function initMonitor() {
      // Restore monitor state from localStorage
      monitorEnabled = localStorage.getItem('monitorEnabled') === 'true';
      const savedMetric = localStorage.getItem('trackedMetric');
      if (savedMetric) {
        try {
          trackedMetric = JSON.parse(savedMetric);
        } catch (e) {
          trackedMetric = null;
        }
      }
      notificationSent = localStorage.getItem('notificationSent') === 'true';

      // Save original favicon
      const existingFavicon = document.querySelector('link[rel="icon"]');
      if (existingFavicon) {
        originalFavicon = existingFavicon.href;
      }

      // Update UI to reflect saved state
      updateMonitorButton();

      // Restore tracked metric button state
      if (trackedMetric && monitorEnabled) {
        const trackBtn = document.querySelector(\`.track-btn[data-metric-id="\${trackedMetric.metricId}"]\`);
        const trackRow = document.querySelector(\`.usage-item[data-metric-id="\${trackedMetric.metricId}"]\`);
        if (trackBtn) {
          trackBtn.classList.add('tracking');
          if (trackRow) {
            trackRow.classList.add('tracking');
          }
          // Update trackedMetric with fresh data from the page
          trackedMetric.percent = parseInt(trackBtn.dataset.percent, 10);
          trackedMetric.color = trackBtn.dataset.color;
          trackedMetric.resetsIn = trackBtn.dataset.resetsIn;
          localStorage.setItem('trackedMetric', JSON.stringify(trackedMetric));
          updateFaviconAndTitle();
          checkAndNotify();
        } else {
          // Metric no longer exists, clear tracking
          clearTracking();
          generateDefaultFavicon();
        }
      } else {
        // No tracking active, show default favicon
        generateDefaultFavicon();
      }
    }

    // Toggle monitor on/off globally
    function toggleMonitor() {
      monitorEnabled = !monitorEnabled;
      localStorage.setItem('monitorEnabled', monitorEnabled.toString());

      if (monitorEnabled) {
        // Request notification permission
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      } else {
        // Clear tracking when monitor is disabled
        clearTracking();
        restoreOriginalState();
      }

      updateMonitorButton();
    }

    // Update monitor button UI
    function updateMonitorButton() {
      const btn = document.getElementById('monitor-toggle-btn');
      const text = document.getElementById('monitor-text');
      if (!btn || !text) return;

      if (monitorEnabled) {
        btn.classList.add('active');
        btn.title = 'Disable background monitoring';
        text.textContent = 'Monitoring';
      } else {
        btn.classList.remove('active');
        btn.title = 'Enable background monitoring';
        text.textContent = 'Monitor';
      }
    }

    // Toggle tracking on a specific metric
    function toggleTracking(btn) {
      if (!monitorEnabled) {
        // Auto-enable monitor when user clicks track
        monitorEnabled = true;
        localStorage.setItem('monitorEnabled', 'true');
        updateMonitorButton();

        // Request notification permission
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      }

      const metricId = btn.dataset.metricId;

      // If already tracking this metric, untrack it and turn off global monitoring
      if (trackedMetric && trackedMetric.metricId === metricId) {
        clearTracking();
        // Turn off global monitoring when user unchecks a tracked metric
        monitorEnabled = false;
        localStorage.setItem('monitorEnabled', 'false');
        updateMonitorButton();
        restoreOriginalState();
        return;
      }

      // Clear previous tracking
      const prevTracked = document.querySelector('.track-btn.tracking');
      if (prevTracked) {
        prevTracked.classList.remove('tracking');
      }
      const prevTrackedRow = document.querySelector('.usage-item.tracking');
      if (prevTrackedRow) {
        prevTrackedRow.classList.remove('tracking');
      }

      // Set new tracking
      btn.classList.add('tracking');
      // Also mark the parent row as tracking
      const parentRow = btn.closest('.usage-item');
      if (parentRow) {
        parentRow.classList.add('tracking');
      }
      trackedMetric = {
        metricId: metricId,
        agent: btn.dataset.agent,
        label: btn.dataset.label,
        percent: parseInt(btn.dataset.percent, 10),
        color: btn.dataset.color,
        resetsIn: btn.dataset.resetsIn
      };

      // Reset notification state for new metric
      notificationSent = false;
      localStorage.setItem('notificationSent', 'false');

      // Save to localStorage
      localStorage.setItem('trackedMetric', JSON.stringify(trackedMetric));

      // Update favicon and title
      updateFaviconAndTitle();
      checkAndNotify();
    }

    // Clear tracking state
    function clearTracking() {
      const prevTracked = document.querySelector('.track-btn.tracking');
      if (prevTracked) {
        prevTracked.classList.remove('tracking');
      }
      const prevTrackedRow = document.querySelector('.usage-item.tracking');
      if (prevTrackedRow) {
        prevTrackedRow.classList.remove('tracking');
      }
      trackedMetric = null;
      localStorage.removeItem('trackedMetric');
      notificationSent = false;
      localStorage.removeItem('notificationSent');
    }

    // Toggle tracking from clicking on the entire row
    function toggleTrackingFromRow(row) {
      // Find the track button within this row and delegate to toggleTracking
      const trackBtn = row.querySelector('.track-btn');
      if (trackBtn) {
        toggleTracking(trackBtn);
        // Also toggle the row's tracking class
        if (trackBtn.classList.contains('tracking')) {
          row.classList.add('tracking');
        } else {
          row.classList.remove('tracking');
        }
      }
    }

    // Restore default favicon and title
    function restoreOriginalState() {
      document.title = 'Agent Tank';

      // Generate default idle tank favicon
      generateDefaultFavicon();
    }

    // Update favicon with Canvas-generated vertical tank
    function updateFaviconAndTitle() {
      if (!trackedMetric || !monitorEnabled) return;

      const { percent, color, resetsIn, agent, label } = trackedMetric;

      // Update page title: (XX%) Model | Agent Tank
      const agentName = agent.charAt(0).toUpperCase() + agent.slice(1);
      document.title = \`(\${percent}%) \${agentName} | Agent Tank\`;

      // Generate favicon using Canvas API
      generateProgressFavicon(percent, color);
    }

    // Check and send notification if metric hits 90%
    function checkAndNotify() {
      if (!trackedMetric || !monitorEnabled) return;
      if (notificationSent) return; // Only notify once per metric

      const { percent, agent, label } = trackedMetric;

      if (percent >= 90) {
        // Mark as notified to prevent duplicates
        notificationSent = true;
        localStorage.setItem('notificationSent', 'true');

        // Send browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          const agentName = agent.charAt(0).toUpperCase() + agent.slice(1);
          new Notification('Agent Tank Warning', {
            body: \`\${agentName} \${label} is at \${percent}% usage!\`,
            icon: '/favicon.ico',
            tag: 'agent-tank-warning'
          });
        }
      }
    }

    // Initialize monitor on page load
    initMonitor();
`;

module.exports = { clientScript };
