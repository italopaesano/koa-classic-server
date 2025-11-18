#!/usr/bin/env node

/**
 * Quick test: RegExp index option
 */

const Koa = require('koa');
const koaClassicServer = require('./index.cjs');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Crea directory di test
const testDir = path.join(__dirname, 'test-regex-temp');
if (fs.existsSync(testDir)) {
    fs.readdirSync(testDir).forEach(file => {
        fs.unlinkSync(path.join(testDir, file));
    });
    fs.rmdirSync(testDir);
}
fs.mkdirSync(testDir);

// Test case 1: Case-insensitive matching
console.log('\n📋 TEST 1: Case-insensitive /index\\.html/i\n');
console.log('File creati:');
console.log('  - INDEX.HTML (maiuscolo)');
console.log('  - other.txt\n');

fs.writeFileSync(path.join(testDir, 'INDEX.HTML'), '<h1>INDEX.HTML (MAIUSCOLO)</h1>');
fs.writeFileSync(path.join(testDir, 'other.txt'), 'altro file');

const app1 = new Koa();
app1.use(koaClassicServer(testDir, {
    index: [/index\.html/i]  // ← REGEXP CASE-INSENSITIVE!
}));

const server1 = app1.listen(9001);

// Test la richiesta
setTimeout(() => {
    http.get('http://localhost:9001/', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            if (data.includes('INDEX.HTML (MAIUSCOLO)')) {
                console.log('✅ SUCCESS: Il server ha trovato INDEX.HTML usando /index\\.html/i');
                console.log('   Contenuto ricevuto: ' + data.trim());
            } else {
                console.log('❌ FAIL: Pattern non ha matchato');
                console.log('   Contenuto ricevuto: ' + data);
            }

            server1.close();

            // Test case 2
            runTest2();
        });
    });
}, 100);

function runTest2() {
    // Pulisci directory
    fs.readdirSync(testDir).forEach(file => {
        fs.unlinkSync(path.join(testDir, file));
    });

    console.log('\n📋 TEST 2: Multi-extension /index\\.(html|htm)/i\n');
    console.log('File creati:');
    console.log('  - Index.HTM (mixed case, estensione .htm)');
    console.log('  - other.html\n');

    fs.writeFileSync(path.join(testDir, 'Index.HTM'), '<h1>Index.HTM (mixed case)</h1>');
    fs.writeFileSync(path.join(testDir, 'other.html'), '<h1>altro</h1>');

    const app2 = new Koa();
    app2.use(koaClassicServer(testDir, {
        index: [/index\.(html|htm)/i]  // ← REGEXP con (html|htm)!
    }));

    const server2 = app2.listen(9002);

    setTimeout(() => {
        http.get('http://localhost:9002/', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (data.includes('Index.HTM (mixed case)')) {
                    console.log('✅ SUCCESS: Il server ha trovato Index.HTM usando /index\\.(html|htm)/i');
                    console.log('   Contenuto ricevuto: ' + data.trim());
                } else {
                    console.log('❌ FAIL: Pattern non ha matchato');
                    console.log('   Contenuto ricevuto: ' + data);
                }

                server2.close();

                // Test case 3
                runTest3();
            });
        });
    }, 100);
}

function runTest3() {
    // Pulisci directory
    fs.readdirSync(testDir).forEach(file => {
        fs.unlinkSync(path.join(testDir, file));
    });

    console.log('\n📋 TEST 3: Array con priorità [/index\\.html/i, /default\\.html/i]\n');
    console.log('File creati:');
    console.log('  - DEFAULT.HTML (maiuscolo)');
    console.log('  - other.txt\n');
    console.log('Nota: index.html NON esiste, dovrebbe trovare default.html\n');

    fs.writeFileSync(path.join(testDir, 'DEFAULT.HTML'), '<h1>DEFAULT.HTML (fallback)</h1>');
    fs.writeFileSync(path.join(testDir, 'other.txt'), 'altro');

    const app3 = new Koa();
    app3.use(koaClassicServer(testDir, {
        index: [
            /index\.html/i,    // Prima cerca index.html (NON esiste)
            /default\.html/i   // Poi cerca default.html (ESISTE!)
        ]
    }));

    const server3 = app3.listen(9003);

    setTimeout(() => {
        http.get('http://localhost:9003/', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (data.includes('DEFAULT.HTML (fallback)')) {
                    console.log('✅ SUCCESS: Il server ha fatto fallback a DEFAULT.HTML');
                    console.log('   Contenuto ricevuto: ' + data.trim());
                } else {
                    console.log('❌ FAIL: Fallback non ha funzionato');
                    console.log('   Contenuto ricevuto: ' + data);
                }

                server3.close();

                // Cleanup finale
                cleanup();
            });
        });
    }, 100);
}

function cleanup() {
    console.log('\n🧹 Pulizia...\n');
    fs.readdirSync(testDir).forEach(file => {
        fs.unlinkSync(path.join(testDir, file));
    });
    fs.rmdirSync(testDir);
    console.log('✅ Tutti i test completati!\n');
}
