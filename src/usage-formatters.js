const { trackIcon } = require('./icons');

// Cycle duration constants in seconds
const CYCLE_DURATIONS = {
  session: 5 * 60 * 60,        // 5 hours = 18000 seconds
  sessionGemini: 24 * 60 * 60, // 24 hours = 86400 seconds (Gemini uses 24h sessions)
  weekly: 7 * 24 * 60 * 60,    // 7 days = 604800 seconds
  fiveHour: 5 * 60 * 60        // 5 hours = 18000 seconds
};

// Parse "Resets in" time string to seconds
function parseResetsInToSeconds(resetsIn) {
  if (!resetsIn || typeof resetsIn !== 'string') return null;

  let totalSeconds = 0;

  // Match patterns like "2h 30m", "5 hours", "3d 12h", "45 minutes", etc.
  const dayMatch = resetsIn.match(/(\d+)\s*d(?:ay)?s?/i);
  const hourMatch = resetsIn.match(/(\d+)\s*h(?:our)?s?/i);
  const minMatch = resetsIn.match(/(\d+)\s*m(?:in(?:ute)?)?s?/i);
  const secMatch = resetsIn.match(/(\d+)\s*s(?:ec(?:ond)?)?s?/i);

  if (dayMatch) totalSeconds += parseInt(dayMatch[1], 10) * 24 * 60 * 60;
  if (hourMatch) totalSeconds += parseInt(hourMatch[1], 10) * 60 * 60;
  if (minMatch) totalSeconds += parseInt(minMatch[1], 10) * 60;
  if (secMatch) totalSeconds += parseInt(secMatch[1], 10);

  return totalSeconds > 0 ? totalSeconds : null;
}

// Helper to determine color class based on usage percentage
function getColorClass(value, isUsed) {
  if (isUsed) {
    if (value < 50) return 'high';
    if (value < 80) return 'medium';
    return 'low';
  }
  if (value > 50) return 'high';
  if (value > 20) return 'medium';
  return 'low';
}

// Helper to determine status dot class based on value
function getStatusDotClass(value) {
  if (value <= 50) return 'status-green';
  if (value <= 80) return 'status-yellow';
  return 'status-red';
}

function resetInfoItem(resetsIn, originalValue, cycleType, isZero = false) {
  // Always render the wrapper so XHR updates can show/hide it dynamically.
  // Hidden when at 0% (no useful info when at full capacity).
  const hidden = isZero ? ' style="display:none"' : '';
  const tooltip = originalValue ? ` title="${originalValue}"` : '';

  // Calculate elapsed time progress bar
  let timeProgressHtml = '';
  const resetsInSeconds = parseResetsInToSeconds(resetsIn);
  const cycleDuration = cycleType ? CYCLE_DURATIONS[cycleType] : null;

  if (resetsInSeconds !== null && cycleDuration) {
    const elapsedSeconds = cycleDuration - resetsInSeconds;
    const elapsedPercent = Math.min(100, Math.max(0, (elapsedSeconds / cycleDuration) * 100));

    timeProgressHtml = `<div class="time-progress-bar" title="Time elapsed in cycle: ${Math.round(elapsedPercent)}%">
      <div class="time-progress-fill" style="width: ${elapsedPercent}%;"></div>
    </div>`;
  }

  return `<div class="reset-info-wrapper"${hidden}>
    <div class="usage-item reset-info"${tooltip}><span class="usage-label">↳ Resets in</span><span class="usage-value">${resetsIn || ''}</span></div>
    ${timeProgressHtml}
  </div>`;
}

