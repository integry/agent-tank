/**
 * Unit tests for the dashboard's usage-history sparklines.
 *
 * The browser script is evaluated in a vm sandbox with a minimal fake DOM;
 * assertions run against the markup each chart container receives.
 */

const vm = require('vm');
const { historyScript } = require('../../src/client-history.js');

function fakeContainer(agentId) {
  return {
    dataset: { agentId },
    innerHTML: '<div class="history-chart-empty">Loading history…</div>',
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function seriesBody(series) {
  return { ok: true, status: 200, json: async () => ({ agent: 'work', store: 'sqlite', retention_days: 14, series }) };
}

function loadHistoryScript(containers, fetchImpl) {
  const context = {
    console: { log: () => {}, warn: jest.fn(), error: jest.fn() },
    fetch: jest.fn(fetchImpl),
    document: {
      querySelectorAll: (selector) => (selector === '.history-chart[data-agent-id]' ? containers : []),
    },
    Date,
    Math,
    Number,
    Promise,
    Array,
    Map,
    String,
  };
  vm.createContext(context);
  vm.runInContext(historyScript, context);
  return context;
}

const twoPoints = (key, label, first, second) => ({
  key,
  label,
  model: null,
  cycle: 'weekly',
  points: [{ t: '2026-10-16T08:00:00.000Z', percent: first }, { t: '2026-10-16T09:00:00.000Z', percent: second }],
});

describe('dashboard usage-history sparklines', () => {
  it('fetches each card\'s chart series by agent id', async () => {
    const work = fakeContainer('work');
    const personal = fakeContainer('team a');
    const context = loadHistoryScript([work, personal], async () => seriesBody([]));

    await context.renderHistoryCharts();

    expect(context.fetch).toHaveBeenCalledWith('/history/work?view=chart');
    expect(context.fetch).toHaveBeenCalledWith('/history/team%20a?view=chart');
  });

  it('renders one SVG line and legend entry per tracked metric', async () => {
    const work = fakeContainer('work');
    const series = [twoPoints('fiveHour', '5h', 20, 25), twoPoints('weekly', 'Weekly', 45, 50)];
    const context = loadHistoryScript([], async () => seriesBody(series));

    context.renderHistoryChart(work, series);

    expect(work.innerHTML).toContain('<svg class="history-sparkline"');
    expect(work.innerHTML.match(/<polyline /g)).toHaveLength(2);
    expect(work.innerHTML).toContain('history-line history-series-1');
    expect(work.innerHTML).toContain('history-line history-series-2');
    expect(work.innerHTML).toContain('<span class="history-legend-label">Weekly</span>');
    expect(work.innerHTML).not.toContain('Not enough history yet');
  });

  it('maps percent used onto a fixed 0-100 y-axis', () => {
    const work = fakeContainer('work');
    const context = loadHistoryScript([], async () => seriesBody([]));

    context.renderHistoryChart(work, [twoPoints('weekly', 'Weekly', 0, 100)]);

    expect(work.innerHTML).toContain('points="0.0,45.0 240.0,3.0"');
  });

  it('shows "Not enough history yet" for fewer than two points', async () => {
    const work = fakeContainer('work');
    const context = loadHistoryScript([work], async () => seriesBody([]));

    await context.renderHistoryCharts();
    context.renderHistoryChart(work, [{ key: 'weekly', label: 'Weekly', points: [{ t: '2026-10-16T08:00:00.000Z', percent: 3 }] }]);

    expect(work.innerHTML).toBe('<div class="history-chart-empty">Not enough history yet</div>');
    expect(context.console.error).not.toHaveBeenCalled();
  });

  it('keeps each metric\'s colour when another metric drops out', () => {
    const work = fakeContainer('work');
    const context = loadHistoryScript([], async () => seriesBody([]));

    context.renderHistoryChart(work, [twoPoints('fiveHour', '5h', 1, 2), twoPoints('weekly', 'Weekly', 3, 4)]);
    context.renderHistoryChart(work, [twoPoints('weekly', 'Weekly', 3, 4)]);

    expect(work.innerHTML).toContain('history-line history-series-2');
    expect(work.innerHTML).not.toContain('history-series-1');
  });

  it('escapes metric labels', () => {
    const work = fakeContainer('work');
    const context = loadHistoryScript([], async () => seriesBody([]));

    context.renderHistoryChart(work, [twoPoints('x', '<b>Weekly</b>', 1, 2)]);

    expect(work.innerHTML).toContain('&lt;b&gt;Weekly&lt;/b&gt;');
    expect(work.innerHTML).not.toContain('<b>Weekly</b>');
  });

  it('redraws with new points on the next refresh', async () => {
    const work = fakeContainer('work');
    let series = [];
    const context = loadHistoryScript([work], async () => seriesBody(series));

    await context.renderHistoryCharts();
    expect(work.innerHTML).toContain('Not enough history yet');

    series = [twoPoints('weekly', 'Weekly', 45, 50)];
    await context.renderHistoryCharts();
    expect(work.innerHTML).toContain('<polyline ');
  });

  it('keeps the last chart when a later fetch fails', async () => {
    const work = fakeContainer('work');
    let fail = false;
    const context = loadHistoryScript([work], async () => {
      if (fail) throw new Error('offline');
      return seriesBody([twoPoints('weekly', 'Weekly', 45, 50)]);
    });

    await context.renderHistoryCharts();
    fail = true;
    await context.renderHistoryCharts();

    expect(work.innerHTML).toContain('<polyline ');
    expect(context.console.error).not.toHaveBeenCalled();
  });

  it('replaces the loading placeholder when history cannot be fetched', async () => {
    const work = fakeContainer('work');
    const context = loadHistoryScript([work], async () => ({ ok: false, status: 500, json: async () => ({}) }));

    await context.renderHistoryCharts();

    expect(work.innerHTML).toBe('<div class="history-chart-empty">History unavailable</div>');
  });
});
