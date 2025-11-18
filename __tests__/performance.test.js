/**
 * Performance Benchmark Tests
 *
 * These tests measure current performance to establish a baseline.
 * After optimizations, run these tests again to measure improvements.
 *
 * Usage:
 *   npm run test:performance
 *
 * To save results:
 *   npm run test:performance > benchmark-results-v1.2.0.txt
 */

const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const path = require('path');
const fs = require('fs');

const BENCHMARK_DIR = path.join(__dirname, '../benchmark-data');

// Auto-setup benchmark data if not exists
function setupBenchmarkData() {
    if (fs.existsSync(BENCHMARK_DIR)) {
        return; // Data already exists
    }

    console.log('\n🔧 Setting up benchmark data automatically...\n');

    // Create benchmark directory
    fs.mkdirSync(BENCHMARK_DIR, { recursive: true });

    // Create small files (1KB each)
    console.log('  Creating 100 small files (1KB each)...');
    const smallDir = path.join(BENCHMARK_DIR, 'small-files');
    fs.mkdirSync(smallDir);
    for (let i = 1; i <= 100; i++) {
        const content = 'X'.repeat(1024);
        fs.writeFileSync(path.join(smallDir, `file-${i}.txt`), content);
    }

    // Create medium files (100KB each)
    console.log('  Creating 50 medium files (100KB each)...');
    const mediumDir = path.join(BENCHMARK_DIR, 'medium-files');
    fs.mkdirSync(mediumDir);
    for (let i = 1; i <= 50; i++) {
        const content = 'X'.repeat(100 * 1024);
        fs.writeFileSync(path.join(mediumDir, `file-${i}.txt`), content);
    }

    // Create large files (1MB each)
    console.log('  Creating 10 large files (1MB each)...');
    const largeDir = path.join(BENCHMARK_DIR, 'large-files');
    fs.mkdirSync(largeDir);
    for (let i = 1; i <= 10; i++) {
        const content = 'X'.repeat(1024 * 1024);
        fs.writeFileSync(path.join(largeDir, `file-${i}.txt`), content);
    }

    // Create directory with 1000 files
    console.log('  Creating directory with 1000 files...');
    const largeDirListing = path.join(BENCHMARK_DIR, 'large-directory');
    fs.mkdirSync(largeDirListing);
    for (let i = 1; i <= 1000; i++) {
        const content = `File number ${i}\n`;
        fs.writeFileSync(path.join(largeDirListing, `item-${String(i).padStart(4, '0')}.txt`), content);
    }

    // Create directory with 10,000 files
    console.log('  Creating directory with 10,000 files (this may take a moment)...');
    const veryLargeDirListing = path.join(BENCHMARK_DIR, 'very-large-directory');
    fs.mkdirSync(veryLargeDirListing);
    for (let i = 1; i <= 10000; i++) {
        const content = `File number ${i}\n`;
        fs.writeFileSync(path.join(veryLargeDirListing, `item-${String(i).padStart(5, '0')}.txt`), content);
    }

    // Create HTML file for caching test
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Benchmark Test</title>
</head>
<body>
    <h1>Benchmark Test Page</h1>
    <p>${'Lorem ipsum dolor sit amet. '.repeat(100)}</p>
</body>
</html>`;
    fs.writeFileSync(path.join(BENCHMARK_DIR, 'test.html'), htmlContent);

    console.log('\n✅ Benchmark data setup complete!\n');
}

// Setup benchmark data automatically if needed
setupBenchmarkData();

// Helper to measure execution time
function measureTime(fn) {
    const start = process.hrtime.bigint();
    const result = fn();
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1000000; // Convert to ms
    return { result, durationMs };
}

async function measureTimeAsync(fn) {
    const start = process.hrtime.bigint();
    const result = await fn();
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1000000;
    return { result, durationMs };
}

// Helper to run multiple iterations and get statistics
async function benchmark(name, fn, iterations = 10) {
    const times = [];

    for (let i = 0; i < iterations; i++) {
        const { durationMs } = await measureTimeAsync(fn);
        times.push(durationMs);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const median = times.sort((a, b) => a - b)[Math.floor(times.length / 2)];

    return { name, avg, min, max, median, times };
}

describe('Performance Benchmarks - BASELINE (v1.2.0)', () => {
    let app;
    let server;
    let request;

    beforeAll(() => {
        app = new Koa();
        app.use(koaClassicServer(BENCHMARK_DIR));
        server = app.listen();
        request = supertest(server);
    });

    afterAll(() => {
        server.close();
    });

    describe('File Serving Performance', () => {
        test('Benchmark: Small file (1KB) - 100 iterations', async () => {
            const stats = await benchmark(
                'Small file (1KB)',
                async () => {
                    const res = await request.get('/small-files/file-1.txt');
                    expect(res.status).toBe(200);
                },
                100
            );

            console.log('\n📊 Small File (1KB) Benchmark:');
            console.log(`   Average: ${stats.avg.toFixed(2)}ms`);
            console.log(`   Median:  ${stats.median.toFixed(2)}ms`);
            console.log(`   Min:     ${stats.min.toFixed(2)}ms`);
            console.log(`   Max:     ${stats.max.toFixed(2)}ms`);

            expect(stats.avg).toBeLessThan(50); // Should be fast
        }, 30000);

        test('Benchmark: Medium file (100KB) - 50 iterations', async () => {
            const stats = await benchmark(
                'Medium file (100KB)',
                async () => {
                    const res = await request.get('/medium-files/file-1.txt');
                    expect(res.status).toBe(200);
                },
                50
            );

            console.log('\n📊 Medium File (100KB) Benchmark:');
            console.log(`   Average: ${stats.avg.toFixed(2)}ms`);
            console.log(`   Median:  ${stats.median.toFixed(2)}ms`);
            console.log(`   Min:     ${stats.min.toFixed(2)}ms`);
            console.log(`   Max:     ${stats.max.toFixed(2)}ms`);

            expect(stats.avg).toBeLessThan(100);
        }, 30000);

        test('Benchmark: Large file (1MB) - 20 iterations', async () => {
            const stats = await benchmark(
                'Large file (1MB)',
                async () => {
                    const res = await request.get('/large-files/file-1.txt');
                    expect(res.status).toBe(200);
                },
                20
            );

            console.log('\n📊 Large File (1MB) Benchmark:');
            console.log(`   Average: ${stats.avg.toFixed(2)}ms`);
            console.log(`   Median:  ${stats.median.toFixed(2)}ms`);
            console.log(`   Min:     ${stats.min.toFixed(2)}ms`);
            console.log(`   Max:     ${stats.max.toFixed(2)}ms`);

            expect(stats.avg).toBeLessThan(500);
        }, 30000);
    });

    describe('Directory Listing Performance', () => {
        test('Benchmark: Small directory (100 files) - 50 iterations', async () => {
            const stats = await benchmark(
                'Directory listing (100 files)',
                async () => {
                    const res = await request.get('/small-files/');
                    expect(res.status).toBe(200);
                    expect(res.text).toContain('file-1.txt');
                },
                50
            );

            console.log('\n📊 Small Directory (100 files) Benchmark:');
            console.log(`   Average: ${stats.avg.toFixed(2)}ms`);
            console.log(`   Median:  ${stats.median.toFixed(2)}ms`);
            console.log(`   Min:     ${stats.min.toFixed(2)}ms`);
            console.log(`   Max:     ${stats.max.toFixed(2)}ms`);
        }, 30000);

        test('Benchmark: Large directory (1,000 files) - 20 iterations', async () => {
            const stats = await benchmark(
                'Directory listing (1,000 files)',
                async () => {
                    const res = await request.get('/large-directory/');
                    expect(res.status).toBe(200);
                    expect(res.text).toContain('item-0001.txt');
                },
                20
            );

            console.log('\n📊 Large Directory (1,000 files) Benchmark:');
            console.log(`   Average: ${stats.avg.toFixed(2)}ms`);
            console.log(`   Median:  ${stats.median.toFixed(2)}ms`);
            console.log(`   Min:     ${stats.min.toFixed(2)}ms`);
            console.log(`   Max:     ${stats.max.toFixed(2)}ms`);

            // This is expected to be slow with current sync implementation
            console.log(`   ⚠️  WARNING: This will be MUCH faster after async optimization`);
        }, 60000);

        test('Benchmark: Very large directory (10,000 files) - 5 iterations', async () => {
            const stats = await benchmark(
                'Directory listing (10,000 files)',
                async () => {
                    const res = await request.get('/very-large-directory/');
                    expect(res.status).toBe(200);
                    expect(res.text).toContain('item-00001.txt');
                },
                5
            );

            console.log('\n📊 Very Large Directory (10,000 files) Benchmark:');
            console.log(`   Average: ${stats.avg.toFixed(2)}ms`);
            console.log(`   Median:  ${stats.median.toFixed(2)}ms`);
            console.log(`   Min:     ${stats.min.toFixed(2)}ms`);
            console.log(`   Max:     ${stats.max.toFixed(2)}ms`);
            console.log(`   ⚠️  WARNING: Event loop BLOCKED during this operation!`);
            console.log(`   ⚠️  Expected to drop to ~${(stats.avg * 0.3).toFixed(2)}ms after optimization`);
        }, 120000);
    });

    describe('Concurrent Request Performance', () => {
        test('Benchmark: 10 concurrent small file requests', async () => {
            const start = process.hrtime.bigint();

            const promises = Array.from({ length: 10 }, (_, i) =>
                request.get(`/small-files/file-${i + 1}.txt`)
            );

            const results = await Promise.all(promises);

            const end = process.hrtime.bigint();
            const totalTime = Number(end - start) / 1000000;

            console.log('\n📊 10 Concurrent Small Files:');
            console.log(`   Total time: ${totalTime.toFixed(2)}ms`);
            console.log(`   Avg per request: ${(totalTime / 10).toFixed(2)}ms`);

            results.forEach(res => expect(res.status).toBe(200));
        }, 10000);

        test('Benchmark: 5 concurrent directory listings (100 files each)', async () => {
            const start = process.hrtime.bigint();

            const promises = Array.from({ length: 5 }, () =>
                request.get('/small-files/')
            );

            const results = await Promise.all(promises);

            const end = process.hrtime.bigint();
            const totalTime = Number(end - start) / 1000000;

            console.log('\n📊 5 Concurrent Directory Listings (100 files):');
            console.log(`   Total time: ${totalTime.toFixed(2)}ms`);
            console.log(`   Avg per request: ${(totalTime / 5).toFixed(2)}ms`);
            console.log(`   ⚠️  With current sync code, these run SEQUENTIALLY`);
            console.log(`   ⚠️  After async optimization, will run in PARALLEL`);

            results.forEach(res => expect(res.status).toBe(200));
        }, 30000);
    });

    describe('404 Not Found Performance', () => {
        test('Benchmark: Non-existent file - 50 iterations', async () => {
            const stats = await benchmark(
                '404 Not Found',
                async () => {
                    const res = await request.get('/does-not-exist-12345.txt');
                    expect(res.status).toBe(404);
                },
                50
            );

            console.log('\n📊 404 Not Found Benchmark:');
            console.log(`   Average: ${stats.avg.toFixed(2)}ms`);
            console.log(`   Median:  ${stats.median.toFixed(2)}ms`);
            console.log(`   Min:     ${stats.min.toFixed(2)}ms`);
            console.log(`   Max:     ${stats.max.toFixed(2)}ms`);
        }, 10000);
    });

    describe('Memory Usage (Informational)', () => {
        test('Memory usage during large directory listing', async () => {
            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }

            const memBefore = process.memoryUsage();

            // Request large directory
            const res = await request.get('/very-large-directory/');
            expect(res.status).toBe(200);

            const memAfter = process.memoryUsage();

            const heapUsedDiff = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;
            const externalDiff = (memAfter.external - memBefore.external) / 1024 / 1024;

            console.log('\n📊 Memory Usage (10,000 files directory):');
            console.log(`   Heap used increase: ${heapUsedDiff.toFixed(2)} MB`);
            console.log(`   External increase: ${externalDiff.toFixed(2)} MB`);
            console.log(`   Response size: ${(res.text.length / 1024 / 1024).toFixed(2)} MB`);
            console.log(`   ⚠️  Expected to reduce by ~30-40% after optimization`);
        }, 30000);
    });
});

// Summary report
afterAll(() => {
    console.log('\n' + '='.repeat(70));
    console.log('📋 BASELINE BENCHMARK SUMMARY');
    console.log('='.repeat(70));
    console.log('\nThese results represent the CURRENT performance (v1.2.0)');
    console.log('After implementing optimizations, run this test again to see improvements.\n');
    console.log('Expected improvements after optimization:');
    console.log('  ✓ Small files:        10-20% faster (async operations)');
    console.log('  ✓ Large directories:  50-70% faster (async + array join)');
    console.log('  ✓ Concurrent requests: 5-10x faster (non-blocking event loop)');
    console.log('  ✓ Memory usage:       30-40% reduction (array join vs concatenation)');
    console.log('  ✓ With HTTP caching:  80-95% faster (304 responses)');
    console.log('='.repeat(70) + '\n');
});