function usageItem(label, value, suffix, options = {}) {
  const { isUsed = true, isZero = false, isModelName = false, isNestedMetric = false, agentName = '', resetsIn = '', metricId = '' } = options;
  const colorClass = getColorClass(value, isUsed);
  const progressPercent = isUsed ? value : (100 - value);
  const progressColor = colorClass === 'high' ? '#48bb78' : colorClass === 'medium' ? '#ecc94b' : '#e53e3e';
  const zeroClass = isZero ? ' zero-usage' : '';
  const nestedClass = isNestedMetric ? ' nested-metric' : '';
  const statusDotClass = getStatusDotClass(value);
  // All usage items now have status dots (LEDs) for unified monitoring station look
  const labelHtml = `<span class="usage-label${isModelName ? ' model-name' : ''}"><span class="status-dot ${statusDotClass}"></span>${label}</span>`;

  // Generate unique metric ID for tracking
  const trackingId = metricId || `${agentName}-${label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

  // Track button with data attributes for client-side tracking
  const trackButton = `<button class="track-btn"
    data-metric-id="${trackingId}"
    data-agent="${agentName}"
    data-label="${label}"
    data-percent="${value}"
    data-color="${progressColor}"
    data-resets-in="${resetsIn}"
    onclick="event.stopPropagation(); toggleTracking(this)"
    title="Track this metric in tab">${trackIcon}</button>`;

  return `
    <div class="usage-item${zeroClass}${nestedClass} trackable"
      data-metric-id="${trackingId}"
      data-agent="${agentName}"
      data-label="${label}"
      data-percent="${value}"
      data-color="${progressColor}"
      data-resets-in="${resetsIn}"
      onclick="toggleTrackingFromRow(this)"
      title="Click to track this metric">
      ${labelHtml}
      <span class="usage-value ${colorClass}"><span class="usage-percent">${value}</span><span class="usage-suffix">${suffix}</span>${trackButton}</span>
    </div>
    <div class="progress-bar${zeroClass}${nestedClass}">
      <div class="progress-fill" style="width: ${progressPercent}%; background: ${progressColor};"></div>
    </div>
  `;
}

function formatClaudeUsage(usage) {
  let html = '';
  const sections = [
    { data: usage.session, label: 'Session', cycle: 'session' },
    { data: usage.weeklyAll, label: 'Weekly (all)', cycle: 'weekly' },
    { data: usage.weeklySonnet, label: 'Weekly (Sonnet)', cycle: 'weekly' },
    { data: usage.weekly, label: 'Weekly', cycle: 'weekly' },
  ];
  for (const { data, label, cycle } of sections) {
    if (data) {
      const percent = data.percent ?? 0;
      const isZero = percent === 0;
      const resetsIn = data.resetsIn || '';
      html += '<div class="model-container">';
      html += usageItem(label, percent, '% used', { isZero, agentName: 'claude', resetsIn });
      html += resetInfoItem(data.resetsIn, data.resetsAt, cycle, isZero);
      html += '</div>';
    }
  }
  // Extra usage (paid overage budget)
  if (usage.extraUsage) {
    const extra = usage.extraUsage;
    const percent = extra.percent ?? 0;
    const isZero = percent === 0;
    const spentLabel = extra.spent != null && extra.budget != null
      ? `$${extra.spent.toFixed(2)} / $${extra.budget.toFixed(2)}`
      : '';
    html += '<div class="model-container">';
    html += usageItem('Extra', percent, '% used', { isZero, agentName: 'claude', resetsIn: extra.resetsIn || '' });
    if (spentLabel) {
      html += `<div class="reset-info"><span class="reset-label">${spentLabel}</span></div>`;
    }
    html += resetInfoItem(extra.resetsIn, extra.resetsAt, 'weekly', isZero);
    html += '</div>';
  }
  return html;
}

function formatGeminiUsage(usage) {
  let html = '';
  if (usage.models && usage.models.length > 0) {
    for (const model of usage.models) {
      const percent = model.percentUsed ?? 0;
      const isZero = percent === 0;
      // Use lowercase model name with model-name styling
      const modelName = model.model.toLowerCase();
      const resetsIn = model.resetsIn || '';
      html += '<div class="model-container">';
      html += usageItem(modelName, percent, '% used', { isZero, isModelName: true, agentName: 'gemini', resetsIn });
      html += resetInfoItem(model.resetsIn, null, 'sessionGemini', isZero);
      html += '</div>';
    }
  }
  return html;
}

function formatCodexUsage(usage) {
  let html = '';
  const models = [];
  if (usage.fiveHour || usage.weekly) {
    models.push({ name: usage.model || 'Default', fiveHour: usage.fiveHour, weekly: usage.weekly });
  }
  if (usage.modelLimits) {
    models.push(...usage.modelLimits);
  }
  for (const ml of models) {
    // Use model-subheading class for Codex models to create visual grouping (keeps ALL CAPS)
    // CSS :first-child handles the first item styling automatically
    const modelSlug = ml.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    html += `<div class="usage-item model-subheading"><span class="usage-label">${ml.name.toUpperCase()}</span></div>`;
    if (ml.fiveHour) {
      const fiveHourPercent = ml.fiveHour.percentUsed ?? 0;
      const isZero = fiveHourPercent === 0;
      const resetsIn = ml.fiveHour.resetsIn || '';
      html += '<div class="model-container nested-container">';
      html += usageItem('5h limit', fiveHourPercent, '% used', { isZero, isNestedMetric: true, agentName: 'codex', resetsIn, metricId: `codex-${modelSlug}-5h` });
      html += resetInfoItem(ml.fiveHour.resetsIn, ml.fiveHour.resetsAt, 'fiveHour', isZero);
      html += '</div>';
    }
    if (ml.weekly) {
      const weeklyPercent = ml.weekly.percentUsed ?? 0;
      const isZero = weeklyPercent === 0;
      const resetsIn = ml.weekly.resetsIn || '';
      html += '<div class="model-container nested-container">';
      html += usageItem('Weekly', weeklyPercent, '% used', { isZero, isNestedMetric: true, agentName: 'codex', resetsIn, metricId: `codex-${modelSlug}-weekly` });
      html += resetInfoItem(ml.weekly.resetsIn, ml.weekly.resetsAt, 'weekly', isZero);
      html += '</div>';
    }
  }
  return html;
}

function formatUsage(agentName, usage) {
  if (!usage) {
    return '<p class="usage-item">No data available</p>';
  }

  const formatters = { claude: formatClaudeUsage, gemini: formatGeminiUsage, codex: formatCodexUsage };
  const formatter = formatters[agentName];
  const html = formatter ? formatter(usage) : '';

  return html || '<p class="usage-item">No usage data</p>';
}

module.exports = {
  formatUsage,
  formatClaudeUsage,
  formatGeminiUsage,
  formatCodexUsage,
  usageItem,
  resetInfoItem,
  parseResetsInToSeconds,
  CYCLE_DURATIONS
};
