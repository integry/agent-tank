/* eslint-disable complexity -- Validation keeps all supported agent config forms in one place. */

const path = require('node:path');
const os = require('node:os');

const SUPPORTED_PROVIDERS = new Set(['claude', 'agy', 'codex']);
const AGENT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function resolveConfigPath(configPath, baseDir) {
  if (configPath === '~') return os.homedir();
  if (configPath.startsWith('~/') || configPath.startsWith('~\\')) {
    return path.resolve(os.homedir(), configPath.slice(2));
  }
  return path.resolve(baseDir, configPath);
}

function parseAgentOption(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Agent option must be a non-empty string');
  }

  const equalsIndex = value.indexOf('=');
  const identity = (equalsIndex === -1 ? value : value.slice(0, equalsIndex)).trim();
  const configPath = equalsIndex === -1 ? null : value.slice(equalsIndex + 1).trim();
  const colonIndex = identity.indexOf(':');
  const provider = (colonIndex === -1 ? identity : identity.slice(0, colonIndex)).trim();
  const alias = colonIndex === -1 ? null : identity.slice(colonIndex + 1).trim();

  if (equalsIndex !== -1 && !configPath) {
    throw new Error(`Agent option "${value}" has an empty config path`);
  }
  if (colonIndex !== -1 && !alias) {
    throw new Error(`Agent option "${value}" has an empty alias`);
  }

  return {
    provider,
    ...(alias && { id: alias, alias }),
    ...(configPath && { configPath }),
  };
}

function normalizeAgentSpec(entry, baseDir) {
  const raw = typeof entry === 'string' ? { provider: entry } : entry;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Each agent must be a provider name or an agent configuration object');
  }

  const provider = String(raw.provider || raw.name || '').trim().toLowerCase();
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(`Unsupported agent provider: ${provider || '(missing)'}`);
  }

  const explicitId = raw.id == null ? null : String(raw.id).trim();
  const alias = raw.alias == null ? null : String(raw.alias).trim();
  const id = explicitId || alias || provider;
  if (!AGENT_ID_PATTERN.test(id)) {
    throw new Error(`Invalid agent id "${id}"; use letters, numbers, dots, underscores, or hyphens`);
  }
  if (raw.alias != null && !alias) {
    throw new Error(`Alias for agent "${id}" must not be empty`);
  }

  const rawConfigPath = raw.configPath ?? raw.path ?? null;
  let configPath = null;
  if (rawConfigPath != null) {
    if (typeof rawConfigPath !== 'string' || !rawConfigPath.trim()) {
      throw new Error(`Config path for agent "${id}" must be a non-empty string`);
    }
    configPath = resolveConfigPath(rawConfigPath.trim(), baseDir);
  }

  return {
    provider,
    id,
    alias: alias || (id !== provider ? id : null),
    configPath,
  };
}

function normalizeAgentSpecs(entries, options = {}) {
  if (!Array.isArray(entries)) {
    throw new Error('agents must be an array');
  }

  const baseDir = options.baseDir || process.cwd();
  const normalized = entries.map(entry => normalizeAgentSpec(entry, baseDir));
  const ids = new Set();

  for (const spec of normalized) {
    if (ids.has(spec.id)) {
      throw new Error(`Duplicate agent id "${spec.id}"; give each account a unique id or alias`);
    }
    ids.add(spec.id);
  }

  return normalized;
}

module.exports = {
  AGENT_ID_PATTERN,
  SUPPORTED_PROVIDERS,
  normalizeAgentSpecs,
  parseAgentOption,
};
