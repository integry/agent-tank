const fs = require('node:fs');
const path = require('node:path');
const pkg = require(path.join(__dirname, '..', 'package.json'));

const { agentIcons, refreshIcon, tankIcon, syncIcon, copyIcon } = require('./icons');
const { formatUsage } = require('./usage-formatters');
const { clientScript } = require('./client-script');
const { getStatusBadgeClass, getStatusText } = require('./public-status');

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

    // Public API status badge
    const publicStatus = data.publicStatus;
    const badgeClass = publicStatus ? getStatusBadgeClass(publicStatus.status) : 'status-badge-grey';
    const badgeText = publicStatus ? getStatusText(publicStatus.status) : 'Unknown';
    const badgeTitle = publicStatus?.description || 'Unable to fetch status';
    const statusBadgeHtml = `<span class="status-badge ${badgeClass}" title="${badgeTitle}">${badgeText}</span>`;

    // Version update notice - check usage.version (Codex) or metadata.updateAvailable (Gemini)
    const version = data.usage?.version || data.metadata?.updateAvailable;
    const updateHtml = (version && version.current && version.latest && version.current !== version.latest)
      ? `<div class="version-update-notice">Update available: v${version.current} → v${version.latest}</div>`
      : '';

    // Only show card-footer if there's an error or update notice
    const hasFooterContent = data.error || updateHtml;
    const footerHtml = hasFooterContent
      ? `<div class="card-footer">${data.error ? `<span class="error-msg">${data.error}</span>` : ''}${updateHtml}</div>`
      : '';

    return `
      <div class="agent-card ${statusClass} agent-${name}">
        <h2 class="agent-heading">
          ${icon}
          <span>${displayName}</span>
          ${statusBadgeHtml}
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
      <a href="https://agenttank.io" target="_blank" rel="noopener noreferrer" class="logo-link">
        ${tankIcon}
        <h1 class="top-nav-title">AGENT <span class="brand-emphasis">TANK</span></h1>
      </a>
    </div>
    <div class="top-nav-right">
      ${globalLastChecked ? `<span class="last-checked">Last checked: ${globalLastChecked}</span>` : ''}
      <button class="refresh-all-btn" onclick="refreshAll(event)">
        ${syncIcon}
        <span class="btn-text">Refresh All</span>
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
        <span>&copy; ${new Date().getFullYear()} <a href="https://propr.dev">Rinalds Uzkalns</a></span>
      </div>
      <div class="footer-right">
        <span class="footer-version"><a href="https://github.com/integry/agent-tank/releases">v${pkg.version}</a></span>
        <span class="footer-separator">•</span>
        <a href="https://github.com/integry/agent-tank/blob/main/CHANGELOG.md">Changelog</a>
        <span class="footer-separator">•</span>
        <a href="https://github.com/integry/agent-tank">GitHub</a>
        <span class="footer-separator">•</span>
        <a href="https://www.reddit.com/r/agenttank">Reddit</a>
        <span class="footer-separator">•</span>
        <a href="/status" target="_blank" class="api-link" id="api-link" title="Open API endpoint">[ API Endpoint ]</a>
        <button class="copy-api-btn" onclick="copyApiEndpoint(event)" title="Copy API URL">${copyIcon}</button>
      </div>
    </footer>
  </div>
  <script>${clientScript}</script>
</body>
</html>`;
}

module.exports = { statusPage };
