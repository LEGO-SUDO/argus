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
    // ts-jest for our own TS/TSX sources.
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
      },
    ],
    // The markdown stack (react-markdown, remark-*, rehype-*, and their
    // unified/micromark/hast/mdast transitive deps) ships ESM-only. We
    // transform those node_modules .js to CommonJS via ts-jest so jest's CJS
    // runtime can require them. isolatedModules keeps it fast (no type-check
    // of node_modules) and allowJs lets ts-jest accept plain .js input.
    '^.+\\.(js|mjs)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
        isolatedModules: true,
        diagnostics: false,
      },
    ],
  },
  // Do NOT ignore the ESM markdown ecosystem under pnpm's store — those .js
  // files must be transformed to CommonJS. The negative lookahead lists the
  // unified/remark/rehype/mdast/micromark/hast families plus their small
  // single-purpose helper deps. Everything else in node_modules stays
  // ignored for speed.
  transformIgnorePatterns: [
    'node_modules/\\.pnpm/(?!(' +
      [
        'react-markdown',
        'remark-[^/@]+',
        'rehype-[^/@]+',
        'mdast-[^/@]+',
        'micromark[^/@]*',
        'unified',
        'unist-[^/@]+',
        'hast-[^/@]+',
        'hastscript',
        'property-information',
        '[a-z]+-separated-tokens',
        'vfile[^/@]*',
        'bail',
        'trough',
        'is-plain-obj',
        'trim-lines',
        'decode-named-character-reference',
        'character-entities[^/@]*',
        'devlop',
        'html-url-attributes',
        'estree-util-is-identifier-name',
        'ccount',
        'escape-string-regexp',
        'markdown-table',
        'longest-streak',
        'zwitch',
        'html-void-elements',
        'web-namespaces',
        'character-reference-invalid',
        'is-[^/@]+',
      ].join('|') +
      ')@)',
  ],
  testEnvironmentOptions: {
    customExportConditions: [''],
  },
  passWithNoTests: true,
};
