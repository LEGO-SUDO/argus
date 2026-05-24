/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@argus/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
    '^@argus/contracts/(.*)$': '<rootDir>/../../packages/contracts/src/$1',
    '^@argus/db$': '<rootDir>/../../packages/db/src/index.ts',
    '^@argus/db/(.*)$': '<rootDir>/../../packages/db/src/$1',
    '^@argus/sdk$': '<rootDir>/../../packages/sdk/src/index.ts',
    '^@argus/sdk/(.*)$': '<rootDir>/../../packages/sdk/src/$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
      },
    ],
  },
  // Integration tests boot testcontainers (Postgres) — slow boot needs headroom.
  testTimeout: 60000,
  passWithNoTests: true,
};
