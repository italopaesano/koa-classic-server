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
  ]
};
