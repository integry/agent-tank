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
      document.title = 'Agent Tank';

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

    // Generate vertical tank favicon using Canvas API
    // Tank drains/fills based on usage - available space shown as liquid level
    function generateProgressFavicon(percent, color) {
      const canvas = document.createElement('canvas');
      const size = 64; // Favicon size
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      // Clear canvas
      ctx.clearRect(0, 0, size, size);

      // Tank dimensions - U-shaped vertical tank
      const tankLeft = 12;
      const tankRight = size - 12;
      const tankTop = 8;
      const tankBottom = size - 4;
      const tankWidth = tankRight - tankLeft;
      const tankHeight = tankBottom - tankTop;
      const cornerRadius = 8;

      // Determine fill color based on percentage thresholds
      // 0-50% green (plenty left), 51-80% yellow (caution), 81-100% red (critical)
      let fillColor;
      if (percent <= 50) {
        fillColor = '#48bb78'; // Green - plenty available
      } else if (percent <= 80) {
        fillColor = '#ecc94b'; // Yellow - caution
      } else {
        fillColor = '#e53e3e'; // Red - critical
      }

      // Calculate liquid level (inverted - 0% usage = full tank, 100% usage = empty tank)
      const availablePercent = 100 - percent;
      const liquidHeight = (availablePercent / 100) * (tankHeight - cornerRadius);
      const liquidTop = tankBottom - cornerRadius - liquidHeight;

      // Draw tank background (empty space)
      ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
      ctx.beginPath();
      ctx.moveTo(tankLeft, tankTop);
      ctx.lineTo(tankRight, tankTop);
      ctx.lineTo(tankRight, tankBottom - cornerRadius);
      ctx.quadraticCurveTo(tankRight, tankBottom, tankRight - cornerRadius, tankBottom);
      ctx.lineTo(tankLeft + cornerRadius, tankBottom);
      ctx.quadraticCurveTo(tankLeft, tankBottom, tankLeft, tankBottom - cornerRadius);
      ctx.lineTo(tankLeft, tankTop);
      ctx.closePath();
      ctx.fill();

      // Draw liquid fill
      if (availablePercent > 0) {
        ctx.fillStyle = fillColor;
        ctx.beginPath();

        // Start from bottom-left corner
        if (liquidTop >= tankBottom - cornerRadius) {
          // Liquid is below the curved part
          ctx.moveTo(tankLeft, liquidTop);
          ctx.lineTo(tankRight, liquidTop);
          ctx.lineTo(tankRight, tankBottom - cornerRadius);
          ctx.quadraticCurveTo(tankRight, tankBottom, tankRight - cornerRadius, tankBottom);
          ctx.lineTo(tankLeft + cornerRadius, tankBottom);
          ctx.quadraticCurveTo(tankLeft, tankBottom, tankLeft, tankBottom - cornerRadius);
        } else {
          // Liquid extends into the curved area or fills more
          ctx.moveTo(tankLeft, liquidTop);
          ctx.lineTo(tankRight, liquidTop);
          ctx.lineTo(tankRight, tankBottom - cornerRadius);
          ctx.quadraticCurveTo(tankRight, tankBottom, tankRight - cornerRadius, tankBottom);
          ctx.lineTo(tankLeft + cornerRadius, tankBottom);
          ctx.quadraticCurveTo(tankLeft, tankBottom, tankLeft, tankBottom - cornerRadius);
        }
        ctx.closePath();
        ctx.fill();

        // Add liquid shine effect
        const gradient = ctx.createLinearGradient(tankLeft, 0, tankRight, 0);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
        gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.1)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.1)');
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      // Draw tank outline
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tankLeft, tankTop);
      ctx.lineTo(tankRight, tankTop);
      ctx.lineTo(tankRight, tankBottom - cornerRadius);
      ctx.quadraticCurveTo(tankRight, tankBottom, tankRight - cornerRadius, tankBottom);
      ctx.lineTo(tankLeft + cornerRadius, tankBottom);
      ctx.quadraticCurveTo(tankLeft, tankBottom, tankLeft, tankBottom - cornerRadius);
      ctx.lineTo(tankLeft, tankTop);
      ctx.stroke();

      // Draw measurement tick marks
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        const tickY = tankTop + (tankHeight - cornerRadius) * (i / 5);
        ctx.beginPath();
        ctx.moveTo(tankLeft + 2, tickY);
        ctx.lineTo(tankLeft + 8, tickY);
        ctx.stroke();
      }

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
