# Performance Benchmarks

This directory contains comprehensive performance benchmarks for `koa-classic-server`.

## Purpose

These benchmarks measure:
- **Response times** for different file sizes
- **Directory listing performance** for various sizes
- **Concurrent request handling**
- **Memory usage**
- **Throughput** (requests/second, MB/second)

## Quick Start

### 1. Setup Benchmark Data

First, create the test files and directories:

```bash
npm run benchmark:setup
```

This creates:
- `benchmark-data/small-files/` - 100 files × 1KB
- `benchmark-data/medium-files/` - 50 files × 100KB
- `benchmark-data/large-files/` - 10 files × 1MB
- `benchmark-data/large-directory/` - 1,000 files for listing test
- `benchmark-data/very-large-directory/` - 10,000 files for stress test
- `benchmark-data/nested/` - 5 levels deep directory structure

Total: ~15 MB of test data

### 2. Run Jest Performance Tests

```bash
npm run test:performance
```

This runs comprehensive tests measuring:
- Individual file serving times
- Directory listing times
- Concurrent request handling
- 404 error handling
- Memory usage

**Save results:**
```bash
npm run test:performance > results-baseline-v1.2.0.txt
```

### 3. Run HTTP Load Tests (autocannon)

```bash
npm run benchmark
```

This performs realistic load testing with:
- 10 seconds per scenario
- 5-10 concurrent connections
- Measures requests/sec, latency, throughput

**Save results for comparison:**
```bash
npm run benchmark:save baseline-v1.2.0.json
```

## Workflow: Before/After Optimization

### Step 1: Baseline (BEFORE optimization)

```bash
# Setup test data
npm run benchmark:setup

# Run tests and save results
npm run test:performance > results-before.txt
npm run benchmark:save baseline-before.json
```

### Step 2: Apply Optimizations

Make code changes to improve performance...

### Step 3: Compare (AFTER optimization)

```bash
# Run tests again
npm run test:performance > results-after.txt
npm run benchmark:save baseline-after.json --compare baseline-before.json
```

### Step 4: Analyze Differences

```bash
# Compare test results
diff results-before.txt results-after.txt

# Benchmark comparison is shown automatically
```

## Expected Improvements

After implementing the optimizations from `PERFORMANCE_ANALYSIS.md`:

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Small file (1KB) | ~2.5ms | ~0.5ms | **80% faster** |
| Directory (1,000 files) | ~120ms | ~40ms | **67% faster** |
| Directory (10,000 files) | ~1,800ms | ~450ms | **75% faster** |
| Concurrent requests | Sequential | Parallel | **5-10x faster** |
| Memory (10k directory) | ~25MB | ~15MB | **40% less** |

With HTTP caching enabled:
| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Cached file | 2.5ms | 0.1ms | **96% faster** |
| Bandwidth | 100% | 5% | **95% reduction** |

## Understanding the Results

### Jest Performance Tests

Output includes:
- **Average time**: Mean across all iterations
- **Median time**: 50th percentile (less affected by outliers)
- **Min/Max time**: Range of values
- **Warnings**: Areas where optimizations will have big impact

Example output:
```
📊 Large Directory (1,000 files) Benchmark:
   Average: 123.45ms
   Median:  120.30ms
   Min:     110.20ms
   Max:     145.80ms
   ⚠️  WARNING: This will be MUCH faster after async optimization
```

### Autocannon Load Tests

Output includes:
- **Requests/sec**: How many requests the server can handle per second
- **Latency**: Response time (avg, p50, p99)
- **Throughput**: Data transferred per second (MB/sec)

Example output:
```
Scenario                          | Req/sec | Latency (avg) | Throughput
----------------------------------|---------|---------------|-------------
Small file (1KB)                  |    2500 |       4.00ms  |    2.44 MB/s
Directory listing (1,000 files)   |      80 |     125.00ms  |   15.60 MB/s
```

Higher **Requests/sec** = Better ✅
Lower **Latency** = Better ✅
Higher **Throughput** = Better ✅

## Interpreting Latency Percentiles

