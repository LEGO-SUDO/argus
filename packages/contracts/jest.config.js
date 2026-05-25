/**
 * Jest config for @argus/contracts.
 *
 * Node env (these are pure zod/TS schemas — no DOM). Mirrors the monorepo
 * convention (ts-jest preset, `passWithNoTests` so an empty test dir doesn't
 * break the turbo gate). No explicit `roots` so jest discovers tests under
 * both `src/__tests__/` (co-located, PR #5's relative-import tests) and the
 * top-level `__tests__/` (cross-pane contract assertions added by the web +
 * infra panes, which import via `@argus/contracts`) without erroring when one
 * dir is absent; node_modules / dist are excluded by jest's default ignore +
 * the .ts match. The `moduleNameMapper` is required so the top-level
 * cross-pane tests can resolve `@argus/contracts` to source.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  moduleNameMapper: {
    '^@argus/contracts$': '<rootDir>/src/index.ts',
    '^@argus/contracts/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
      },
    ],
  },
  testTimeout: 15000,
  passWithNoTests: true,
};
