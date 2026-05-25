// ESLint config for @argus/workers.
//
// Phase A shipped the `lint` script + @typescript-eslint deps but no config
// (only apps/web carried one), so `pnpm --filter @argus/workers lint` errored
// repo-wide. This is the minimal conventional TS config that makes the gate
// real for the NestJS worker source. Lints `src/**/*.ts` only (per the script).
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true },
  ignorePatterns: ['dist', 'node_modules', '*.js', '*.cjs'],
  rules: {
    // kafkajs / Prisma boundary code legitimately needs structural casts.
    '@typescript-eslint/no-explicit-any': 'off',
  },
};
