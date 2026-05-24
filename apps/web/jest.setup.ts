// Jest setup — runs after jest-jsdom env is installed and React Testing
// Library is available. Registers the jest-dom matcher set globally and
// adds a per-test DOM cleanup.
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
