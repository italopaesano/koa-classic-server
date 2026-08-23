/**
 * options.method normalization — case folding and entry pruning (5.3.0, register #11).
 *
 * HTTP method tokens are case-SENSITIVE (RFC 9110 §9) and ctx.method is always the
 * raw uppercase token, so a lowercase entry matches nothing. Before this pass that
 * failed in the worst possible way: method: ['get'] left the middleware inert and
 * answering 404 to EVERY request, GET included, with no diagnostic anywhere. The
 * same is true of an entry that is not a usable method token at all — it simply
 * sits in the config doing nothing.
 *
 * Both are now corrected AND announced. The warning is a notice, not a deprecation:
 * the operator's intent is unmistakable (['get'] plainly means GET), so there is no
 * future-throw promise attached and the message must not carry one.
 *
 * The notice is deduplicated once-per-process per distinct message, so each test
 * takes a fresh module via jest.resetModules() to keep the assertions independent
 * of execution order — same approach as url-prefix-reserved-validation.test.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');

let fixturesDir;

beforeAll(() => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-method-norm-'));
    fs.writeFileSync(path.join(fixturesDir, 'file.txt'), 'plain content');
});

afterAll(() => {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
});

beforeEach(() => {
    jest.resetModules();               // fresh module → fresh once-per-process dedup Set
});

function capturingLogger() {
    const warns = [];
    return {
        warns,
        warn: (...args) => warns.push(args.map(String).join(' ')),
        error: () => {},
    };
}

// Fresh module per call, so the dedup Set does not leak between assertions.
function build(opts) {
    const koaClassicServer = require('../index.cjs');
    const app = new Koa();
    app.on('error', () => {});
    app.use(koaClassicServer(fixturesDir, opts));
    return app.listen();
}

async function statuses(server) {
    return {
        get: (await supertest(server).get('/file.txt')).status,
        head: (await supertest(server).head('/file.txt')).status,
        post: (await supertest(server).post('/file.txt')).status,
    };
}

// ─── Case folding ────────────────────────────────────────────────────────────

describe('lowercase entries are upper-cased and reported', () => {
    test("method: ['get','head'] serves normally and warns once", async () => {
        const logger = capturingLogger();
        const server = build({ method: ['get', 'head'], logger });
        try {
            expect(await statuses(server)).toEqual({ get: 200, head: 200, post: 404 });
        } finally {
            server.close();
        }

        expect(logger.warns).toHaveLength(1);
        expect(logger.warns[0]).toContain('must be uppercase');
        expect(logger.warns[0]).toContain('"get" → "GET"');
        expect(logger.warns[0]).toContain('"head" → "HEAD"');
        // A notice, NOT a deprecation: no future-throw promise may ride along.
        expect(logger.warns[0]).not.toContain('DEPRECATION');
        expect(logger.warns[0]).not.toContain('WILL throw');
    });

    test('mixed case is corrected too, and the rule covers every verb, not just GET/HEAD', async () => {
        const logger = capturingLogger();
        const server = build({ method: ['Get', 'Head', 'PoSt'], logger });
        try {
            // POST is served exactly like GET once the entry is normalized.
            expect(await statuses(server)).toEqual({ get: 200, head: 200, post: 200 });
        } finally {
            server.close();
        }

        expect(logger.warns[0]).toContain('"PoSt" → "POST"');
    });

    test('correctly uppercased entries are silent — including unusual verbs', async () => {
        const logger = capturingLogger();
        const server = build({ method: ['GET', 'HEAD', 'POST', 'PURGE'], logger });
        try {
            expect(await statuses(server)).toEqual({ get: 200, head: 200, post: 200 });
        } finally {
            server.close();
        }

        // PURGE is a valid token the operator asked for. The middleware serves any
        // verb it is given; warning about unfamiliar ones would be pure noise.
        expect(logger.warns).toEqual([]);
    });

    test('the default configuration warns about nothing', async () => {
        const logger = capturingLogger();
        const server = build({ logger });
        try {
            expect(await statuses(server)).toEqual({ get: 200, head: 200, post: 404 });
        } finally {
            server.close();
        }
        expect(logger.warns).toEqual([]);
    });
});

// ─── Pruning unusable entries ────────────────────────────────────────────────

describe('entries that could never match are dropped and reported', () => {
    test('non-string entries are dropped, naming primitives by value', async () => {
        const logger = capturingLogger();
        const server = build({ method: ['GET', null, 42, {}, []], logger });
        try {
            expect(await statuses(server)).toEqual({ get: 200, head: 404, post: 404 });
        } finally {
            server.close();
        }

        expect(logger.warns).toHaveLength(1);
        expect(logger.warns[0]).toContain('dropped 4 unusable entries');
        expect(logger.warns[0]).toContain('null');
        expect(logger.warns[0]).toContain('42');       // the value, not just "number"
        expect(logger.warns[0]).toContain('an array');
    });

    test('strings that are not method tokens are dropped (space, empty, separator)', async () => {
        const logger = capturingLogger();
        const server = build({ method: ['GET', 'BAD METHOD', '', 'a,b'], logger });
        try {
            expect(await statuses(server)).toEqual({ get: 200, head: 404, post: 404 });
        } finally {
            server.close();
        }

        expect(logger.warns[0]).toContain('dropped 3 unusable entries');
        expect(logger.warns[0]).toContain('"BAD METHOD"');
    });

    test('singular wording for a single dropped entry', async () => {
        const logger = capturingLogger();
        const server = build({ method: ['GET', 'HEAD', null], logger });
        try {
            expect(await statuses(server)).toEqual({ get: 200, head: 200, post: 404 });
        } finally {
            server.close();
        }
        expect(logger.warns[0]).toContain('dropped 1 unusable entry:');
    });

    test('a list of only unusable entries leaves the middleware inert, but says so', async () => {
        const logger = capturingLogger();
        const server = build({ method: [null, 42], logger });
        try {
            // Same observable outcome as the documented method: [] — every request
            // falls through to next(). The difference is that it is now explained.
            expect(await statuses(server)).toEqual({ get: 404, head: 404, post: 404 });
        } finally {
            server.close();
        }
        expect(logger.warns[0]).toContain('dropped 2 unusable entries');
    });

    test('both corrections are reported separately when both apply', async () => {
        const logger = capturingLogger();
        const server = build({ method: ['get', null], logger });
        try {
            expect(await statuses(server)).toEqual({ get: 200, head: 404, post: 404 });
        } finally {
            server.close();
        }

        expect(logger.warns).toHaveLength(2);
        expect(logger.warns.some(w => w.includes('must be uppercase'))).toBe(true);
        expect(logger.warns.some(w => w.includes('dropped 1 unusable entry'))).toBe(true);
    });
});

// ─── Delivery ────────────────────────────────────────────────────────────────

describe('notice delivery', () => {
    test('deduplicated once per process: two instances, one warning', async () => {
        const koaClassicServer = require('../index.cjs');
        const logger = capturingLogger();

        koaClassicServer(fixturesDir, { method: ['get'], logger });
        koaClassicServer(fixturesDir, { method: ['get'], logger });

        expect(logger.warns).toHaveLength(1);
    });

    test('console receives ANSI colors; a structured logger receives plain text', () => {
        const koaClassicServer = require('../index.cjs');

        const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            koaClassicServer(fixturesDir, { method: ['get'] });   // default logger === console
            expect(consoleWarn).toHaveBeenCalledTimes(1);
            expect(consoleWarn.mock.calls[0][0]).toBe('\x1b[33m%s\x1b[0m');
            expect(consoleWarn.mock.calls[0][1]).toContain('must be uppercase');
        } finally {
            consoleWarn.mockRestore();
        }

        // Same process, distinct logger: the dedup Set has already seen this exact
        // message, so a structured logger gets nothing more. Use a different case
        // mistake to produce a distinct message.
        const structured = { warn: jest.fn(), error: jest.fn() };
        koaClassicServer(fixturesDir, { method: ['post'], logger: structured });
        expect(structured.warn).toHaveBeenCalledTimes(1);
        expect(structured.warn.mock.calls[0]).toHaveLength(1);   // plain text, no format string
        expect(structured.warn.mock.calls[0][0]).toContain('must be uppercase');
    });
});
