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
        <div class="card-footer">
          ${data.error ? `<span class="error-msg">${data.error}</span>` : ''}
          <button onclick="refresh('${name}')" ${data.isRefreshing ? 'disabled' : ''}>
            ${data.isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <span class="last-updated">Updated: ${lastUpdate}</span>
        </div>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LLM Limit Watcher</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      /* Dark mode colors (default) */
      --bg-primary: #343A40;
      --bg-card: #2d3339;
      --bg-secondary: #2d3748;
      --text-primary: #eee;
      --text-secondary: #a0aec0;
      --text-tertiary: #718096;
      --accent-primary: #1D8A8A;
      --accent-hover: #166d6d;
      --border-color: #2d3748;
      --disabled-bg: #4a5568;
      --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }

    body.light-mode {
      /* Light mode colors */
      --bg-primary: #f5f7f9;
      --bg-card: #ffffff;
      --bg-secondary: #e2e8f0;
      --text-primary: #2d3748;
      --text-secondary: #4a5568;
      --text-tertiary: #718096;
      --accent-primary: #1D8A8A;
      --accent-hover: #166d6d;
      --border-color: #e2e8f0;
      --disabled-bg: #cbd5e0;
      --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    * { box-sizing: border-box; }
    body {
      font-family: 'Inter', 'Montserrat', 'Source Sans Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      margin: 0;
      padding: 20px;
      transition: background-color 0.3s ease, color 0.3s ease;
    }
    h1 {
      text-align: center;
      color: var(--accent-primary);
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
      background: var(--bg-card);
      border-radius: 8px;
      padding: 20px;
      border: none;
      border-top: 4px solid var(--accent-primary);
      box-shadow: var(--card-shadow);
      display: flex;
      flex-direction: column;
      transition: background-color 0.3s ease, box-shadow 0.3s ease;
    }
    .agent-card.error { border-top-color: #e53e3e; }
    .agent-card.refreshing { border-top-color: #ecc94b; }
    .agent-card h2 {
      margin: 0 0 15px 0;
      color: var(--accent-primary);
    }
    .usage { margin-bottom: 15px; flex: 1; }
    .usage-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-bottom: 1px solid var(--border-color);
    }
    .usage-item:last-child { border-bottom: none; }
    .usage-item.reset-info {
      padding: 4px 0 8px 12px;
      font-size: 13px;
      border-bottom: none;
    }
    .usage-item.reset-info .usage-label { font-size: 12px; }
    .usage-item.reset-info .usage-value { font-weight: normal; color: var(--text-secondary); }
    .usage-label {
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 400;
    }
    .usage-value {
      font-weight: 600;
      display: flex;
      align-items: baseline;
      gap: 2px;
    }
    .usage-percent {
      font-size: 28px;
      font-weight: 700;
      line-height: 1.2;
    }
    .usage-suffix {
      font-size: 14px;
      font-weight: 500;
      opacity: 0.8;
    }
    .usage-value.high { color: #48bb78; }
    .usage-value.high .usage-percent { color: #48bb78; }
    .usage-value.medium { color: #ecc94b; }
    .usage-value.medium .usage-percent { color: #ecc94b; }
    .usage-value.low { color: #e53e3e; }
    .usage-value.low .usage-percent { color: #e53e3e; }
    .progress-bar {
      height: 8px;
      background: var(--bg-secondary);
      border-radius: 4px;
      margin-top: 5px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s;
    }
    .card-footer {
      margin-top: auto;
      padding-top: 15px;
      border-top: 1px solid var(--border-color);
    }
    .card-footer .last-updated {
      display: block;
      font-size: 12px;
      color: var(--text-tertiary);
      margin-top: 10px;
      text-align: center;
    }
    .error-msg {
      display: block;
      color: #e53e3e;
      margin-bottom: 10px;
      font-size: 13px;
    }
    button {
      width: 100%;
      padding: 10px;
      background: var(--accent-primary);
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      transition: background-color 0.2s ease;
    }
    button:hover:not(:disabled) { background: var(--accent-hover); }
    button:disabled {
      background: var(--disabled-bg);
      cursor: not-allowed;
    }
    button .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 6px;
      vertical-align: middle;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .refresh-all {
      text-align: center;
      margin-bottom: 20px;
    }
    .refresh-all button {
      width: auto;
      padding: 10px 30px;
    }
    .theme-toggle {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 1000;
    }
    .theme-toggle button {
      width: auto;
      padding: 8px 16px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
  </style>
</head>
<body>
  <div class="theme-toggle">
    <button onclick="toggleTheme()" id="theme-toggle-btn">
      <span id="theme-icon">☀️</span>
      <span id="theme-text">Light</span>
    </button>
  </div>
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

    function setButtonLoading(btn, loading) {
      btn.disabled = loading;
      if (loading) {
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = '<span class="spinner"></span>Refreshing...';
      } else {
        btn.innerHTML = btn.dataset.originalText || 'Refresh';
      }
    }
    async function refresh(agent) {
      const btn = event.target;
      setButtonLoading(btn, true);
      try {
        await fetch('/refresh/' + agent, { method: 'POST' });
        location.reload();
      } catch (e) {
        setButtonLoading(btn, false);
        alert('Failed to refresh: ' + e.message);
      }
    }
    async function refreshAll() {
      const btn = event.target;
      const allBtns = document.querySelectorAll('button');
      allBtns.forEach(b => setButtonLoading(b, true));
      try {
        await fetch('/refresh', { method: 'POST' });
        location.reload();
      } catch (e) {
        allBtns.forEach(b => setButtonLoading(b, false));
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
      if (usage.session.resetsIn) {
        html += resetInfoItem(usage.session.resetsIn, usage.session.resetsAt);
      }
    }
    if (usage.weeklyAll) {
      html += usageItem('Weekly (all)', usage.weeklyAll.percent, '% used', true);
      if (usage.weeklyAll.resetsIn) {
        html += resetInfoItem(usage.weeklyAll.resetsIn, usage.weeklyAll.resetsAt);
      }
    }
    if (usage.weeklySonnet) {
      html += usageItem('Weekly (Sonnet)', usage.weeklySonnet.percent, '% used', true);
      if (usage.weeklySonnet.resetsIn) {
        html += resetInfoItem(usage.weeklySonnet.resetsIn, usage.weeklySonnet.resetsAt);
      }
    }
    if (usage.weekly) {
      html += usageItem('Weekly', usage.weekly.percent, '% used', true);
      if (usage.weekly.resetsIn) {
        html += resetInfoItem(usage.weekly.resetsIn, usage.weekly.resetsAt);
      }
    }
  } else if (agentName === 'gemini') {
    if (usage.models && usage.models.length > 0) {
      for (const model of usage.models) {
        html += usageItem(model.model, model.percentUsed, '% used', true);
        if (model.resetsIn) {
          html += resetInfoItem(model.resetsIn);
        }
      }
    }
  } else if (agentName === 'codex') {
    if (usage.fiveHour) {
      html += usageItem('5h limit', usage.fiveHour.percentUsed, '% used', true);
      if (usage.fiveHour.resetsIn) {
        html += resetInfoItem(usage.fiveHour.resetsIn, usage.fiveHour.resetsAt);
      }
    }
    if (usage.weekly) {
      html += usageItem('Weekly', usage.weekly.percentUsed, '% used', true);
      if (usage.weekly.resetsIn) {
        html += resetInfoItem(usage.weekly.resetsIn, usage.weekly.resetsAt);
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
      <span class="usage-value ${colorClass}"><span class="usage-percent">${value}</span><span class="usage-suffix">${suffix}</span></span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" style="width: ${progressPercent}%; background: ${progressColor};"></div>
    </div>
  `;
}

function resetInfoItem(resetsIn, originalValue) {
  const tooltip = originalValue ? ` title="${originalValue}"` : '';
  return `<div class="usage-item reset-info"${tooltip}><span class="usage-label">↳ Resets in</span><span class="usage-value">${resetsIn}</span></div>`;
}

module.exports = { statusPage };
