import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      ".vercel/**",
      "**/.vercel/**",
      ".worktrees/**",
      "**/.worktrees/**",
    ],
  },
];
