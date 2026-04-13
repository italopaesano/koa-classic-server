//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  SECURITY & BUG TESTS
//  These tests verify the security properties and bug fixes documented in DEBUG_REPORT.md
//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const Koa = require('koa');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, 'publicWwwTest');

// ─── Path Traversal ───────────────────────────────────────────────────────────

describe('Security Tests - Path Traversal', () => {
  let app;
  let server;

  beforeAll(() => {
    app = new Koa();
    app.use(koaClassicServer(rootDir, {
      showDirContents: true
    }));
    server = app.listen();
  });

  afterAll(() => {
    server.close();
  });

  // On Linux, path.normalize() cannot escape '/' (the OS root), so '/../package.json'
  // resolves to rootDir/package.json — which simply does not exist → 404.
  // On Windows, backslash sequences can escape rootDir and the startsWith() check
  // fires → 403. Both outcomes prove the traversal was blocked (no 200 with file content).

  test('../ traversal is blocked (403 or 404, never 200 with file content)', async () => {
    const res = await supertest(server).get('/../package.json');
    expect([403, 404]).toContain(res.status);
    expect(res.text).not.toContain('"name"');
  });

  test('URL-encoded ../ traversal (%2e%2e%2f) is blocked (403 or 404)', async () => {
    const res = await supertest(server).get('/%2e%2e%2f%2e%2e%2fpackage.json');
    expect([403, 404]).toContain(res.status);
    expect(res.text).not.toContain('"name"');
  });

  test('multi-level traversal (/../../../etc/hosts) is blocked (403 or 404)', async () => {
    const res = await supertest(server).get('/../../../etc/hosts');
    expect([403, 404]).toContain(res.status);
  });

  test('null byte in path is rejected with 400', async () => {
    // path.normalize() throws ERR_INVALID_ARG_VALUE for paths with \0;
    // the null byte guard returns 400 before reaching fs operations.
    const res = await supertest(server).get('/file%00.txt');
    expect(res.status).toBe(400);
  });

  test('backslash sequences are not treated as path separators on Linux', async () => {
    // On Linux, \\ is a literal filename character, not a path separator.
    // path.normalize leaves it intact and the resolved path stays within rootDir.
    // The file simply does not exist → 404 (not a traversal escape).
    const res = await supertest(server).get('/..%5C..%5Cetc%5Chosts');
    expect([403, 404]).toContain(res.status);
    // On Windows, path.normalize converts \ to / and the traversal check catches it → 403.
  });
});

// ─── Status Code 404 ─────────────────────────────────────────────────────────

describe('Bug Tests - Status Code 404', () => {
  let app;
  let server;

  beforeAll(() => {
    app = new Koa();
    app.use(koaClassicServer(rootDir, {
      showDirContents: true
    }));
    server = app.listen();
  });

  test('FIXED: Non-existent file returns 404', async () => {
    const res = await supertest(server).get('/file-che-non-esiste-xyz123.txt');
    expect(res.status).toBe(404);
    expect(res.text).toContain('Not Found');
  });

  test('FIXED: Directory with showDirContents=false returns 404', async () => {
    const app2 = new Koa();
    app2.use(koaClassicServer(rootDir, {
      showDirContents: false
    }));
    const server2 = app2.listen();

    const res = await supertest(server2).get('/');
    expect(res.status).toBe(404);

    server2.close();
  });

  afterAll(() => {
    server.close();
  });
});

// ─── Template Rendering Errors ────────────────────────────────────────────────

describe('Bug Tests - Template Rendering Errors', () => {
  test('FIXED: Template render error returns 500 HTML page, server does not crash', async () => {
    const app = new Koa();

    const brokenRender = async (ctx, next, filePath) => {
      throw new Error('Simulated template rendering error');
    };

    app.use(koaClassicServer(rootDir, {
      template: {
        render: brokenRender,
        ext: ['txt']
      }
    }));

    const server = app.listen();
    const testFile = path.join(rootDir, 'test-template.txt');
    fs.writeFileSync(testFile, 'test content');

    try {
      const res = await supertest(server).get('/test-template.txt');

      expect(res.status).toBe(500);
      expect(res.headers['content-type']).toMatch(/html/);
      expect(res.text).toContain('Internal Server Error');
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
      server.close();
    }
  });
});

// ─── File Extension Extraction ────────────────────────────────────────────────

