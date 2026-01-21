function statusPage(status) {
  const agents = Object.entries(status);

  const agentCards = agents.map(([name, data]) => {
    const usageHtml = formatUsage(name, data.usage);
    const statusClass = data.error ? 'error' : data.isRefreshing ? 'refreshing' : 'ok';
    const lastUpdate = data.lastUpdated
      ? new Date(data.lastUpdated).toLocaleString()
      : 'Never';

    return `
      <div class="agent-card ${statusClass}">
        <h2>${name.charAt(0).toUpperCase() + name.slice(1)}</h2>
        <div class="usage">${usageHtml}</div>
        <div class="meta">
          <span class="last-updated">Updated: ${lastUpdate}</span>
          ${data.error ? `<span class="error-msg">${data.error}</span>` : ''}
        </div>
        <button onclick="refresh('${name}')" ${data.isRefreshing ? 'disabled' : ''}>
          ${data.isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LLM Limit Watcher</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      margin: 0;
      padding: 20px;
    }
    h1 {
      text-align: center;
      color: #7f5af0;
      margin-bottom: 30px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    .agents {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
    }
    .agent-card {
      background: #16213e;
      border-radius: 12px;
      padding: 20px;
      border-left: 4px solid #7f5af0;
    }
    .agent-card.error { border-left-color: #e53e3e; }
    .agent-card.refreshing { border-left-color: #ecc94b; }
    .agent-card h2 {
      margin: 0 0 15px 0;
      color: #7f5af0;
    }
    .usage { margin-bottom: 15px; }
    .usage-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #2d3748;
    }
    .usage-item:last-child { border-bottom: none; }
    .usage-item.reset-info {
      padding: 4px 0 8px 12px;
      font-size: 13px;
      border-bottom: none;
    }
    .usage-item.reset-info .usage-label { font-size: 12px; }
    .usage-item.reset-info .usage-value { font-weight: normal; color: #a0aec0; }
    .usage-label { color: #a0aec0; }
    .usage-value { font-weight: bold; }
    .usage-value.high { color: #48bb78; }
    .usage-value.medium { color: #ecc94b; }
    .usage-value.low { color: #e53e3e; }
    .progress-bar {
      height: 8px;
      background: #2d3748;
      border-radius: 4px;
      margin-top: 5px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s;
    }
    .meta {
      font-size: 12px;
      color: #718096;
      margin-bottom: 15px;
    }
    .error-msg {
      display: block;
      color: #e53e3e;
      margin-top: 5px;
    }
    button {
      width: 100%;
      padding: 10px;
      background: #7f5af0;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
    }
    button:hover:not(:disabled) { background: #6b46c1; }
    button:disabled {
      background: #4a5568;
      cursor: not-allowed;
    }
    .refresh-all {
      text-align: center;
      margin-bottom: 20px;
    }
    .refresh-all button {
      width: auto;
      padding: 10px 30px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>LLM Limit Watcher</h1>
    <div class="refresh-all">
      <button onclick="refreshAll()">Refresh All</button>
    </div>
    <div class="agents">
      ${agentCards || '<p>No agents configured</p>'}
    </div>
  </div>
  <script>
    async function refresh(agent) {
      try {
        await fetch('/refresh/' + agent, { method: 'POST' });
        location.reload();
      } catch (e) {
        alert('Failed to refresh: ' + e.message);
      }
    }
    async function refreshAll() {
      try {
        await fetch('/refresh', { method: 'POST' });
        location.reload();
      } catch (e) {
        alert('Failed to refresh: ' + e.message);
      }
    }
    // Auto-refresh every 5 minutes
    setTimeout(() => location.reload(), 5 * 60 * 1000);
  </script>
</body>
</html>`;
}

function formatUsage(agentName, usage) {
  if (!usage) {
    return '<p class="usage-item">No data available</p>';
  }

  let html = '';

  if (agentName === 'claude') {
    if (usage.session) {
      html += usageItem('Session', usage.session.percent, '% used', true);
      if (usage.session.resetsAt) {
        html += `<div class="usage-item reset-info"><span class="usage-label">↳ Resets</span><span class="usage-value">${usage.session.resetsAt}</span></div>`;
      }
    }
    if (usage.weeklyAll) {
      html += usageItem('Weekly (all)', usage.weeklyAll.percent, '% used', true);
      if (usage.weeklyAll.resetsAt) {
        html += `<div class="usage-item reset-info"><span class="usage-label">↳ Resets</span><span class="usage-value">${usage.weeklyAll.resetsAt}</span></div>`;
      }
    }
    if (usage.weeklySonnet) {
      html += usageItem('Weekly (Sonnet)', usage.weeklySonnet.percent, '% used', true);
    }
    if (usage.weekly) {
      html += usageItem('Weekly', usage.weekly.percent, '% used', true);
      if (usage.weekly.resetsAt) {
        html += `<div class="usage-item reset-info"><span class="usage-label">↳ Resets</span><span class="usage-value">${usage.weekly.resetsAt}</span></div>`;
      }
    }
  } else if (agentName === 'gemini') {
    if (usage.models && usage.models.length > 0) {
      for (const model of usage.models) {
        html += usageItem(model.model, model.usageLeft, '% left', false);
        if (model.resetsIn) {
          html += `<div class="usage-item reset-info"><span class="usage-label">↳ Resets in</span><span class="usage-value">${model.resetsIn}</span></div>`;
        }
      }
    }
  } else if (agentName === 'codex') {
    if (usage.fiveHour) {
      html += usageItem('5h limit', usage.fiveHour.percentLeft, '% left', false);
      if (usage.fiveHour.resetsAt) {
        html += `<div class="usage-item reset-info"><span class="usage-label">↳ Resets</span><span class="usage-value">${usage.fiveHour.resetsAt}</span></div>`;
      }
    }
    if (usage.weekly) {
      html += usageItem('Weekly', usage.weekly.percentLeft, '% left', false);
      if (usage.weekly.resetsAt) {
        html += `<div class="usage-item reset-info"><span class="usage-label">↳ Resets</span><span class="usage-value">${usage.weekly.resetsAt}</span></div>`;
      }
    }
    if (usage.model) {
      html += `<div class="usage-item"><span class="usage-label">Model</span><span class="usage-value">${usage.model}</span></div>`;
    }
  }

  return html || '<p class="usage-item">No usage data</p>';
}

function usageItem(label, value, suffix, isUsed) {
  // For "used" percentages, higher is worse. For "left" percentages, lower is worse.
  let colorClass;
  if (isUsed) {
    colorClass = value < 50 ? 'high' : value < 80 ? 'medium' : 'low';
  } else {
    colorClass = value > 50 ? 'high' : value > 20 ? 'medium' : 'low';
  }

  const progressPercent = isUsed ? value : (100 - value);
  const progressColor = colorClass === 'high' ? '#48bb78' : colorClass === 'medium' ? '#ecc94b' : '#e53e3e';

  return `
    <div class="usage-item">
      <span class="usage-label">${label}</span>
      <span class="usage-value ${colorClass}">${value}${suffix}</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" style="width: ${progressPercent}%; background: ${progressColor};"></div>
    </div>
  `;
}

module.exports = { statusPage };
