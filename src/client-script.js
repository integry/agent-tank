// Client-side JavaScript for the status page
// This module exports a string containing all client-side JS code

const clientScript = `
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
        btn.innerHTML = '<span class="spinner"></span>Refreshing...';
      } else {
        btn.innerHTML = btn.dataset.originalText || 'Refresh';
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
        const trackBtn = document.querySelector(\`[data-metric-id="\${trackedMetric.metricId}"]\`);
        if (trackBtn) {
          trackBtn.classList.add('tracking');
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
        }
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

      // If already tracking this metric, untrack it
      if (trackedMetric && trackedMetric.metricId === metricId) {
        clearTracking();
        restoreOriginalState();
        return;
      }

      // Clear previous tracking
      const prevTracked = document.querySelector('.track-btn.tracking');
      if (prevTracked) {
        prevTracked.classList.remove('tracking');
      }

      // Set new tracking
      btn.classList.add('tracking');
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
      trackedMetric = null;
      localStorage.removeItem('trackedMetric');
      notificationSent = false;
      localStorage.removeItem('notificationSent');
    }

    // Restore original favicon and title
    function restoreOriginalState() {
      document.title = 'LLM Limit Watcher';

      // Remove canvas favicon and restore original
      const canvasFavicon = document.querySelector('link[rel="icon"]');
      if (canvasFavicon) {
        canvasFavicon.remove();
      }

      if (originalFavicon) {
        const link = document.createElement('link');
        link.rel = 'icon';
        link.href = originalFavicon;
        document.head.appendChild(link);
      }
    }

    // Update favicon with Canvas-generated pie chart
    function updateFaviconAndTitle() {
      if (!trackedMetric || !monitorEnabled) return;

      const { percent, color, resetsIn, agent, label } = trackedMetric;

      // Update page title: [74%] 1h 22m | Claude Session
      // Include both agent name and specific metric label for clarity
      const agentName = agent.charAt(0).toUpperCase() + agent.slice(1);
      const resetsPart = resetsIn ? \` \${resetsIn}\` : '';
      document.title = \`[\${percent}%]\${resetsPart} | \${agentName} \${label}\`;

      // Generate favicon using Canvas API
      generateProgressFavicon(percent, color);
    }

    // Generate filled pie chart favicon using Canvas API
    // Available space is green, used space is yellow/red based on usage level
    function generateProgressFavicon(percent, color) {
      const canvas = document.createElement('canvas');
      const size = 64; // Favicon size
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      const centerX = size / 2;
      const centerY = size / 2;
      const radius = (size / 2) - 2;

      // Clear canvas
      ctx.clearRect(0, 0, size, size);

      // Determine used color based on percentage thresholds
      // Green: 0-49%, Yellow: 50-79%, Red: 80-100%
      let usedColor;
      if (percent < 50) {
        usedColor = '#ecc94b'; // Yellow for low usage (not alarming)
      } else if (percent < 80) {
        usedColor = '#ecc94b'; // Yellow for medium usage
      } else {
        usedColor = '#e53e3e'; // Red for high usage
      }

      const availableColor = '#48bb78'; // Green for available space
      const startAngle = -Math.PI / 2; // Start at top
      const usedAngle = startAngle + (2 * Math.PI * percent / 100);

      // Draw available (remaining) slice first - green
      if (percent < 100) {
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, usedAngle, startAngle + 2 * Math.PI);
        ctx.closePath();
        ctx.fillStyle = availableColor;
        ctx.fill();
      }

      // Draw used slice - yellow or red based on level
      if (percent > 0) {
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, usedAngle);
        ctx.closePath();
        ctx.fillStyle = usedColor;
        ctx.fill();
      }

      // Draw thin border around the pie
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw percentage text in center with background for readability
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.beginPath();
      ctx.arc(centerX, centerY, 16, 0, 2 * Math.PI);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(\`\${percent}\`, centerX, centerY);

      // Convert to favicon
      const faviconUrl = canvas.toDataURL('image/png');

      // Update or create favicon link
      let faviconLink = document.querySelector('link[rel="icon"]');
      if (!faviconLink) {
        faviconLink = document.createElement('link');
        faviconLink.rel = 'icon';
        document.head.appendChild(faviconLink);
      }
      faviconLink.href = faviconUrl;
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
          new Notification('LLM Limit Warning', {
            body: \`\${agentName} \${label} is at \${percent}% usage!\`,
            icon: '/favicon.ico',
            tag: 'llm-limit-warning'
          });
        }
      }
    }

    // Initialize monitor on page load
    initMonitor();
`;

module.exports = { clientScript };
