/**
 * Extension-suffix equivalence — regression tests for finding #10 of
 * docs/revisione_codice_v4.3.md (V5, "option E" + multi-dot unification).
 *
 * One shared rule for BOTH extension options: the leading dot is optional
 * decoration ('.ejs' ≡ 'ejs'; '.ejs' is the preferred documented form) and
 * compound suffixes ('.tar.gz', '.html.ejs') are first-class — template.ext
 * now matches by SUFFIX like hideExtension always did.
 *
 * The flagship regression: template.ext: ['.ejs'] used to never match — the
 * render never ran and the TEMPLATE SOURCE was served raw (a confidentiality
 * failure, silent by design of the old code).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-extsuffix-'));
    fs.writeFileSync(path.join(root, 'page.ejs'), 'SOURCE page.ejs');
    fs.writeFileSync(path.join(root, 'multi.html.ejs'), 'SOURCE multi.html.ejs');
    fs.writeFileSync(path.join(root, 'plain.txt'), 'plain');
    fs.writeFileSync(path.join(root, '.ejs'), 'SOURCE dotfile .ejs');
    fs.writeFileSync(path.join(root, 'backup.tar.gz'), 'TARBALL');
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

// Minimal render: proves the template branch ran (vs raw static serving).
const render = async (ctx, _next, filePath) => {
    ctx.type = 'text/html';
    ctx.body = 'RENDERED:' + path.basename(filePath);
};

// superagent only fills res.text for textual MIME types; .ejs/.tar.gz are
// served as application/octet-stream and land in res.body (Buffer).
function bodyOf(res) {
    if (res.text !== undefined && res.text !== '') return res.text;
    return Buffer.isBuffer(res.body) ? res.body.toString('utf8') : res.text;
}

function capturingLogger() {
    const warns = [];
    return { warns, warn: (...args) => warns.push(args.map(String).join(' ')), error: () => {} };
}

function makeServer(opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(root, opts));
    return app.listen();
}

describe('#10 — template.ext: leading dot optional, suffix semantics', () => {
    test.each([
        ["dotted form ['.ejs']", ['.ejs']],
        ["dotless form ['ejs']", ['ejs']],
        ["mixed ['.ejs'] via equivalence", ['ejs', '.EJS']],
    ])('%s renders instead of serving the raw source', async (_label, ext) => {
        const server = makeServer({ template: { render, ext } });
        try {
            const res = await supertest(server).get('/page.ejs');
            expect(res.status).toBe(200);
            expect(bodyOf(res)).toBe('RENDERED:page.ejs'); // pre-fix with '.ejs': 'SOURCE page.ejs'
        } finally {
            server.close();
        }
    });

    test("compound suffix ['.html.ejs'] targets only the compound files", async () => {
        const server = makeServer({ template: { render, ext: ['.html.ejs'] } });
        try {
            const multi = await supertest(server).get('/multi.html.ejs');
            expect(bodyOf(multi)).toBe('RENDERED:multi.html.ejs'); // pre-fix: extname gave 'ejs' → no match → raw
            const single = await supertest(server).get('/page.ejs');
            expect(bodyOf(single)).toBe('SOURCE page.ejs'); // not targeted — served raw as configured
        } finally {
            server.close();
        }
    });

    test("'.ejs' entry still matches compound files ending in .ejs (historical behavior)", async () => {
        const server = makeServer({ template: { render, ext: ['.ejs'] } });
        try {
            const res = await supertest(server).get('/multi.html.ejs');
            expect(bodyOf(res)).toBe('RENDERED:multi.html.ejs');
        } finally {
            server.close();
        }
    });

    test('dotfile guard: a file named exactly ".ejs" is NOT a template match', async () => {
        const server = makeServer({
            template: { render, ext: ['.ejs'] },
            hidden: { dotFiles: { default: 'visible' } },
        });
        try {
            const res = await supertest(server).get('/.ejs');
            expect(res.status).toBe(200);
            expect(bodyOf(res)).toBe('SOURCE dotfile .ejs'); // served raw, like the extname era
        } finally {
            server.close();
        }
    });

    test('invalid entries warn and are dropped; valid ones keep working', async () => {
        const logger = capturingLogger();
        const server = makeServer({ template: { render, ext: [42, '', '.', '.ejs'] }, logger });
        try {
            const deprecations = logger.warns.filter((w) => w.includes('DEPRECATION') && w.includes('template.ext'));
            expect(deprecations.length).toBe(3); // 42, '', '.' — distinct messages
            const res = await supertest(server).get('/page.ejs');
            expect(bodyOf(res)).toBe('RENDERED:page.ejs');
        } finally {
            server.close();
        }
    });
});

describe('#10 — template.render non-function warns instead of silent drop', () => {
    test('render: "string" → DEPRECATION warn, templates disabled, file served raw', async () => {
        const logger = capturingLogger();
        const server = makeServer({ template: { render: 'not-a-function', ext: ['.ejs'] }, logger });
        try {
            const hits = logger.warns.filter((w) => w.includes('DEPRECATION') && w.includes('template.render'));
            expect(hits.length).toBe(1);
            const res = await supertest(server).get('/page.ejs');
            expect(res.status).toBe(200);
            expect(bodyOf(res)).toBe('SOURCE page.ejs'); // unchanged behavior, now announced
        } finally {
            server.close();
        }
    });
});

describe('#10 — hideExtension.ext: same equivalence, same suffix engine', () => {
    test.each([
        ["dotted '.ejs'", '.ejs'],
        ["dotless 'ejs' (no warning since V5)", 'ejs'],
    ])('%s: /page.ejs → 301 /page and clean URL serves the file', async (_label, ext) => {
        const server = makeServer({ hideExtension: { ext } });
        try {
            const redir = await supertest(server).get('/page.ejs');
            expect(redir.status).toBe(301);
            expect(redir.headers.location).toBe('/page');
            const clean = await supertest(server).get('/page');
            expect(clean.status).toBe(200);
            expect(bodyOf(clean)).toBe('SOURCE page.ejs');
        } finally {
            server.close();
        }
    });

    test("compound 'tar.gz' (dotless!) works end-to-end", async () => {
        const server = makeServer({ hideExtension: { ext: 'tar.gz' } });
        try {
            const redir = await supertest(server).get('/backup.tar.gz');
            expect(redir.status).toBe(301);
            expect(redir.headers.location).toBe('/backup');
            const clean = await supertest(server).get('/backup');
            expect(clean.status).toBe(200);
            expect(bodyOf(clean)).toBe('TARBALL');
        } finally {
            server.close();
        }
    });

    test.each([
        ["empty string ''", ''],
        ["bare dot '.'", '.'],
        ['non-string 42', 42],
    ])('%s still throws at factory time', (_label, ext) => {
        expect(() => koaClassicServer(root, { hideExtension: { ext } })).toThrow(/hideExtension.ext/);
    });
});
