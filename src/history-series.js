/**
 * History Series Presentation Helper
 *
 * Turns `HistoryStore#getSeries()` output into what the dashboard sparkline
 * plots. The store already groups rows per metric and normalises `percent` to
 * "percent used" at write time, so there is no provider-specific parsing here.
 */

const DEFAULT_PLOTTABLE_UNITS = ['percent'];
const DEFAULT_MIN_POINTS = 2;

function isFinitePercent(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Reduce store series to chartable series.
 *
 * - Keeps only series whose `unit` is plottable (percent by default), since
 *   the sparkline has a fixed 0-100 y-axis.
 * - Flattens each point to `{ t, percent }`, dropping points without a
 *   finite percentage.
 * - Drops series with fewer than `minPoints` remaining points.
 *
 * @param {Array<{key, label, model, cycle, unit, points: Array<{t, percent, value}>}>} series
 * @param {Object} [options]
 * @param {string[]} [options.units=['percent']] - Units that can be plotted
 * @param {number} [options.minPoints=2] - Minimum points for a series to be kept
 * @returns {Array<{key, label, model, cycle, points: Array<{t, percent}>}>}
 */
function toChartSeries(series, options = {}) {
  if (!Array.isArray(series)) return [];
  const units = options.units ?? DEFAULT_PLOTTABLE_UNITS;
  const minPoints = options.minPoints ?? DEFAULT_MIN_POINTS;

  const chartSeries = [];
  for (const entry of series) {
    if (!entry || !units.includes(entry.unit || 'percent')) continue;
    const points = (entry.points || [])
      .filter(point => point && point.t && isFinitePercent(point.percent))
      .map(point => ({ t: point.t, percent: point.percent }));
    if (points.length < minPoints) continue;
    chartSeries.push({
      key: entry.key,
      label: entry.label || entry.key,
      model: entry.model ?? null,
      cycle: entry.cycle ?? null,
      points,
    });
  }
  return chartSeries;
}

module.exports = { toChartSeries, DEFAULT_PLOTTABLE_UNITS, DEFAULT_MIN_POINTS };
