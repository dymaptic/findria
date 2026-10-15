import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [".next/**", "dist/**", "node_modules/**", "next-env.d.ts"],
  },
  {
    // Pre-existing debt surfaced when lint was re-enabled; tracked as warnings.
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "@next/next/no-html-link-for-pages": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  {
    // CommonJS config and build scripts
    files: ["**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
