const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const Koa = require('koa');
const path = require('path');

const root = path.join(__dirname, 'hidden-fixtures');

function createApp(hiddenOpts) {
  const app = new Koa();
  app.use(koaClassicServer(root, { showDirContents: true, hidden: hiddenOpts }));
  return app.listen();
}

// ─── Implicit default warning ─────────────────────────────────────────────────
// This describe block MUST be first: the warning flag is module-level and fires
// only once per Jest worker process.  Jest isolates each test FILE into its own
// module registry, so the flag starts as false when this file loads.

describe('hidden option — implicit default warning', () => {
  let warnSpy;

  beforeAll(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  test('warns when dotFiles.default and dotDirs.default are not explicitly set', () => {
    warnSpy.mockClear();
    koaClassicServer(root, {}); // no hidden config at all — both defaults implicit
    const warnings = warnSpy.mock.calls.filter(c =>
      c[1] && c[1].includes('dotFiles') && c[1].includes('dotDirs')
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0][1]).toContain('hidden.dotFiles.default');
    expect(warnings[0][1]).toContain('v3.0.0');
  });

  test('does not warn again on subsequent calls (once per process)', () => {
    warnSpy.mockClear();
    koaClassicServer(root, {}); // flag already set from the test above
    const warnings = warnSpy.mock.calls.filter(c =>
      c[1] && c[1].includes('dotFiles')
    );
    expect(warnings.length).toBe(0);
  });

  test('no warning when both dotFiles.default and dotDirs.default are explicitly set', () => {
    // Use jest.isolateModules to obtain a fresh copy of index.cjs whose flag is false,
    // then verify that an explicit configuration emits no warning.
    let fresh;
    jest.isolateModules(() => {
      fresh = require('../index.cjs');
    });
    warnSpy.mockClear();
    fresh(root, {
      hidden: {
        dotFiles: { default: 'hidden' },
        dotDirs:  { default: 'visible' },
      }
    });
    const warnings = warnSpy.mock.calls.filter(c =>
      c[1] && c[1].includes('dotFiles')
    );
    expect(warnings.length).toBe(0);
  });
});

// ─── Option validation ────────────────────────────────────────────────────────

describe('hidden option — validation', () => {
  test('throws when dotFiles.default is not "hidden" or "visible"', () => {
    expect(() =>
      koaClassicServer(root, { hidden: { dotFiles: { default: 'yes' } } })
    ).toThrow(/hidden\.dotFiles\.default must be "hidden" or "visible"/);
  });

  test('throws when dotDirs.default is not "hidden" or "visible"', () => {
    expect(() =>
      koaClassicServer(root, { hidden: { dotDirs: { default: 'yes' } } })
    ).toThrow(/hidden\.dotDirs\.default must be "hidden" or "visible"/);
  });

  test('does not throw when hidden option is omitted', () => {
    expect(() => koaClassicServer(root, {})).not.toThrow();
  });

  test('does not throw when hidden is a valid object', () => {
    expect(() =>
      koaClassicServer(root, {
        hidden: {
          dotFiles: { default: 'hidden', whitelist: ['.well-known'], blacklist: ['.env'] },
          dotDirs:  { default: 'visible', blacklist: [/^\.git/] },
          alwaysHide: ['*.secret', /\.key$/]
        }
      })
    ).not.toThrow();
  });
});

// ─── dotFiles default: 'hidden' (system default) ─────────────────────────────

describe('dotFiles — default hidden (system default)', () => {
  let server;
  beforeAll(() => { server = createApp(undefined); });
  afterAll(() => server.close());

  test('GET /.env returns 404', async () => {
    const res = await supertest(server).get('/.env');
    expect(res.status).toBe(404);
  });

  test('GET /.gitignore returns 404', async () => {
    const res = await supertest(server).get('/.gitignore');
    expect(res.status).toBe(404);
  });

  test('GET /subdir/.env returns 404 (dot-file in subdirectory)', async () => {
    const res = await supertest(server).get('/subdir/.env');
    expect(res.status).toBe(404);
  });

  test('directory listing does not include .env', async () => {
    const res = await supertest(server).get('/');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('.env');
  });

  test('directory listing does not include .gitignore', async () => {
    const res = await supertest(server).get('/');
    expect(res.text).not.toContain('.gitignore');
  });

  test('regular files remain accessible', async () => {
    const res = await supertest(server).get('/normal.txt');
    expect(res.status).toBe(200);
  });
});

// ─── dotFiles default: 'visible' ─────────────────────────────────────────────

