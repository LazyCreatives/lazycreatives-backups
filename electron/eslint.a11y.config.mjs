// Accessibility lint only: eslint-plugin-jsx-a11y's recommended rules on the app's screens
// (npm run lint:a11y). No style or code-quality rules; those are not what this is for.
//
// The rules under "warn" fired on the code as it was when this was added (Oct 2026), mostly on
// patterns used on purpose: clickable rows and covers that also have a keyboard path through
// the list (useListKeys, data-nav-key), autoFocus in search boxes, pickers and the palette that
// open on a click. They are still printed so new cases get looked at, but they do not fail the
// run. Every other recommended rule is an error. Use `npm run lint:a11y -- --quiet` to see errors only.
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

const WARN = [
  "click-events-have-key-events",
  "no-static-element-interactions",
  "no-noninteractive-element-interactions",
  "no-autofocus",
  "interactive-supports-focus",
  "no-noninteractive-tabindex",
  "no-interactive-element-to-noninteractive-role",
  "label-has-associated-control",
];

// The app's source has `eslint-disable react-hooks/...` comments; this stand-in plugin lets
// ESLint know those rule names without running the react-hooks rules.
const reactHooksNames = {
  rules: { "exhaustive-deps": { create: () => ({}) }, "rules-of-hooks": { create: () => ({}) } },
};

export default [
  { ignores: ["dist/**", "release/**", "e2e/**", "node_modules/**"] },
  {
    files: ["src/**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: { "jsx-a11y": jsxA11y, "react-hooks": reactHooksNames },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      ...Object.fromEntries(WARN.map((r) => [`jsx-a11y/${r}`, "warn"])),
    },
  },
];
