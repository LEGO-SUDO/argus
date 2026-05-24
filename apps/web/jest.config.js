/**
 * Jest config for @argus/web.
 *
 * Mirrors the monorepo convention from apps/workers/jest.config.js — ts-jest
 * preset, workspace path aliases, and `passWithNoTests` so an empty test
 * directory does not break the turbo gate. jsdom is the environment because
 * the unit tests cover RTL component renders + a stubbed `WebSocket`.
 *
 * The LLD originally specified Vitest; we chose Jest to match the rest of
 * the monorepo so contributors don't context-switch test runners between
 * workspaces.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  rootDir: '.',
  roots: ['<rootDir>/__tests__', '<rootDir>/app', '<rootDir>/components', '<rootDir>/lib'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@argus/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
    '^@argus/contracts/(.*)$': '<rootDir>/../../packages/contracts/src/$1',
    // CSS imports are not relevant to component logic tests — stub them.
    '\\.(css|less|scss|sass)$': '<rootDir>/__mocks__/style-mock.js',
    // `server-only` throws at import time to enforce server boundary at
    // build. We import it in server-* helpers; in jsdom tests we need a
    // no-op so the test runner can load the module.
    '^server-only$': '<rootDir>/__mocks__/server-only.js',
  },
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
      },
    ],
  },
  testEnvironmentOptions: {
    customExportConditions: [''],
  },
  passWithNoTests: true,
};