describe('Bug Tests - File Extension Extraction', () => {
  let app;
  let server;

  beforeAll(() => {
    app = new Koa();

    const trackingRender = async (ctx, next, filePath) => {
      ctx.body = 'Rendered: ' + path.basename(filePath);
    };

    app.use(koaClassicServer(rootDir, {
      template: {
        render: trackingRender,
        ext: ['txt']
      }
    }));

    server = app.listen();
  });

  afterAll(() => {
    server.close();
  });

  test('FIXED: File without extension does not trigger template rendering', async () => {
    const testFile = path.join(rootDir, 'README');
    fs.writeFileSync(testFile, 'readme content');

    try {
      const res = await supertest(server).get('/README');
      const responseBody = res.text !== undefined ? res.text : res.body.toString('utf8');
      expect(responseBody).not.toContain('Rendered');
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });

  test('Unix hidden file (.gitignore) is served as a regular file, not rendered', async () => {
    // dotFiles are hidden by default; make them visible for this test so we can
    // verify that the extension check (not the template renderer) handles the file.
    const appVisible = new Koa();
    appVisible.use(koaClassicServer(rootDir, {
      hidden: { dotFiles: { default: 'visible' } },
      template: {
        render: async (ctx, next, filePath) => { ctx.body = 'Rendered: ' + path.basename(filePath); },
        ext: ['txt']
      }
    }));
    const serverVisible = appVisible.listen();

    const testFile = path.join(rootDir, '.gitignore');
    fs.writeFileSync(testFile, 'node_modules/');

    try {
      const res = await supertest(serverVisible).get('/.gitignore');
      // .gitignore has no .txt extension — template must not be invoked
      expect(res.status).toBe(200);
      const responseBody = res.text !== undefined ? res.text : res.body.toString('utf8');
      expect(responseBody).not.toContain('Rendered');
      expect(responseBody).toContain('node_modules/');
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
      serverVisible.close();
    }
  });
});

// ─── Race Condition File Access ───────────────────────────────────────────────
//
// BEHAVIOUR GUARANTEE (not tested — timing is non-deterministic):
//   If a file is deleted between the access check and the stream open,
//   the stream error handler fires and — if headers have not been sent yet —
//   the server returns 500. When rawFile cache is warm the race cannot occur
//   because the file is served entirely from memory.
//
// ─────────────────────────────────────────────────────────────────────────────

// ─── Directory Read Errors ────────────────────────────────────────────────────

describe('Bug Tests - Directory Read Errors', () => {
  test('FIXED: Unreadable directory returns 500, server does not crash', async () => {
    // Skip on Windows (chmod has no effect) and when running as root
    // (root ignores permission bits, so chmod 0o000 has no effect).
    if (process.platform === 'win32') return;
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;

    const app = new Koa();
    const tempDir = path.join(rootDir, 'temp-perm-test-dir');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    app.use(koaClassicServer(rootDir, { showDirContents: true }));
    const server = app.listen();

    try {
      const res1 = await supertest(server).get('/temp-perm-test-dir');
      expect(res1.status).toBe(200);

      fs.chmodSync(tempDir, 0o000);
      const res2 = await supertest(server).get('/temp-perm-test-dir');
      expect([403, 500]).toContain(res2.status);
    } finally {
      try { fs.chmodSync(tempDir, 0o755); } catch { /* ignore */ }
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
      server.close();
    }
  });
});

// ─── Content-Disposition ──────────────────────────────────────────────────────

describe('Bug Tests - Content-Disposition', () => {
  let app;
  let server;

  beforeAll(() => {
    app = new Koa();
    app.use(koaClassicServer(rootDir));
    server = app.listen();
  });

  afterAll(() => {
    server.close();
  });

  test('FIXED: Filename with spaces is quoted in Content-Disposition', async () => {
    const testFile = path.join(rootDir, 'file with spaces.txt');
    fs.writeFileSync(testFile, 'test content');

    try {
      const res = await supertest(server).get('/file%20with%20spaces.txt');
      const contentDisp = res.headers['content-disposition'];
      // quoted-string form must wrap the filename in double quotes
      expect(contentDisp).toMatch(/filename="file with spaces\.txt"/);
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });

  test('FIXED: Filename with special chars has RFC 5987 extended form', async () => {
    const testFile = path.join(rootDir, 'file with spaces & special.txt');
    fs.writeFileSync(testFile, 'test content');

    try {
      const res = await supertest(server).get('/file%20with%20spaces%20%26%20special.txt');
      const contentDisp = res.headers['content-disposition'];
      // RFC 5987 extended form must be present with UTF-8 encoding prefix
      expect(contentDisp).toMatch(/filename\*=UTF-8''/);
      // The & must be percent-encoded as %26 in the extended form
      expect(contentDisp).toContain('%26');
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });

  test('FIXED: Filename with double-quote is safely escaped', async () => {
    // Create file with a double-quote in its name (valid on Linux)
    let testFile;
    try {
      testFile = path.join(rootDir, 'file"name.txt');
      fs.writeFileSync(testFile, 'test');
    } catch {
      // Some filesystems disallow " in filenames — skip gracefully
      return;
    }

    try {
      const res = await supertest(server).get('/file%22name.txt');
      const contentDisp = res.headers['content-disposition'];
      // The " inside the quoted-string must be escaped as \"
      expect(contentDisp).toMatch(/filename="file\\"name\.txt"/);
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });
});
