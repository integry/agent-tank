/**
 * Custom ANSI Logger Utility
 *
 * A lightweight, dependency-free ANSI logger providing color-coded output,
 * agent-specific styles, and highlighted URLs.
 */

// ANSI escape codes for styling
const ANSI = {
  // Reset
  reset: '\x1b[0m',

  // Text styles
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  underline: '\x1b[4m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Bright foreground colors
  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
};

// Agent color mapping
const AGENT_COLORS = {
  claude: ANSI.magenta,
  gemini: ANSI.cyan,
  codex: ANSI.green,
};

// URL regex pattern for highlighting
const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

/**
 * Highlights URLs in a string with underline and blue color
 * @param {string} text - The text to process
 * @returns {string} - Text with highlighted URLs
 */
function highlightUrls(text) {
  if (typeof text !== 'string') {
    return text;
  }
  return text.replace(URL_PATTERN, (url) => {
    return `${ANSI.blue}${ANSI.underline}${url}${ANSI.reset}`;
  });
}

/**
 * Formats arguments into a single string, handling objects and arrays
 * @param {...any} args - Arguments to format
 * @returns {string} - Formatted string
 */
function formatArgs(...args) {
  return args.map(arg => {
    if (typeof arg === 'object' && arg !== null) {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
}

/**
 * Colorizes text with the specified ANSI color
 * @param {string} color - ANSI color code
 * @param {string} text - Text to colorize
 * @returns {string} - Colorized text
 */
function colorize(color, text) {
  return `${color}${text}${ANSI.reset}`;
}

/**
 * Creates a prefixed log message
 * @param {string} prefix - The prefix (e.g., "INFO", "ERROR")
 * @param {string} color - ANSI color for the prefix
 * @param {...any} args - Message arguments
 * @returns {string} - Formatted message
 */
function createPrefixedMessage(prefix, color, ...args) {
  const formattedMessage = highlightUrls(formatArgs(...args));
  return `${colorize(color, `[${prefix}]`)} ${formattedMessage}`;
}

/**
 * Logger object with formatting methods
 */
const logger = {
  /**
   * Log an informational message (blue prefix)
   * @param {...any} args - Message arguments
   */
  info(...args) {
    console.log(createPrefixedMessage('INFO', ANSI.blue, ...args));
  },

  /**
   * Log a success message (green prefix)
   * @param {...any} args - Message arguments
   */
  success(...args) {
    console.log(createPrefixedMessage('SUCCESS', ANSI.green, ...args));
  },

  /**
   * Log a warning message (yellow prefix)
   * @param {...any} args - Message arguments
   */
  warn(...args) {
    console.warn(createPrefixedMessage('WARN', ANSI.yellow, ...args));
  },

  /**
   * Log an error message (red prefix)
   * @param {...any} args - Message arguments
   */
  error(...args) {
    console.error(createPrefixedMessage('ERROR', ANSI.red, ...args));
  },

  /**
   * Log an agent-specific message with mapped color
   * @param {string} agentName - Name of the agent (claude, gemini, codex)
   * @param {...any} args - Message arguments
   */
  agent(agentName, ...args) {
    const normalizedName = agentName.toLowerCase();
    const color = AGENT_COLORS[normalizedName] || ANSI.white;
    const formattedMessage = highlightUrls(formatArgs(...args));
    console.log(`${colorize(color, `[${agentName}]`)} ${formattedMessage}`);
  },

  /**
   * Log a server-related message (cyan prefix with "SERVER" label)
   * @param {...any} args - Message arguments
   */
  server(...args) {
    console.log(createPrefixedMessage('SERVER', ANSI.cyan, ...args));
  },

  /**
   * Format text with dim styling (for verbose/secondary output)
   * @param {string} text - Text to dim
   * @returns {string} - Dimmed text
   */
  dim(text) {
    return `${ANSI.dim}${text}${ANSI.reset}`;
  },

  /**
   * Format and dim JSON data (for large data payloads)
   * @param {any} data - Data to format as JSON
   * @param {boolean} [pretty=false] - Whether to pretty-print the JSON
   * @returns {string} - Dimmed JSON string
   */
  json(data, pretty = false) {
    let jsonStr;
    try {
      jsonStr = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    } catch {
      jsonStr = String(data);
    }
    return `${ANSI.dim}${jsonStr}${ANSI.reset}`;
  },

  /**
   * Get the color code for a specific agent
   * @param {string} agentName - Name of the agent
   * @returns {string} - ANSI color code
   */
  getAgentColor(agentName) {
    const normalizedName = agentName.toLowerCase();
    return AGENT_COLORS[normalizedName] || ANSI.white;
  },

  /**
   * Highlight URLs in text (exposed for external use)
   * @param {string} text - Text to process
   * @returns {string} - Text with highlighted URLs
   */
  highlightUrls,

  /**
   * Raw ANSI codes for custom formatting
   */
  ANSI,

  /**
   * Agent color mapping for custom formatting
   */
  AGENT_COLORS,
};

module.exports = logger;
