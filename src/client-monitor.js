// Client-side JavaScript for background monitoring feature
// This module exports a string containing the monitor tracking code

const monitorScript = `
    // ===== Background Monitor Feature =====
    // Monitoring is ALWAYS ON - "Automatic" tracks highest usage, "Manual" pins a specific metric

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

      // Update page title: XX% Agent | Agent Tank (clean format for squeezed tabs)
      const agentName = agent.charAt(0).toUpperCase() + agent.slice(1);
      document.title = \`\${percent}% \${agentName} | Agent Tank\`;

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
      event.preventDefault();
      event.stopPropagation();

      const apiUrl = window.location.origin + '/status';
      const copyBtn = event.target.closest('.copy-api-btn');

      navigator.clipboard.writeText(apiUrl).then(() => {
        // Show "Copied!" feedback on button
        if (copyBtn) {
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.classList.remove('copied');
          }, 1500);
        }
      }).catch(err => {
        console.error('Failed to copy API URL:', err);
      });
    }
`;

module.exports = { monitorScript };
