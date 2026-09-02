/**
 * `hidden` shape warnings — docs/revisione_codice_v5.0.md finding #14 (5.3.1).
 *
 * Every branch of normalizeHiddenConfig that DISCARDS what the operator wrote
 * now reports it. The behaviour it discards is unchanged — `hidden` is a
 * v2-stable option and throwing on a minor upgrade would break working
 * deployments — so the fix is a report, not a refusal, and the report carries
 * the promise that 6.0.0 will throw instead.
 *
 * Why this namespace got the treatment before the other open shape findings
 * (#15 compression.mimeTypes, #16 the boolean conventions): it is the only one
 * whose wrong shape fails OPEN. A listing that wrongly appears is visible on
 * the first request; a file that was supposed to be hidden and is not stays
 * invisible until someone asks for it. So the warning IS the detection.
 *
 * Two contracts are asserted for each shape:
 *   1. the message names the exact option path, what arrived, and — the part
 *      that matters — that the entry stays SERVED;
 *   2. what the middleware serves is byte-for-byte what it served before.
 *      A warning that changed behaviour would be a breaking change wearing a
 *      warning's clothes.
 *
 * The dedup behind warnConfigDeprecation is module-level (once per process per
 * distinct message), so each test takes a fresh module — same remedy, and same
 * reason, as url-prefix-reserved-validation.test.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');

let koaClassicServer;
beforeEach(() => {
    jest.resetModules();                // fresh module → fresh once-per-process dedup Set
    koaClassicServer = require('../index.cjs');
});

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-hidden-warn-'));
    fs.writeFileSync(path.join(root, '.env'), 'DB_PASSWORD=hunter2');
    fs.writeFileSync(path.join(root, 'secret.key'), 'PRIVATE KEY');
    fs.writeFileSync(path.join(root, 'public.txt'), 'public');
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, '.git', 'config'), 'GIT CONFIG');
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function capturingLogger() {
    const warns = [];
    return { warns, error: () => {}, warn: (...a) => warns.push(a.map(String).join(' ')) };
}

function build(hidden) {
    const logger = capturingLogger();
    const app = new Koa();
    app.use(koaClassicServer(root, { hidden, logger, index: [] }));
    return { server: app.callback(), logger, text: () => logger.warns.join('\n') };
}

const bodyText = (res) =>
    (typeof res.text === 'string' && res.text.length)
        ? res.text
        : (Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.body));

// ─── every malformed shape is reported ───────────────────────────────────────

describe('the whole namespace is not an object', () => {
    test.each([
        ['a string', 'yes', 'string'],
        ['null', null, 'null'],
        ['an array', [], 'an array'],
        ['a number', 42, 'number'],
    ])('hidden: %s → warned, and the shape that arrived is named', (_label, value, described) => {
        const { logger } = build(value);
        expect(logger.warns).toHaveLength(1);
        expect(logger.warns[0]).toContain('hidden must be an object');
        expect(logger.warns[0]).toContain('got ' + described);
    });

    test('the message says the namespace is ignored and entries stay SERVED', () => {
        const { text } = build('yes');
        expect(text()).toMatch(/IGNORED/);
        expect(text()).toMatch(/stays SERVED/);
    });

    test('and the served behaviour is unchanged — .env is still reachable', async () => {
        const { server } = build('yes');
        const res = await supertest(server).get('/.env');
        expect(res.status).toBe(200);
        expect(bodyText(res)).toContain('hunter2');
    });
});

describe('a category is not an object', () => {
    test('hidden.dotFiles: "hidden" → warned, with the near-miss spelled out', () => {
        const { logger } = build({ dotFiles: 'hidden' });
        expect(logger.warns).toHaveLength(1);
        expect(logger.warns[0]).toContain('hidden.dotFiles must be an object');
        // The message guesses what was meant, because this exact near-miss is
        // the one an operator actually writes.
        expect(logger.warns[0]).toContain('did you mean { default: "hidden" }?');
        expect(logger.warns[0]).toContain('remain SERVED');
    });

    test('hidden.dotDirs is reported under its own name, not dotFiles\'', () => {
        const { logger } = build({ dotDirs: 42 });
        expect(logger.warns[0]).toContain('hidden.dotDirs must be an object');
        expect(logger.warns[0]).not.toContain('dotFiles');
    });

    test('the two categories are reported independently', () => {
        const { logger } = build({ dotFiles: 'hidden', dotDirs: 'hidden' });
        expect(logger.warns).toHaveLength(2);
        expect(logger.warns.join('\n')).toContain('hidden.dotFiles must be an object');
        expect(logger.warns.join('\n')).toContain('hidden.dotDirs must be an object');
    });

    test('served behaviour unchanged: the dot-file and the dot-dir stay reachable', async () => {
        const { server } = build({ dotFiles: 'hidden', dotDirs: 'hidden' });
        expect((await supertest(server).get('/.env')).status).toBe(200);
        expect((await supertest(server).get('/.git/config')).status).toBe(200);
    });
});

describe('a pattern list is not an array', () => {
    test.each([
        ['hidden.alwaysHide', { alwaysHide: '*.key' }, 'hidden.alwaysHide'],
        ['hidden.dotFiles.blacklist', { dotFiles: { blacklist: '.env' } }, 'hidden.dotFiles.blacklist'],
        ['hidden.dotFiles.whitelist', { dotFiles: { whitelist: '.env' } }, 'hidden.dotFiles.whitelist'],
        ['hidden.dotDirs.blacklist', { dotDirs: { blacklist: '.git' } }, 'hidden.dotDirs.blacklist'],
        ['hidden.dotDirs.whitelist', { dotDirs: { whitelist: '.git' } }, 'hidden.dotDirs.whitelist'],
    ])('%s: a bare string → warned under its full path', (_label, hidden, optionPath) => {
        const { logger } = build(hidden);
        expect(logger.warns).toHaveLength(1);
        expect(logger.warns[0]).toContain(optionPath + ' must be an ARRAY');
    });

    test('the message says the list is treated as empty and hides nothing', () => {
        const { text } = build({ alwaysHide: '*.key' });
        expect(text()).toMatch(/treated as EMPTY/);
        expect(text()).toMatch(/hides NOTHING/);
        expect(text()).toMatch(/stay SERVED/);
    });

    test('served behaviour unchanged: secret.key is still reachable', async () => {
        const { server } = build({ alwaysHide: '*.key' });
        expect((await supertest(server).get('/secret.key')).status).toBe(200);
    });
});

describe('an entry inside a valid list is not a pattern', () => {
    test('each dropped entry is reported once, naming its type', () => {
        const { logger } = build({ alwaysHide: [123, null, '*.key'] });
        expect(logger.warns).toHaveLength(2);
        expect(logger.warns.join('\n')).toContain('dropping a non-pattern (number)');
        expect(logger.warns.join('\n')).toContain('dropping a non-pattern (null)');
    });

    test('the valid entries in the same list keep working', async () => {
        const { server } = build({ alwaysHide: [123, null, '*.key'] });
        expect((await supertest(server).get('/secret.key')).status).toBe(404);
        expect((await supertest(server).get('/public.txt')).status).toBe(200);
    });

    test('a RegExp entry is a pattern, not a dropped object', () => {
        const { logger } = build({ alwaysHide: [/\.key$/] });
        expect(logger.warns).toEqual([]);
    });
});

// ─── every message announces the 6.0.0 throw ─────────────────────────────────

describe('every warning announces that a future major will throw', () => {
    test.each([
        ['hidden: "yes"', 'yes'],
        ['hidden.dotFiles: "hidden"', { dotFiles: 'hidden' }],
        ['hidden.dotFiles.blacklist: ".env"', { dotFiles: { blacklist: '.env' } }],
        ['hidden.alwaysHide: "*.key"', { alwaysHide: '*.key' }],
        ['hidden.alwaysHide: [123]', { alwaysHide: [123] }],
    ])('%s', (_label, hidden) => {
        const { logger } = build(hidden);
        expect(logger.warns.length).toBeGreaterThan(0);
        for (const warning of logger.warns) {
            expect(warning).toContain('DEPRECATION');
            expect(warning).toContain('WILL throw in a future major version');
        }
    });
});

// ─── silence where silence is correct ────────────────────────────────────────

describe('a correct configuration says nothing', () => {
    test('a fully-specified valid namespace warns nothing and still hides', async () => {
        const { server, logger } = build({
            dotFiles: { default: 'hidden', whitelist: ['.well-known'], blacklist: [/^\.env/] },
            dotDirs: { default: 'hidden', whitelist: [], blacklist: ['.git'] },
            alwaysHide: ['*.key', /secret/],
        });
        expect(logger.warns).toEqual([]);
        expect((await supertest(server).get('/.env')).status).toBe(404);
        expect((await supertest(server).get('/secret.key')).status).toBe(404);
        expect((await supertest(server).get('/public.txt')).status).toBe(200);
    });

    test('an omitted namespace warns nothing', () => {
        expect(build(undefined).logger.warns).toEqual([]);
    });

    test('omitted sub-keys warn nothing — absent is not malformed', () => {
        expect(build({}).logger.warns).toEqual([]);
        expect(build({ dotFiles: {} }).logger.warns).toEqual([]);
        expect(build({ dotFiles: { default: 'hidden' } }).logger.warns).toEqual([]);
        expect(build({ alwaysHide: [] }).logger.warns).toEqual([]);
    });
});

// ─── what did NOT change ─────────────────────────────────────────────────────

describe('the value guard is untouched — it still throws', () => {
    test('hidden.dotFiles.default: "maybe" throws, it was not softened to a warning', () => {
        expect(() => koaClassicServer(root, { hidden: { dotFiles: { default: 'maybe' } } }))
            .toThrow(/hidden\.dotFiles\.default must be "hidden" or "visible"/);
    });

    test('hidden.dotDirs.default: "maybe" throws too', () => {
        expect(() => koaClassicServer(root, { hidden: { dotDirs: { default: 'maybe' } } }))
            .toThrow(/hidden\.dotDirs\.default must be "hidden" or "visible"/);
    });

    test('a malformed CONTAINER around a valid default still only warns', () => {
        // The distinction #14 is about: the VALUE has always been guarded, the
        // SHAPE of the container around it was not.
        const logger = capturingLogger();
        expect(() => koaClassicServer(root, { hidden: { dotFiles: 'hidden' }, logger })).not.toThrow();
        expect(logger.warns).toHaveLength(1);
    });
});

describe('warnings are deduplicated once per process, per distinct message', () => {
    test('three servers with the same malformed value warn once in total', () => {
        const loggers = [capturingLogger(), capturingLogger(), capturingLogger()];
        for (const logger of loggers) {
            koaClassicServer(root, { hidden: { alwaysHide: '*.key' }, logger });
        }
        const total = loggers.reduce((n, l) => n + l.warns.length, 0);
        expect(total).toBe(1);
    });

    test('two DIFFERENT malformed values each get their own warning', () => {
        const a = capturingLogger();
        const b = capturingLogger();
        koaClassicServer(root, { hidden: { alwaysHide: '*.key' }, logger: a });
        koaClassicServer(root, { hidden: { dotFiles: 'hidden' }, logger: b });
        expect(a.warns).toHaveLength(1);
        expect(b.warns).toHaveLength(1);
    });
});
