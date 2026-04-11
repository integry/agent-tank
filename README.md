# Agent Tank

![Agent Tank Web UI preview](https://raw.githubusercontent.com/integry/agent-tank/main/media/www-preview.png)

Agent Tank is a local dashboard and HTTP API for monitoring usage limits in AI coding agent CLIs.

It supports:

- Claude Code
- Gemini CLI
- OpenAI Codex

## How It Gets the Data

This is the part that matters.

Agent Tank reads usage directly from the local CLI tools you already use. It launches the installed CLIs locally, runs their built-in usage commands, and parses the output into a unified web UI and JSON API.

- Claude: runs `/usage`
- Gemini: runs `/stats`
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
- Gemini CLI with supported subscription plans
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

### First Run

```bash
# Auto-discover installed agents and start the web UI + API
agent-tank
```

By default it starts on:

```text
http://127.0.0.1:3456
```

If Docker is running with a detectable local bridge interface, Agent Tank also binds that bridge address by default so containers on the same host can reach it without exposing it on the public interface.

Use this if you want localhost only:

```bash
agent-tank --no-docker
```

### Most Common Commands

```bash
# Monitor only specific agents
agent-tank --claude --gemini

# Use a custom port
agent-tank --port 8080

# Fetch once and print JSON
agent-tank --once --json

# Show the installed Agent Tank version
agent-tank --version
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
| Claude | PTY `/usage` or Anthropic OAuth API | Current session, weekly all-models, weekly Sonnet-only |
| Gemini | PTY `/stats` | Per-model usage and reset windows |
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

## Command Line Options

```text
Options:
  --claude              Enable Claude monitoring
  --gemini              Enable Gemini monitoring
  --codex               Enable Codex monitoring
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
  --auto-refresh-interval <seconds>  Auto-refresh interval in seconds (default: 60)
  --activity-debounce <ms>           Activity debounce interval in milliseconds (default: 5000)
  --keepalive           Enable/disable session keepalive (default: true)
  --keepalive-interval <seconds>     Session keepalive interval in seconds (default: 300)
  --history-retention-days <days>    Days to retain usage history (default: 14)
  --once                Fetch usage once and exit (no HTTP server)
  --json                Output pure JSON (suppress logging, use with --once)
  --help, -h            Show this help message
```

## Configuration

### Environment Variables

Environment variables override CLI flags and config file values.

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
| `AGENT_TANK_ACTIVITY_DEBOUNCE` | Activity debounce interval in milliseconds |
| `AGENT_TANK_KEEPALIVE` | Enable/disable keepalive |
| `AGENT_TANK_KEEPALIVE_INTERVAL` | Keepalive interval in seconds |
| `AGENT_TANK_HISTORY_RETENTION_DAYS` | History retention window |

### Config File

```json
{
  "claude": true,
  "gemini": true,
  "codex": false,
  "port": 8080,
  "dockerAccess": true,
  "claudeApi": false,
  "autoRefresh": {
    "mode": "activity",
    "interval": 60,
    "activityDebounce": 5000
  },
  "keepalive": {
    "enabled": true,
    "interval": 300
  },
  "history": {
    "retentionDays": 14
  }
}
```

Run with:

```bash
agent-tank -c config.json
```

## HTTP API

### Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | HTML status page |
| GET | `/status` | JSON status for all agents |
| GET | `/status/:agent` | JSON status for one agent |
| GET | `/config` | Auto-refresh and history config |
| GET | `/history` | History summary |
| GET | `/history/:agent` | History for one agent |
| POST | `/refresh` | Refresh all agents |
| POST | `/refresh/:agent` | Refresh one agent |

### Example `GET /status`

```json
{
  "claude": {
    "name": "claude",
    "usage": {
      "session": {
        "label": "Current session",
        "percent": 42,
        "resetsAt": "10pm (Europe/London)",
        "resetsIn": "12m",
        "resetsInSeconds": 764
      },
      "weeklyAll": {
        "label": "Current week (all models)",
        "percent": 31,
        "resetsAt": "Mar 13, 3am (Europe/London)",
        "resetsIn": "4d 5h",
        "resetsInSeconds": 364364
      }
    },
    "metadata": {
      "email": "user@example.com",
      "version": "2.1.71"
    },
    "lastUpdated": "2026-03-08T21:47:15.090Z",
    "error": null,
    "isRefreshing": false
  },
  "codex": {
    "name": "codex",
    "usage": {
      "fiveHour": {
        "percentUsed": 0,
        "resetsAt": "02:44 on 9 Mar",
        "resetsIn": "4h 56m",
        "resetsInSeconds": 17807
      },
      "weekly": {
        "percentUsed": 0,
        "resetsAt": "21:44 on 15 Mar",
        "resetsIn": "6d 23h",
        "resetsInSeconds": 604607
      }
    },
    "metadata": {
      "email": "user@example.com",
      "model": "gpt-5.3-codex"
    },
    "lastUpdated": "2026-03-08T21:47:12.648Z",
    "error": null,
    "isRefreshing": false
  }
}
```

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
- Gemini: `~/.config/gemini/`, `~/.gemini/`

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

Agent Tank stores usage snapshots and calculates whether a metric is being consumed faster than the time window would suggest.

You can configure retention:

```bash
agent-tank --history-retention-days 7
```

History endpoints:

- `GET /history`
- `GET /history/:agent`

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
- Gemini CLI as `gemini`
  - Version 0.24.5+ required for `/stats`
- OpenAI Codex as `codex`

Useful checks:

```bash
claude --version
gemini --version
codex --version
```

## Programmatic Usage

```javascript
const { AgentTank } = require('agent-tank');

const watcher = new AgentTank({
  agents: ['claude', 'gemini'],
  port: 3456,
  autoDiscover: true
});

await watcher.start();

const status = watcher.getStatus();
console.log(status);

await watcher.refreshAgent('claude');

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
