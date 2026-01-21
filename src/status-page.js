const fs = require('node:fs');
const path = require('node:path');

const styles = fs.readFileSync(path.join(__dirname, 'status-page.css'), 'utf8');

// Brand icons for each agent - inline SVG for performance and styling flexibility
const agentIcons = {
  claude: `<svg class="agent-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" opacity="0.8"/>
    <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  gemini: `<svg class="agent-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" fill="currentColor"/>
  </svg>`,
  codex: `<svg class="agent-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 18L22 12L16 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M8 6L2 12L8 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M14 4L10 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`
};

function statusPage(status) {
  const agents = Object.entries(status);

  const agentCards = agents.map(([name, data]) => {
    const usageHtml = formatUsage(name, data.usage);
    const statusClass = data.error ? 'error' : data.isRefreshing ? 'refreshing' : 'ok';
    const lastUpdate = data.lastUpdated
      ? new Date(data.lastUpdated).toLocaleString()
      : 'Never';

    const icon = agentIcons[name] || '';
    const displayName = name.charAt(0).toUpperCase() + name.slice(1);

    return `
      <div class="agent-card ${statusClass} agent-${name}">
        <h2 class="agent-heading">
          ${icon}
          <span>${displayName}</span>
        </h2>
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
${styles}
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
