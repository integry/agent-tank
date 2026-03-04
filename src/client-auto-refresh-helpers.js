// Client-side JavaScript helpers for auto-refresh system
// These helper functions are injected into the client-side code

const colorHelpers = `
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
`;

const timeHelpers = `
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
`;

const metricExtractors = `
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
`;

module.exports = {
  colorHelpers,
  timeHelpers,
  metricExtractors
};
