const fs = require('node:fs');
const path = require('node:path');

const { agentIcons, refreshIcon, monitorIcon, tankIcon, syncIcon } = require('./icons');
const { formatUsage } = require('./usage-formatters');
const { clientScript } = require('./client-script');

const styles = fs.readFileSync(path.join(__dirname, 'status-page.css'), 'utf8');

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
  <title>Agent Tank</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
${styles}
  </style>
</head>
<body>
  <nav class="top-nav">
    <div class="top-nav-left">
      ${tankIcon}
      <h1 class="top-nav-title">AGENT <span class="brand-emphasis">TANK</span></h1>
    </div>
    <div class="top-nav-right">
      ${globalLastChecked ? `<span class="last-checked">Last checked: ${globalLastChecked}</span>` : ''}
      <button class="refresh-all-btn" onclick="refreshAll(event)">
        ${syncIcon}
        <span class="btn-text">Refresh All</span>
      </button>
      <button class="monitor-toggle-btn" onclick="toggleMonitor()" id="monitor-toggle-btn" title="Enable background monitoring">
        ${monitorIcon}
        <span id="monitor-text">Monitor</span>
        <span class="led-indicator" id="led-indicator"></span>
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
        <span>Agent Tank &copy; ${new Date().getFullYear()} <a href="https://propr.dev">Rinalds Uzkalns</a></span>
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
  <script>${clientScript}</script>
</body>
</html>`;
}

module.exports = { statusPage };
