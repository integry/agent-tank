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
    // Monitoring is ALWAYS ON - "Automatic" tracks highest usage, "Manual" pins a specific metric

    // State management
    let pinnedMetric = null; // null = automatic mode (track highest), object = manual/pinned mode
    let trackedMetric = null; // Currently tracked metric (either highest or pinned)
    let notificationSent = false;
    let originalFavicon = null;

    // Find the metric with the highest usage percentage across all providers
    function findHighestUsageMetric() {
      const allTrackBtns = document.querySelectorAll('.track-btn');
      let highestMetric = null;
      let highestPercent = -1;

      allTrackBtns.forEach(btn => {
        const percent = parseInt(btn.dataset.percent, 10);
        if (percent > highestPercent) {
          highestPercent = percent;
          highestMetric = {
            metricId: btn.dataset.metricId,
            agent: btn.dataset.agent,
            label: btn.dataset.label,
            percent: percent,
            color: btn.dataset.color,
            resetsIn: btn.dataset.resetsIn
          };
        }
      });

      return highestMetric;
    }

    // Initialize monitor on page load - always on
    function initMonitor() {
      // Restore pinned metric from localStorage (if user manually pinned one)
      const savedPinned = localStorage.getItem('pinnedMetric');
      if (savedPinned) {
        try {
          pinnedMetric = JSON.parse(savedPinned);
        } catch (e) {
          pinnedMetric = null;
        }
      }
      notificationSent = localStorage.getItem('notificationSent') === 'true';

      // Save original favicon
      const existingFavicon = document.querySelector('link[rel="icon"]');
      if (existingFavicon) {
        originalFavicon = existingFavicon.href;
      }

      // Request notification permission on first load
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }

      // Determine which metric to track
      if (pinnedMetric) {
        // Manual mode: check if pinned metric still exists
        const trackBtn = document.querySelector(\`.track-btn[data-metric-id="\${pinnedMetric.metricId}"]\`);
        const trackRow = document.querySelector(\`.usage-item[data-metric-id="\${pinnedMetric.metricId}"]\`);
        if (trackBtn) {
          trackBtn.classList.add('tracking');
          if (trackRow) {
            trackRow.classList.add('tracking');
          }
          // Update pinnedMetric with fresh data from the page
          pinnedMetric.percent = parseInt(trackBtn.dataset.percent, 10);
          pinnedMetric.color = trackBtn.dataset.color;
          pinnedMetric.resetsIn = trackBtn.dataset.resetsIn;
          trackedMetric = pinnedMetric;
          localStorage.setItem('pinnedMetric', JSON.stringify(pinnedMetric));
        } else {
          // Pinned metric no longer exists, fall back to automatic
          pinnedMetric = null;
          localStorage.removeItem('pinnedMetric');
          trackedMetric = findHighestUsageMetric();
          highlightTrackedMetric();
        }
      } else {
        // Automatic mode: track highest usage
        trackedMetric = findHighestUsageMetric();
        highlightTrackedMetric();
      }

      // Update favicon and title
      updateFaviconAndTitle();
      checkAndNotify();
    }

    // Highlight the currently tracked metric (for automatic mode)
    function highlightTrackedMetric() {
      if (!trackedMetric) return;

      const trackBtn = document.querySelector(\`.track-btn[data-metric-id="\${trackedMetric.metricId}"]\`);
      const trackRow = document.querySelector(\`.usage-item[data-metric-id="\${trackedMetric.metricId}"]\`);
      if (trackBtn) {
        trackBtn.classList.add('tracking');
        if (trackRow) {
          trackRow.classList.add('tracking');
        }
      }
    }

    // Toggle pinning on a specific metric (manual mode)
    function toggleTracking(btn) {
      const metricId = btn.dataset.metricId;

      // If already pinned to this metric, unpin it (go back to automatic mode)
      if (pinnedMetric && pinnedMetric.metricId === metricId) {
        // Clear pinning
        clearPinning();
        // Fall back to automatic mode - track highest
        trackedMetric = findHighestUsageMetric();
        highlightTrackedMetric();
        updateFaviconAndTitle();
        return;
      }

      // Clear previous pinned state
      clearPinning();

      // Pin to this new metric
      btn.classList.add('tracking');
      const parentRow = btn.closest('.usage-item');
      if (parentRow) {
        parentRow.classList.add('tracking');
      }

      pinnedMetric = {
        metricId: metricId,
        agent: btn.dataset.agent,
        label: btn.dataset.label,
        percent: parseInt(btn.dataset.percent, 10),
        color: btn.dataset.color,
        resetsIn: btn.dataset.resetsIn
      };
      trackedMetric = pinnedMetric;

      // Reset notification state for new metric
      notificationSent = false;
      localStorage.setItem('notificationSent', 'false');

      // Save to localStorage
      localStorage.setItem('pinnedMetric', JSON.stringify(pinnedMetric));

      // Update favicon and title
      updateFaviconAndTitle();
      checkAndNotify();
    }

    // Clear pinned metric state (returns to automatic mode)
    function clearPinning() {
      const prevTracked = document.querySelector('.track-btn.tracking');
      if (prevTracked) {
        prevTracked.classList.remove('tracking');
      }
      const prevTrackedRow = document.querySelector('.usage-item.tracking');
      if (prevTrackedRow) {
        prevTrackedRow.classList.remove('tracking');
      }
      pinnedMetric = null;
      localStorage.removeItem('pinnedMetric');
      notificationSent = false;
      localStorage.removeItem('notificationSent');
    }

    // Toggle tracking from clicking on the entire row
    function toggleTrackingFromRow(row) {
      // Find the track button within this row and delegate to toggleTracking
      const trackBtn = row.querySelector('.track-btn');
      if (trackBtn) {
        toggleTracking(trackBtn);
      }
    }

    // Update favicon with Canvas-generated vertical tank
    function updateFaviconAndTitle() {
      if (!trackedMetric) {
        generateDefaultFavicon();
        return;
      }

      const { percent, color, agent, label } = trackedMetric;

      // Update page title: [XX%] Agent MetricName • Agent Tank (system readout format)
      const agentName = agent.charAt(0).toUpperCase() + agent.slice(1);
      document.title = \`[\${percent}%] \${agentName} \${label} • Agent Tank\`;

      // Generate favicon using Canvas API
      generateProgressFavicon(percent, color);
    }

    // Check and send notification if metric hits 90%
    function checkAndNotify() {
      if (!trackedMetric) return;
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

    // ===== API Endpoint Copy Feature =====
    function copyApiEndpoint(event) {
      // If Ctrl/Cmd+Click, let the link open normally in new tab
      if (event.ctrlKey || event.metaKey) {
        return;
      }

      // Prevent default link behavior for regular click
      event.preventDefault();

      const apiUrl = window.location.origin + '/api/v1/limits';
      const apiLink = document.getElementById('api-link');

      navigator.clipboard.writeText(apiUrl).then(() => {
        // Show "Copied!" feedback
        const originalText = apiLink.textContent;
        apiLink.textContent = '[ Copied! ]';
        apiLink.classList.add('copied');

        setTimeout(() => {
          apiLink.textContent = originalText;
          apiLink.classList.remove('copied');
        }, 1500);
      }).catch(err => {
        // Fallback: open in new tab if clipboard fails
        window.open('/api/v1/limits', '_blank');
      });
    }
`;

module.exports = { clientScript };
