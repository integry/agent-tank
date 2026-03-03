const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: ["node_modules/**", "dist/**"],
  },
  {
    files: ["src/**/*.js", "bin/**/*.js"],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "max-lines": ["warn", 400],
      "complexity": ["warn", 20],
      "max-depth": ["warn", 4],
      "max-params": ["warn", 4],
    },
  },
];
