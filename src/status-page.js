const fs = require('node:fs');
const path = require('node:path');

const styles = fs.readFileSync(path.join(__dirname, 'status-page.css'), 'utf8');

// Brand icons for each agent - inline SVG for performance and styling flexibility
const agentIcons = {
  claude: `<svg class="agent-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" />
  </svg>`,
  gemini: `<svg class="agent-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" />
  </svg>`,
  codex: `<svg class="agent-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
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
        html += resetInfoItem(usage.session.resetsIn, usage.session.resetsAt, 'session');
      }
    }
    if (usage.weeklyAll) {
      html += usageItem('Weekly (all)', usage.weeklyAll.percent, '% used', true);
      if (usage.weeklyAll.resetsIn) {
        html += resetInfoItem(usage.weeklyAll.resetsIn, usage.weeklyAll.resetsAt, 'weekly');
      }
    }
    if (usage.weeklySonnet) {
      html += usageItem('Weekly (Sonnet)', usage.weeklySonnet.percent, '% used', true);
      if (usage.weeklySonnet.resetsIn) {
        html += resetInfoItem(usage.weeklySonnet.resetsIn, usage.weeklySonnet.resetsAt, 'weekly');
      }
    }
    if (usage.weekly) {
      html += usageItem('Weekly', usage.weekly.percent, '% used', true);
      if (usage.weekly.resetsIn) {
        html += resetInfoItem(usage.weekly.resetsIn, usage.weekly.resetsAt, 'weekly');
      }
    }
  } else if (agentName === 'gemini') {
    if (usage.models && usage.models.length > 0) {
      for (const model of usage.models) {
        html += usageItem(model.model, model.percentUsed, '% used', true);
        if (model.resetsIn) {
          html += resetInfoItem(model.resetsIn, null, 'sessionGemini');
        }
      }
    }
  } else if (agentName === 'codex') {
    if (usage.fiveHour) {
      html += usageItem('5h limit', usage.fiveHour.percentUsed, '% used', true);
      if (usage.fiveHour.resetsIn) {
        html += resetInfoItem(usage.fiveHour.resetsIn, usage.fiveHour.resetsAt, 'fiveHour');
      }
    }
    if (usage.weekly) {
      html += usageItem('Weekly', usage.weekly.percentUsed, '% used', true);
      if (usage.weekly.resetsIn) {
        html += resetInfoItem(usage.weekly.resetsIn, usage.weekly.resetsAt, 'weekly');
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

function resetInfoItem(resetsIn, originalValue, cycleType) {
  const tooltip = originalValue ? ` title="${originalValue}"` : '';

  // Calculate elapsed time progress bar
  let timeProgressHtml = '';
  const resetsInSeconds = parseResetsInToSeconds(resetsIn);
  const cycleDuration = cycleType ? CYCLE_DURATIONS[cycleType] : null;

  if (resetsInSeconds !== null && cycleDuration) {
    // Calculate elapsed percentage: (cycleDuration - remaining) / cycleDuration * 100
    const elapsedSeconds = cycleDuration - resetsInSeconds;
    const elapsedPercent = Math.min(100, Math.max(0, (elapsedSeconds / cycleDuration) * 100));

    timeProgressHtml = `<div class="time-progress-bar" title="Time elapsed in cycle: ${Math.round(elapsedPercent)}%">
      <div class="time-progress-fill" style="width: ${elapsedPercent}%;"></div>
    </div>`;
  }

  // Wrap in container so the time bar can be positioned below the reset text
  return `<div class="reset-info-wrapper">
    <div class="usage-item reset-info"${tooltip}><span class="usage-label">↳ Resets in</span><span class="usage-value">${resetsIn}</span></div>
    ${timeProgressHtml}
  </div>`;
}

module.exports = { statusPage };
