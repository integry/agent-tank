// Client-side JavaScript for the usage-history sparklines
// This module exports a string containing the hand-built SVG chart code

const historyScript = `
    // ===== Usage History Sparklines =====
    // One inline-SVG sparkline per agent card, fed by GET /history/:id?view=chart
    // (plottable { t, percent } points, "percent used"). Drawn on load and
    // redrawn after every performAutoRefresh().
    const HISTORY_CHART_WIDTH = 240;
    const HISTORY_CHART_HEIGHT = 48;
    const HISTORY_CHART_PAD = 3;
    const HISTORY_SERIES_SLOTS = 8;
    const HISTORY_EMPTY_TEXT = 'Not enough history yet';
    // Colour follows the metric: agentId -> Map(metric key -> palette slot)
    const historySeriesSlots = new Map();

    function escapeHistoryText(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function historySlotFor(agentId, key) {
      let slots = historySeriesSlots.get(agentId);
      if (!slots) {
        slots = new Map();
        historySeriesSlots.set(agentId, slots);
      }
      if (!slots.has(key)) slots.set(key, slots.size % HISTORY_SERIES_SLOTS);
      return slots.get(key) + 1;
    }

    function historyY(percent) {
      const clamped = Math.min(100, Math.max(0, percent));
      return HISTORY_CHART_PAD + (1 - clamped / 100) * (HISTORY_CHART_HEIGHT - 2 * HISTORY_CHART_PAD);
    }

    function historyTimeLabel(ms) {
      return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function showHistoryMessage(container, message) {
      container._historyChart = null;
      container.innerHTML = '<div class="history-chart-empty">' + escapeHistoryText(message) + '</div>';
    }

    // Build the plot model: time-scaled points per series, sharing one x-axis
    function buildHistoryModel(agentId, series) {
      const lines = series.map(entry => ({
        key: entry.key,
        label: entry.label || entry.key,
        slot: historySlotFor(agentId, entry.key),
        points: entry.points
          .map(point => ({ ms: Date.parse(point.t), percent: point.percent }))
          .filter(point => Number.isFinite(point.ms) && Number.isFinite(point.percent)),
      })).filter(line => line.points.length >= 2);
      let start = Infinity;
      let end = -Infinity;
      for (const line of lines) {
        start = Math.min(start, line.points[0].ms);
        end = Math.max(end, line.points[line.points.length - 1].ms);
      }
      const span = Math.max(1, end - start);
      return { lines, start, end: start + span, span };
    }

    function historyX(model, ms) {
      return ((ms - model.start) / model.span) * HISTORY_CHART_WIDTH;
    }

    function historySvg(model) {
      const gridLines = [100, 0].map(percent => {
        const y = historyY(percent).toFixed(1);
        return '<line class="history-grid" x1="0" x2="' + HISTORY_CHART_WIDTH + '" y1="' + y + '" y2="' + y + '" vector-effect="non-scaling-stroke"></line>';
      }).join('');
      const polylines = model.lines.map(line => {
        const points = line.points
          .map(point => historyX(model, point.ms).toFixed(1) + ',' + historyY(point.percent).toFixed(1))
          .join(' ');
        return '<polyline class="history-line history-series-' + line.slot + '" points="' + points + '" vector-effect="non-scaling-stroke"></polyline>';
      }).join('');
      return '<svg class="history-sparkline" viewBox="0 0 ' + HISTORY_CHART_WIDTH + ' ' + HISTORY_CHART_HEIGHT +
        '" preserveAspectRatio="none" aria-hidden="true">' + gridLines + polylines +
        '<line class="history-crosshair" x1="0" x2="0" y1="0" y2="' + HISTORY_CHART_HEIGHT + '" vector-effect="non-scaling-stroke"></line></svg>';
    }

    function historyLegend(model) {
      return '<ul class="history-legend">' + model.lines.map(line =>
        '<li class="history-legend-item" data-metric-key="' + escapeHistoryText(line.key) + '">' +
          '<span class="history-swatch history-series-' + line.slot + '"></span>' +
          '<span class="history-legend-label">' + escapeHistoryText(line.label) + '</span>' +
          '<span class="history-legend-value"></span>' +
        '</li>'
      ).join('') + '</ul>';
    }

    // Show each line's value at (or just before) the given time; null = latest.
    // A line with no sample yet at that time shows a dash, never a later value.
    function showHistoryValuesAt(container, ms) {
      const chart = container._historyChart;
      if (!chart) return;
      const at = ms == null ? chart.end : ms;
      const items = container.querySelectorAll('.history-legend-item');
      chart.lines.forEach((line, index) => {
        const point = line.points.filter(p => p.ms <= at).pop();
        const value = items[index] && items[index].querySelector('.history-legend-value');
        if (value) value.textContent = point ? Math.round(point.percent) + '%' : '—';
      });
      const time = container.querySelector('.history-chart-time');
      if (time) time.textContent = ms == null ? 'Since ' + historyTimeLabel(chart.start) : historyTimeLabel(at);
      const crosshair = container.querySelector('.history-crosshair');
      if (crosshair) {
        const x = historyX(chart, at).toFixed(1);
        crosshair.setAttribute('x1', x);
        crosshair.setAttribute('x2', x);
        crosshair.classList.toggle('visible', ms != null);
      }
    }

    function attachHistoryHover(container) {
      const svg = container.querySelector('.history-sparkline');
      if (!svg) return;
      svg.addEventListener('mousemove', event => {
        const chart = container._historyChart;
        const rect = svg.getBoundingClientRect();
        if (!chart || rect.width <= 0) return;
        const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        showHistoryValuesAt(container, chart.start + fraction * chart.span);
      });
      svg.addEventListener('mouseleave', () => showHistoryValuesAt(container, null));
    }

    function renderHistoryChart(container, series) {
      const model = buildHistoryModel(container.dataset.agentId, Array.isArray(series) ? series : []);
      if (model.lines.length === 0) {
        showHistoryMessage(container, HISTORY_EMPTY_TEXT);
        return;
      }
      container.innerHTML = historySvg(model) +
        '<div class="history-chart-meta"><span class="history-chart-time"></span></div>' + historyLegend(model);
      container._historyChart = model;
      showHistoryValuesAt(container, null);
      attachHistoryHover(container);
    }

    async function loadHistoryChart(container) {
      try {
        const response = await fetch('/history/' + encodeURIComponent(container.dataset.agentId) + '?view=chart');
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const body = await response.json();
        renderHistoryChart(container, body.series);
      } catch (error) {
        // Keep the last good chart; only replace the loading placeholder
        if (!container._historyChart) showHistoryMessage(container, 'History unavailable');
        console.warn('[History] Could not load history for', container.dataset.agentId, error.message);
      }
    }

    // Redraw every card's sparkline (no-op when the chart is disabled)
    function renderHistoryCharts() {
      const containers = Array.from(document.querySelectorAll('.history-chart[data-agent-id]'));
      return Promise.all(containers.map(loadHistoryChart));
    }

    renderHistoryCharts();
`;

module.exports = { historyScript };