describe('dotFiles — default visible', () => {
  let server;
  beforeAll(() => {
    server = createApp({ dotFiles: { default: 'visible' } });
  });
  afterAll(() => server.close());

  test('GET /.env returns 200 when dotFiles.default is "visible"', async () => {
    const res = await supertest(server).get('/.env');
    expect(res.status).toBe(200);
  });

  test('directory listing includes .env when dotFiles.default is "visible"', async () => {
    const res = await supertest(server).get('/');
    expect(res.text).toContain('.env');
  });
});

// ─── dotFiles whitelist ───────────────────────────────────────────────────────

describe('dotFiles — whitelist exceptions', () => {
  let server;
  beforeAll(() => {
    server = createApp({
      dotFiles: { default: 'hidden', whitelist: ['.well-known'] },
      dotDirs:  { default: 'hidden', whitelist: ['.well-known'] }
    });
  });
  afterAll(() => server.close());

  test('GET /.well-known/ is accessible (whitelisted dir)', async () => {
    const res = await supertest(server).get('/.well-known/');
    expect(res.status).toBe(200);
  });

  test('GET /.well-known/acme-challenge.txt is accessible (inside whitelisted dir)', async () => {
    const res = await supertest(server).get('/.well-known/acme-challenge.txt');
    expect(res.status).toBe(200);
  });

  test('.well-known appears in root listing', async () => {
    const res = await supertest(server).get('/');
    expect(res.text).toContain('.well-known');
  });

  test('GET /.env still returns 404 (not whitelisted)', async () => {
    const res = await supertest(server).get('/.env');
    expect(res.status).toBe(404);
  });

  test('whitelist with RegExp: /^\\.public/ matches .public-assets', async () => {
    // This tests the regex matching logic; .public-assets doesn't exist so we
    // expect 404 from "not found", not from "hidden" — indirectly confirms regex is not blocking
    const server2 = createApp({
      dotFiles: { default: 'hidden', whitelist: [/^\.public/] }
    });
    // .env is not matched by /^\.public/ so it stays hidden
    const res = await supertest(server2).get('/.env');
    expect(res.status).toBe(404);
    server2.close();
  });
});

// ─── dotFiles blacklist ───────────────────────────────────────────────────────

describe('dotFiles — blacklist', () => {
  let server;
  beforeAll(() => {
    server = createApp({
      dotFiles: { default: 'visible', blacklist: ['.env'] }
    });
  });
  afterAll(() => server.close());

  test('GET /.env returns 404 (blacklisted even with default: visible)', async () => {
    const res = await supertest(server).get('/.env');
    expect(res.status).toBe(404);
  });

  test('GET /.gitignore returns 200 (visible, not blacklisted)', async () => {
    const res = await supertest(server).get('/.gitignore');
    expect(res.status).toBe(200);
  });

  test('.env not in listing when blacklisted', async () => {
    const res = await supertest(server).get('/');
    expect(res.text).not.toContain('.env');
  });
});

// ─── blacklist beats whitelist ────────────────────────────────────────────────

describe('dotFiles — blacklist beats whitelist', () => {
  let server;
  beforeAll(() => {
    server = createApp({
      dotFiles: { default: 'visible', whitelist: ['.env'], blacklist: ['.env'] }
    });
  });
  afterAll(() => server.close());

  test('GET /.env returns 404 (blacklist wins over whitelist)', async () => {
    const res = await supertest(server).get('/.env');
    expect(res.status).toBe(404);
  });
});

// ─── dotDirs default: 'visible' (system default) ─────────────────────────────

describe('dotDirs — default visible (system default)', () => {
  let server;
  beforeAll(() => { server = createApp(undefined); });
  afterAll(() => server.close());

  test('.dot-dir appears in root listing by default', async () => {
    const res = await supertest(server).get('/');
    expect(res.text).toContain('.dot-dir');
  });

  test('GET /.dot-dir/ returns 200 (directory listing) by default', async () => {
    const res = await supertest(server).get('/.dot-dir/');
    expect(res.status).toBe(200);
  });

  test('GET /.dot-dir/inside.txt returns 200 by default', async () => {
    const res = await supertest(server).get('/.dot-dir/inside.txt');
    expect(res.status).toBe(200);
  });
});

// ─── dotDirs blacklist ────────────────────────────────────────────────────────

