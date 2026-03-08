# Agent Tank

Monitor and query usage limits for LLM CLI tools (Claude, Gemini, Codex) via a simple HTTP API.

> **Note:** Agent Tank is designed for **AI coding agent subscriptions** such as Claude Code Pro/Max, Google Gemini CLI (with Advanced/Max plans), and ChatGPT Codex (with Plus/Pro plans). It tracks **active session and rate limit usage**—not API key consumption or pay-per-use billing. If you're using API keys with pay-as-you-go pricing, this tool won't help you track costs; check your provider's billing dashboard instead.

## Features

- **Privacy-first** - Runs entirely locally with no external data transmission
- **Auto-discovery** - Automatically detects installed LLM CLI tools
- **HTTP API** - Query usage limits via REST endpoints
- **Status page** - Built-in HTML dashboard
- **Unified Web UI** - All-in-one dashboard showing Claude, Gemini, and Codex usage at a glance
- **Instant Tab Tracking** - Pin the dashboard to your browser tab and see live usage updates via favicon and title changes
- **Lightweight** - Single dependency (node-pty)
- **Multi-agent** - Monitor Claude, Gemini, and Codex simultaneously
- **Secure by design** - No browser cookies, web scraping, or credential access

## Installation

```bash
npm install -g agent-tank
```

Or run directly with npx:

```bash
npx agent-tank
```

## Usage

### Basic Usage

```bash
# Auto-discover and monitor all available LLM agents
agent-tank

# Monitor specific agents only
agent-tank --claude --gemini

# Use a custom port (default: 3456)
agent-tank --port 8080
```

### Command Line Options

```
Options:
  --claude              Enable Claude monitoring
  --gemini              Enable Gemini monitoring
  --codex               Enable Codex monitoring
  --port <port>         HTTP server port (default: 3456)
  --host <host>         Bind address (default: 127.0.0.1)
  --auth-user <user>    HTTP Basic Auth username
  --auth-pass <pass>    HTTP Basic Auth password
  --auth-token <token>  API key for Bearer token auth
  --fresh-process       Spawn a new process per refresh (default: false)
  --config, -c          Path to config file (JSON)
  --auto-discover       Auto-discover available agents (default: true)
  --auto-refresh        Enable/disable background auto-refresh (default: true)
  --auto-refresh-interval <seconds>  Auto-refresh interval in seconds (default: 60)
  --help, -h            Show this help message
```

### Environment Variables

Environment variables override CLI flags and config file settings:

| Variable | Description |
|----------|-------------|
| `AGENT_TANK_USER` | Basic auth username (overrides `--auth-user`) |
| `AGENT_TANK_PASS` | Basic auth password (overrides `--auth-pass`) |
| `AGENT_TANK_TOKEN` | API key (overrides `--auth-token`) |
| `AGENT_TANK_HOST` | Bind address (overrides `--host`) |
| `AGENT_TANK_FRESH_PROCESS` | Use fresh process per refresh (`1` or `true`) |
| `AGENT_TANK_AUTO_REFRESH` | Enable/disable background auto-refresh (`1`/`true` or `0`/`false`) |
| `AGENT_TANK_AUTO_REFRESH_INTERVAL` | Auto-refresh interval in seconds |

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
agent-tank -c config.json
```

## HTTP API

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | HTML status page |
| GET | `/status` | JSON status for all agents |
| GET | `/status/:agent` | JSON status for specific agent |
| GET | `/config` | Auto-refresh configuration (JSON) |
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

## Developer & Advanced Setup

### Prerequisites

#### Build Requirements

The `node-pty` dependency requires native compilation. You'll need:

- **Python 3.8+** (Python 3.11 recommended)
- **C++ build tools** (gcc, g++, make)
- **Node.js development headers**

##### Linux (Ubuntu/Debian)
```bash
sudo apt-get install python3.11 python3.11-dev build-essential nodejs-dev
```

##### Linux (Fedora/RHEL/CentOS)
```bash
sudo dnf install python3.11 python3.11-devel gcc gcc-c++ make nodejs-devel
```

##### Linux (openSUSE)
```bash
sudo zypper install python311 python311-devel gcc gcc-c++ make nodejs20-devel
```

##### macOS
```bash
# Install Xcode Command Line Tools if not already installed
xcode-select --install

