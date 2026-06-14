# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.8] - 2026-06-14

### Added

- Add `--background` (and `AGENT_TANK_BACKGROUND`) to start Agent Tank as a detached process that prints its PID and log path, then exits the parent command
- Add `AGENT_TANK_BACKGROUND_LOG` to set the background child's stdout/stderr log path, and `AGENT_TANK_BACKGROUND_GRACE_MS` to configure the parent's startup grace period before reporting success
- Warn at startup when other Agent Tank processes are already running, listing each PID with credential flags redacted, and including `kill` / `kill -9` instructions to stop them; the warning header is shown in bold red on an interactive terminal
- Document running Agent Tank from source in the README (clone, install, run, flags, prerequisites)

### Fixed

- Harden the debug output dump on the status page so malformed agent output can't crash the process

## [0.9.7] - 2026-06-05

### Changed

- Use chokidar polling for activity monitoring to reduce native watcher pressure on large CLI log trees
- Replace Gemini CLI support with Antigravity CLI (`agy`) using the interactive `/usage` command

### Fixed

- Fix Claude Code PTY one-shot stats checks against Claude Code 2.1 compact usage output
- Prevent Claude metadata fetch from crashing when the CLI exits before delayed PTY writes run
- Dismiss Claude `/status` metadata dialogs before sending `/usage` so one-shot usage checks can complete
- Parse compact Claude reset timestamps such as `Jun10,6pm(Europe/Berlin)`
- Wait for Claude's separate weekly Sonnet usage section before completing `/usage` parsing

## [0.9.5] - 2026-04-13

### Added

- Add a per-agent refresh cooldown with a default of 30 seconds, applied to manual refreshes, startup refreshes, and auto-refresh activity
- Add `--refresh-cooldown` and `AGENT_TANK_REFRESH_COOLDOWN` to reconfigure or disable the refresh cooldown

### Changed

- Prefer Docker bridge gateway discovery via `docker network inspect`, falling back to local interface detection only when Docker is unavailable

### Fixed

- Stop interval-mode auto-refresh from bypassing the central refresh guard
- Tighten Gemini CLI readiness detection so auth and agent-thinking screens are less likely to be misread as ready prompts

## [0.9.4] - 2026-04-12

### Added

- Bind to the local Docker bridge by default when `--host` is omitted, so containers on the same host can reach Agent Tank without exposing it publicly
- Add `--no-docker` and `AGENT_TANK_DOCKER` to disable Docker bridge binding explicitly

### Fixed

- Keep zero-usage reset times visible in the UI for Claude, Gemini, and Codex when reset information exists
- Remove trailing slashes from startup banner status page URLs

## [0.9.3] - 2026-04-11

### Added

- Add `--version` to the `agent-tank` CLI for quick version checks
- Log PTY and JSON-RPC subprocess PIDs when agent processes start

### Fixed

- Make `Ctrl+C` exits immediate again by avoiding reliance on a JS `SIGINT` handler
- Prevent shutdown races from respawning agent processes after teardown begins
- Guard PTY refresh, metadata fetch, and keepalive paths against restart during shutdown

## [0.9.2] - 2026-04-09

### Fixed

- Prevent Gemini agent crashes when the CLI process exits during authentication flows
- Avoid sending `Escape` while Gemini OAuth authentication is in progress, which could cancel login
- Improve Gemini trust prompt handling during command execution and slow startup scenarios
- Detect Gemini CLI unauthenticated/setup screens and report them clearly instead of surfacing a generic timeout

### Added

- Regression tests covering Gemini shell null-safety during delayed callbacks
- Gemini authentication-required status in the API response and a concise login instruction in the UI

## [0.9.0] - 2024-01-20

### Added

- Initial release
- Support for Claude Code CLI (`/usage` command)
  - Session usage percentage
  - Weekly usage (all models)
  - Weekly usage (Sonnet only)
  - Reset times
- Support for Gemini CLI (`/stats` command)
  - Per-model usage percentages
  - Reset times for each model
- Support for OpenAI Codex CLI (`/status` command)
  - 5-hour limit percentage
  - Weekly limit percentage
  - Model and account info
- Auto-discovery of installed LLM CLI tools
- HTTP API with JSON responses
- Built-in HTML status page dashboard
- Refresh endpoints for on-demand updates
- CORS support for cross-origin requests
- Cursor position query response for Codex compatibility