- **p50 (median)**: 50% of requests complete in this time
- **p75**: 75% of requests complete in this time
- **p90**: 90% of requests complete in this time
- **p99**: 99% of requests complete in this time
- **p999**: 99.9% of requests complete in this time

**Why p99 matters:**
- p50 might be 10ms, but p99 could be 100ms
- This means 1% of users experience 10× slower responses
- Optimizations should improve both average AND p99

## Memory Usage Tests

Memory tests show:
- **Heap used**: JavaScript objects, strings, arrays
- **External**: Buffers, native objects
- **Response size**: Size of HTML/data generated

**What to look for:**
- Large heap increase = memory leaks or inefficient allocation
- After optimization: should see 30-40% reduction

## Directory Structure

```
koa-classic-server/
├── benchmark-data/           # Test data (git-ignored, ~15MB)
│   ├── small-files/
│   ├── medium-files/
│   ├── large-files/
│   ├── large-directory/
│   └── very-large-directory/
├── scripts/
│   └── setup-benchmark.js    # Creates test data
├── __tests__/
│   └── performance.test.js   # Jest performance tests
├── benchmark.js              # Autocannon load tests
└── BENCHMARKS.md            # This file
```

## Troubleshooting

### "Benchmark data not found"

Run: `npm run benchmark:setup`

### Tests timeout

Increase Jest timeout in `performance.test.js`:
```javascript
test('...', async () => { ... }, 60000); // 60 seconds
```

### Out of memory

Reduce iterations or skip very-large-directory tests:
```javascript
test.skip('Very large directory...', async () => { ... });
```

### Inconsistent results

- Close other applications
- Run multiple times and average results
- Check system load: `top` or `htop`
- Disable CPU throttling

## Best Practices

1. **Run on idle system**: Close browsers, apps
2. **Run multiple times**: Results vary, average 3+ runs
3. **Same environment**: Use same machine for before/after
4. **Document environment**: Note CPU, RAM, Node version
5. **Save results**: Use `> file.txt` to save for comparison

## Example: Complete Before/After Test

```bash
# === BEFORE OPTIMIZATION ===

# Setup
npm run benchmark:setup

# Jest tests
npm run test:performance > results-v1.2.0-before.txt

# Load tests
npm run benchmark:save baseline-v1.2.0.json

# === APPLY OPTIMIZATIONS ===
# Edit index.cjs...

# === AFTER OPTIMIZATION ===

# Jest tests
npm run test:performance > results-v1.3.0-after.txt

# Load tests with comparison
node benchmark.js --save baseline-v1.3.0.json --compare baseline-v1.2.0.json

# Review differences
diff results-v1.2.0-before.txt results-v1.3.0-after.txt
```

## Environment Information

When reporting results, include:

```bash
node --version
npm --version
cat /proc/cpuinfo | grep "model name" | head -n 1
free -h
```

Example:
```
Node.js: v20.10.0
npm: 10.2.3
CPU: Intel(R) Core(TM) i7-9750H @ 2.60GHz
RAM: 16GB
OS: Ubuntu 22.04 LTS
```

## Next Steps

After running baseline benchmarks:

1. Review `PERFORMANCE_ANALYSIS.md` for optimization recommendations
2. Review `OPTIMIZATION_HTTP_CACHING.md` for HTTP caching details
3. Implement Priority 1 optimizations:
   - Convert sync operations to async
   - Fix string concatenation in `show_dir()`
   - Add HTTP caching headers
4. Re-run benchmarks to measure improvements
5. Update to v1.3.0 "Performance Edition"

## Contributing

When submitting performance improvements:

1. Run baseline benchmarks BEFORE changes
2. Apply your optimization
3. Run benchmarks AFTER changes
4. Include both results in PR
5. Document the optimization approach

## Resources

- [autocannon documentation](https://github.com/mcollina/autocannon)
- [Jest performance testing](https://jestjs.io/docs/timer-mocks)
- [Node.js performance best practices](https://nodejs.org/en/docs/guides/simple-profiling/)

---

**Last updated**: 2025-11-18
**Version**: 1.2.0 (baseline)
