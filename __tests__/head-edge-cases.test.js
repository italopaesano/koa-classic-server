/**
 * HEAD-method edge combinations — 2026-07 coverage review.
 *
 * head-method.test.js covers the mainline template/static/listing HEAD
 * contract. This file completes the rarer serving-state combinations, where
 * the Content-Length restoration dance is subtle (assigning ctx.body resets
 * the header, so every branch restores it by hand — exactly the kind of thing
 * a refactor silently breaks):
 *
 *   - HEAD × compressed-buffered response (compressed cache path)
 *   - HEAD × compressed-streaming response (no Content-Length by design)
 *   - HEAD × uncompressed response served from the rawFile buffer
 *   - HEAD × template render that produces a STREAM body (stripBodyForHead
 *     must drop Content-Length instead of inventing one)
 *
 * RFC 9110 §9.3.2 contract asserted throughout: same status + headers as GET,
 * no body.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

const CONTENT = 'H'.repeat(2048); // above compression.minFileSize (1024)
let fixturesDir;

beforeAll(() => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-head-edge-'));
    fs.writeFileSync(path.join(fixturesDir, 'asset.txt'), CONTENT);
    fs.writeFileSync(path.join(fixturesDir, 'small.txt'), 'tiny'); // below minFileSize → never compressed
    fs.writeFileSync(path.join(fixturesDir, 'page.ejs'), 'template source');
});

afterAll(() => {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
});

function createServer(opts = {}) {
    const app = new Koa();
    app.on('error', () => {});
    // HEAD must be opted into: the v2-stable default is method: ['GET']
    app.use(koaClassicServer(fixturesDir, { method: ['GET', 'HEAD'], dirListing: { enabled: false }, ...opts }));
    return app.listen();
}

describe('HEAD × compressed-buffered response (compressedFile cache)', () => {
    test('HEAD mirrors the GET status/headers with the COMPRESSED length, empty body', async () => {
        const server = createServer(); // compression + compressedFile cache: defaults (on)

        let getRes, headRes;
        try {
            getRes = await supertest(server).get('/asset.txt').set('Accept-Encoding', 'gzip');
            headRes = await supertest(server).head('/asset.txt').set('Accept-Encoding', 'gzip');
        } finally {
            server.close();
        }

        expect(getRes.status).toBe(200);
        expect(getRes.headers['content-encoding']).toBe('gzip');

        expect(headRes.status).toBe(200);
        expect(headRes.headers['content-encoding']).toBe('gzip');
        expect(headRes.headers['content-type']).toBe(getRes.headers['content-type']);
        // The advertised length is the compressed size — identical to GET's.
        expect(headRes.headers['content-length']).toBe(getRes.headers['content-length']);
        expect(Number(headRes.headers['content-length'])).toBeLessThan(CONTENT.length);
        expect(headRes.text ?? '').toBe('');
    });
});

describe('HEAD × compressed-streaming response (compressedFile cache disabled)', () => {
    test('HEAD answers 200 with Content-Encoding but NO Content-Length (unknown without compressing)', async () => {
        const server = createServer({ serverCache: { compressedFile: { enabled: false } } });

        let res;
        try {
            res = await supertest(server).head('/asset.txt').set('Accept-Encoding', 'gzip');
        } finally {
            server.close();
        }

        expect(res.status).toBe(200); // explicit status: Koa would default to 404 with no body
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(res.headers['content-length']).toBeUndefined();
        expect(res.text ?? '').toBe('');
    });
});

describe('HEAD × uncompressed response from the rawFile buffer', () => {
    test('HEAD restores Content-Length to the buffer size, empty body', async () => {
        const server = createServer({ serverCache: { rawFile: { enabled: true } } });

        let res;
        try {
            // Prime the buffer, then HEAD must serve the same metadata from memory.
            await supertest(server).get('/small.txt').set('Accept-Encoding', 'identity');
            res = await supertest(server).head('/small.txt').set('Accept-Encoding', 'identity');
        } finally {
            server.close();
        }

        expect(res.status).toBe(200);
        expect(res.headers['content-length']).toBe('4'); // 'tiny'
        expect(res.text ?? '').toBe('');
    });
});

describe('HEAD × template render producing a stream body', () => {
    test('stripBodyForHead drops Content-Length (unknown) instead of inventing one', async () => {
        const server = createServer({
            template: {
                ext: ['ejs'],
                render: async (ctx) => {
                    ctx.type = 'text/html';
                    // Stream body: length is unknowable without consuming it.
                    ctx.body = Readable.from(['<h1>', 'streamed render', '</h1>']);
                },
            },
        });

        let getRes, headRes;
        try {
            getRes = await supertest(server).get('/page.ejs');
            headRes = await supertest(server).head('/page.ejs');
        } finally {
            server.close();
        }

        expect(getRes.status).toBe(200);
        expect(getRes.text).toBe('<h1>streamed render</h1>');

        // HEAD mirrors GET's status and Content-Type; the body is stripped and
        // stripBodyForHead REMOVES the unknown length instead of fabricating
        // one. What reaches the wire is Content-Length: 0 — Koa's own HEAD
        // handling re-derives it from the empty replacement buffer — which is
        // still correct-by-construction: never the length of the consumed
        // stream, never a stale template length.
        expect(headRes.status).toBe(200);
        expect(headRes.headers['content-type']).toContain('text/html');
        expect(headRes.headers['content-length'] ?? '0').toBe('0');
        expect(headRes.text ?? '').toBe('');
    });
});

// ─── HEAD × template renders that leave nothing to strip ─────────────────────
// stripBodyForHead has two early-return guards that were previously untested:
// a render that produced NO body at all (redirect / pass-through style), and a
// render that already FLUSHED the response head itself.

describe('HEAD × template render that sets no body', () => {
    test('HEAD mirrors the no-body GET outcome instead of crashing on ctx.body', async () => {
        const render = async (ctx) => {
            ctx.status = 204; // render answers with a bodyless status of its own
        };
        const server = createServer({ template: { ext: ['ejs'], render } });

        let getRes, headRes;
        try {
            getRes = await supertest(server).get('/page.ejs');
            headRes = await supertest(server).head('/page.ejs');
        } finally {
            server.close();
        }

        // GET and HEAD agree: the render's status survives untouched.
        expect(getRes.status).toBe(204);
        expect(headRes.status).toBe(204);
        expect(headRes.text ?? '').toBe('');
    });
});

describe('HEAD × template render that flushes its own headers', () => {
    test('stripBodyForHead leaves an already-flushed response alone', async () => {
        const render = async (ctx) => {
            ctx.status = 200;
            ctx.type = 'text/html';
            ctx.res.flushHeaders(); // head is on the wire — nothing may be rewritten
        };
        const server = createServer({ template: { ext: ['ejs'], render } });

        let headRes;
        try {
            headRes = await supertest(server).head('/page.ejs');
        } finally {
            server.close();
        }

        expect(headRes.status).toBe(200);
        expect(headRes.headers['content-type']).toContain('text/html');
        expect(headRes.text ?? '').toBe('');
    });
});
