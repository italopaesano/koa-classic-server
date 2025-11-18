#!/usr/bin/env node

/**
 * Demo: Enhanced index option with RegExp support
 *
 * Questo esempio dimostra come usare RegExp nell'opzione index
 * per matching case-insensitive e pattern flessibili
 */

const Koa = require('koa');
const koaClassicServer = require('./index.cjs');
const fs = require('fs');
const path = require('path');

// Crea directory di test
const testDir = path.join(__dirname, 'demo-regex-test');
if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir);
}

// Crea file di test con vari case
console.log('📁 Creazione file di test...\n');

const files = [
    { name: 'INDEX.HTML', content: '<h1 style="color: red;">Trovato INDEX.HTML (maiuscolo)</h1>' },
    { name: 'Index.Html', content: '<h1 style="color: blue;">Trovato Index.Html (mixed case)</h1>' },
    { name: 'index.htm', content: '<h1 style="color: green;">Trovato index.htm (estensione .htm)</h1>' },
    { name: 'default.html', content: '<h1 style="color: orange;">Trovato default.html</h1>' },
    { name: 'readme.txt', content: 'Questo è un file normale' }
];

files.forEach(file => {
    const filePath = path.join(testDir, file.name);
    fs.writeFileSync(filePath, file.content);
    console.log(`  ✓ Creato: ${file.name}`);
});

console.log('\n' + '='.repeat(70));
console.log('🧪 TEST CONFIGURAZIONI DIVERSE\n');

// ============================================================================
// TEST 1: Solo case-insensitive .html
// ============================================================================
console.log('TEST 1: RegExp case-insensitive /index\\.html/i');
console.log('  Pattern: [/index\\.html/i]');
console.log('  Aspettativa: Matcha INDEX.HTML o Index.Html');

const app1 = new Koa();
app1.use(koaClassicServer(testDir, {
    index: [/index\.html/i],
    showDirContents: true
}));
const server1 = app1.listen(3001);
console.log('  ✓ Server avviato su http://localhost:3001\n');

// ============================================================================
// TEST 2: Multiple estensioni (.html e .htm)
// ============================================================================
console.log('TEST 2: RegExp per .html e .htm');
console.log('  Pattern: [/index\\.(html|htm)/i]');
console.log('  Aspettativa: Matcha INDEX.HTML, Index.Html, index.htm');

const app2 = new Koa();
app2.use(koaClassicServer(testDir, {
    index: [/index\.(html|htm)/i],
    showDirContents: true
}));
const server2 = app2.listen(3002);
console.log('  ✓ Server avviato su http://localhost:3002\n');

// ============================================================================
// TEST 3: Priority: index.html prima, poi default.html
// ============================================================================
console.log('TEST 3: Array con priorità');
console.log('  Pattern: [/index\\.(html|htm)/i, /default\\.html/i]');
console.log('  Aspettativa: Prima cerca index.*, poi default.html');

const app3 = new Koa();
app3.use(koaClassicServer(testDir, {
    index: [
        /index\.(html|htm)/i,
        /default\.html/i
    ],
    showDirContents: true
}));
const server3 = app3.listen(3003);
console.log('  ✓ Server avviato su http://localhost:3003\n');

// ============================================================================
// TEST 4: Mixed (string + RegExp)
// ============================================================================
console.log('TEST 4: Mixed array (string exact + RegExp fallback)');
console.log('  Pattern: ["index.html", /INDEX\\.HTML/i, /default\\.html/i]');
console.log('  Aspettativa: Prima exact "index.html", poi case-insensitive');

const app4 = new Koa();
app4.use(koaClassicServer(testDir, {
    index: [
        'index.html',       // Exact match (più veloce)
        /INDEX\.HTML/i,     // Case-insensitive fallback
        /default\.html/i    // Default fallback
    ],
    showDirContents: true
}));
const server4 = app4.listen(3004);
console.log('  ✓ Server avviato su http://localhost:3004\n');

console.log('='.repeat(70));
console.log('\n🌐 SERVER ATTIVI:\n');
console.log('  1️⃣  http://localhost:3001 - Case-insensitive /index\\.html/i');
console.log('  2️⃣  http://localhost:3002 - Multi-extension /index\\.(html|htm)/i');
console.log('  3️⃣  http://localhost:3003 - Priority array con fallback');
console.log('  4️⃣  http://localhost:3004 - Mixed string + RegExp\n');

console.log('📝 File presenti nella directory:');
files.forEach(file => {
    console.log(`     - ${file.name}`);
});

console.log('\n💡 Prova ad aprire i link sopra per vedere quale file viene servito!');
console.log('   Ogni server ha una configurazione diversa.\n');
console.log('⏹️  Premi Ctrl+C per fermare i server\n');

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('\n\n🧹 Chiusura server e pulizia...');
    server1.close();
    server2.close();
    server3.close();
    server4.close();

    // Rimuovi file di test
    files.forEach(file => {
        fs.unlinkSync(path.join(testDir, file.name));
    });
    fs.rmdirSync(testDir);

    console.log('✓ Cleanup completato\n');
    process.exit(0);
});
