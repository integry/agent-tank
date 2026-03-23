# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
