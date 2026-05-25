// ESLint config for @argus/api.
//
// Phase A shipped the `lint` script + @typescript-eslint deps but no config
// (only apps/web carried one; apps/workers added its own in Phase A infra), so
// `pnpm --filter @argus/api lint` errored. This mirrors the workers config —
// the minimal conventional TS setup that makes the gate real for the NestJS
// api source. Lints `src/**/*.ts` only (per the script).
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true },
  ignorePatterns: ['dist', 'node_modules', '*.js', '*.cjs'],
  rules: {
    // Prisma / kafkajs / OTel boundary code legitimately needs structural casts.
    '@typescript-eslint/no-explicit-any': 'off',
    // Underscore-prefixed args/vars are intentionally unused (standard convention).
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  },
};
