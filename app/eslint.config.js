// ESLint flat config (ESLint 9). Built on eslint-config-expo, the official
// Expo/React Native ruleset — it already understands JSX, hooks, and the RN
// globals, so this file only layers on the project's own conventions.
const expo = require("eslint-config-expo/flat");
const tseslint = require("typescript-eslint");

module.exports = [
  ...expo,
  {
    ignores: [
      "dist/**",
      "web-build/**",
      ".expo/**",
      ".wrangler/**", // generated Worker bundles — not source
      "node_modules/**",
      "expo-env.d.ts",
    ],
  },
  {
    // Register the TypeScript plugin so the TS-aware unused-vars rule below
    // resolves. eslint-config-expo parses TS but does not expose the plugin
    // under this name in flat config.
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      // The app already runs `tsc --strict` in CI, which is the real
      // type-safety gate. ESLint's job here is to catch what the compiler
      // does not: dead code, hook mistakes, and accidental console noise.
      "no-unused-vars": "off", // superseded by the TS-aware check below
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // console.warn/error are how the app surfaces real problems; a bare
      // console.log is almost always a debugging leftover.
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // --- Rules tuned down for this codebase, with reasons ---

      // TypeScript already resolves every identifier; no-undef only produces
      // false positives on ambient globals (per typescript-eslint's own
      // guidance to disable it for TS).
      "no-undef": "off",

      // Style, not correctness. The codebase deliberately uses Array<T> in
      // places for readability with long element types; both forms are fine.
      "@typescript-eslint/array-type": "off",

      // Apostrophes and quotes in JSX text render correctly; escaping them
      // hurts readability of user-facing copy for no behavioral gain.
      "react/no-unescaped-entities": "off",

      // eslint-config-expo 57 ships eslint-plugin-react-hooks v6, which
      // includes the opt-in React Compiler ruleset. This app does not build
      // with the React Compiler, and these three rules flag correct,
      // intentional patterns as errors:
      //   - refs: the standard RN idiom useRef(new Animated.Value(x)).current
      //   - set-state-in-effect: mount-time initialization from the URL /
      //     stored session, which is exactly what effects are for
      //   - purity: Date.now() in render where the output SHOULD track wall
      //     time (filtering "upcoming" runs)
      // Kept as warnings so a genuinely suspicious case still surfaces in
      // review, without failing the lint gate on working code. Revisit if the
      // app adopts the React Compiler, where these become real constraints.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
  {
    // Node build scripts (asset generation) run outside the RN runtime and
    // legitimately use Node globals like Buffer and process.
    files: ["assets/**/*.js", "*.config.js", "scripts/**/*.js"],
    languageOptions: { globals: { Buffer: "readonly", process: "readonly", __dirname: "readonly" } },
    rules: { "no-console": "off" },
  },
  {
    // Tests lean on Jest globals and intentionally throwaway values.
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "no-console": "off",
      // jest.mock() must precede the imports it intercepts, so imports after
      // a mock block are correct here, not a style slip.
      "import/first": "off",
    },
  },
];
