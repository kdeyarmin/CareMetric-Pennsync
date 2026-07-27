import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";
import pluginJsxA11y from "eslint-plugin-jsx-a11y";

export default [
  {
    ignores: [
      "dist/**",
      "dist-ssr/**",
      "node_modules/**",
      "coverage/**",
    ],
  },
  {
    files: [
      "src/components/**/*.{js,mjs,cjs,jsx}",
      "src/pages/**/*.{js,mjs,cjs,jsx}",
      // Previously unlinted application infrastructure — now covered so bugs in
      // auth/query/api/hook code are caught too (see docs/CODE_REVIEW_2026-06-05.md Q1).
      "src/lib/**/*.{js,mjs,cjs,jsx}",
      "src/hooks/**/*.{js,mjs,cjs,jsx}",
      "src/api/**/*.{js,mjs,cjs,jsx}",
      "src/Layout.jsx",
      // The app root, its entrypoint, and the remaining top-level modules were
      // the last unlinted source files — App.jsx holds the auth gate and the
      // route table, which is exactly where an unused/undefined identifier
      // matters most.
      "src/App.jsx",
      "src/main.jsx",
      "src/routes.jsx",
      "src/utils/**/*.{js,mjs,cjs,jsx}",
      "src/constants/**/*.{js,mjs,cjs,jsx}",
      "src/functions/**/*.{js,mjs,cjs,jsx}",
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "19.2.0",
      },
    },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
      "jsx-a11y": pluginJsxA11y,
    },
    rules: {
      // Merge the recommended rulesets explicitly. Spreading the whole config
      // objects at the top level (as before) was a no-op: the `rules` key below
      // replaced their `rules` wholesale, so no-undef/no-dupe-keys/no-unreachable/
      // no-const-assign/react/jsx-key etc. never ran. Merging their `rules` here
      // (under the project overrides below) actually enforces them.
      ...pluginJs.configs.recommended.rules,
      ...pluginReact.configs.flat.recommended.rules,
      "no-unused-vars": "off",
      "react/jsx-uses-vars": "error",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": [
        "error",
        { ignore: ["cmdk-input-wrapper", "toast-close"] },
      ],
      "react-hooks/rules-of-hooks": "error",
      // Surface missing/incorrect effect dependencies (the class of bug behind
      // several stale-closure issues found in review) as a non-blocking warning.
      "react-hooks/exhaustive-deps": "warn",
      // App code already follows an errors/warns-only convention (no stray
      // console.log/debug/info). Lock it in: `warn`/`error` stay allowed for
      // intentional diagnostics; everything else should route through
      // `@/lib/logger` (which is exempt via a file-level eslint-disable).
      "no-console": ["error", { allow: ["warn", "error"] }],
      // Accessibility: surfaced as warnings (not errors) so the 0-error CI gate
      // stays green while the a11y backlog is worked down. A follow-up can promote
      // these to "error" once clean. Curated set covering the highest-value checks.
      "jsx-a11y/alt-text": "warn",
      "jsx-a11y/anchor-has-content": "warn",
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      // ignoreNonDOM: a custom component's `role` prop (e.g. <TelehealthCall role="staff" />)
      // is a domain value, not a DOM ARIA role, so only validate roles on real DOM elements.
      "jsx-a11y/aria-role": ["warn", { ignoreNonDOM: true }],
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/label-has-associated-control": "warn",
      "jsx-a11y/no-redundant-roles": "warn",
      // Recommended rules now actually run (see the merge above). The high-value
      // correctness checks (no-undef, no-const-assign, no-dupe-keys, no-unreachable,
      // react/jsx-key, …) pass clean and stay as errors to catch future regressions.
      // These lower-value stylistic/backlog rules are demoted to warn (or off for the
      // purely cosmetic one) so the 0-error CI gate stays green, matching the a11y
      // convention above rather than churning ~300 pre-existing cosmetic sites.
      "react/no-unescaped-entities": "off",
      "no-case-declarations": "warn",
      "no-empty": "warn",
      "no-empty-pattern": "warn",
      "no-prototype-builtins": "warn",
    },
  },
];
