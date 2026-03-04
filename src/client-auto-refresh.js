// Client-side JavaScript for auto-refresh system
// This module exports a string containing the XHR-based auto-refresh code

const autoRefreshScript = `
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
`;

module.exports = { autoRefreshScript };
