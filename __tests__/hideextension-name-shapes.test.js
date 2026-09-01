/**
 * hideExtension × unusual entry names — 2026-09 coverage review.
 *
 * hideExtension.test.js and hideExtension-trailing-slash.test.js cover the
 * feature against ordinary names: `about.ejs`, `blog/articolo.ejs`, an encoded
 * dot, a space. What none of them cover is what happens when the name is a
 * shape the suffix rule was not written for:
 *
 *   - a DIRECTORY whose name ends with the hidden suffix (`blog.ejs/`);
 *   - a compound suffix (`.tar.gz`), documented as supported but only ever
 *     tested on template.ext;
 *   - a file whose whole name IS the suffix (`.ejs`), where stripping leaves
 *     an empty path;
 *   - a non-ASCII name, where the redirect has to round-trip percent-encoding.
 *
 * Plus two contracts that the feature rests on and that nothing asserted:
 * the redirect is UNCONDITIONAL (it never touches the filesystem, so a missing
 * file redirects exactly like an existing one — no existence oracle), and
 * `hidden` still wins at the clean URL.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-hideext-names-'));
    fs.writeFileSync(path.join(root, 'about.ejs'), 'ABOUT');
    fs.writeFileSync(path.join(root, '.ejs'), 'WHOLE NAME IS THE SUFFIX');
    fs.writeFileSync(path.join(root, 'caffè.ejs'), 'UNICODE');
    fs.writeFileSync(path.join(root, 'sp ace.ejs'), 'SPACED');
    fs.writeFileSync(path.join(root, 'archive.tar.gz'), 'TARBALL');
    // A DIRECTORY that ends with the hidden suffix.
    fs.mkdirSync(path.join(root, 'blog.ejs'));
    fs.writeFileSync(path.join(root, 'blog.ejs', 'post.txt'), 'post');
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

// A clean URL has no extension, so mime.lookup() falls back to
// application/octet-stream and supertest delivers the payload as a Buffer in
// res.body rather than as res.text.
function bodyText(res) {
    if (typeof res.text === 'string' && res.text.length) return res.text;
    return Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.body);
}

function makeServer(opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(root, { index: [], ...opts }));
    return app.callback();
}

const EJS = { hideExtension: { ext: '.ejs' } };

// ─── the redirect never consults the filesystem ──────────────────────────────

describe('the extension→clean redirect is unconditional', () => {
    let server;
    beforeAll(() => { server = makeServer(EJS); });

    test('an EXISTING file redirects', async () => {
        const res = await supertest(server).get('/about.ejs').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/about');
    });

    test('a MISSING file redirects identically — the redirect is not an existence oracle', async () => {
        const res = await supertest(server).get('/nothere.ejs').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/nothere');
    });

    test('a missing file in a missing directory redirects too', async () => {
        const res = await supertest(server).get('/no/such/dir/page.ejs').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/no/such/dir/page');
    });

    test('the 404 arrives one hop later, at the clean URL', async () => {
        expect((await supertest(server).get('/nothere')).status).toBe(404);
    });
});

describe('hidden still wins at the clean URL', () => {
    let server;
    beforeAll(() => {
        server = makeServer({ ...EJS, hidden: { alwaysHide: ['about.ejs'] } });
    });

    test('the clean URL of a hidden file is 404', async () => {
        expect((await supertest(server).get('/about')).status).toBe(404);
    });

    test('the extension URL still redirects (it never looked at the file)', async () => {
        const res = await supertest(server).get('/about.ejs').redirects(0);
        expect(res.status).toBe(301);
    });

    test('the redirect leaks nothing: a hidden name and a missing name behave alike', async () => {
        const hiddenName = await supertest(server).get('/about.ejs').redirects(0);
        const missingName = await supertest(server).get('/nothere.ejs').redirects(0);
        expect(hiddenName.status).toBe(missingName.status);

        const hiddenClean = await supertest(server).get('/about');
        const missingClean = await supertest(server).get('/nothere');
        expect(hiddenClean.status).toBe(missingClean.status);
    });
});

// ─── a directory whose name ends with the suffix ─────────────────────────────

describe('a DIRECTORY named like the hidden extension', () => {
    let server;
    beforeAll(() => { server = makeServer(EJS); });

    test('it is reachable at its real name, listing and all', async () => {
        const res = await supertest(server).get('/blog.ejs/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('post.txt');
    });

    test('files inside it are served at the un-stripped path', async () => {
        const res = await supertest(server).get('/blog.ejs/post.txt');
        expect(res.status).toBe(200);
        expect(res.text).toBe('post');
    });

    test('the "clean" form of a directory name is NOT synthesized — /blog is a 404', async () => {
        // hideExtension strips a suffix from FILE URLs only; a directory keeps
        // its real name, so /blog was never an alias for /blog.ejs/.
        expect((await supertest(server).get('/blog/')).status).toBe(404);
        expect((await supertest(server).get('/blog').redirects(0)).status).toBe(404);
    });

    test('requesting the directory WITHOUT a slash redirects into the extension URL, not away from it', async () => {
        const res = await supertest(server).get('/blog.ejs').redirects(0);
        // The hideExtension redirect fires first (the URL ends with the suffix)
        // and lands on /blog, which does not exist.
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/blog');
        expect((await supertest(server).get(res.headers.location)).status).toBe(404);
    });

    test('the escape hatch: without hideExtension the directory canonicalizes normally', async () => {
        const plain = makeServer({});
        const res = await supertest(plain).get('/blog.ejs').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/blog.ejs/');
    });
});

// ─── compound suffix ─────────────────────────────────────────────────────────

describe('compound suffix (.tar.gz)', () => {
    let server;
    beforeAll(() => { server = makeServer({ hideExtension: { ext: '.tar.gz' } }); });

    test('the clean URL serves the file', async () => {
        const res = await supertest(server).get('/archive');
        expect(res.status).toBe(200);
        expect(bodyText(res)).toBe('TARBALL');
    });

    test('the full suffix redirects to the clean URL', async () => {
        const res = await supertest(server).get('/archive.tar.gz').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/archive');
    });

    test('a PARTIAL suffix is not the configured one — /archive.tar is a plain 404', async () => {
        const res = await supertest(server).get('/archive.tar').redirects(0);
        expect(res.status).toBe(404);
    });

    test("the dot is optional in the config: 'tar.gz' behaves identically", async () => {
        const s = makeServer({ hideExtension: { ext: 'tar.gz' } });
        expect(bodyText(await supertest(s).get('/archive'))).toBe('TARBALL');
        expect((await supertest(s).get('/archive.tar.gz').redirects(0)).headers.location).toBe('/archive');
    });
});

// ─── names that need percent-encoding ────────────────────────────────────────

describe('non-ASCII and spaced names round-trip through the redirect', () => {
    let server;
    beforeAll(() => { server = makeServer(EJS); });

    test('a non-ASCII name redirects to the encoded clean URL', async () => {
        const res = await supertest(server).get('/caff%C3%A8.ejs').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/caff%C3%A8');
    });

    test('and that encoded clean URL actually serves the file', async () => {
        const res = await supertest(server).get('/caff%C3%A8');
        expect(res.status).toBe(200);
        expect(bodyText(res)).toBe('UNICODE');
    });

    test('a space stays encoded across the redirect and still resolves', async () => {
        const res = await supertest(server).get('/sp%20ace.ejs').redirects(0);
        expect(res.headers.location).toBe('/sp%20ace');
        expect(bodyText(await supertest(server).get('/sp%20ace'))).toBe('SPACED');
    });
});

// ─── the file whose entire name is the suffix ────────────────────────────────

describe('a file named exactly ".ejs"', () => {
    let server;
    beforeAll(() => { server = makeServer(EJS); });

    test('its URL strips to nothing and redirects to the root', async () => {
        const res = await supertest(server).get('/.ejs').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/');
    });

    test('the root then answers with the listing — the file is unreachable via hideExtension', async () => {
        const res = await supertest(server).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<!DOCTYPE html>');
    });

    test('without hideExtension the same file is served normally', async () => {
        const plain = makeServer({});
        const res = await supertest(plain).get('/.ejs');
        expect(res.status).toBe(200);
    });
});

// ─── what the listing links to ───────────────────────────────────────────────

describe('the listing keeps real names — clean URLs are not synthesized into hrefs', () => {
    let server;
    beforeAll(() => { server = makeServer(EJS); });

    test('entry hrefs carry the extension the operator put on disk', async () => {
        const res = await supertest(server).get('/');
        const links = [...res.text.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
        expect(links).toEqual(expect.arrayContaining(['/about.ejs', '/blog.ejs/']));
        expect(links).not.toContain('/about');
    });

    test('so a click on a template entry costs one 301 hop before the file arrives', async () => {
        const hop = await supertest(server).get('/about.ejs').redirects(0);
        expect(hop.status).toBe(301);
        const final = await supertest(server).get(hop.headers.location);
        expect(final.status).toBe(200);
        expect(bodyText(final)).toBe('ABOUT');
    });
});

// ─── hideExtension.ext === template.ext ──────────────────────────────────────

describe('hideExtension.ext identical to template.ext', () => {
    let server;
    beforeAll(() => {
        server = makeServer({
            ...EJS,
            template: {
                ext: ['.ejs'],
                render: async (ctx, _next, filePath) => {
                    ctx.type = 'html';
                    ctx.body = 'RENDERED:' + path.basename(filePath);
                },
            },
        });
    });

    test('the clean URL renders through the template engine', async () => {
        const res = await supertest(server).get('/about');
        expect(res.status).toBe(200);
        expect(res.text).toBe('RENDERED:about.ejs');
    });

    test('the extension URL still redirects first — the render never runs on it', async () => {
        const res = await supertest(server).get('/about.ejs').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/about');
    });

    test('the directory named blog.ejs is a directory, not a template to render', async () => {
        const res = await supertest(server).get('/blog.ejs/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('post.txt');
        expect(res.text).not.toContain('RENDERED');
    });
});
