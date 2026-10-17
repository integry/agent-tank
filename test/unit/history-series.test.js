const { toChartSeries } = require('../../src/history-series.js');

function storeSeries(overrides = {}) {
  return {
    key: 'weekly',
    label: 'Weekly',
    model: null,
    cycle: 'weekly',
    unit: 'percent',
    points: [
      { t: '2026-10-16T08:00:00.000Z', percent: 12, value: null },
      { t: '2026-10-16T09:00:00.000Z', percent: 15, value: null },
    ],
    ...overrides,
  };
}

describe('toChartSeries', () => {
  it('flattens each point to { t, percent } and keeps descriptive fields', () => {
    const result = toChartSeries([storeSeries()]);

    expect(result).toEqual([{
      key: 'weekly',
      label: 'Weekly',
      model: null,
      cycle: 'weekly',
      points: [
        { t: '2026-10-16T08:00:00.000Z', percent: 12 },
        { t: '2026-10-16T09:00:00.000Z', percent: 15 },
      ],
    }]);
  });

  it('keeps only plottable units', () => {
    const credits = storeSeries({
      key: 'credits',
      unit: 'credits',
      points: [{ t: '2026-10-16T08:00:00.000Z', percent: null, value: 40 }, { t: '2026-10-16T09:00:00.000Z', percent: null, value: 38 }],
    });

    const result = toChartSeries([credits, storeSeries()]);

    expect(result.map(s => s.key)).toEqual(['weekly']);
  });

  it('accepts custom plottable units', () => {
    const tokens = storeSeries({ key: 'tokens', unit: 'tokens' });

    expect(toChartSeries([tokens], { units: ['tokens'] }).map(s => s.key)).toEqual(['tokens']);
  });

  it('drops series with fewer than two points', () => {
    const single = storeSeries({ key: 'session', points: [{ t: '2026-10-16T08:00:00.000Z', percent: 3, value: null }] });

    expect(toChartSeries([single, storeSeries()]).map(s => s.key)).toEqual(['weekly']);
  });

  it('drops points without a finite percentage before counting', () => {
    const sparse = storeSeries({
      points: [
        { t: '2026-10-16T08:00:00.000Z', percent: null, value: null },
        { t: '2026-10-16T09:00:00.000Z', percent: 15, value: null },
      ],
    });

    expect(toChartSeries([sparse])).toEqual([]);
  });

  it('honours a custom minimum point count', () => {
    const single = storeSeries({ points: [{ t: '2026-10-16T08:00:00.000Z', percent: 3, value: null }] });

    expect(toChartSeries([single], { minPoints: 1 })[0].points).toEqual([{ t: '2026-10-16T08:00:00.000Z', percent: 3 }]);
  });

  it('falls back to the key when a label is missing', () => {
    expect(toChartSeries([storeSeries({ label: null })])[0].label).toBe('weekly');
  });

  it('returns an empty array for empty or invalid input', () => {
    expect(toChartSeries([])).toEqual([]);
    expect(toChartSeries(null)).toEqual([]);
    expect(toChartSeries(undefined)).toEqual([]);
  });
});
