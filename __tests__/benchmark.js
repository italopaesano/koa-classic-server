#!/usr/bin/env node

/**
 * HTTP Load Testing Benchmark using autocannon
 *
 * This script performs realistic load testing to measure:
 * - Requests per second
 * - Latency (avg, p50, p99)
 * - Throughput
 *
 * Usage:
 *   node benchmark.js
 *   node benchmark.js --save baseline.json
 *
 * Compare before/after:
 *   node benchmark.js --save before.json
 *   # ... apply optimizations ...
 *   node benchmark.js --save after.json --compare before.json
 */

const autocannon = require('autocannon');
const Koa = require('koa');
const koaClassicServer = require('./index.cjs');
const path = require('path');
const fs = require('fs');

const BENCHMARK_DIR = path.join(__dirname, 'benchmark-data');

// Check if benchmark data exists
if (!fs.existsSync(BENCHMARK_DIR)) {
    console.error('\n❌ Benchmark data not found!');
    console.error('Please run: node scripts/setup-benchmark.js\n');
    process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
const saveFile = args.includes('--save') ? args[args.indexOf('--save') + 1] : null;
const compareFile = args.includes('--compare') ? args[args.indexOf('--compare') + 1] : null;

console.log('🚀 Starting koa-classic-server benchmark...\n');

// Start server
const app = new Koa();
app.use(koaClassicServer(BENCHMARK_DIR));
const server = app.listen(0); // Random available port

const port = server.address().port;
console.log(`Server running on http://localhost:${port}\n`);

// Define benchmark scenarios
const scenarios = [
    {
        name: 'Small file (1KB)',
        url: `http://localhost:${port}/small-files/file-1.txt`,
        duration: 10,
        connections: 10
    },
    {
        name: 'Medium file (100KB)',
        url: `http://localhost:${port}/medium-files/file-1.txt`,
        duration: 10,
        connections: 10
    },
    {
        name: 'Large file (1MB)',
        url: `http://localhost:${port}/large-files/file-1.txt`,
        duration: 10,
        connections: 10
    },
    {
        name: 'Directory listing (100 files)',
        url: `http://localhost:${port}/small-files/`,
        duration: 10,
        connections: 10
    },
    {
        name: 'Directory listing (1,000 files)',
        url: `http://localhost:${port}/large-directory/`,
        duration: 10,
        connections: 5
    },
    {
        name: 'HTML file',
        url: `http://localhost:${port}/test.html`,
        duration: 10,
        connections: 10
    },
    {
        name: '404 Not Found',
        url: `http://localhost:${port}/does-not-exist.txt`,
        duration: 10,
        connections: 10
    }
];

// Run benchmarks sequentially
async function runBenchmarks() {
    const results = {};

    for (const scenario of scenarios) {
        console.log('─'.repeat(70));
        console.log(`📊 Benchmarking: ${scenario.name}`);
        console.log('─'.repeat(70));

        const result = await runBenchmark(scenario);
        results[scenario.name] = result;

        // Wait a bit between tests
        await sleep(2000);
    }

    return results;
}

function runBenchmark(scenario) {
    return new Promise((resolve, reject) => {
        const instance = autocannon({
            url: scenario.url,
            connections: scenario.connections,
            duration: scenario.duration,
            pipelining: 1,
        }, (err, result) => {
            if (err) {
                reject(err);
            } else {
                printResults(result, scenario.name);
                resolve(formatResults(result, scenario.name));
            }
        });

        autocannon.track(instance, { renderProgressBar: true });
    });
}

function printResults(result, name) {
    console.log(`\n✓ ${name} - Results:`);
    console.log(`  Requests/sec:  ${result.requests.average.toFixed(2)}`);
    console.log(`  Latency (avg): ${result.latency.mean.toFixed(2)}ms`);
    console.log(`  Latency (p50): ${result.latency.p50.toFixed(2)}ms`);
    console.log(`  Latency (p99): ${result.latency.p99.toFixed(2)}ms`);
    console.log(`  Throughput:    ${(result.throughput.average / 1024 / 1024).toFixed(2)} MB/sec`);
    console.log(`  Total requests: ${result.requests.total}`);
    console.log('');
}

function formatResults(result, name) {
    return {
        name,
        requestsPerSecond: result.requests.average,
        latency: {
            mean: result.latency.mean,
            p50: result.latency.p50,
            p75: result.latency.p75,
            p90: result.latency.p90,
            p99: result.latency.p99,
            p999: result.latency.p999
        },
        throughput: result.throughput.average,
        totalRequests: result.requests.total,
        errors: result.errors
    };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Main execution
runBenchmarks()
    .then(results => {
        console.log('='.repeat(70));
        console.log('📋 BENCHMARK SUMMARY');
        console.log('='.repeat(70));
        console.log('');

        // Summary table
        console.log('Scenario                          | Req/sec | Latency (avg) | Throughput');
        console.log('----------------------------------|---------|---------------|-------------');

        Object.values(results).forEach(result => {
            const name = result.name.padEnd(33);
            const reqSec = result.requestsPerSecond.toFixed(0).padStart(7);
            const latency = `${result.latency.mean.toFixed(2)}ms`.padStart(13);
            const throughput = `${(result.throughput / 1024 / 1024).toFixed(2)} MB/s`.padStart(11);
            console.log(`${name} | ${reqSec} | ${latency} | ${throughput}`);
        });

        console.log('');
        console.log('='.repeat(70));

        // Save results if requested
        if (saveFile) {
            const data = {
                timestamp: new Date().toISOString(),
                version: require('./package.json').version,
                results
            };
            fs.writeFileSync(saveFile, JSON.stringify(data, null, 2));
            console.log(`\n✓ Results saved to: ${saveFile}`);
        }

        // Compare with previous results if requested
        if (compareFile && fs.existsSync(compareFile)) {
            const previous = JSON.parse(fs.readFileSync(compareFile, 'utf8'));
            console.log('\n📊 COMPARISON WITH PREVIOUS RESULTS');
            console.log('='.repeat(70));

            Object.keys(results).forEach(key => {
                const current = results[key];
                const prev = previous.results[key];

                if (prev) {
                    const reqDiff = ((current.requestsPerSecond - prev.requestsPerSecond) / prev.requestsPerSecond * 100);
                    const latDiff = ((current.latency.mean - prev.latency.mean) / prev.latency.mean * 100);

                    console.log(`\n${key}:`);
                    console.log(`  Requests/sec: ${prev.requestsPerSecond.toFixed(2)} → ${current.requestsPerSecond.toFixed(2)} (${reqDiff > 0 ? '+' : ''}${reqDiff.toFixed(1)}%)`);
                    console.log(`  Latency:      ${prev.latency.mean.toFixed(2)}ms → ${current.latency.mean.toFixed(2)}ms (${latDiff > 0 ? '+' : ''}${latDiff.toFixed(1)}%)`);

                    if (reqDiff > 10) {
                        console.log(`  ✅ Significant improvement!`);
                    } else if (reqDiff < -10) {
                        console.log(`  ⚠️  Performance regression!`);
                    }
                }
            });

            console.log('\n' + '='.repeat(70));
        }

        server.close();
        console.log('\n✓ Benchmark complete!\n');
    })
    .catch(err => {
        console.error('❌ Benchmark failed:', err);
        server.close();
        process.exit(1);
    });
