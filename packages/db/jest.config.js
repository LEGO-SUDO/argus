/** @type {import('jest').Config} */
// db-package integration tests boot an ephemeral Postgres via testcontainers,
// apply the committed migrations with `prisma migrate deploy`, then assert the
// resulting schema shape. Repo convention is a `.js` jest config (not `.ts`).
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
      },
    ],
  },
  // testcontainers Postgres boot needs headroom on a cold image pull.
  testTimeout: 120000,
  passWithNoTests: true,
};
