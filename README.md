# Agent Tank

![Agent Tank Web UI preview](https://raw.githubusercontent.com/integry/agent-tank/main/media/www-preview.png)

Agent Tank is a local dashboard and HTTP API for monitoring usage limits in AI coding agent CLIs.

It supports:

- Claude Code
- Antigravity CLI
- OpenAI Codex

## How It Gets the Data

This is the part that matters.

Agent Tank reads usage directly from the local CLI tools you already use. It launches the installed CLIs locally, runs their built-in usage commands, and parses the output into a unified web UI and JSON API.

- Claude: runs `/usage`
- Antigravity: runs `/usage`
- Codex: prefers JSON-RPC `account/rateLimits/read`, falls back to `/status`

What it does not do:

- It does not scrape provider websites
- It does not read browser cookies
- It does not depend on a logged-in browser session
- It does not MITM or inspect your network traffic
- It does not send your usage data to a remote service

If you have seen other tools built around log-file heuristics or browser-session scraping, Agent Tank is deliberately not that.

## Who It Is For

Agent Tank is meant for subscription-based coding agent products where the CLI itself exposes session or limit information.

Examples:

- Claude Code Pro / Max
- Antigravity CLI with supported subscription plans
- ChatGPT Codex with supported plans

It is not for:

- pay-as-you-go API key billing
- cost tracking for API requests
- provider billing dashboards

If you need API spend tracking, use the provider’s billing tools instead.

## Quick Start

### Install

```bash
npm install -g agent-tank
```

Or run it directly:

```bash
npx agent-tank
```

### Run from Source

If you want to run the latest code from a checkout instead of the published package:

```bash
# 1. Clone the repo
git clone https://github.com/integry/agent-tank.git
cd agent-tank

# 2. Install dependencies (compiles node-pty natively)
npm install

# 3. Run it
npm start          # = node bin/agent-tank.js
```

By default it auto-discovers installed CLIs and serves the dashboard + API at `http://127.0.0.1:3456`.

To pass flags, call the entry point directly (`npm start` does not forward arguments cleanly):

```bash
node bin/agent-tank.js --claude --codex --port 8080
node bin/agent-tank.js --once --json          # one-shot, prints JSON, no server
node bin/agent-tank.js --no-docker            # localhost only
node bin/agent-tank.js --help                 # full option list
```

Prerequisites:

- **Node.js 18+** (usage history needs **Node.js 22.5+** for the built-in `node:sqlite`; on older runtimes history is disabled with a warning)
- `node-pty` is a native module, so `npm install` needs **Python 3.8+** and **C/C++ build tools**. See [Installation Notes](#installation-notes) if the build fails.
- At least one supported CLI installed and authenticated on your `PATH` (`claude`, `agy`, or `codex`).

Other useful scripts:

```bash
npm test           # run all tests
npm run lint       # check code style
npm run rebuild    # rebuild node-pty against a detected Python
```

### First Run

```bash
# Auto-discover installed agents and start the web UI + API
agent-tank
```

By default it starts on:

```text
http://127.0.0.1:3456
```

If Docker is available, Agent Tank asks Docker for the active bridge gateway addresses and binds them by default so containers on the same host can reach it without exposing it on the public interface. If Docker is unavailable, it falls back to local bridge interface detection.

Use this if you want localhost only:

```bash
agent-tank --no-docker
```

### Most Common Commands

```bash
# Monitor only specific agents
agent-tank --claude --agy

# Use a custom port
agent-tank --port 8080

# Keep Agent Tank running after closing this terminal
agent-tank --background

# Fetch once and print JSON
agent-tank --once --json

# Show the installed Agent Tank version
agent-tank --version

# Require at least 60 seconds between refreshes for the same agent
agent-tank --refresh-cooldown 60
```

## What You Get

### Web UI

- Single-page dashboard for all supported agents
- Live refresh
- Reset countdowns
- Pace indicators
- Browser-tab tracking via title and favicon updates

### HTTP API

- `GET /status`
- `GET /status/:agent`
- `POST /refresh`
- `POST /refresh/:agent`
- `GET /config`
- `GET /history`
- `GET /history/:agent`

### Supported Metrics

| Agent | Method | Metrics |
|---|---|---|
| Claude | PTY `/usage` or Anthropic OAuth API | Current session, weekly all-models, weekly Fable allowance (Max accounts only) |
| Antigravity | PTY `/usage` | Per-model quota availability and reset windows when reported |
| Codex | JSON-RPC preferred, PTY fallback | 5-hour limits, weekly limits, model/account info |

## Basic Usage

### Auto-Discover Everything

```bash
agent-tank
```

### Monitor Specific Agents

```bash
agent-tank --claude --codex
```

### One-Shot Scripting Mode

```bash
agent-tank --once --json
```

### Background Server Mode

```bash
agent-tank --background
```

This starts Agent Tank as a detached process, prints the background PID, and exits the parent command.

### Bind to a Different Host or Port

```bash
agent-tank --host 0.0.0.0 --port 8080
```

### Disable Docker Bridge Binding

```bash
agent-tank --no-docker
```

### Disable Background Refresh

```bash
agent-tank --auto-refresh-mode none
```

### Slow Down Agent Refreshes

By default, Agent Tank will not refresh the same agent more than once every 30 seconds, even if the refresh is triggered manually or by detected CLI activity. This reduces unnecessary polling and helps avoid CLI-side rate limiting.

```bash
agent-tank --refresh-cooldown 60
```

Set it to `0` to disable the cooldown entirely.

## Command Line Options

```text
Options:
  --claude              Enable Claude monitoring
  --agy                 Enable Antigravity monitoring
  --codex               Enable Codex monitoring
  --agent <spec>        Add an account as provider[:alias][=config-path] (repeatable)
  --port <port>         HTTP server port (default: 3456)
  --host <host>         Bind address (default: 127.0.0.1 + Docker bridge when available)
  --docker              Enable Docker bridge bind when --host is omitted (default: true)
  --auth-user <user>    HTTP Basic Auth username
  --auth-pass <pass>    HTTP Basic Auth password
  --auth-token <token>  API key for Bearer token auth
  --fresh-process       Spawn a new process per refresh (default: false)
  --claude-api          Use direct Anthropic API for Claude usage (faster, 60s refresh)
  --config, -c          Path to config file (JSON)
  --version, -v         Show version
  --auto-discover       Auto-discover available agents (default: true)
  --auto-refresh        Enable/disable background auto-refresh (default: true)
  --auto-refresh-mode <mode>         Refresh mode: none, interval, activity (default: activity)
  --auto-refresh-interval <seconds>  Auto-refresh interval in seconds (default: 60, 0 = disabled)
  --refresh-cooldown <seconds>       Minimum time between refreshes per agent (default: 30, 0 = disabled)
  --activity-debounce <ms>           Activity debounce interval in milliseconds (default: 5000)
  --keepalive           Enable/disable session keepalive (default: true)
  --keepalive-interval <seconds>     Session keepalive interval in seconds (default: 300, 0 = disabled)
  --history             Enable/disable usage history recording (default: true)
  --history-db <path>   SQLite history database (default: ~/.agent-tank/history.db)
  --history-retention-days <days>    Days to retain usage history (default: 14)
  --history-chart       Show/hide the dashboard usage-history sparkline (default: true)
  --once                Fetch usage once and exit (no HTTP server)
  --json                Output pure JSON (suppress logging, use with --once)
  --background          Start Agent Tank as a detached background process
  --help, -h            Show this help message
```

## Configuration

### Environment Variables

Environment variables override CLI flags and config file values. Background mode has
three exceptions: `--no-background`, `--once`, and `--json` suppress
`AGENT_TANK_BACKGROUND=1` for that run.

| Variable | Description |
|---|---|
| `AGENT_TANK_USER` | Basic auth username |
| `AGENT_TANK_PASS` | Basic auth password |
| `AGENT_TANK_TOKEN` | Bearer token auth |
| `AGENT_TANK_HOST` | Bind address |
| `AGENT_TANK_DOCKER` | Enable/disable Docker bridge bind when `--host` is omitted |
| `AGENT_TANK_FRESH_PROCESS` | Use fresh process per refresh (`1`/`true`) |
| `AGENT_TANK_CLAUDE_API` | Use Claude API mode (`1`/`true`) |
| `AGENT_TANK_AUTO_REFRESH` | Enable/disable auto-refresh |
| `AGENT_TANK_AUTO_REFRESH_MODE` | `none`, `interval`, or `activity` |
| `AGENT_TANK_AUTO_REFRESH_INTERVAL` | Auto-refresh interval in seconds |
| `AGENT_TANK_REFRESH_COOLDOWN` | Minimum time between refreshes per agent in seconds |
| `AGENT_TANK_ACTIVITY_DEBOUNCE` | Activity debounce interval in milliseconds |
| `AGENT_TANK_KEEPALIVE` | Enable/disable keepalive |
| `AGENT_TANK_KEEPALIVE_INTERVAL` | Keepalive interval in seconds |
| `AGENT_TANK_HISTORY` | Enable/disable usage history (`1`/`true` or `0`/`false`) |
| `AGENT_TANK_HISTORY_DB` | SQLite history database path |
| `AGENT_TANK_HISTORY_RETENTION_DAYS` | History retention window |
| `AGENT_TANK_HISTORY_CHART` | Show/hide the dashboard usage-history sparkline (`1`/`true` or `0`/`false`) |
| `AGENT_TANK_BACKGROUND` | Start as a detached background process (`1`/`true`) |
| `AGENT_TANK_BACKGROUND_LOG` | Background child stdout/stderr log path (defaults to a temp file) |
| `AGENT_TANK_BACKGROUND_GRACE_MS` | Parent startup grace period before reporting background success; success means the child survived this period |

### Config File

Use the `agents` array to monitor multiple accounts, including multiple accounts
from the same provider. Each entry accepts a `provider`, an optional unique `id`
and display `alias`, and an optional `configPath` directory:

```json
{
  "agents": [
    {
      "provider": "codex",
      "id": "work",
      "alias": "Work",
      "configPath": "/srv/accounts/codex-work"
    },
    {
      "provider": "codex",
      "id": "personal",
      "alias": "Personal",
      "configPath": "/srv/accounts/codex-personal"
    },
    {
      "provider": "claude",
      "id": "client-a",
      "alias": "Client A",
      "configPath": "./accounts/claude-client-a"
    }
  ],
  "port": 8080,
  "dockerAccess": true,
  "claudeApi": false,
  "refreshCooldown": 30,
  "autoRefresh": {
    "mode": "activity",
    "interval": 60,
    "activityDebounce": 5000,
    "refreshCooldown": 30
  },
  "keepalive": {
    "enabled": true,
    "interval": 300
  },
  "history": {
    "enabled": true,
    "dbPath": "~/.agent-tank/history.db",
    "retentionDays": 14,
    "chart": true
  },
  "contextWindows": {
    "gpt-6-astra": 300000
  }
}
```

`contextWindows` adds entries to, or corrects, the built-in table of known model
context windows (see `context_window` under [Example `GET /status`](#example-get-status)).
Keys are matched against the model name the CLI reports, case-insensitively and
ignoring spaces, dots, underscores and hyphens, longest key first. A Claude
display name without the `claude-` prefix, such as `Opus 5.5`, is matched as
`claude-opus-5-5`. Values are token counts.

Relative account paths are resolved relative to the JSON config file, and `~/`
paths are expanded to the current user's home directory. The path
is passed to the provider CLI as its config home: `CLAUDE_CONFIG_DIR` for Claude,
`CODEX_HOME` for Codex, and `GEMINI_CLI_HOME` for Antigravity. Legacy top-level
settings such as `"claude": true` remain supported for single default accounts.

Run with:

```bash
agent-tank -c config.json
```

The same setup can be supplied directly on the command line. Repeat `--agent`
once per account:

```bash
agent-tank \
  --agent codex:work=/srv/accounts/codex-work \
  --agent codex:personal=/srv/accounts/codex-personal
```

The `id` (or CLI alias after `:`) is the key returned by `/status` and is used
by account-specific status, history, and refresh endpoints. IDs may contain
letters, numbers, dots, underscores, and hyphens. If both `id` and `alias` are
set in JSON, `id` is the API key and `alias` is the dashboard label.

## Antigravity

Antigravity support uses the `agy` CLI and reads the interactive `/usage` output.

In `--once` mode, Agent Tank prints the result and exits immediately after the output is flushed.

Examples:

```bash
agent-tank --agy
agent-tank --agy --once --json
```

Each entry in `usage.models` reports the quota left, the countdown Antigravity
displays (`Resets in` on older builds, `Refreshes in` on the grouped
`Models & Quota` screen), the absolute instant that countdown points at, and the
cycle the limit belongs to. A limit showing `Quota available` has no pending
reset, so its reset fields are `null`.

```json
{
  "model": "Gemini · Five Hour Limit Remaining",
  "usageLeft": 90.31,
  "percentUsed": 9.7,
  "resetsIn": "58m",
  "resetsInSeconds": 3480,
  "resetsAt": "2026-09-23T11:52:00.000Z",
  "cycle": "fiveHour",
  "group": "Gemini"
}
```

Limits are grouped by the section they appear under (`GEMINI MODELS`,
`CLAUDE AND GPT MODELS`, …), and shared labels such as `Weekly Limit` are
qualified with their group. Antigravity 1.3.x also reports **Gemini 4 Argon** as
a separate quota pool under a `GEMINI 4 ARGON` header. It is reported as its own
weekly limit with `group: "Gemini 4 Argon"`, so `GET /status` returns it as a
`weekly` window with `model: "Gemini 4 Argon"`:

```json
{
  "model": "Gemini 4 Argon Weekly Limit",
  "usageLeft": 98.23,
  "percentUsed": 1.8,
  "resetsIn": "158h 44m",
  "resetsInSeconds": 571440,
  "resetsAt": "2026-10-24T00:44:00.000Z",
  "cycle": "weekly",
  "group": "Gemini 4 Argon"
}
```

Section descriptions (such as Argon's "For paid Pro plans, …" note) and rows
without a percentage (such as a `Disabled: …` five-hour limit after the weekly
limit is hit) are not reported as limits. Argon's context window is not yet
published, so when the CLI banner names `Gemini 4 Argon` as the active model the
account's `context_window` is `null` unless you set it with the `contextWindows`
config key (e.g. `{ "gemini-4-argon": 1048576 }`, reported as `source: "override"`).

## HTTP API

### Endpoints

Upgrading from 0.9.x? The response shapes changed; see
[Upgrading from 0.9.x](#upgrading-from-09x).

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | HTML status page |
| GET | `/status` | Canonical usage for all agents (`{ "providers": [...] }`) |
| GET | `/status/:id` | Canonical usage for one configured account |
| GET | `/config` | Auto-refresh and history config |
| GET | `/history` | History summary, including the backend (`store`: `sqlite` or `none`) |
| GET | `/history/:id` | Metric series for one configured account (`?since=`, `?until=`, `?metric=`, `?view=chart`) |
| POST | `/refresh` | Refresh all agents; returns `{ "success": true, "providers": [...] }` |
| POST | `/refresh/:id` | Refresh one configured account; returns `{ "success": true, "provider": {...} }` |

### Example `GET /status`

Every provider returns the same canonical shape. Limits are a `windows` list
(`type` is one of `session`, `five_hour`, `weekly`), all resets are ISO 8601,
and `pace` is `null` when there is no pace signal. Percentages are rounded to
two decimals, and `remaining_percent` is always `100 - used_percent`, so the two
add up to 100 (Antigravity's reported remaining percentage is kept as-is and
`used_percent` is derived from it). The untouched per-agent
payload is kept under `raw` (abbreviated below). Antigravity limits reporting
"Quota available" are kept with `resets_at`/`resets_in_seconds` set to `null`.

- `model` names the model (or model group) a window is specific to, such as
  `"Fable"` or `"GPT-5.3-Codex-Spark"`, and is `null` for windows covering all
  models. Use it to tell apart windows that share a `type`. Antigravity's
  grouped limits use the group name, so `"Gemini · Weekly Limit Remaining"` and
  `"Gemini · Five Hour Limit Remaining"` both have `model: "Gemini"` (the
  qualified name stays in `label`).
- `used_percent` and `remaining_percent` are clamped to the 0–100 range, even
  if a vendor reports something like 102% used.
- `status` is `"refreshing"` while a refresh is running and `"error"` when the
  last refresh failed, even if `windows` still holds cached usage from an
  earlier refresh. It is `"pending"` before the first refresh and `"ok"`
  otherwise.
- Claude's extra usage is a spend budget, not a rate-limit window, so it isn't
  in `windows`. It is still available under `raw.usage.extraUsage`.
- `last_updated` is when the usage in `windows` was captured. A refresh that
  fails but keeps the cached usage does not move it (or the reset times); the
  failure is reported through `status: "error"` and `error`.
- `plan` comes from the plan the CLI reports, lowercased: the Codex plan type
  (`"plus"`), Claude's `/status` login method (`"max"`), or the plan shown next
  to the account in Antigravity's startup banner (`"google ai pro"`). If Claude
  doesn't report a plan, it falls back to `"max"` when a weekly Fable window is
  present, and `null` otherwise.
- `context_window` is a best-effort model context window, or `null` when
  unknown. `source` says where it came from: `"cli"` when the CLI reported it
  (Codex `/status` or its app-server), `"override"` when it came from the
  `contextWindows` config key, or `"known-model"` when the reported model
  (e.g. `claude-opus-5-5`) matched Agent Tank's built-in table. Only `"cli"`
  values carry `used_tokens` and the percentages; looked-up values report the
  size only, with `used_tokens`, `used_percent` and `remaining_percent` set to
  `null`.
- `credits` is the Codex credit balance (`{ "remaining": 48405, "unit": "credits" }`),
  and `null` for other providers or when Codex doesn't report one. It is a
  balance, not a time window, so it isn't in `windows`. Claude's extra usage is
  a dollar budget, not credits, and stays under `raw.usage.extraUsage`.

```json
{
  "providers": [
    {
      "id": "claude",
      "provider": "claude",
      "plan": "max",
      "status": "ok",
      "last_updated": "2026-10-03T19:59:00.000Z",
      "error": null,
      "windows": [
        {
          "type": "session",
          "label": "Current session",
          "model": null,
          "used_percent": 42,
          "remaining_percent": 58,
          "resets_at": "2026-10-03T21:19:00.000Z",
          "resets_in_seconds": 4740,
          "pace": { "ratio": 0.8, "burning_fast": false }
        },
        {
          "type": "weekly",
          "label": "Current week (all models)",
          "model": null,
          "used_percent": 31,
          "remaining_percent": 69,
          "resets_at": "2026-10-08T01:11:44.000Z",
          "resets_in_seconds": 364304,
          "pace": { "ratio": 1.1, "burning_fast": true }
        },
        {
          "type": "weekly",
          "label": "Current week (Fable)",
          "model": "Fable",
          "used_percent": 82,
          "remaining_percent": 18,
          "resets_at": "2026-10-08T01:11:44.000Z",
          "resets_in_seconds": 364304,
          "pace": { "ratio": 2.91, "burning_fast": true }
        }
      ],
      "context_window": {
        "total_tokens": 1000000,
        "used_tokens": null,
        "used_percent": null,
        "remaining_percent": null,
        "model": "claude-opus-5-5",
        "source": "known-model"
      },
      "credits": null,
      "raw": { "name": "claude", "usage": { "session": { "percent": 42, "resetsAt": "12:20am (Europe/Berlin)" } } }
    },
    {
      "id": "codex",
      "provider": "codex",
      "plan": "plus",
      "status": "ok",
      "last_updated": "2026-10-03T19:59:00.000Z",
      "error": null,
      "windows": [
        {
          "type": "weekly",
          "label": "Weekly limit",
          "model": null,
          "used_percent": 12,
          "remaining_percent": 88,
          "resets_at": "2026-10-10T19:45:40.000Z",
          "resets_in_seconds": 603940,
          "pace": null
        }
      ],
      "context_window": {
        "total_tokens": 258000,
        "used_tokens": 198000,
        "used_percent": 76.74,
        "remaining_percent": 23.26,
        "model": "GPT-6-Astra",
        "source": "cli"
      },
      "credits": { "remaining": 48405, "unit": "credits" },
      "raw": { "name": "codex", "usage": { "fiveHour": null, "weekly": { "percentUsed": 12, "resetsAt": 1791661540 } } }
    }
  ]
}
```

## Upgrading from 0.9.x

0.10.0 changes the shape of every usage response and the history backend.
If you consume the HTTP API, `--once --json`, or the `AgentTank` class, check
the following before upgrading.

### Usage responses use one canonical shape

Every provider now returns the same object (see
[Example `GET /status`](#example-get-status)). The previous per-provider
payload is still available, unchanged, under each provider's `raw` field.

| Call | 0.9.x | 0.10.0 |
|---|---|---|
| `GET /status`, `--once --json` | `{ "claude": {...}, "codex": {...} }` | `{ "providers": [ {...}, {...} ] }` |
| `GET /status/:id` | raw agent payload | one canonical provider object |
| `POST /refresh` | `{ "success": true, "status": {...} }` | `{ "success": true, "providers": [...] }` |
| `POST /refresh/:id` | `{ "success": true, "status": {...} }` | `{ "success": true, "provider": {...} }` |

Reading a five-hour limit, before and after:

```javascript
// 0.9.x
const res = await fetch('http://127.0.0.1:3456/status').then(r => r.json());
const used = res.codex.usage.fiveHour.percentUsed;

// 0.10.0
const { providers } = await fetch('http://127.0.0.1:3456/status').then(r => r.json());
const codex = providers.find(p => p.id === 'codex');
const used = codex.windows.find(w => w.type === 'five_hour')?.used_percent;
// The 0.9.x payload is still there if you need it:
const legacyUsed = codex.raw.usage.fiveHour.percentUsed;
```

Notable differences in the canonical shape:

- Reset times are always ISO 8601 in `resets_at` (Codex's raw `resetsAt` stays
  in epoch seconds, Claude's stays a display string).
- Accounts are identified by `id` (the alias for multi-account setups) and
  `provider`; Antigravity's `provider` is `"antigravity"`.
- New fields: `plan`, `context_window`, `credits`, and `pace` per window.
- `last_updated` is when usage was last captured. A failed refresh that keeps
  cached usage no longer moves it.

In the `AgentTank` class, `getStatus()` and `getAgentStatus(id)` still return
the raw payloads. Use `getNormalizedStatus()` and `getNormalizedAgentStatus(id)`
for the canonical shape.

### History moved to SQLite

- `~/.agent-tank/history.json` is no longer read or written, and its contents
  are **not migrated**. History starts empty in `~/.agent-tank/history.db`
  (change it with `--history-db`). You can delete the old JSON file.
- History needs **Node.js 22.5+** (`node:sqlite`). On older Node versions
  Agent Tank still runs, logs one warning, and reports `store: "none"`.
- `GET /history/:id` now returns `{ agent, store, retention_days, series }`
  with one series per metric, instead of a list of snapshots. See
  [Usage History and Pace](#usage-history-and-pace).
- `GET /config` reports history as
  `history: { enabled, store, path, retentionDays, chart }`.
- Call `watcher.stop()` when you're done with the `AgentTank` class, so
  the history database is closed.

## Claude API Mode

By default, Claude usage is collected via PTY by running `/usage`.

With `--claude-api`, Agent Tank uses the Anthropic OAuth usage API instead. This is usually faster and supports a shorter refresh interval.

```bash
agent-tank --claude --claude-api
```

How it works:

- reads the same Claude OAuth credentials the CLI already uses
- calls `https://api.anthropic.com/api/oauth/usage`
- refreshes expired OAuth tokens when needed
- falls back to PTY mode if the API path fails

You can also enable it with:

```bash
AGENT_TANK_CLAUDE_API=1 agent-tank --claude
```

## Auto-Refresh Modes

Agent Tank supports three refresh strategies:

| Mode | Description |
|---|---|
| `activity` | Default. Watches known local agent directories and refreshes when activity is detected |
| `interval` | Refreshes on a fixed timer |
| `none` | No background refresh. Use manual refresh only |

Examples:

```bash
# Default mode
agent-tank

# Interval polling
agent-tank --auto-refresh-mode interval

# Manual-only mode
agent-tank --auto-refresh-mode none

# Longer activity debounce
agent-tank --activity-debounce 10000
```

### Activity-Based Polling

In activity mode, Agent Tank watches common local directories:

- Claude: `~/.config/claude/projects/`, `~/.claude/`
- Codex: `~/.codex/sessions/`, `~/.codex/`
- Antigravity: `~/.gemini/antigravity-cli/`

If no suitable directories are found, it falls back to interval mode.

## Session Keepalive

Keepalive helps persistent PTY-backed sessions stay warm.

```bash
# Default keepalive
agent-tank

# Every 10 minutes
agent-tank --keepalive-interval 600

# Disable keepalive
agent-tank --no-keepalive
```

Notes:

- disabled automatically in `--fresh-process`
- disabled automatically in `--once`
- not needed for Codex JSON-RPC mode

## Usage History and Pace

Agent Tank records usage history and calculates whether a metric is being consumed faster than the time window would suggest.

History is stored in SQLite at `~/.agent-tank/history.db`, using Node's built-in
`node:sqlite` (no extra dependency). Each refresh writes **one row per metric**
to the `usage_metrics` table:

| Column | Description |
|---|---|
| `agent_id` | Configured account id (e.g. `claude`, `work`) |
| `provider` | Provider key (`claude`, `agy`, `codex`) |
| `metric_key` | Stable series id, e.g. `session`, `weeklyAll`, `fiveHour`, `model:Gemini · Weekly Limit`, `GPT-5.3-Codex-Spark:fiveHour`; Codex also records `contextUsedPercent` (context window utilisation) and `credits` (credit balance) |
| `metric_label` | Human-readable label (may change without forking the series) |
| `model`, `cycle` | Model (group) the limit applies to, and `session` / `five_hour` / `weekly` |
| `percent_used` | Always percent **used**, including for Antigravity |
| `value`, `unit` | Non-percentage metrics such as the Codex credit balance (`unit: credits`); `unit` is `percent` for percentage rows |
| `recorded_at`, `recorded_at_ms` | Capture time as ISO 8601 and epoch milliseconds |

A series needs no application code:

```bash
sqlite3 ~/.agent-tank/history.db \
  "SELECT recorded_at, percent_used FROM usage_metrics
   WHERE agent_id='work' AND metric_key='weekly' ORDER BY recorded_at_ms"
```

Options:

```bash
agent-tank --history-retention-days 7   # delete rows older than 7 days on write
agent-tank --history-db /tmp/at.db      # use a different database file
agent-tank --no-history                 # disable history recording
agent-tank --no-history-chart           # keep recording, hide the dashboard sparkline
```

`node:sqlite` requires Node.js 22.5+. On older runtimes Agent Tank logs one
warning at startup, keeps running without history, and reports
`"store": "none"` on `GET /config` and `GET /history`. The same is reported
when history is disabled with `--no-history`.

History endpoints:

- `GET /history` returns per-account row counts, the database path and `store`
- `GET /history/:id` returns `{ "agent", "store", "retention_days", "series": [{ "key", "label", "model", "cycle", "unit", "points": [{ "t", "percent", "value" }] }] }`;
  filter with `since` / `until` (ISO 8601 or epoch ms) and `metric` (a `metric_key`).
  `series` is `[]` for an account with no recorded metrics
- `GET /history/:id?view=chart` returns the same envelope with only plottable
  series (percent units with at least two points), each point reduced to `{ "t", "percent" }`:

```json
{
  "agent": "work",
  "store": "sqlite",
  "retention_days": 14,
  "series": [
    {
      "key": "weekly",
      "label": "Weekly",
      "model": null,
      "cycle": "weekly",
      "points": [{ "t": "2026-10-16T08:00:00.000Z", "percent": 12 }, { "t": "2026-10-16T09:00:00.000Z", "percent": 15 }]
    }
  ]
}
```

`percent` is always percent **used**.

### Dashboard sparkline

Each agent card on the status page shows a sparkline of its usage history, one
line per tracked metric on a fixed 0–100% scale, with a legend that shows each
metric's latest value (hover the chart to read values at an earlier time). The
chart is redrawn after every auto-refresh poll and after a card's refresh
button, without reloading the page. Until a metric has at least two recorded
points the card shows "Not enough history yet".

The sparkline is on by default. Hide it with `--no-history-chart`,
`AGENT_TANK_HISTORY_CHART=0` or `"history": { "chart": false }`; `GET /config`
reports the effective setting as `history.chart`. When recording is off
(`--no-history`, or `store: "none"` on runtimes without `node:sqlite`) the chart
is never rendered and `history.chart` is `false`.

## Installation Notes

### Build Requirements

`node-pty` requires native compilation support.

You need:

- Python 3.8+
- C/C++ build tools
- Node.js development headers

#### Ubuntu / Debian

```bash
sudo apt-get install python3.11 python3.11-dev build-essential nodejs-dev
```

#### Fedora / RHEL / CentOS

```bash
sudo dnf install python3.11 python3.11-devel gcc gcc-c++ make nodejs-devel
```

#### openSUSE

```bash
sudo zypper install python311 python311-devel gcc gcc-c++ make nodejs20-devel
```

#### macOS

```bash
xcode-select --install
brew install python@3.11
```

#### Windows

- Install [Python 3.11+](https://www.python.org/downloads/)
- Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)

## CLI Requirements

You need at least one supported CLI installed and authenticated.

- [Claude Code](https://claude.ai/download) as `claude`
  - Version 2.0+ required for `/usage`
- Antigravity CLI as `agy`
  - `/usage` command support required
- OpenAI Codex as `codex`

Useful checks:

```bash
claude --version
agy --version
codex --version
```

## Programmatic Usage

```javascript
const { AgentTank } = require('agent-tank');

const watcher = new AgentTank({
  agents: [
    { provider: 'codex', id: 'work', configPath: '/srv/accounts/codex-work' },
    { provider: 'codex', id: 'personal', configPath: '/srv/accounts/codex-personal' },
    'agy'
  ],
  port: 3456,
  autoDiscover: true
});

await watcher.start();

// Canonical shape shared by every provider (same as GET /status)
const { providers } = watcher.getNormalizedStatus();
for (const { id, provider, windows } of providers) {
  for (const w of windows) {
    console.log(`${id} (${provider}) ${w.label}: ${w.used_percent}% used, resets ${w.resets_at}`);
  }
}

await watcher.refreshAgent('work');
// One configured account (same as GET /status/work), or null if unknown
console.log(watcher.getNormalizedAgentStatus('work'));

// Raw per-provider payloads are still available
console.log(watcher.getStatus());

watcher.stop();
```

## Troubleshooting

### `gyp ERR!` during install

This usually means your system is missing Python, compiler tools, or Node headers.

Try:

```bash
PYTHON=/usr/bin/python3.11 npm install
npm run rebuild
```

### `Timeout waiting for usage data`

- make sure the CLI works on its own
- make sure the CLI is authenticated
- check for trust prompts, auth prompts, or update prompts
- try `--fresh-process`
- try disabling keepalive or background refresh while debugging

### `context_window` or `plan` is `null`

`context_window` needs the model the CLI is using. Claude reports it on
`/status` and Antigravity in its startup banner; both are read once, on the
first refresh. It is `null` when:

- the CLI didn't report a model (check `raw.metadata.model`), or
- the model isn't in Agent Tank's built-in table (for example Gemini 4 Argon,
  whose window isn't published yet).

Add or correct a size with the `contextWindows` config key, for example
`{ "contextWindows": { "gemini-4-argon": 1048576 } }`; it is then reported with
`source: "override"`. Codex reports its own context window only while it has
an active session, so it is often `null` from a fresh `codex` process.

`plan` is `null` when the CLI doesn't show one, such as an Antigravity account
without a plan next to its email.

### No agents found

Make sure at least one supported CLI is installed and on your `PATH`.

### Port already in use

```bash
agent-tank --port 8080
```

## Community

[r/agenttank](https://www.reddit.com/r/agenttank)

## Author

[Rinalds Uzkalns](https://propr.dev)

## License

MIT

## Contributing

Pull requests are welcome.
