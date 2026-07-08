module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/__tests__/**/*.test.js'
  ],
  // Injects retry defaults into recursive fs.rm/rmSync so afterAll cleanup
  // doesn't flake on Windows (ENOTEMPTY/EBUSY); inert on Linux/macOS.
  setupFiles: [
    '<rootDir>/__tests__/jest.setup.js'
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
