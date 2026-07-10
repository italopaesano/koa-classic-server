module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/__tests__/**/*.test.js'
  ],
  testTimeout: 120000, // 2 minutes for performance tests
  verbose: true,
  collectCoverageFrom: [
    'index.cjs',
    'index.mjs'
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/customTest/',
    '/benchmark-data/',
    '/scripts/'
  ],
  // Ring-fence for the coverage level reached in the 2026-07 test-coverage
  // review (`npm run test:coverage`: ~97.9% stmts / 95.1% branch / 100% funcs
  // / 98.5% lines on index.cjs). Thresholds sit ~1% below the measured values
  // so genuinely new code has some slack, while a regression that deletes or
  // bypasses tests fails loudly. Note: index.mjs shows 0% here because it is
  // exercised by __tests__/esm-export.test.js in a CHILD node process (Jest's
  // CJS transform cannot load real ESM in-process), which Istanbul cannot see;
  // its ~2 statements are noise in the global aggregate.
  coverageThreshold: {
    global: {
      statements: 97,
      branches: 94,
      functions: 99,
      lines: 97.5
    }
  }
};
