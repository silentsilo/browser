import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Correctness rules only, no stylistic ones.
export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Build scripts run under Node.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Nothing received from the app may reach a log.
      "no-console": "error",
    },
  },
);
