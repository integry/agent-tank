# llm-limit-watcher

Monitor and query usage limits for LLM CLI tools (Claude, Gemini, Codex) via a simple HTTP API.

## Features

- **Auto-discovery** - Automatically detects installed LLM CLI tools
- **HTTP API** - Query usage limits via REST endpoints
- **Status page** - Built-in HTML dashboard
- **Lightweight** - Single dependency (node-pty)
- **Multi-agent** - Monitor Claude, Gemini, and Codex simultaneously

## Installation

```bash
npm install -g llm-limit-watcher
```

Or run directly with npx:

```bash
npx llm-limit-watcher
```

## Prerequisites

You need at least one of these CLI tools installed and authenticated:

- [Claude Code](https://claude.ai/download) (`claude`)
- [Gemini CLI](https://github.com/anthropics/gemini-cli) (`gemini`)
- [OpenAI Codex](https://platform.openai.com/docs/codex) (`codex`)

## Usage

### Basic Usage

```bash
# Auto-discover and monitor all available LLM agents
llm-limit-watcher

# Monitor specific agents only
llm-limit-watcher --claude --gemini

# Use a custom port (default: 3456)
llm-limit-watcher --port 8080
```

### Command Line Options

```
Options:
  --claude          Enable Claude monitoring
  --gemini          Enable Gemini monitoring
  --codex           Enable Codex monitoring
  --port <port>     HTTP server port (default: 3456)
  --config, -c      Path to config file (JSON)
  --auto-discover   Auto-discover available agents (default: true)
  --help, -h        Show help message
```

### Configuration File

You can use a JSON configuration file:

```json
{
  "claude": true,
  "gemini": true,
  "codex": false,
  "port": 8080
}
```

```bash
llm-limit-watcher -c config.json
```

## HTTP API

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | HTML status page |
| GET | `/status` | JSON status for all agents |
| GET | `/status/:agent` | JSON status for specific agent |
| POST | `/refresh` | Refresh all agents |
| POST | `/refresh/:agent` | Refresh specific agent |

### Example Responses

#### GET /status

```json
{
  "claude": {
    "name": "claude",
    "usage": {
      "session": { "percent": 45, "label": "Current session" },
      "weeklyAll": { "percent": 30, "label": "Current week (all models)" },
      "weeklySonnet": { "percent": 10, "label": "Current week (Sonnet only)" },
      "resets": ["Jan 22, 2pm (Europe/Berlin)"]
    },
    "lastUpdated": "2024-01-20T10:30:00.000Z",
    "error": null,
    "isRefreshing": false
  },
  "gemini": {
    "name": "gemini",
    "usage": {
      "models": [
        { "model": "gemini-2.5-flash", "usageLeft": 90.5, "resetsIn": "3h 26m" },
        { "model": "gemini-2.5-pro", "usageLeft": 85.2, "resetsIn": "3h 29m" }
      ]
    },
    "lastUpdated": "2024-01-20T10:30:05.000Z",
    "error": null,
    "isRefreshing": false
  },
  "codex": {
    "name": "codex",
    "usage": {
      "fiveHour": { "percentLeft": 100, "resetsAt": "20:34", "label": "5h limit" },
      "weekly": { "percentLeft": 50, "resetsAt": "17:32", "label": "Weekly limit" },
      "model": "gpt-5.2-codex"
    },
    "lastUpdated": "2024-01-20T10:30:10.000Z",
    "error": null,
    "isRefreshing": false
  }
}
```

#### GET /status/claude

```json
{
  "name": "claude",
  "usage": {
    "session": { "percent": 45, "label": "Current session" },
    "weeklyAll": { "percent": 30, "label": "Current week (all models)" },
    "weeklySonnet": { "percent": 10, "label": "Current week (Sonnet only)" }
  },
  "lastUpdated": "2024-01-20T10:30:00.000Z",
  "error": null,
  "isRefreshing": false
}
```

## Programmatic Usage

```javascript
const { LLMWatcher } = require('llm-limit-watcher');

const watcher = new LLMWatcher({
  agents: ['claude', 'gemini'], // or null for auto-discover
  port: 3456,
  autoDiscover: true
});

await watcher.start();

// Get status programmatically
const status = watcher.getStatus();
console.log(status.claude.usage);

// Refresh a specific agent
await watcher.refreshAgent('claude');

// Stop the server
watcher.stop();
```

## How It Works

The watcher spawns each CLI tool in a pseudo-terminal (PTY), sends the appropriate usage command (`/usage`, `/stats`, or `/status`), parses the output, and exposes the data via HTTP.

### Supported Commands

| Agent | Command | Output |
|-------|---------|--------|
| Claude | `/usage` | Session %, Weekly % |
| Gemini | `/stats` | Model-specific usage % |
| Codex | `/status` | 5h limit %, Weekly % |

## Troubleshooting

### Agent shows "Timeout waiting for usage data"

- Ensure the CLI tool is properly authenticated
- Try running the CLI tool manually to verify it works
- Check if there are any prompts requiring user input

### Codex fails with cursor position error

This is handled automatically. If you still see issues, ensure your terminal supports standard escape sequences.

### Port already in use

```bash
llm-limit-watcher --port 8080
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