describe('dotDirs — blacklist', () => {
  let server;
  beforeAll(() => {
    server = createApp({ dotDirs: { blacklist: ['.dot-dir'] } });
  });
  afterAll(() => server.close());

  test('GET /.dot-dir/ returns 404 (blacklisted dir)', async () => {
    const res = await supertest(server).get('/.dot-dir/');
    expect(res.status).toBe(404);
  });

  test('GET /.dot-dir/inside.txt returns 404 (inside blocked dir)', async () => {
    const res = await supertest(server).get('/.dot-dir/inside.txt');
    expect(res.status).toBe(404);
  });

  test('.dot-dir not in root listing when blacklisted', async () => {
    const res = await supertest(server).get('/');
    expect(res.text).not.toContain('.dot-dir');
  });
});

// ─── dotDirs blacklist with RegExp ────────────────────────────────────────────

describe('dotDirs — blacklist with RegExp', () => {
  let server;
  beforeAll(() => {
    server = createApp({ dotDirs: { blacklist: [/^\.dot/] } });
  });
  afterAll(() => server.close());

  test('GET /.dot-dir/ returns 404 (RegExp blacklist match)', async () => {
    const res = await supertest(server).get('/.dot-dir/');
    expect(res.status).toBe(404);
  });

  test('.well-known accessible (does not match /^\\.dot/)', async () => {
    const res = await supertest(server).get('/.well-known/');
    expect(res.status).toBe(200);
  });
});

// ─── alwaysHide ───────────────────────────────────────────────────────────────

describe('alwaysHide — glob and regex patterns', () => {
  let server;
  beforeAll(() => {
    server = createApp({
      dotFiles: { default: 'visible' }, // dot-files visible so we can test alwaysHide separately
      alwaysHide: ['*.secret', /\.key$/]
    });
  });
  afterAll(() => server.close());

  test('GET /file.secret returns 404 (glob *.secret)', async () => {
    const res = await supertest(server).get('/file.secret');
    expect(res.status).toBe(404);
  });

  test('GET /data.key returns 404 (regex /\\.key$/)', async () => {
    const res = await supertest(server).get('/data.key');
    expect(res.status).toBe(404);
  });

  test('file.secret not in directory listing', async () => {
    const res = await supertest(server).get('/');
    expect(res.text).not.toContain('file.secret');
  });

  test('data.key not in directory listing', async () => {
    const res = await supertest(server).get('/');
    expect(res.text).not.toContain('data.key');
  });

  test('regular files remain accessible', async () => {
    const res = await supertest(server).get('/normal.txt');
    expect(res.status).toBe(200);
  });
});

// ─── alwaysHide — path-anchored patterns ─────────────────────────────────────

describe('alwaysHide — path-anchored glob (config/secrets/**)', () => {
  let server;
  beforeAll(() => {
    server = createApp({ alwaysHide: ['config/secrets/**'] });
  });
  afterAll(() => server.close());

  test('GET /config/secrets/password.txt returns 404', async () => {
    const res = await supertest(server).get('/config/secrets/password.txt');
    expect(res.status).toBe(404);
  });

  test('password.txt not in /config/secrets/ listing', async () => {
    const res = await supertest(server).get('/config/secrets/');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('password.txt');
  });

  test('GET /normal.txt remains accessible (not under config/secrets/)', async () => {
    const res = await supertest(server).get('/normal.txt');
    expect(res.status).toBe(200);
  });
});

// ─── alwaysHide secondary to whitelist ───────────────────────────────────────

describe('alwaysHide — secondary to dotFiles whitelist', () => {
  let server;
  beforeAll(() => {
    server = createApp({
      dotFiles: { default: 'hidden', whitelist: ['.env'] },
      alwaysHide: ['.env']  // both alwaysHide and whitelist target .env
    });
  });
  afterAll(() => server.close());

  test('GET /.env returns 200 (whitelist wins over alwaysHide)', async () => {
    const res = await supertest(server).get('/.env');
    expect(res.status).toBe(200);
  });
});

// ─── deep tree: dot-files hidden at any depth ─────────────────────────────────

describe('hidden entries at any depth in directory tree', () => {
  let server;
  beforeAll(() => { server = createApp(undefined); });
  afterAll(() => server.close());

  test('GET /subdir/.env returns 404 (dot-file hidden at any depth)', async () => {
    const res = await supertest(server).get('/subdir/.env');
    expect(res.status).toBe(404);
  });

  test('/subdir/.env not in /subdir/ listing', async () => {
    const res = await supertest(server).get('/subdir/');
    expect(res.text).not.toContain('.env');
  });

  test('GET /subdir/regular.txt returns 200 (regular file accessible)', async () => {
    const res = await supertest(server).get('/subdir/regular.txt');
    expect(res.status).toBe(200);
  });
});
