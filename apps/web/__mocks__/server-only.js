// Jest stub for `server-only`. The real package throws at import time so
// that bundlers refuse to ship server-only code into client bundles. In
// jest (jsdom) we have no such concern — neutralise it so server-* helper
// modules can be imported directly by unit tests.
module.exports = {};
