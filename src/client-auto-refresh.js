// Client-side JavaScript for auto-refresh system
// This module exports a string containing the XHR-based auto-refresh code

const { colorHelpers, timeHelpers, metricExtractors } = require('./client-auto-refresh-helpers');

const autoRefreshScript = `
    // ===== Auto-Refresh System (XHR-based) =====
    // Fetches /status endpoint and updates the DOM without page reload

${colorHelpers}
${timeHelpers}
${metricExtractors}

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

    // Fetch backend configuration and initialize auto-refresh
    async function initAutoRefreshFromBackend() {
      try {
        const response = await fetch('/config');
        if (!response.ok) {
          console.warn('[Auto-refresh] Could not fetch /config, using defaults');
          startAutoRefreshWithConfig(autoRefreshConfig.enabled, autoRefreshConfig.interval);
          return;
        }

        const config = await response.json();
        const backendEnabled = config.autoRefresh?.enabled ?? false;
        const backendInterval = config.autoRefresh?.interval ?? 0;
        const lastRefreshedAt = config.lastRefreshedAt;

        // If backend auto-refresh is disabled, disable frontend auto-refresh too
        if (!backendEnabled || backendInterval <= 0) {
          console.log('[Auto-refresh] Disabled (backend auto-refresh is off)');
          autoRefreshConfig.enabled = false;
          autoRefreshConfig.interval = 0;
          return;
        }

        // Update frontend config to match backend
        autoRefreshConfig.enabled = true;
        autoRefreshConfig.interval = backendInterval * 1000;

        // Calculate delay to sync with backend refresh cycle
        let initialDelay = 2000;
        if (lastRefreshedAt) {
          const lastRefreshTime = new Date(lastRefreshedAt).getTime();
          const now = Date.now();
          const timeSinceLastRefresh = now - lastRefreshTime;
          const intervalMs = backendInterval * 1000;
          const timeUntilNextRefresh = intervalMs - (timeSinceLastRefresh % intervalMs);
          initialDelay = timeUntilNextRefresh + 2000;
          if (timeUntilNextRefresh < 1000) {
            initialDelay = intervalMs + 2000;
          }
        }

        console.log('[Auto-refresh] Backend interval:', backendInterval, 'seconds');
        console.log('[Auto-refresh] Initial delay:', Math.round(initialDelay / 1000), 'seconds');
        startAutoRefreshWithDelay(initialDelay, autoRefreshConfig.interval);
      } catch (error) {
        console.error('[Auto-refresh] Error fetching config:', error);
        startAutoRefreshWithConfig(autoRefreshConfig.enabled, autoRefreshConfig.interval);
      }
    }

    // Start auto-refresh with a specific initial delay and then regular interval
    function startAutoRefreshWithDelay(initialDelay, interval) {
      if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
      }
      setTimeout(async () => {
        await performAutoRefresh();
        autoRefreshTimer = setInterval(performAutoRefresh, interval);
        console.log('[Auto-refresh] Regular interval started:', interval, 'ms');
      }, initialDelay);
    }

    // Start auto-refresh with given configuration
    function startAutoRefreshWithConfig(enabled, intervalMs) {
      if (!enabled || intervalMs === 0) {
        console.log('[Auto-refresh] Disabled by configuration');
        return;
      }
      if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
      }
      autoRefreshTimer = setInterval(performAutoRefresh, intervalMs);
      console.log('[Auto-refresh] Started with interval:', intervalMs, 'ms');
    }

    // Stop auto-refresh polling
    function stopAutoRefresh() {
      if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
        console.log('[Auto-refresh] Stopped');
      }
    }

    // Initialize auto-refresh from backend config on page load
    initAutoRefreshFromBackend();
`;

module.exports = { autoRefreshScript };