# Install Python 3.11
brew install python@3.11
```

##### Windows
- Install [Python 3.11+](https://www.python.org/downloads/)
- Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)

#### LLM CLI Tools

You need at least one of these CLI tools installed and authenticated:

- [Claude Code](https://claude.ai/download) (`claude`) - **Version 2.0+ required** for `/usage` command support
- [Gemini CLI](https://github.com/anthropics/gemini-cli) (`gemini`) - **Version 0.24.5+ required** for `/stats` command support
- [OpenAI Codex](https://platform.openai.com/docs/codex) (`codex`)

**Version Requirements:**

**Claude Code:** Version 1.x does not support the `/usage` command.
```bash
# Check version
claude --version

# Update to latest
npm update -g @anthropic-ai/claude-code
```

**Gemini CLI:** Version 0.24.4 and below do not support the `/stats` command properly.
```bash
# Check version
gemini --version

# Update to latest
npm update -g gemini
```

### Programmatic Usage

```javascript
const { AgentTank } = require('agent-tank');

const watcher = new AgentTank({
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

### How It Works: Privacy-First Local Execution

Agent Tank is designed with privacy and security as core principles. Understanding how it collects usage data is essential for users evaluating the tool's security posture.

#### Local PTY-Based Architecture

The tool operates entirely on your local machine by spawning instances of LLM CLI tools within a pseudo-terminal (PTY). This approach is functionally equivalent to you opening a terminal window and typing commands yourself—Agent Tank simply automates this process.

Here's what happens when Agent Tank queries your usage:

1. **Spawns a local PTY** - Creates a pseudo-terminal session on your machine
2. **Launches the CLI tool** - Starts the authenticated CLI (e.g., `claude`, `gemini`, or `codex`)
3. **Sends usage commands** - Types the appropriate command (`/usage`, `/stats`, or `/status`)
4. **Parses the output** - Reads and structures the text response from the terminal
5. **Exposes via local HTTP** - Makes the parsed data available through a localhost API

#### What Agent Tank Does NOT Do

To be explicit about what this tool avoids:

- **No browser cookie access** - Agent Tank never reads, parses, or transmits browser cookies
- **No web scraping** - The tool does not access web interfaces or scrape HTML pages
- **No credential extraction** - Your API keys, tokens, or passwords are never accessed or stored
- **No network interception** - There is no proxy, MITM, or traffic inspection involved
- **No external data transmission** - Usage data stays on your machine; nothing is sent to external servers

#### Why This Approach?

LLM usage data is sensitive—it can reveal work patterns, subscription tiers, and usage intensity. By operating through local CLI tools that you've already authenticated, Agent Tank inherits the security model you've already established with each provider. The tool acts as a local automation layer, not a data collection service.

#### Supported Commands

| Agent | Command | Output |
|-------|---------|--------|
| Claude | `/usage` | Session %, Weekly % |
| Gemini | `/stats` | Model-specific usage % |
| Codex | `/status` | 5h limit %, Weekly % |

## Troubleshooting

### Installation fails with "gyp ERR!"

This indicates missing build dependencies. Make sure you have:

1. **Python 3.8+**: Check with `python3 --version`. If you have multiple Python versions, set the PYTHON environment variable:
   ```bash
   PYTHON=/usr/bin/python3.11 npm install
   ```

2. **Build tools**: Install gcc, g++, and make for your platform (see Prerequisites above)

3. **Node.js headers**: Install the nodejs-devel or nodejs-dev package for your distribution

If you still have issues, try rebuilding:
```bash
npm run rebuild
```

### Agent shows "Timeout waiting for usage data"

- Ensure the CLI tool is properly authenticated
- Try running the CLI tool manually to verify it works
- Check if there are any prompts requiring user input

### Codex fails with cursor position error

This is handled automatically. If you still see issues, ensure your terminal supports standard escape sequences.

### Port already in use

```bash
agent-tank --port 8080
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
