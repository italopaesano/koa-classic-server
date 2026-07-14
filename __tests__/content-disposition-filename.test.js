/**
 * Content-Disposition filename handling — regression tests for finding #1 of
 * docs/revisione_codice_v4.3.md.
 *
 * The quoted-string fallback (`filename="..."`) must stay within what Node
 * accepts in a header value (printable latin1): before the fix, a filename
 * containing CJK / emoji / control characters made ctx.set() throw
 * ERR_INVALID_CHAR, which surfaced as a 500 — breaking the middleware's
 * primary contract ("if a file exists, GET on its path returns it").
 * Characters outside printable latin1 are replaced with '?' in the fallback
 * (same policy as express's content-disposition package); the real name still
 * round-trips via the RFC 5987 `filename*` form.
 *
 * Platform note: NTFS forbids `"`, `\` and control characters in filenames
 * (and `\` is the Windows path separator), so the control-char and
 * quote/backslash fixtures cannot exist there — those tests are skipped on
 * win32. CJK / emoji / latin1 names are valid on every supported platform.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

const IS_WINDOWS = process.platform === 'win32';
const testUnixOnly = IS_WINDOWS ? test.skip : test;

const CJK_NAME     = '中文ファイル.txt';
const EMOJI_NAME   = '🎉party.txt';
const LATIN1_NAME  = 'café.txt';
const CONTROL_NAME = 'a\nb.txt';        // unrepresentable on NTFS
const QUOTED_NAME  = 'we"ird\\name.txt'; // unrepresentable on NTFS

const FIXTURES = [CJK_NAME, EMOJI_NAME, LATIN1_NAME]
    .concat(IS_WINDOWS ? [] : [CONTROL_NAME, QUOTED_NAME]);

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-cd-'));
    for (const name of FIXTURES) {
        fs.writeFileSync(path.join(root, name), 'content of ' + name);
    }
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function capturingLogger() {
    const errors = [];
    return { errors, error: (...args) => errors.push(args.map(String).join(' ')), warn: () => {} };
}

// Extracts the two filename forms from a Content-Disposition header value.
function parseCd(header) {
    const quoted = /filename="((?:[^"\\]|\\.)*)"/.exec(header);
    const ext = /filename\*=UTF-8''([^;]*)/.exec(header);
    return {
        fallback: quoted && quoted[1],
        real: ext && decodeURIComponent(ext[1]),
    };
}

describe('Content-Disposition — filenames outside printable latin1 (finding #1, v4.3 register)', () => {
    let server, logger;

    beforeAll(() => {
        logger = capturingLogger();
        const app = new Koa();
        app.use(koaClassicServer(root, { logger }));
        server = app.listen();
    });

    afterAll(() => server.close());

    test.each([
        ['CJK', CJK_NAME],
        ['emoji', EMOJI_NAME],
    ])('a file with a %s name is served with 200, not 500', async (_label, name) => {
        const res = await supertest(server).get('/' + encodeURIComponent(name));
        expect(res.status).toBe(200);
        expect(res.text).toBe('content of ' + name);
    });

    testUnixOnly('a file with a control character in the name is served with 200, not 500', async () => {
        const res = await supertest(server).get('/' + encodeURIComponent(CONTROL_NAME));
        expect(res.status).toBe(200);
        expect(res.text).toBe('content of ' + CONTROL_NAME);
    });

    test('the RFC 5987 filename* form round-trips the real name', async () => {
        const res = await supertest(server).get('/' + encodeURIComponent(CJK_NAME));
        expect(parseCd(res.headers['content-disposition']).real).toBe(CJK_NAME);
    });

    test('the quoted-string fallback replaces non-latin1 characters with "?"', async () => {
        const res = await supertest(server).get('/' + encodeURIComponent(CJK_NAME));
        expect(parseCd(res.headers['content-disposition']).fallback).toBe('??????.txt');
    });

    testUnixOnly('control characters are replaced in the fallback too', async () => {
        const res = await supertest(server).get('/' + encodeURIComponent(CONTROL_NAME));
        expect(parseCd(res.headers['content-disposition']).fallback).toBe('a?b.txt');
    });

    test('latin1 names are NOT degraded (no regression on the previously working range)', async () => {
        const res = await supertest(server).get('/' + encodeURIComponent(LATIN1_NAME));
        expect(res.status).toBe(200);
        const cd = parseCd(res.headers['content-disposition']);
        expect(cd.fallback).toBe(LATIN1_NAME); // é (0xE9) stays literal, as before the fix
        expect(cd.real).toBe(LATIN1_NAME);
    });

    testUnixOnly('quote and backslash escaping in the fallback still works', async () => {
        const res = await supertest(server).get('/' + encodeURIComponent(QUOTED_NAME));
        expect(res.status).toBe(200);
        expect(parseCd(res.headers['content-disposition']).fallback).toBe('we\\"ird\\\\name.txt');
        expect(parseCd(res.headers['content-disposition']).real).toBe(QUOTED_NAME);
    });

    test('a Range request (206) on a non-latin1 name does not 500 either', async () => {
        const res = await supertest(server)
            .get('/' + encodeURIComponent(CJK_NAME))
            .set('Range', 'bytes=0-3');
        expect(res.status).toBe(206);
        expect(parseCd(res.headers['content-disposition']).real).toBe(CJK_NAME);
    });

    // The pre-fix bug logged "[koa-classic-server] Unexpected error ... ERR_INVALID_CHAR"
    // on every affected request. Assert on that signature specifically: benign
    // client-side teardown noise (ERR_STREAM_PREMATURE_CLOSE from a closed
    // keep-alive socket) is timing-dependent and must not fail this suite.
    test('no header-validation error reaches the logger (the pre-fix bug logged one per request)', () => {
        const regressionSignature = logger.errors.filter(
            (msg) => msg.includes('ERR_INVALID_CHAR') || msg.includes('Unexpected error')
        );
        expect(regressionSignature).toEqual([]);
    });
});
