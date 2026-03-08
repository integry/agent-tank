# CLAUDE.md - AI Agent Guidelines

This document provides essential guidelines for AI coding assistants (Claude Code, Cursor, GitHub Copilot, etc.) working on this repository.

## Project Overview

**Agent Tank** is a privacy-first tool that monitors and queries usage limits for LLM CLI tools (Claude, Gemini, Codex) via a local HTTP API. It uses pseudo-terminal (PTY) sessions to interact with authenticated CLI tools locally.

### Architecture

```
agent-tank/
├── bin/                    # CLI entry point
├── src/
│   ├── agents/             # Agent implementations (claude, gemini, codex)
│   │   ├── base.js         # Base agent class with shared PTY logic
│   │   ├── claude.js       # Claude-specific parsing
│   │   ├── gemini.js       # Gemini-specific parsing
│   │   └── codex.js        # Codex-specific parsing
│   ├── discovery.js        # Auto-discovery of installed CLI tools
│   ├── status-page.js      # HTML dashboard generation
│   ├── usage-formatters.js # Output formatting utilities
│   └── index.js            # Main LLMWatcher class and HTTP server
├── test/
│   ├── unit/               # Unit tests (isolated, mocked dependencies)
│   └── e2e/                # End-to-end tests (full integration)
└── jest.config.js          # Jest configuration
```

## Testing Requirements

**All code changes must include appropriate tests.** This is mandatory, not optional.

### Test Commands

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run end-to-end tests only
npm run test:e2e

# Run tests with coverage
npm test -- --coverage
```

### Unit Tests vs E2E Tests

| Aspect | Unit Tests (`test/unit/`) | E2E Tests (`test/e2e/`) |
|--------|---------------------------|-------------------------|
| **Scope** | Single function or module | Full application flow |
| **Dependencies** | Mocked (PTY, HTTP, file system) | Real or minimal mocking |
| **Speed** | Fast (< 1 second each) | Slower (may involve I/O) |
| **Purpose** | Test business logic in isolation | Test real user scenarios |

#### When to Write Unit Tests

- Parser functions (e.g., parsing CLI output)
- Utility functions (e.g., formatting, validation)
- Business logic (e.g., rate limit calculations)
- Error handling paths

#### When to Write E2E Tests

- HTTP API endpoints
- CLI command behavior
- Agent lifecycle (start, refresh, stop)
- Integration between multiple modules

### Test File Naming

- Place unit tests in `test/unit/`
- Place e2e tests in `test/e2e/`
- Name test files with `.test.js` suffix
- Mirror the source file structure (e.g., `src/agents/claude.js` → `test/unit/agents/claude.test.js`)

### Test Quality Standards

1. **Descriptive test names**: Use `describe` and `it` blocks that read like documentation
2. **Arrange-Act-Assert**: Structure tests clearly with setup, action, and verification
3. **Test edge cases**: Include error conditions, empty inputs, boundary values
4. **No test pollution**: Each test should be independent and not affect others
5. **Meaningful assertions**: Assert specific values, not just truthiness

### Example Test Structure

```javascript
// test/unit/agents/claude.test.js
const { parseClaudeUsage } = require('../../../src/agents/claude');

describe('ClaudeAgent', () => {
  describe('parseClaudeUsage', () => {
    it('parses session percentage from usage output', () => {
      const output = 'Session: 45% used';
      const result = parseClaudeUsage(output);
      expect(result.session.percent).toBe(45);
    });

    it('handles malformed output gracefully', () => {
      const output = 'Invalid output';
      const result = parseClaudeUsage(output);
      expect(result).toBeNull();
    });
  });
});
```

## Code Quality Rules

### Before Committing

1. Run `npm test` - all tests must pass
2. Run `npm run lint` - no linting errors
3. Ensure new functionality has corresponding tests
4. Update `README.md` if functionality changes - keep documentation in sync with code

### Code Style

- Use ES6+ features where appropriate
- Follow existing code patterns in the repository
- Keep functions small and focused
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

### Dependencies

- This project uses minimal dependencies (only `node-pty`)
- Avoid adding new runtime dependencies unless absolutely necessary
- Dev dependencies (testing, linting) are acceptable when needed

## Common Development Tasks

### Adding a New Agent

1. Create `src/agents/newagent.js` extending the base agent
2. Implement the `parseOutput` method for CLI-specific parsing
3. Add unit tests in `test/unit/agents/newagent.test.js`
4. Add e2e tests in `test/e2e/newagent.test.js`
5. Register the agent in `src/discovery.js`

### Modifying Parsing Logic

1. Write failing tests first (TDD approach preferred)
2. Implement the changes
3. Verify all existing tests still pass
4. Add tests for new edge cases

### Fixing Bugs

1. Write a test that reproduces the bug
2. Fix the bug
3. Verify the test now passes
4. Ensure no regression in other tests

## Important Notes

- **Node.js 18+** is required
- Tests run in a Node environment (not browser)
- PTY-related tests may require mocking on CI environments
- The HTTP server uses Node's built-in `http` module (no Express)

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm test` | Run all tests |
| `npm run test:unit` | Run unit tests only |
| `npm run test:e2e` | Run e2e tests only |
| `npm run lint` | Check code style |
| `npm start` | Start the server |
| `npm run dev` | Development mode |
