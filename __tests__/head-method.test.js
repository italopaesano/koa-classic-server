const Koa = require('koa');
const koaClassicServer = require('../index.cjs');
const supertest = require('supertest');
const path = require('path');
const fs = require('fs');
const ejs = require('ejs');

// Regression tests for the HEAD-method HTTP-conformance bug.
//
// RFC 9110 §9.3.2: a HEAD response must be identical to the GET response for the
// same resource, minus the message body — same status code, same headers
// (notably Content-Type and Content-Length).
//
// Before the fix, a route served by the template engine returned 200 on GET but
// 404 on HEAD whenever the operator's render function did not itself handle HEAD
// (e.g. it returned early on non-GET requests). The static-file branch already
// handled HEAD correctly, and directory listings happened to work because Koa
// strips the string body for HEAD — only the template branch was broken.

const ROOT = path.join(__dirname, 'publicWwwTest');

// Minimal data for the templates exercised here. ejs-templates/index.ejs needs no
// variables; simple.ejs needs these four. Anything else renders with no locals.
function templateData(filePath) {
    if (path.basename(filePath, '.ejs') === 'simple') {
        return {
            title: 'Simple EJS Test',
            heading: 'Hello from EJS',
            message: 'This is a simple template test',
            timestamp: '2025-11-18',
        };
    }
    return {};
}

// A method-AWARE render: it only produces a body on GET. This is a common
// real-world pattern (operators guard render work behind a GET check) and is
// exactly what exposed the bug — on HEAD it never set ctx.body, so the status
// stayed at Koa's default 404. This render is what makes the regression real:
// with a naive render the test would pass even without the fix, because Koa
// strips the body of a 200 GET response for HEAD on its own.
const methodAwareRender = async (ctx, next, filePath) => {
    if (ctx.method !== 'GET') return;
    const tpl = await fs.promises.readFile(filePath, 'utf-8');
    ctx.type = 'text/html';
    ctx.body = ejs.render(tpl, templateData(filePath));
};

// A method-AGNOSTIC render: sets the body regardless of method. Proves the fix
// does not regress renders that already worked.
const naiveRender = async (ctx, next, filePath) => {
    const tpl = await fs.promises.readFile(filePath, 'utf-8');
    ctx.type = 'text/html';
    ctx.body = ejs.render(tpl, templateData(filePath));
};

function buildServer(render) {
    const app = new Koa();
    app.use(
        koaClassicServer(ROOT, {
            method: ['GET', 'HEAD'],
            index: ['index.html', 'index.ejs'],
            dirListing: { enabled: true },
            template: { ext: ['ejs'], render },
        })
    );
    return app.listen();
}

// Asserts the HEAD response for `urlPath` matches the corresponding GET in status,
// Content-Type and Content-Length, and that HEAD carries no body.
async function expectHeadMatchesGet(request, urlPath, expectedStatus) {
    const get = await request.get(urlPath);
    const head = await request.head(urlPath);

    expect(get.status).toBe(expectedStatus);
    expect(head.status).toBe(expectedStatus);

    // Same headers as GET (RFC 9110 §9.3.2)
    expect(head.headers['content-type']).toBe(get.headers['content-type']);
    expect(head.headers['content-length']).toBe(get.headers['content-length']);
    // Content-Length must actually be populated for a body-bearing response
    expect(head.headers['content-length']).toBeDefined();

    // HEAD must not send a body (supertest surfaces an empty object for HEAD)
    expect(head.text).toBeFalsy();
    expect(head.body).toEqual({});

    return { get, head };
}

describe('HEAD method — template engine routes (method-aware render)', () => {
    let server;
    let request;
    beforeAll(() => { server = buildServer(methodAwareRender); request = supertest(server); });
    afterAll(() => server.close());

    // The headline bug: a directory whose index is a template (index.ejs as the
    // index of /ejs-templates/). GET 200, HEAD must also be 200 — not 404.
    test('HEAD on a directory whose index is a template → 200, matches GET', async () => {
        const { get } = await expectHeadMatchesGet(request, '/ejs-templates/', 200);
        // sanity: GET really did render the template
        expect(get.text).toContain('Test Templates EJS');
        expect(get.headers['content-type']).toMatch(/text\/html/);
    });

    test('HEAD on a directly-requested template file → 200, matches GET', async () => {
        const { get } = await expectHeadMatchesGet(request, '/ejs-templates/simple.ejs', 200);
        expect(get.text).toContain('Hello from EJS');
    });

    test('HEAD on a static file → 200, matches GET', async () => {
        const { head } = await expectHeadMatchesGet(request, '/test.txt', 200);
        // static branch advertises range support
        expect(head.headers['accept-ranges']).toBe('bytes');
    });

    test('HEAD on a listable directory (no index) → 200, matches GET', async () => {
        const { get } = await expectHeadMatchesGet(request, '/cartella/', 200);
        expect(get.headers['content-type']).toMatch(/text\/html/);
    });

    test('HEAD on a non-existent template path → 404, matches GET', async () => {
        const get = await request.get('/ejs-templates/non-existent.ejs');
        const head = await request.head('/ejs-templates/non-existent.ejs');
        expect(get.status).toBe(404);
        expect(head.status).toBe(404);
        expect(head.headers['content-type']).toBe(get.headers['content-type']);
        expect(head.text).toBeFalsy();
    });

    test('HEAD on a non-existent static path → 404, matches GET', async () => {
        const get = await request.get('/does-not-exist.txt');
        const head = await request.head('/does-not-exist.txt');
        expect(get.status).toBe(404);
        expect(head.status).toBe(404);
        expect(head.text).toBeFalsy();
    });
});

describe('HEAD method — template engine routes (method-agnostic render, no regression)', () => {
    let server;
    let request;
    beforeAll(() => { server = buildServer(naiveRender); request = supertest(server); });
    afterAll(() => server.close());

    test('HEAD on template index still matches GET → 200', async () => {
        await expectHeadMatchesGet(request, '/ejs-templates/', 200);
    });

    test('HEAD on direct template still matches GET → 200', async () => {
        await expectHeadMatchesGet(request, '/ejs-templates/simple.ejs', 200);
    });

    test('HEAD on non-existent template → 404', async () => {
        const head = await request.head('/ejs-templates/non-existent.ejs');
        expect(head.status).toBe(404);
        expect(head.text).toBeFalsy();
    });
});
