const supertest = require('supertest');
const crypto = require('crypto');
const koaClassicServer = require('../index.cjs');
const Koa = require('koa');
const path = require('path');

const root = path.join(__dirname, 'publicWwwTest');

// Compute the expected CSP hash from the actual inline CSS in the response, so
// CSS edits to the listing template do not require updating a hardcoded hash here.
async function expectedListingCsp(server, requestPath = '/') {
    const res = await supertest(server).get(requestPath);
    const m = res.text.match(/<style>([\s\S]*?)<\/style>/);
    if (!m) throw new Error('No <style> block in listing HTML — cannot compute expected CSP');
    const cssHash = 'sha256-' + crypto.createHash('sha256').update(m[1], 'utf8').digest('base64');
    return `default-src 'none'; style-src '${cssHash}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
}

const NOT_FOUND_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const COMMON_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

function createApp(opts = {}) {
  const app = new Koa();
  app.use(koaClassicServer(root, { showDirContents: true, ...opts }));
  return app.listen();
}

// ─── Directory listing ────────────────────────────────────────────────────────

describe('Security headers — directory listing page', () => {
  let server;
  beforeAll(() => { server = createApp(); });
  afterAll(() => server.close());

  test('Content-Security-Policy uses hash-based style-src', async () => {
    const res = await supertest(server).get('/');
    expect(res.headers['content-security-policy']).toBe(await expectedListingCsp(server));
  });

  test('X-Content-Type-Options: nosniff', async () => {
    const res = await supertest(server).get('/');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('X-Frame-Options: DENY', async () => {
    const res = await supertest(server).get('/');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  test('Referrer-Policy: no-referrer', async () => {
    const res = await supertest(server).get('/');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  test('Permissions-Policy disables camera, microphone, geolocation, payment', async () => {
    const res = await supertest(server).get('/');
    expect(res.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=(), payment=()');
  });

  test('All common security headers present on listing', async () => {
    const res = await supertest(server).get('/');
    for (const [header, value] of Object.entries(COMMON_HEADERS)) {
      expect(res.headers[header]).toBe(value);
    }
  });

  test('CSP style-src hash in listing matches actual inline CSS', async () => {
    const res = await supertest(server).get('/');
    const styleMatch = res.text.match(/<style>([\s\S]*?)<\/style>/);
    expect(styleMatch).toBeTruthy();
    const expectedHash = 'sha256-' + crypto.createHash('sha256').update(styleMatch[1], 'utf8').digest('base64');
    expect(res.headers['content-security-policy']).toContain(expectedHash);
  });
});

// ─── 404 Not Found page ───────────────────────────────────────────────────────

describe('Security headers — 404 Not Found page', () => {
  let server;
  beforeAll(() => { server = createApp(); });
  afterAll(() => server.close());

  test('Content-Security-Policy on 404 is fully restrictive (no style-src)', async () => {
    const res = await supertest(server).get('/nonexistent-file-xyz.txt');
    expect(res.status).toBe(404);
    expect(res.headers['content-security-policy']).toBe(NOT_FOUND_CSP);
  });

  test('All common security headers present on 404', async () => {
    const res = await supertest(server).get('/nonexistent-file-xyz.txt');
    for (const [header, value] of Object.entries(COMMON_HEADERS)) {
      expect(res.headers[header]).toBe(value);
    }
  });

  test('CSP on 404 does NOT contain style-src', async () => {
    const res = await supertest(server).get('/nonexistent-file-xyz.txt');
    expect(res.headers['content-security-policy']).not.toContain('style-src');
  });
});

// ─── Directory listing disabled (showDirContents: false) ─────────────────────

describe('Security headers — 404 when directory listing disabled', () => {
  let server;
  beforeAll(() => { server = createApp({ showDirContents: false }); });
  afterAll(() => server.close());

  test('Security headers present when directory listing disabled', async () => {
    const res = await supertest(server).get('/');
    expect(res.status).toBe(404);
    expect(res.headers['content-security-policy']).toBe(NOT_FOUND_CSP);
    for (const [header, value] of Object.entries(COMMON_HEADERS)) {
      expect(res.headers[header]).toBe(value);
    }
  });
});

// ─── Served user files — NO security headers ─────────────────────────────────

describe('Security headers — NOT added to user-served files', () => {
  let server;
  beforeAll(() => { server = createApp(); });
  afterAll(() => server.close());

  test('Served static file has no Content-Security-Policy', async () => {
    const res = await supertest(server).get('/test.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  test('Served static file has no X-Frame-Options', async () => {
    const res = await supertest(server).get('/test.txt');
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  test('Served HTML file has no Content-Security-Policy (user file)', async () => {
    const res = await supertest(server).get('/test-page.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});

// ─── Subdirectory listing ─────────────────────────────────────────────────────

describe('Security headers — subdirectory listing page', () => {
  let server;
  beforeAll(() => { server = createApp(); });
  afterAll(() => server.close());

  test('Listing of subdirectory also has security headers', async () => {
    const res = await supertest(server).get('/cartella/');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBe(await expectedListingCsp(server, '/cartella/'));
    for (const [header, value] of Object.entries(COMMON_HEADERS)) {
      expect(res.headers[header]).toBe(value);
    }
  });
});
