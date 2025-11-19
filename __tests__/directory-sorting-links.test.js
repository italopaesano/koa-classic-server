const Koa = require('koa');
const request = require('supertest');
const koaClassicServer = require('../index.cjs');
const path = require('path');

describe('Directory Sorting Links Bug Tests', () => {
    let app;
    let server;

    beforeAll(() => {
        app = new Koa();
        const publicDir = path.join(__dirname, 'publicWwwTest');

        app.use(koaClassicServer(publicDir, {
            method: ['GET'],
            showDirContents: true
        }));

        server = app.listen();
    });

    afterAll(() => {
        server.close();
    });

    describe('Bug: Links with query parameters in path', () => {
        test('File links should not contain sort query parameters in path', async () => {
            const response = await request(server)
                .get('/?sort=name&order=asc')
                .expect(200);

            console.log('Testing for bug...');
            console.log('Looking for malformed URLs like: ?sort=name&order=asc/');

            // The bug creates malformed URLs like: href="http://localhost:3000/?sort=name&order=asc/test.txt"
            // Should NOT contain query params before slash
            expect(response.text).not.toContain('?sort=name&order=asc/');

            // Also check specific pattern
            const malformedPattern = /href="[^"]*\?sort=[^"]*\//;
            expect(response.text).not.toMatch(malformedPattern);
        });

        test('Directory links should not contain query parameters in path', async () => {
            const response = await request(server)
                .get('/?sort=size&order=desc')
                .expect(200);

            // Bug would create: href="http://localhost/?sort=size&order=desc/cartella"
            expect(response.text).not.toContain('?sort=size&order=desc/');

            // Check for malformed href pattern
            const malformedPattern = /href="[^"]*\?sort=[^"]*\//;
            expect(response.text).not.toMatch(malformedPattern);
        });
    });

    describe('Functional: Navigation after sorting', () => {
        test('Should enter folder after sorting by name', async () => {
            // Load root with sorting
            const rootResponse = await request(server)
                .get('/?sort=name&order=asc')
                .expect(200);

            expect(rootResponse.text).toContain('cartella');

            // Enter cartella folder
            const folderResponse = await request(server)
                .get('/cartella')
                .expect(200);

            expect(folderResponse.text).toContain('sottocartella');
        });

        test('Should navigate subfolders after sorting by size', async () => {
            await request(server)
                .get('/?sort=size&order=desc')
                .expect(200);

            // Enter cartella
            const folderResponse = await request(server)
                .get('/cartella')
                .expect(200);

            expect(folderResponse.text).toContain('sottocartella');

            // Enter sottocartella
            const subfolderResponse = await request(server)
                .get('/cartella/sottocartella')
                .expect(200);

            expect(subfolderResponse.text).toContain('ciao.html');
        });

        test('Should access file after sorting by type', async () => {
            await request(server)
                .get('/?sort=type&order=asc')
                .expect(200);

            // Access file
            const fileResponse = await request(server)
                .get('/test.txt')
                .expect(200);

            expect(fileResponse.text).toContain('hello world');
        });
    });

    describe('Regression: Sort links still work', () => {
        test('Sort header links should work', async () => {
            const response = await request(server)
                .get('/')
                .expect(200);

            // Sort links SHOULD have query parameters
            expect(response.text).toContain('?sort=name');
            expect(response.text).toContain('?sort=type');
            expect(response.text).toContain('?sort=size');
        });

        test('Sort indicators should toggle', async () => {
            const response1 = await request(server)
                .get('/?sort=name&order=asc')
                .expect(200);

            expect(response1.text).toContain('↑');

            const response2 = await request(server)
                .get('/?sort=name&order=desc')
                .expect(200);

            expect(response2.text).toContain('↓');
        });
    });
});
