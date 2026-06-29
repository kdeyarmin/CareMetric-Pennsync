import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";
import pluginJsxA11y from "eslint-plugin-jsx-a11y";

export default [
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
    ],
    ...pluginJs.configs.recommended,
    ...pluginReact.configs.flat.recommended,
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
        version: "detect",
      },
    },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
      "jsx-a11y": pluginJsxA11y,
    },
    rules: {
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
    },
  },
];
