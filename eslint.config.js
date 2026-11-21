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
const SELECT_STAR_RULE = {
  selector: SELECT_STAR,
  message:
    'Select the columns you need instead of "*" (plan 9.2 data gate). For a count, use select("*", { count: "exact", head: true }).',
};

/**
 * WP 4.0: members never see raw database or technical error text. In src/routes and src/components, a toast
 * (toast(...), toast.error/warning/info/message(...)) may not show `x.message`, `x?.message` or `String(x)` anywhere
 * in its text or its `description`: passed directly, in a template literal, joined with `+`, as either branch of a
 * ternary, or on either side of `??`, `||` or `&&` (`e instanceof Error ? e.message : "Failed"`,
 * `err?.message ?? "Failed"`). A call other than String(...) is not looked into, so userErrorMessage(err, "...") and
 * the feature mappers are fine, and neither is the branch of `e instanceof OwnRefusal ? e.message : ...` (an Error
 * class of our own, not Error or a library's). Turn the error into a sentence with userErrorMessage(err, fallback) or the feature's
 * mapper instead. A sentence the app wrote itself can still be shown: give it a name (a constant, an own Error class)
 * rather than reading it back off the error.
 */
const RAW_TOAST_ERROR_MESSAGE =
  'Don\'t show raw error text (x.message, String(x), `${x.message}`, e instanceof Error ? e.message : "…", e?.message ?? "…") in a toast: members must never see database or technical errors (WP 4.0). Use userErrorMessage(err, "Couldn\'t … Please try again.") from src/lib/user-error.ts, or the feature\'s own mapper, and pass the error object.';
const TOAST_METHOD = /^(error|warning|info|message)$/;
const isToastCall = (node) => {
  const c = node.callee;
  if (c.type === "Identifier") return c.name === "toast";
  return (
    c.type === "MemberExpression" &&
    !c.computed &&
    c.object.type === "Identifier" &&
    c.object.name === "toast" &&
    c.property.type === "Identifier" &&
    TOAST_METHOD.test(c.property.name)
  );
};
/**
 * Error classes whose message is not ours (built-in, Supabase, zod). `e instanceof OwnRefusal ? e.message : ...` shows
 * a sentence the app wrote itself, so it is allowed; `e instanceof Error ? e.message : ...` is not.
 */
const FOREIGN_ERROR_CLASSES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
  "AggregateError",
  "DOMException",
  "PostgrestError",
  "AuthError",
  "AuthApiError",
  "FunctionsError",
  "FunctionsHttpError",
  "StorageError",
  "ZodError",
]);
const isOwnErrorClassTest = (test) =>
  test.type === "BinaryExpression" &&
  test.operator === "instanceof" &&
  test.right.type === "Identifier" &&
  !FOREIGN_ERROR_CLASSES.has(test.right.name);
/** The raw error text `node` shows, if any: a `.message` read or String(x), reached through the shapes above. */
const rawErrorText = (node) => {
  if (!node) return null;
  switch (node.type) {
    case "MemberExpression":
      return !node.computed &&
        node.property.type === "Identifier" &&
        node.property.name === "message"
        ? node
        : null;
    case "CallExpression":
      if (node.callee.type === "Identifier") return node.callee.name === "String" ? node : null;
      // A method on the text itself (e.message.slice(0, 80)) still shows it.
      return node.callee.type === "MemberExpression" ? rawErrorText(node.callee.object) : null;
    case "ChainExpression":
    case "TSAsExpression":
    case "TSNonNullExpression":
    case "TSSatisfiesExpression":
    case "TSTypeAssertion":
    case "AwaitExpression":
      return rawErrorText(node.expression ?? node.argument);
    case "ConditionalExpression":
      return (
        (isOwnErrorClassTest(node.test) ? null : rawErrorText(node.consequent)) ??
        rawErrorText(node.alternate)
      );
    case "LogicalExpression":
    case "BinaryExpression":
      return rawErrorText(node.left) ?? rawErrorText(node.right);
    case "TemplateLiteral":
      for (const e of node.expressions) {
        const hit = rawErrorText(e);
        if (hit) return hit;
      }
      return null;
    case "SequenceExpression":
      return rawErrorText(node.expressions[node.expressions.length - 1]);
    default:
      return null;
  }
};
const noRawToastError = {
  meta: { type: "problem", schema: [], messages: { raw: RAW_TOAST_ERROR_MESSAGE } },
  create(context) {
    const check = (expr) => {
      const hit = rawErrorText(expr);
      if (hit) context.report({ node: hit, messageId: "raw" });
    };
    return {
      CallExpression(node) {
        if (!isToastCall(node)) return;
        for (const arg of node.arguments) {
          if (arg.type !== "ObjectExpression") {
            check(arg);
            continue;
          }
          for (const p of arg.properties) {
            if (p.type !== "Property" || p.computed) continue;
            const key = p.key.type === "Identifier" ? p.key.name : p.key.value;
            if (key === "description") check(p.value);
          }
        }
      },
    };
  },
};
localPlugin.rules["no-raw-toast-error"] = noRawToastError;

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
      "no-restricted-syntax": ["error", SELECT_STAR_RULE],
    },
  },
  {
    // WP 4.0 raw-toast gate (local/no-raw-toast-error, above) for these folders only.
    files: ["src/routes/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "local/no-raw-toast-error": "error",
    },
  },
  eslintPluginPrettier,
);
