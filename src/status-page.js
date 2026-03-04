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

// Inline SVG refresh icon for card headers
const refreshIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
  <path d="M21 3v5h-5"/>
</svg>`;

// Crosshair/target icon for tracking metrics
const trackIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10"/>
  <circle cx="12" cy="12" r="6"/>
  <circle cx="12" cy="12" r="2"/>
  <line x1="12" y1="2" x2="12" y2="6"/>
  <line x1="12" y1="18" x2="12" y2="22"/>
  <line x1="2" y1="12" x2="6" y2="12"/>
  <line x1="18" y1="12" x2="22" y2="12"/>
</svg>`;

// Monitor icon for top nav toggle
const monitorIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
  <line x1="8" y1="21" x2="16" y2="21"/>
  <line x1="12" y1="17" x2="12" y2="21"/>
</svg>`;

function statusPage(status) {
  const agents = Object.entries(status);

  // Calculate the maximum lastUpdated timestamp across all agents for global display
  const maxLastUpdated = agents.reduce((max, [, data]) => {
    if (data.lastUpdated) {
      const ts = new Date(data.lastUpdated).getTime();
      return ts > max ? ts : max;
    }
    return max;
  }, 0);

  const globalLastChecked = maxLastUpdated > 0
    ? new Date(maxLastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  const agentCards = agents.map(([name, data]) => {
    const usageHtml = formatUsage(name, data.usage);
    const statusClass = data.error ? 'error' : data.isRefreshing ? 'refreshing' : 'ok';

    const icon = agentIcons[name] || '';
    const displayName = name.charAt(0).toUpperCase() + name.slice(1);

    // Only show card-footer if there's an error
    const footerHtml = data.error
      ? `<div class="card-footer"><span class="error-msg">${data.error}</span></div>`
      : '';

    return `
      <div class="agent-card ${statusClass} agent-${name}">
        <h2 class="agent-heading">
          ${icon}
          <span>${displayName}</span>
          <button class="refresh-icon-btn" onclick="refresh('${name}', event)" ${data.isRefreshing ? 'disabled' : ''} title="Refresh ${displayName}">
            ${refreshIcon}
          </button>
        </h2>
        <div class="usage">${usageHtml}</div>
        ${footerHtml}
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
  <nav class="top-nav">
    <div class="top-nav-left">
      <h1 class="top-nav-title">LLM Limit Watcher</h1>
    </div>
    <div class="top-nav-right">
      ${globalLastChecked ? `<span class="last-checked">Last checked: ${globalLastChecked}</span>` : ''}
      <button class="refresh-all-btn" onclick="refreshAll(event)">Refresh All</button>
      <button class="monitor-toggle-btn" onclick="toggleMonitor()" id="monitor-toggle-btn" title="Enable background monitoring">
        ${monitorIcon}
        <span id="monitor-text">Monitor</span>
      </button>
      <button class="theme-toggle-btn" onclick="toggleTheme()" id="theme-toggle-btn">
        <span id="theme-icon">☀️</span>
        <span id="theme-text">Light</span>
      </button>
    </div>
  </nav>
  <div class="container">
    <div class="agents">
      ${agentCards || '<p>No agents configured</p>'}
    </div>
    <footer class="footer">
      <div class="footer-left">
        <span>LLM Limit Watcher &copy; ${new Date().getFullYear()} <a href="https://propr.dev">Rinalds Uzkalns</a></span>
      </div>
      <div class="footer-right">
        <span class="footer-version"><a href="https://github.com/integry/llm-limit-watcher/releases">v1.0.0</a></span>
        <span class="footer-separator">•</span>
        <a href="https://github.com/integry/llm-limit-watcher/blob/main/CHANGELOG.md">Changelog</a>
        <span class="footer-separator">•</span>
        <a href="https://github.com/integry/llm-limit-watcher">GitHub</a>
      </div>
    </footer>
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
    function setRefreshIconLoading(btn, loading) {
      btn.disabled = loading;
      if (loading) {
        btn.classList.add('spinning');
      } else {
        btn.classList.remove('spinning');
      }
    }
    async function refresh(agent, event) {
      // Handle clicks on the refresh icon button (may be SVG or button)
      const btn = event.target.closest('button');
      if (!btn) return;

      // Check if it's a refresh-icon-btn (inline icon) or regular button
      const isIconBtn = btn.classList.contains('refresh-icon-btn');

      if (isIconBtn) {
        setRefreshIconLoading(btn, true);
      } else {
        setButtonLoading(btn, true);
      }

      try {
        await fetch('/refresh/' + agent, { method: 'POST' });
        location.reload();
      } catch (e) {
        if (isIconBtn) {
          setRefreshIconLoading(btn, false);
        } else {
          setButtonLoading(btn, false);
        }
        alert('Failed to refresh: ' + e.message);
      }
    }
    async function refreshAll(event) {
      const btn = event.target.closest('button');
      const refreshAllBtn = document.querySelector('.refresh-all-btn');
      const allIconBtns = document.querySelectorAll('.refresh-icon-btn');
      if (refreshAllBtn) setButtonLoading(refreshAllBtn, true);
      allIconBtns.forEach(b => setRefreshIconLoading(b, true));
      try {
        await fetch('/refresh', { method: 'POST' });
        location.reload();
      } catch (e) {
        if (refreshAllBtn) setButtonLoading(refreshAllBtn, false);
        allIconBtns.forEach(b => setRefreshIconLoading(b, false));
        alert('Failed to refresh: ' + e.message);
      }
    }
    // Auto-refresh every 5 minutes
    setTimeout(() => location.reload(), 5 * 60 * 1000);

    // ===== Background Monitor Feature =====

    // State management
    let monitorEnabled = false;
    let trackedMetric = null;
    let notificationSent = false;
    let originalFavicon = null;

    // Initialize monitor on page load
    function initMonitor() {
      // Restore monitor state from localStorage
      monitorEnabled = localStorage.getItem('monitorEnabled') === 'true';
      const savedMetric = localStorage.getItem('trackedMetric');
      if (savedMetric) {
        try {
          trackedMetric = JSON.parse(savedMetric);
        } catch (e) {
          trackedMetric = null;
        }
      }
      notificationSent = localStorage.getItem('notificationSent') === 'true';

      // Save original favicon
      const existingFavicon = document.querySelector('link[rel="icon"]');
      if (existingFavicon) {
        originalFavicon = existingFavicon.href;
      }

      // Update UI to reflect saved state
      updateMonitorButton();

      // Restore tracked metric button state
      if (trackedMetric && monitorEnabled) {
        const trackBtn = document.querySelector(\`[data-metric-id="\${trackedMetric.metricId}"]\`);
        if (trackBtn) {
          trackBtn.classList.add('tracking');
          // Update trackedMetric with fresh data from the page
          trackedMetric.percent = parseInt(trackBtn.dataset.percent, 10);
          trackedMetric.color = trackBtn.dataset.color;
          trackedMetric.resetsIn = trackBtn.dataset.resetsIn;
          localStorage.setItem('trackedMetric', JSON.stringify(trackedMetric));
          updateFaviconAndTitle();
          checkAndNotify();
        } else {
          // Metric no longer exists, clear tracking
          clearTracking();
        }
      }
    }

    // Toggle monitor on/off globally
    function toggleMonitor() {
      monitorEnabled = !monitorEnabled;
      localStorage.setItem('monitorEnabled', monitorEnabled.toString());

      if (monitorEnabled) {
        // Request notification permission
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      } else {
        // Clear tracking when monitor is disabled
        clearTracking();
        restoreOriginalState();
      }

      updateMonitorButton();
    }

    // Update monitor button UI
    function updateMonitorButton() {
      const btn = document.getElementById('monitor-toggle-btn');
      const text = document.getElementById('monitor-text');
      if (!btn || !text) return;

      if (monitorEnabled) {
        btn.classList.add('active');
        btn.title = 'Disable background monitoring';
        text.textContent = 'Monitoring';
      } else {
        btn.classList.remove('active');
        btn.title = 'Enable background monitoring';
        text.textContent = 'Monitor';
      }
    }

    // Toggle tracking on a specific metric
    function toggleTracking(btn) {
      if (!monitorEnabled) {
        // Auto-enable monitor when user clicks track
        monitorEnabled = true;
        localStorage.setItem('monitorEnabled', 'true');
        updateMonitorButton();

        // Request notification permission
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      }

      const metricId = btn.dataset.metricId;

      // If already tracking this metric, untrack it
      if (trackedMetric && trackedMetric.metricId === metricId) {
        clearTracking();
        restoreOriginalState();
        return;
      }

      // Clear previous tracking
      const prevTracked = document.querySelector('.track-btn.tracking');
      if (prevTracked) {
        prevTracked.classList.remove('tracking');
      }

      // Set new tracking
      btn.classList.add('tracking');
      trackedMetric = {
        metricId: metricId,
        agent: btn.dataset.agent,
        label: btn.dataset.label,
        percent: parseInt(btn.dataset.percent, 10),
        color: btn.dataset.color,
        resetsIn: btn.dataset.resetsIn
      };

      // Reset notification state for new metric
      notificationSent = false;
      localStorage.setItem('notificationSent', 'false');

      // Save to localStorage
      localStorage.setItem('trackedMetric', JSON.stringify(trackedMetric));

      // Update favicon and title
      updateFaviconAndTitle();
      checkAndNotify();
    }

    // Clear tracking state
    function clearTracking() {
      const prevTracked = document.querySelector('.track-btn.tracking');
      if (prevTracked) {
        prevTracked.classList.remove('tracking');
      }
      trackedMetric = null;
      localStorage.removeItem('trackedMetric');
      notificationSent = false;
      localStorage.removeItem('notificationSent');
    }

    // Restore original favicon and title
    function restoreOriginalState() {
      document.title = 'LLM Limit Watcher';

      // Remove canvas favicon and restore original
      const canvasFavicon = document.querySelector('link[rel="icon"]');
      if (canvasFavicon) {
        canvasFavicon.remove();
      }

      if (originalFavicon) {
        const link = document.createElement('link');
        link.rel = 'icon';
        link.href = originalFavicon;
        document.head.appendChild(link);
      }
    }

    // Update favicon with Canvas-generated progress ring
    function updateFaviconAndTitle() {
      if (!trackedMetric || !monitorEnabled) return;

      const { percent, color, resetsIn, agent, label } = trackedMetric;

      // Update page title: [74%] 1h 22m | Claude
      const agentName = agent.charAt(0).toUpperCase() + agent.slice(1);
      const resetsPart = resetsIn ? \` \${resetsIn}\` : '';
      document.title = \`[\${percent}%]\${resetsPart} | \${agentName}\`;

      // Generate favicon using Canvas API
      generateProgressFavicon(percent, color);
    }

    // Generate circular progress ring favicon using Canvas API
    function generateProgressFavicon(percent, color) {
      const canvas = document.createElement('canvas');
      const size = 64; // Favicon size
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      const centerX = size / 2;
      const centerY = size / 2;
      const radius = (size / 2) - 4;
      const lineWidth = 6;

      // Clear canvas
      ctx.clearRect(0, 0, size, size);

      // Draw background circle (track)
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)';
      ctx.lineWidth = lineWidth;
      ctx.stroke();

      // Draw progress arc
      const startAngle = -Math.PI / 2; // Start at top
      const endAngle = startAngle + (2 * Math.PI * percent / 100);

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Draw percentage text in center
      ctx.fillStyle = color;
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(\`\${percent}\`, centerX, centerY);

      // Convert to favicon
      const faviconUrl = canvas.toDataURL('image/png');

      // Update or create favicon link
      let faviconLink = document.querySelector('link[rel="icon"]');
      if (!faviconLink) {
        faviconLink = document.createElement('link');
        faviconLink.rel = 'icon';
        document.head.appendChild(faviconLink);
      }
      faviconLink.href = faviconUrl;
    }

    // Check and send notification if metric hits 90%
    function checkAndNotify() {
      if (!trackedMetric || !monitorEnabled) return;
      if (notificationSent) return; // Only notify once per metric

      const { percent, agent, label } = trackedMetric;

      if (percent >= 90) {
        // Mark as notified to prevent duplicates
        notificationSent = true;
        localStorage.setItem('notificationSent', 'true');

        // Send browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          const agentName = agent.charAt(0).toUpperCase() + agent.slice(1);
          new Notification('LLM Limit Warning', {
            body: \`\${agentName} \${label} is at \${percent}% usage!\`,
            icon: '/favicon.ico',
            tag: 'llm-limit-warning'
          });
        }
      }
    }

    // Initialize monitor on page load
    initMonitor();
  </script>
</body>
</html>`;
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
      if (data.resetsIn && !isZero) {
        html += resetInfoItem(data.resetsIn, data.resetsAt, cycle, isZero);
      }
      html += '</div>';
    }
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
      if (model.resetsIn && !isZero) {
        html += resetInfoItem(model.resetsIn, null, 'sessionGemini', isZero);
      }
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
      html += '<div class="model-container">';
      html += usageItem('5h limit', fiveHourPercent, '% used', { isZero, agentName: 'codex', resetsIn, metricId: `codex-${modelSlug}-5h` });
      if (ml.fiveHour.resetsIn && !isZero) {
        html += resetInfoItem(ml.fiveHour.resetsIn, ml.fiveHour.resetsAt, 'fiveHour', isZero);
      }
      html += '</div>';
    }
    if (ml.weekly) {
      const weeklyPercent = ml.weekly.percentUsed ?? 0;
      const isZero = weeklyPercent === 0;
      const resetsIn = ml.weekly.resetsIn || '';
      html += '<div class="model-container">';
      html += usageItem('Weekly', weeklyPercent, '% used', { isZero, agentName: 'codex', resetsIn, metricId: `codex-${modelSlug}-weekly` });
      if (ml.weekly.resetsIn && !isZero) {
        html += resetInfoItem(ml.weekly.resetsIn, ml.weekly.resetsAt, 'weekly', isZero);
      }
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

function usageItem(label, value, suffix, options = {}) {
  const { isUsed = true, isZero = false, isModelName = false, agentName = '', resetsIn = '', metricId = '' } = options;
  // For "used" percentages, higher is worse. For "left" percentages, lower is worse.
  let colorClass;
  if (isUsed) {
    colorClass = value < 50 ? 'high' : value < 80 ? 'medium' : 'low';
  } else {
    colorClass = value > 50 ? 'high' : value > 20 ? 'medium' : 'low';
  }

  const progressPercent = isUsed ? value : (100 - value);
  const progressColor = colorClass === 'high' ? '#48bb78' : colorClass === 'medium' ? '#ecc94b' : '#e53e3e';
  const zeroClass = isZero ? ' zero-usage' : '';
  const labelClass = isModelName ? 'usage-label model-name' : 'usage-label';

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
    onclick="toggleTracking(this)"
    title="Track this metric in tab">${trackIcon}</button>`;

  return `
    <div class="usage-item${zeroClass}">
      <span class="${labelClass}">${label}</span>
      <span class="usage-value ${colorClass}"><span class="usage-percent">${value}</span><span class="usage-suffix">${suffix}</span>${trackButton}</span>
    </div>
    <div class="progress-bar${zeroClass}">
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

function resetInfoItem(resetsIn, originalValue, cycleType, isZero = false) {
  // If usage is at 0%, hide the "Resets in" row entirely - it's useless info when at full capacity
  if (isZero) {
    return '';
  }

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
