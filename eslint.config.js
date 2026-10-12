import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

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
    },
  },
  {
    // Provider/hook modules and shadcn primitives intentionally export helpers
    // next to components; hot reload falls back to a full refresh there.
    files: ["src/hooks/**", "src/components/**", "remotion/**"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    // Raw third-party payloads (Stripe, RevenueCat, Suno, Telegram, edge runtime)
    // arrive untyped; these modules check fields at runtime instead.
    files: [
      "supabase/functions/**",
      "src/**/*.server.ts",
      "src/**/*.functions.ts",
      "src/routes/api/**",
      "src/routes/lovable/**",
      "src/**/*.test.ts",
      "src/lib/revenuecat.ts",
    ],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  // Platform-generated MCP routes.
  { ignores: ["src/routes/mcp.ts", "src/routes/[.mcp]/**", "src/routes/[.well-known]/**"] },
  eslintPluginPrettier,
);
