#!/usr/bin/env node

/**
 * Setup script for performance benchmarks
 * Creates test files and directories for realistic performance testing
 */

const fs = require('fs');
const path = require('path');

const BENCHMARK_DIR = path.join(__dirname, '../benchmark-data');

console.log('🔧 Setting up benchmark environment...\n');

// Clean up old benchmark data
if (fs.existsSync(BENCHMARK_DIR)) {
    console.log('Cleaning old benchmark data...');
    fs.rmSync(BENCHMARK_DIR, { recursive: true, force: true });
}

// Create benchmark directory
fs.mkdirSync(BENCHMARK_DIR, { recursive: true });

// Create small files (1KB each)
console.log('Creating small files (1KB each)...');
const smallDir = path.join(BENCHMARK_DIR, 'small-files');
fs.mkdirSync(smallDir);
for (let i = 1; i <= 100; i++) {
    const content = 'X'.repeat(1024); // 1KB
    fs.writeFileSync(path.join(smallDir, `file-${i}.txt`), content);
}
console.log(`✓ Created 100 small files (1KB each) = 100KB total`);

// Create medium files (100KB each)
console.log('Creating medium files (100KB each)...');
const mediumDir = path.join(BENCHMARK_DIR, 'medium-files');
fs.mkdirSync(mediumDir);
for (let i = 1; i <= 50; i++) {
    const content = 'X'.repeat(100 * 1024); // 100KB
    fs.writeFileSync(path.join(mediumDir, `file-${i}.txt`), content);
}
console.log(`✓ Created 50 medium files (100KB each) = 5MB total`);

// Create large files (1MB each)
console.log('Creating large files (1MB each)...');
const largeDir = path.join(BENCHMARK_DIR, 'large-files');
fs.mkdirSync(largeDir);
for (let i = 1; i <= 10; i++) {
    const content = 'X'.repeat(1024 * 1024); // 1MB
    fs.writeFileSync(path.join(largeDir, `file-${i}.txt`), content);
}
console.log(`✓ Created 10 large files (1MB each) = 10MB total`);

// Create directory with many files for listing test
console.log('Creating large directory (1000 files)...');
const largeDirListing = path.join(BENCHMARK_DIR, 'large-directory');
fs.mkdirSync(largeDirListing);
for (let i = 1; i <= 1000; i++) {
    const content = `File number ${i}\n`;
    fs.writeFileSync(path.join(largeDirListing, `item-${String(i).padStart(4, '0')}.txt`), content);
}
console.log(`✓ Created directory with 1000 files`);

// Create directory with very many files (10,000) for stress test
console.log('Creating very large directory (10,000 files) - this may take a while...');
const veryLargeDirListing = path.join(BENCHMARK_DIR, 'very-large-directory');
fs.mkdirSync(veryLargeDirListing);
for (let i = 1; i <= 10000; i++) {
    const content = `File number ${i}\n`;
    fs.writeFileSync(path.join(veryLargeDirListing, `item-${String(i).padStart(5, '0')}.txt`), content);
    if (i % 1000 === 0) {
        process.stdout.write(`  Progress: ${i}/10000 files created...\r`);
    }
}
console.log(`✓ Created directory with 10,000 files                    `);

// Create HTML file for caching test
console.log('Creating HTML files for caching test...');
const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Benchmark Test Page</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        p { line-height: 1.6; }
    </style>
</head>
<body>
    <h1>Benchmark Test Page</h1>
    <p>${'Lorem ipsum dolor sit amet. '.repeat(100)}</p>
</body>
</html>`;
fs.writeFileSync(path.join(BENCHMARK_DIR, 'test.html'), htmlContent);
console.log(`✓ Created HTML file for caching test`);

// Create CSS file
const cssContent = `
body {
    margin: 0;
    padding: 20px;
    font-family: system-ui, -apple-system, sans-serif;
}
${'h1 { color: #333; }\n'.repeat(50)}
`.trim();
fs.writeFileSync(path.join(BENCHMARK_DIR, 'style.css'), cssContent);
console.log(`✓ Created CSS file`);

// Create JS file
const jsContent = `
function benchmark() {
    console.log('Benchmark test');
    ${'console.log("test");\n'.repeat(100)}
}
`.trim();
fs.writeFileSync(path.join(BENCHMARK_DIR, 'script.js'), jsContent);
console.log(`✓ Created JS file`);

// Create nested directory structure
console.log('Creating nested directory structure...');
const nestedBase = path.join(BENCHMARK_DIR, 'nested');
fs.mkdirSync(nestedBase);
for (let depth = 1; depth <= 5; depth++) {
    const dirPath = path.join(nestedBase, ...Array(depth).fill('level'));
    fs.mkdirSync(dirPath, { recursive: true });
    for (let i = 1; i <= 10; i++) {
        fs.writeFileSync(
            path.join(dirPath, `file-depth${depth}-${i}.txt`),
            `Depth ${depth}, File ${i}\n`
        );
    }
}
console.log(`✓ Created nested directory structure (5 levels deep)`);

// Create .gitignore for benchmark-data
const gitignorePath = path.join(BENCHMARK_DIR, '.gitignore');
fs.writeFileSync(gitignorePath, '*\n');
console.log(`✓ Created .gitignore to exclude benchmark data from git`);

// Summary
console.log('\n✅ Benchmark environment setup complete!\n');
console.log('Directory structure:');
console.log('  benchmark-data/');
console.log('    ├── small-files/        (100 files × 1KB = 100KB)');
console.log('    ├── medium-files/       (50 files × 100KB = 5MB)');
console.log('    ├── large-files/        (10 files × 1MB = 10MB)');
console.log('    ├── large-directory/    (1,000 files for listing test)');
console.log('    ├── very-large-directory/ (10,000 files for stress test)');
console.log('    ├── nested/             (5 levels deep, 10 files each)');
console.log('    ├── test.html           (HTML for caching test)');
console.log('    ├── style.css           (CSS file)');
console.log('    └── script.js           (JS file)');

const stats = getDirSize(BENCHMARK_DIR);
console.log(`\nTotal size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
console.log(`Total files: ${stats.files}`);

function getDirSize(dir) {
    let totalSize = 0;
    let totalFiles = 0;

    function traverse(currentPath) {
        const items = fs.readdirSync(currentPath, { withFileTypes: true });
        for (const item of items) {
            const fullPath = path.join(currentPath, item.name);
            if (item.isDirectory()) {
                traverse(fullPath);
            } else {
                totalSize += fs.statSync(fullPath).size;
                totalFiles++;
            }
        }
    }

    traverse(dir);
    return { size: totalSize, files: totalFiles };
}
