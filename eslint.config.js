import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { builtinRules } from "eslint/use-at-your-own-risk";

/**
 * Quality gates from the plan (section 9.2), enforced through the lint ratchet
 * (scripts/lint-changed.mjs): a file this branch touches may not end with more errors
 * than it had, and a new file must have none. Existing files over a limit keep their one
 * error; they only fail once they grow past it or a new file starts out past it.
 *   - Component size: 800 lines warns, 1,500 is an error.
 *   - Data: no new `select("*")`. A count with `{ head: true }` returns no rows, so it is allowed.
 */
const MAX_LINES = { skipBlankLines: true, skipComments: true };
// The same core rule under a second name, so one file can warn at 800 and fail at 1,500.
const localPlugin = { rules: { "max-lines-soft": builtinRules.get("max-lines") } };
const SELECT_STAR =
  'CallExpression[callee.property.name="select"][arguments.0.value="*"]:not(:has(Property[key.name="head"]))';

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      local: localPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      "max-lines": ["error", { max: 1500, ...MAX_LINES }],
      "local/max-lines-soft": ["warn", { max: 800, ...MAX_LINES }],
      "no-restricted-syntax": [
        "error",
        {
          selector: SELECT_STAR,
          message:
            'Select the columns you need instead of "*" (plan 9.2 data gate). For a count, use select("*", { count: "exact", head: true }).',
        },
      ],
    },
  },
  eslintPluginPrettier,
);
