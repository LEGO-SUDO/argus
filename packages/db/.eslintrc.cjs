// ESLint config for @argus/db.
//
// Phase A shipped the `lint` script but no config, so `pnpm --filter @argus/db
// lint` errored (pre-existing gap, surfaced by the Phase B `pnpm -r lint` gate).
// Mirrors the contracts / workers / api config — the minimal conventional TS
// setup that makes the gate real. Lints `src/**/*.ts` only (per the script).
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true },
  ignorePatterns: ['dist', 'node_modules', '*.js', '*.cjs'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  },
};
