// ESLint config for @argus/contracts.
//
// Phase A shipped the `lint` script + deps but no config, so
// `pnpm --filter @argus/contracts lint` errored. This mirrors the workers /
// api config — the minimal conventional TS setup that makes the gate real for
// the shared zod/TS contracts. Lints `src/**/*.ts` only (per the script).
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
