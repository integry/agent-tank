# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
