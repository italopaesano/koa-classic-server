/**
 * ESM entry-point smoke test — 2026-07 coverage review.
 *
 * package.json publishes a dual entry point:
 *   exports: { import: './index.mjs', require: './index.cjs' }
 * but index.mjs was never loaded by any test (0% coverage), so a broken
 * re-export (typo'd path, missing default) would only be caught by users.
 *
 * Jest's default CJS transform cannot load real ESM, so the import runs in a
 * child `node` process with --input-type=module — the exact loader a real
 * `import` consumer uses. The child asserts the export surface and exercises
 * the factory end-to-end.
 */

const { execFile } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');

const MJS_URL = pathToFileURL(path.join(__dirname, '..', 'index.mjs')).href;

function runEsm(code) {
    return new Promise(resolve => {
        execFile(
            process.execPath,
            ['--input-type=module', '-e', code],
            { timeout: 30000 },
            (error, stdout, stderr) => resolve({ error, stdout, stderr })
        );
    });
}

describe('index.mjs (ESM entry point)', () => {
    test('default export is the factory function and builds a working middleware', async () => {
        const { error, stdout, stderr } = await runEsm(`
            import koaClassicServer from '${MJS_URL}';
            import assert from 'node:assert';
            import os from 'node:os';

            assert.strictEqual(typeof koaClassicServer, 'function', 'default export must be the factory');

            const mw = koaClassicServer(os.tmpdir());
            assert.strictEqual(typeof mw, 'function', 'factory must return a middleware');
            assert.strictEqual(mw.length, 2, 'middleware must accept (ctx, next)');

            // The factory guards must be live through the ESM wrapper too.
            assert.throws(() => koaClassicServer('relative/path'), /absolute path/);

            console.log('ESM_OK');
        `);

        expect(stderr).toBe('');
        expect(error).toBeNull();
        expect(stdout).toContain('ESM_OK');
    });

    test('ESM default export and CJS export are the same function', async () => {
        const cjsPath = path.join(__dirname, '..', 'index.cjs');
        const { error, stdout } = await runEsm(`
            import koaClassicServer from '${MJS_URL}';
            import { createRequire } from 'node:module';
            const require = createRequire('${pathToFileURL(__filename).href}');
            const cjs = require(${JSON.stringify(cjsPath)});
            console.log(koaClassicServer === cjs ? 'SAME' : 'DIFFERENT');
        `);

        expect(error).toBeNull();
        expect(stdout).toContain('SAME');
    });
});
