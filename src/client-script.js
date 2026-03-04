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

    // ===== Auto-Refresh Configuration =====
    // These can be modified to control background polling behavior
    const autoRefreshConfig = {
      enabled: true,       // Set to false to disable auto-refresh
      interval: 60000      // Refresh interval in milliseconds (default: 60 seconds, 0 = disabled)
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
    // ===== Auto-Refresh System (XHR-based) =====
    // Fetches /status endpoint and updates the DOM without page reload

    // Color helper functions (mirrored from server-side usage-formatters.js)
    function getColorClassFromPercent(value) {
      if (value < 50) return 'high';
      if (value < 80) return 'medium';
      return 'low';
    }

    function getStatusDotClassFromPercent(value) {
      if (value <= 50) return 'status-green';
      if (value <= 80) return 'status-yellow';
      return 'status-red';
    }

    function getProgressColorFromPercent(value) {
      if (value < 50) return '#48bb78';
      if (value < 80) return '#ecc94b';
      return '#e53e3e';
    }

    // Parse "Resets in" time string to seconds (mirrored from server-side)
    function parseResetsInToSeconds(resetsIn) {
      if (!resetsIn || typeof resetsIn !== 'string') return null;
      let totalSeconds = 0;
      const dayMatch = resetsIn.match(/(\\d+)\\s*d(?:ay)?s?/i);
      const hourMatch = resetsIn.match(/(\\d+)\\s*h(?:our)?s?/i);
      const minMatch = resetsIn.match(/(\\d+)\\s*m(?:in(?:ute)?)?s?/i);
      const secMatch = resetsIn.match(/(\\d+)\\s*s(?:ec(?:ond)?)?s?/i);
      if (dayMatch) totalSeconds += parseInt(dayMatch[1], 10) * 24 * 60 * 60;
      if (hourMatch) totalSeconds += parseInt(hourMatch[1], 10) * 60 * 60;
      if (minMatch) totalSeconds += parseInt(minMatch[1], 10) * 60;
      if (secMatch) totalSeconds += parseInt(secMatch[1], 10);
      return totalSeconds > 0 ? totalSeconds : null;
    }

    // Cycle duration constants (mirrored from server-side)
    const CYCLE_DURATIONS = {
      session: 5 * 60 * 60,
      sessionGemini: 24 * 60 * 60,
      weekly: 7 * 24 * 60 * 60,
      fiveHour: 5 * 60 * 60
    };

    // Extract metrics from Claude usage data
    function extractClaudeMetrics(usage) {
      const metrics = [];
      const sections = [
        { data: usage.session, label: 'Session', cycle: 'session' },
        { data: usage.weeklyAll, label: 'Weekly (all)', cycle: 'weekly' },
        { data: usage.weeklySonnet, label: 'Weekly (Sonnet)', cycle: 'weekly' },
        { data: usage.weekly, label: 'Weekly', cycle: 'weekly' }
      ];
      for (const { data, label, cycle } of sections) {
        if (data) {
          const metricId = \`claude-\${label.toLowerCase().replace(/[^a-z0-9]/g, '-')}\`;
          metrics.push({
            metricId,
            agent: 'claude',
            label,
            percent: data.percent ?? 0,
            resetsIn: data.resetsIn || '',
            resetsAt: data.resetsAt || '',
            cycle
          });
        }
      }
      return metrics;
    }

    // Extract metrics from Gemini usage data
    function extractGeminiMetrics(usage) {
      const metrics = [];
      if (usage.models && usage.models.length > 0) {
        for (const model of usage.models) {
          const modelName = model.model.toLowerCase();
          const metricId = \`gemini-\${modelName.replace(/[^a-z0-9]/g, '-')}\`;
          metrics.push({
            metricId,
            agent: 'gemini',
            label: modelName,
            percent: model.percentUsed ?? 0,
            resetsIn: model.resetsIn || '',
            resetsAt: model.resetsAt || '',
            cycle: 'sessionGemini'
          });
        }
      }
      return metrics;
    }

    // Extract metrics from Codex usage data
    function extractCodexMetrics(usage) {
      const metrics = [];
      const models = [];
      if (usage.fiveHour || usage.weekly) {
        models.push({ name: usage.model || 'Default', fiveHour: usage.fiveHour, weekly: usage.weekly });
      }
      if (usage.modelLimits) {
        models.push(...usage.modelLimits);
      }
      for (const ml of models) {
        const modelSlug = ml.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        if (ml.fiveHour) {
          metrics.push({
            metricId: \`codex-\${modelSlug}-5h\`,
            agent: 'codex',
            label: '5h limit',
            modelName: ml.name,
            percent: ml.fiveHour.percentUsed ?? 0,
            resetsIn: ml.fiveHour.resetsIn || '',
            resetsAt: ml.fiveHour.resetsAt || '',
            cycle: 'fiveHour'
          });
        }
        if (ml.weekly) {
          metrics.push({
            metricId: \`codex-\${modelSlug}-weekly\`,
            agent: 'codex',
            label: 'Weekly',
            modelName: ml.name,
            percent: ml.weekly.percentUsed ?? 0,
            resetsIn: ml.weekly.resetsIn || '',
            resetsAt: ml.weekly.resetsAt || '',
            cycle: 'weekly'
          });
        }
      }
      return metrics;
    }

    // Update a single metric's DOM elements
    function updateMetricDOM(metric) {
      const { metricId, percent, resetsIn, cycle } = metric;
      const color = getProgressColorFromPercent(percent);
      const colorClass = getColorClassFromPercent(percent);
      const statusDotClass = getStatusDotClassFromPercent(percent);
      const isZero = percent === 0;

      // Find the usage-item row and track button
      const usageItem = document.querySelector(\`.usage-item[data-metric-id="\${metricId}"]\`);
      const trackBtn = document.querySelector(\`.track-btn[data-metric-id="\${metricId}"]\`);

      if (usageItem) {
        // Update data attributes
        usageItem.dataset.percent = percent;
        usageItem.dataset.color = color;
        usageItem.dataset.resetsIn = resetsIn;

        // Update zero-usage class
        if (isZero) {
          usageItem.classList.add('zero-usage');
        } else {
          usageItem.classList.remove('zero-usage');
        }

        // Update the percentage text
        const percentSpan = usageItem.querySelector('.usage-percent');
        if (percentSpan) {
          percentSpan.textContent = percent;
        }

        // Update the color class on usage-value
        const usageValue = usageItem.querySelector('.usage-value');
        if (usageValue) {
          usageValue.classList.remove('high', 'medium', 'low');
          usageValue.classList.add(colorClass);
        }

        // Update the status dot
        const statusDot = usageItem.querySelector('.status-dot');
        if (statusDot) {
          statusDot.classList.remove('status-green', 'status-yellow', 'status-red');
          statusDot.classList.add(statusDotClass);
        }
      }

      if (trackBtn) {
        // Update track button data attributes
        trackBtn.dataset.percent = percent;
        trackBtn.dataset.color = color;
        trackBtn.dataset.resetsIn = resetsIn;
      }

      // Find and update the progress bar (should be next sibling of usage-item)
      const progressBar = usageItem ? usageItem.nextElementSibling : null;
      if (progressBar && progressBar.classList.contains('progress-bar')) {
        // Update zero-usage class on progress bar
        if (isZero) {
          progressBar.classList.add('zero-usage');
        } else {
          progressBar.classList.remove('zero-usage');
        }

        // Update progress fill
        const progressFill = progressBar.querySelector('.progress-fill');
        if (progressFill) {
          progressFill.style.width = percent + '%';
          progressFill.style.background = color;
        }
      }

      // Update the "Resets in" info if present
      const modelContainer = usageItem ? usageItem.closest('.model-container') : null;
      if (modelContainer) {
        const resetWrapper = modelContainer.querySelector('.reset-info-wrapper');
        if (resetWrapper) {
          if (isZero || !resetsIn) {
            // Hide "Resets in" when at 0%
            resetWrapper.style.display = 'none';
          } else {
            resetWrapper.style.display = '';
            // Update the reset text
            const resetValue = resetWrapper.querySelector('.usage-value');
            if (resetValue) {
              resetValue.textContent = resetsIn;
            }
            // Update time progress bar
            const timeProgressFill = resetWrapper.querySelector('.time-progress-fill');
            if (timeProgressFill && cycle && CYCLE_DURATIONS[cycle]) {
              const resetsInSeconds = parseResetsInToSeconds(resetsIn);
              if (resetsInSeconds !== null) {
                const cycleDuration = CYCLE_DURATIONS[cycle];
                const elapsedSeconds = cycleDuration - resetsInSeconds;
                const elapsedPercent = Math.min(100, Math.max(0, (elapsedSeconds / cycleDuration) * 100));
                timeProgressFill.style.width = elapsedPercent + '%';
              }
            }
          }
        }
      }
    }

    // Update the "Last checked" timestamp in the nav
    function updateLastCheckedTime() {
      const lastCheckedEl = document.querySelector('.last-checked');
      if (lastCheckedEl) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        lastCheckedEl.textContent = 'Last checked: ' + timeStr;
      }
    }

    // Main function to fetch /status and update DOM
    async function performAutoRefresh() {
      try {
        const response = await fetch('/status');
        if (!response.ok) {
          console.error('[Auto-refresh] Failed to fetch /status:', response.status);
          return;
        }

        const status = await response.json();
        const allMetrics = [];

        // Extract and update all metrics from each agent
        for (const [agentName, agentData] of Object.entries(status)) {
          if (!agentData.usage) continue;

          let metrics = [];
          if (agentName === 'claude') {
            metrics = extractClaudeMetrics(agentData.usage);
          } else if (agentName === 'gemini') {
            metrics = extractGeminiMetrics(agentData.usage);
          } else if (agentName === 'codex') {
            metrics = extractCodexMetrics(agentData.usage);
          }

          // Update DOM for each metric
          for (const metric of metrics) {
            updateMetricDOM(metric);
            allMetrics.push(metric);
          }

          // Update agent card error state
          const agentCard = document.querySelector(\`.agent-card.agent-\${agentName}\`);
          if (agentCard) {
            if (agentData.error) {
              agentCard.classList.add('error');
              agentCard.classList.remove('ok', 'refreshing');
            } else if (agentData.isRefreshing) {
              agentCard.classList.add('refreshing');
              agentCard.classList.remove('ok', 'error');
            } else {
              agentCard.classList.add('ok');
              agentCard.classList.remove('error', 'refreshing');
            }
          }
        }

        // Update "Last checked" time
        updateLastCheckedTime();

        // Recalculate highest metric and update tracked metric
        recalculateTrackedMetric(allMetrics);

        // Update favicon and title based on new data
        updateFaviconAndTitle();
        checkAndNotify();

        console.log('[Auto-refresh] Updated', allMetrics.length, 'metrics');
      } catch (error) {
        console.error('[Auto-refresh] Error:', error);
      }
    }

    // Recalculate tracked metric after refresh
    function recalculateTrackedMetric(allMetrics) {
      if (pinnedMetric) {
        // Manual mode: update pinned metric with fresh data
        const freshData = allMetrics.find(m => m.metricId === pinnedMetric.metricId);
        if (freshData) {
          pinnedMetric.percent = freshData.percent;
          pinnedMetric.color = getProgressColorFromPercent(freshData.percent);
          pinnedMetric.resetsIn = freshData.resetsIn;
          trackedMetric = pinnedMetric;
          localStorage.setItem('pinnedMetric', JSON.stringify(pinnedMetric));
        }
      } else {
        // Automatic mode: find highest usage metric
        let highestMetric = null;
        let highestPercent = -1;
        for (const metric of allMetrics) {
          if (metric.percent > highestPercent) {
            highestPercent = metric.percent;
            highestMetric = {
              metricId: metric.metricId,
              agent: metric.agent,
              label: metric.label,
              percent: metric.percent,
              color: getProgressColorFromPercent(metric.percent),
              resetsIn: metric.resetsIn
            };
          }
        }
        if (highestMetric) {
          // Clear previous highlight
          const prevTracked = document.querySelector('.track-btn.tracking');
          if (prevTracked && prevTracked.dataset.metricId !== highestMetric.metricId) {
            prevTracked.classList.remove('tracking');
            const prevRow = document.querySelector('.usage-item.tracking');
            if (prevRow) prevRow.classList.remove('tracking');
          }
          trackedMetric = highestMetric;
          highlightTrackedMetric();
        }
      }
    }

    // Start auto-refresh polling
    function startAutoRefresh() {
      // Don't start if disabled or interval is 0
      if (!autoRefreshConfig.enabled || autoRefreshConfig.interval === 0) {
        console.log('[Auto-refresh] Disabled by configuration');
        return;
      }

      // Clear any existing timer
      if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
      }

      // Start polling
      autoRefreshTimer = setInterval(performAutoRefresh, autoRefreshConfig.interval);
      console.log('[Auto-refresh] Started with interval:', autoRefreshConfig.interval, 'ms');
    }

    // Stop auto-refresh polling
    function stopAutoRefresh() {
      if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
        console.log('[Auto-refresh] Stopped');
      }
    }

    // Initialize auto-refresh on page load
    startAutoRefresh();

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

module.exports = { clientScript };
