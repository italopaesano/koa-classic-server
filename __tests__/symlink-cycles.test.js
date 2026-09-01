/**
 * Symlink cycles and self-references × the three `symlinks` policy modes.
 * 2026-09 coverage review.
 *
 * symlink.test.js has one circular-symlink test. It is the weakest assertion in
 * the suite: a single `GET /circular-a`, only under the default policy, skipped
 * unless a fixture happens to exist, and satisfied by any of `[404, 500]`.
 * Nothing covers the shapes that actually recurse:
 *
 *   - a DIRECTORY symlink pointing at its own parent, walked repeatedly
 *     (`/d/self/self/self/i.txt`) — the only case where a request can make the
 *     resolver do unbounded work;
 *   - a two-node cycle across sibling directories (a → b → a);
 *   - a symlink whose target is itself (ELOOP at the syscall level);
 *   - a dangling symlink, with and without a trailing slash.
 *
 * Each is asserted in all three modes, because they diverge: 'follow' and
 * 'follow-within-root' resolve a cycle that stays inside rootDir (it never
 * escapes, so there is nothing for the boundary check to reject), while 'deny'
 * refuses at the first hop. The listing rendering of each shape is pinned too —
 * a cycle must be visible and labelled, never rendered as a normal directory.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

// Windows without developer mode cannot create symlinks.
let symlinkSupported = true;
try {
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-cycle-check-'));
    fs.writeFileSync(path.join(probe, 't'), 'x');
    fs.symlinkSync(path.join(probe, 't'), path.join(probe, 'l'));
    fs.rmSync(probe, { recursive: true, force: true });
} catch {
    symlinkSupported = false;
}
const describeIfSymlinks = symlinkSupported ? describe : describe.skip;

describeIfSymlinks('symlink cycles', () => {
    let root;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-cycles-'));

        // 1. A directory that contains a symlink back to itself.
        fs.mkdirSync(path.join(root, 'd'));
        fs.writeFileSync(path.join(root, 'd', 'inner.txt'), 'INNER');
        fs.symlinkSync(path.join(root, 'd'), path.join(root, 'd', 'self'), 'dir');

        // 2. A two-node cycle: ca/tocb → cb, cb/toca → ca.
        fs.mkdirSync(path.join(root, 'ca'));
        fs.mkdirSync(path.join(root, 'cb'));
        fs.writeFileSync(path.join(root, 'cb', 'leaf.txt'), 'LEAF');
        fs.symlinkSync(path.join(root, 'cb'), path.join(root, 'ca', 'tocb'), 'dir');
        fs.symlinkSync(path.join(root, 'ca'), path.join(root, 'cb', 'toca'), 'dir');

        // 3. A symlink whose target is itself → ELOOP on any stat().
        fs.symlinkSync(path.join(root, 'ouroboros'), path.join(root, 'ouroboros'));

        // 4. A symlink to a target that does not exist.
        fs.symlinkSync(path.join(root, 'ghost'), path.join(root, 'dangling'));
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    function makeServer(symlinks) {
        const app = new Koa();
        app.use(koaClassicServer(root, {
            symlinks,
            index: [],
            logger: { warn: () => {}, error: () => {} },
        }));
        return app.callback();
    }

    // Rows of a listing body, one string per <tr>.
    function listingRows(html) {
        const body = html.split('<tbody>')[1].split('</tbody>')[0];
        return body.split('<tr>').filter(Boolean);
    }
    const rowFor = (html, name) => listingRows(html).find((r) => r.includes(`>${name}<`));

    // ─── the self-referencing directory symlink ──────────────────────────────

    describe.each([['follow'], ['follow-within-root']])('symlinks: %s — a cycle inside rootDir is followed', (mode) => {
        let server;
        beforeAll(() => { server = makeServer(mode); });

        test('one hop through the self-link lists the same directory', async () => {
            const direct = await supertest(server).get('/d/');
            const viaSelf = await supertest(server).get('/d/self/');
            expect(viaSelf.status).toBe(200);
            expect(viaSelf.text).toContain('inner.txt');
            expect(listingRows(viaSelf.text).length).toBe(listingRows(direct.text).length);
        });

        test('many hops still terminate and still resolve to the same file', async () => {
            const deep = '/d/' + 'self/'.repeat(20) + 'inner.txt';
            const res = await supertest(server).get(deep);
            expect(res.status).toBe(200);
            expect(res.text).toBe('INNER');
        });

        test('the two-node cycle resolves as well', async () => {
            const res = await supertest(server).get('/ca/tocb/toca/tocb/leaf.txt');
            expect(res.status).toBe(200);
            expect(res.text).toBe('LEAF');
        });

        test('the cycle is listed as a clickable entry, labelled a symlink', async () => {
            const res = await supertest(server).get('/d/');
            const row = rowFor(res.text, 'self');
            expect(row).toContain('( Symlink )');
            expect(row).toContain('href="/d/self/"');
        });
    });

    describe('symlinks: deny — the cycle is refused at the first hop', () => {
        let server;
        beforeAll(() => { server = makeServer('deny'); });

        test('a single hop through the self-link is 404', async () => {
            expect((await supertest(server).get('/d/self/')).status).toBe(404);
        });

        test('a deep repetition is 404 too, with no extra work per hop', async () => {
            const deep = '/d/' + 'self/'.repeat(20) + 'inner.txt';
            expect((await supertest(server).get(deep)).status).toBe(404);
        });

        test('the two-node cycle is refused', async () => {
            expect((await supertest(server).get('/ca/tocb/toca/tocb/leaf.txt')).status).toBe(404);
        });

        test('the real directory behind the cycle is still reachable directly', async () => {
            const res = await supertest(server).get('/d/inner.txt');
            expect(res.status).toBe(200);
            expect(res.text).toBe('INNER');
        });

        test('the cycle is listed but NOT clickable, labelled blocked', async () => {
            const res = await supertest(server).get('/d/');
            const row = rowFor(res.text, 'self');
            expect(row).toContain('( Blocked Symlink )');
            expect(row).not.toContain('href="/d/self/"');
        });
    });

    // ─── ELOOP and dangling links: identical in every mode ───────────────────

    describe.each([['follow'], ['follow-within-root'], ['deny']])('symlinks: %s — unresolvable links', (mode) => {
        let server;
        beforeAll(() => { server = makeServer(mode); });

        test('a symlink pointing at itself (ELOOP) is a 404, never a hang or a 500', async () => {
            expect((await supertest(server).get('/ouroboros')).status).toBe(404);
            expect((await supertest(server).get('/ouroboros/')).status).toBe(404);
        });

        test('a dangling symlink is a 404, with and without a trailing slash', async () => {
            expect((await supertest(server).get('/dangling')).status).toBe(404);
            expect((await supertest(server).get('/dangling/')).status).toBe(404);
        });

        test('both appear in the listing as non-clickable broken symlinks', async () => {
            const res = await supertest(server).get('/');
            for (const name of ['ouroboros', 'dangling']) {
                const row = rowFor(res.text, name);
                expect(row).toContain('( Broken Symlink )');
                expect(row).not.toContain(`href="/${name}`);
            }
        });

        test('an unresolvable entry does not abort the listing — real entries still render', async () => {
            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(rowFor(res.text, 'd')).toContain('href="/d/"');
        });
    });

    // ─── the cycle must not become an escape route ───────────────────────────

    describe('a cycle never becomes a way out of rootDir', () => {
        let outside;

        beforeAll(() => {
            outside = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-cycles-out-'));
            fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP-SECRET');
            // A link that leaves the tree, planted INSIDE the cycling directory.
            fs.symlinkSync(outside, path.join(root, 'd', 'escape'), 'dir');
        });

        afterAll(() => {
            fs.rmSync(path.join(root, 'd', 'escape'), { force: true });
            fs.rmSync(outside, { recursive: true, force: true });
        });

        test("follow-within-root: reaching the escape THROUGH the cycle is still 404", async () => {
            const server = makeServer('follow-within-root');
            expect((await supertest(server).get('/d/self/self/escape/secret.txt')).status).toBe(404);
            expect((await supertest(server).get('/d/escape/secret.txt')).status).toBe(404);
        });

        test('deny: same outcome, refused earlier', async () => {
            const server = makeServer('deny');
            expect((await supertest(server).get('/d/self/self/escape/secret.txt')).status).toBe(404);
        });

        test('follow: the historical mode does serve it — the escape hatch is unchanged', async () => {
            const server = makeServer('follow');
            const res = await supertest(server).get('/d/self/self/escape/secret.txt');
            expect(res.status).toBe(200);
            expect(res.text).toBe('TOP-SECRET');
        });
    });
});
