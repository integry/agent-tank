/**
 * Public Status API Polling Module
 *
 * Fetches status information from public API status pages for Anthropic, OpenAI,
 * and Google Cloud. Uses Statuspage.io JSON API for Anthropic and OpenAI, and
 * Google Cloud's incidents JSON for Google/Gemini.
 */

const https = require('node:https');

// Status page configurations
const STATUS_PAGES = {
  claude: {
    url: 'https://anthropic.statuspage.io/api/v2/status.json',
    type: 'statuspage',
    name: 'Anthropic',
  },
  codex: {
    url: 'https://status.openai.com/api/v2/status.json',
    type: 'statuspage',
    name: 'OpenAI',
  },
  gemini: {
    url: 'https://status.cloud.google.com/incidents.json',
    type: 'google-cloud',
    name: 'Google Cloud',
    // Vertex AI Gemini product ID for filtering incidents
    productId: 'Z0FZJAMvEB4j3NbCJs6B',
  },
};

// Status indicator mapping (statuspage.io format)
// Possible values: none, minor, major, critical
const STATUS_INDICATOR_MAP = {
  none: 'operational',
  minor: 'degraded',
  major: 'outage',
  critical: 'outage',
};

// Request timeout in milliseconds
const FETCH_TIMEOUT = 10000;

/**
 * Makes an HTTPS GET request and returns the response body as a string
 * @param {string} url - The URL to fetch
 * @returns {Promise<string>} - The response body
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: FETCH_TIMEOUT }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve(data);
      });
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Parse Statuspage.io JSON response
 * @param {string} json - Raw JSON response
 * @returns {object} - Parsed status object
 */
function parseStatuspageResponse(json) {
  const data = JSON.parse(json);
  const indicator = data.status?.indicator || 'none';
  const description = data.status?.description || 'Unknown';

  return {
    status: STATUS_INDICATOR_MAP[indicator] || 'unknown',
    indicator,
    description,
    updatedAt: data.page?.updated_at || null,
  };
}

/**
 * Parse Google Cloud incidents JSON response
 * Determines status based on recent active incidents affecting the specified product
 * @param {string} json - Raw JSON response
 * @param {string} productId - Product ID to filter incidents
 * @returns {object} - Parsed status object
 */
function parseGoogleCloudResponse(json, productId) {
  const incidents = JSON.parse(json);

  // Find active incidents affecting the specified product (e.g., Vertex AI Gemini)
  const now = new Date();
  const activeIncidents = incidents.filter((incident) => {
    // Check if incident is ongoing (no end date or recent)
    if (incident.end) {
      const endDate = new Date(incident.end);
      // Consider incidents that ended less than 1 hour ago as potentially still affecting
      if (now - endDate > 60 * 60 * 1000) {
        return false;
      }
    }

    // Check if incident affects the target product
    if (productId && incident.affected_products) {
      const affectsProduct = incident.affected_products.some(
        (p) => p.id === productId || p.title?.toLowerCase().includes('gemini') ||
               p.title?.toLowerCase().includes('vertex')
      );
      if (!affectsProduct) {
        return false;
      }
    }

    // Check status - include ongoing or recent disruptions
    return incident.status === 'SERVICE_DISRUPTION' ||
           incident.status === 'SERVICE_OUTAGE' ||
           !incident.end;
  });

  // Determine overall status based on active incidents
  if (activeIncidents.length === 0) {
    return {
      status: 'operational',
      indicator: 'none',
      description: 'All Systems Operational',
      updatedAt: null,
    };
  }

  // Find the most severe active incident
  const hasOutage = activeIncidents.some((i) => i.status === 'SERVICE_OUTAGE');
  const hasDisruption = activeIncidents.some((i) => i.status === 'SERVICE_DISRUPTION');

  if (hasOutage) {
    return {
      status: 'outage',
      indicator: 'major',
      description: activeIncidents[0].external_desc || 'Service Outage',
      updatedAt: activeIncidents[0].modified || null,
    };
  }

  if (hasDisruption) {
    return {
      status: 'degraded',
      indicator: 'minor',
      description: activeIncidents[0].external_desc || 'Service Disruption',
      updatedAt: activeIncidents[0].modified || null,
    };
  }

  // Default to operational if incidents are resolved
  return {
    status: 'operational',
    indicator: 'none',
    description: 'All Systems Operational',
    updatedAt: null,
  };
}

/**
 * Fetch public status for a single agent
 * @param {string} agentName - Name of the agent (claude, gemini, codex)
 * @returns {Promise<object>} - Status object with status, indicator, description
 */
async function fetchAgentPublicStatus(agentName) {
  const config = STATUS_PAGES[agentName];

  if (!config) {
    return {
      status: 'unknown',
      indicator: 'unknown',
      description: 'No status page configured',
      error: null,
    };
  }

  try {
    const response = await httpsGet(config.url);

    if (config.type === 'statuspage') {
      return parseStatuspageResponse(response);
    } else if (config.type === 'google-cloud') {
      return parseGoogleCloudResponse(response, config.productId);
    }

    return {
      status: 'unknown',
      indicator: 'unknown',
      description: 'Unknown status page type',
      error: null,
    };
  } catch (err) {
    console.error(`[PublicStatus] Error fetching ${agentName} status:`, err.message);
    return {
      status: 'unknown',
      indicator: 'unknown',
      description: 'Unable to fetch status',
      error: err.message,
    };
  }
}

/**
 * Fetch public status for all configured agents
 * @param {string[]} agentNames - Array of agent names to fetch status for
 * @returns {Promise<object>} - Object mapping agent names to their public status
 */
async function fetchPublicStatus(agentNames = Object.keys(STATUS_PAGES)) {
  const results = {};

  const promises = agentNames.map(async (name) => {
    results[name] = await fetchAgentPublicStatus(name);
  });

  await Promise.all(promises);

  return results;
}

/**
 * Get the badge color class for a status
 * @param {string} status - Status string (operational, degraded, outage, unknown)
 * @returns {string} - CSS class name for the badge
 */
function getStatusBadgeClass(status) {
  switch (status) {
    case 'operational':
      return 'status-badge-green';
    case 'degraded':
      return 'status-badge-yellow';
    case 'outage':
      return 'status-badge-red';
    default:
      return 'status-badge-grey';
  }
}

/**
 * Get the human-readable status text
 * @param {string} status - Status string
 * @returns {string} - Human-readable status
 */
function getStatusText(status) {
  switch (status) {
    case 'operational':
      return 'Operational';
    case 'degraded':
      return 'Degraded';
    case 'outage':
      return 'Outage';
    default:
      return 'Unknown';
  }
}

module.exports = {
  fetchPublicStatus,
  fetchAgentPublicStatus,
  getStatusBadgeClass,
  getStatusText,
  parseStatuspageResponse,
  parseGoogleCloudResponse,
  STATUS_PAGES,
};
