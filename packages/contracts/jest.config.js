/**
 * Jest config for @argus/contracts.
 *
 * Node env (these are pure zod/TS schemas — no DOM). Mirrors the monorepo
 * convention (ts-jest preset, `passWithNoTests` so an empty test dir doesn't
 * break the turbo gate). No explicit `roots` so jest discovers tests under
 * both `src/` (co-located) and `__tests__/` (cross-pane contract assertions
 * added by the web + infra panes) without erroring when one dir is absent;
 * node_modules / dist are excluded by jest's default ignore + the .ts match.
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
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  passWithNoTests: true,
};
