const Koa = require('koa');
const koaClassicServer = require('../index.cjs');
const supertest = require('supertest');
const path = require('path');
const fs = require('fs');
const ejs = require('ejs');

describe('EJS Template Engine Integration Tests', () => {
    let app;
    let server;
    let request;

    beforeAll(() => {
        app = new Koa();

        const rootDir = path.join(__dirname, 'publicWwwTest');

        // Configure koaClassicServer with EJS template support
        app.use(
            koaClassicServer(rootDir, {
                method: ['GET'],
                showDirContents: true,
                template: {
                    ext: ['ejs'],
                    render: async (ctx, next, filePath) => {
                        // Read the template file
                        const templateContent = await fs.promises.readFile(filePath, 'utf-8');

                        // Prepare data for different templates
                        const data = getTemplateData(filePath);

                        // Render with EJS
                        const html = ejs.render(templateContent, data);

                        ctx.type = 'text/html';
                        ctx.body = html;
                    }
                }
            })
        );

        server = app.listen();
        request = supertest(server);
    });

    afterAll(() => {
        if (server) {
            server.close();
        }
    });

    // Helper function to provide data for each template
    function getTemplateData(filePath) {
        const basename = path.basename(filePath, '.ejs');

        const dataMap = {
            'simple': {
                title: 'Simple EJS Test',
                heading: 'Hello from EJS',
                message: 'This is a simple template test',
                timestamp: '2025-11-18'
            },
            'with-loop': {
                items: [
                    { name: 'Item 1', value: 100 },
                    { name: 'Item 2', value: 200 },
                    { name: 'Item 3', value: 300 }
                ]
            },
            'with-conditional': {
                isLoggedIn: true,
                username: 'TestUser',
                role: 'admin',
                notifications: 5
            },
            'with-escaping': {
                userInput: '<script>alert("XSS")</script>',
                htmlContent: '<strong>Bold text</strong>',
                safeText: 'Plain & safe text',
                allowedHtml: '<em>Emphasized text</em>'
            },
            'complex': {
                pageTitle: 'E-Commerce Products',
                user: {
                    name: 'Mario Rossi'
                },
                products: [
                    {
                        id: 1,
                        name: 'Laptop',
                        description: 'High-performance laptop',
                        price: 999.99,
                        discount: 10,
                        inStock: true
                    },
                    {
                        id: 2,
                        name: 'Mouse',
                        description: 'Wireless mouse',
                        price: 29.99,
                        discount: 0,
                        inStock: true
                    },
                    {
                        id: 3,
                        name: 'Keyboard',
                        description: 'Mechanical keyboard',
                        price: 149.99,
                        discount: 15,
                        inStock: false
                    }
                ]
            },
            'testEjs': {
                // For the existing test file
            }
        };

        return dataMap[basename] || {};
    }

    describe('Simple Template - simple.ejs', () => {
        test('Should render simple template with variables', async () => {
            const response = await request.get('/ejs-templates/simple.ejs');

            expect(response.status).toBe(200);
            expect(response.type).toBe('text/html');
            expect(response.text).toContain('Simple EJS Test');
            expect(response.text).toContain('Hello from EJS');
            expect(response.text).toContain('This is a simple template test');
            expect(response.text).toContain('2025-11-18');
        });
    });

    describe('Loop Template - with-loop.ejs', () => {
        test('Should render template with forEach loop', async () => {
            const response = await request.get('/ejs-templates/with-loop.ejs');

            expect(response.status).toBe(200);
            expect(response.text).toContain('Lista di Items');
            expect(response.text).toContain('Item 1 - 100');
            expect(response.text).toContain('Item 2 - 200');
            expect(response.text).toContain('Item 3 - 300');
            expect(response.text).toContain('Totale items: 3');
            expect(response.text).toContain('data-index="0"');
            expect(response.text).toContain('data-index="1"');
            expect(response.text).toContain('data-index="2"');
        });
    });

    describe('Conditional Template - with-conditional.ejs', () => {
        test('Should render template with if/else conditionals (logged in)', async () => {
            const response = await request.get('/ejs-templates/with-conditional.ejs');

            expect(response.status).toBe(200);
            expect(response.text).toContain('Benvenuto, TestUser!');
            expect(response.text).toContain('Ruolo: admin');
            expect(response.text).toContain('Hai 5 nuove notifiche');
            // Should NOT contain guest panel
            expect(response.text).not.toContain('Benvenuto, ospite!');
        });
    });

    describe('Escaping Template - with-escaping.ejs', () => {
        test('Should properly escape HTML in <%= %> tags', async () => {
            const response = await request.get('/ejs-templates/with-escaping.ejs');

            expect(response.status).toBe(200);

            // HTML should be escaped (safe)
            // Note: EJS uses &#34; instead of &quot; for quotes
            expect(response.text).toContain('&lt;script&gt;alert(&#34;XSS&#34;)&lt;/script&gt;');

            // HTML should NOT be escaped (unsafe - unescaped output)
            expect(response.text).toContain('<strong>Bold text</strong>');

            // Safe text with & should be escaped
            expect(response.text).toContain('Plain &amp; safe text');

            // Allowed HTML should be rendered
            expect(response.text).toContain('<em>Emphasized text</em>');
        });

        test('Should protect against XSS attacks', async () => {
            const response = await request.get('/ejs-templates/with-escaping.ejs');

            // The escaped section should not contain executable script tags
            const escapedSection = response.text.match(/<div class="escaped">[\s\S]*?<\/div>/)[0];
            expect(escapedSection).not.toContain('<script>');
            expect(escapedSection).toContain('&lt;script&gt;');
        });
    });

    describe('Complex Template - complex.ejs', () => {
        test('Should render complex template with all features', async () => {
            const response = await request.get('/ejs-templates/complex.ejs');

            expect(response.status).toBe(200);

            // Page title
            expect(response.text).toContain('E-Commerce Products');

            // User greeting
            expect(response.text).toContain('Ciao, Mario Rossi!');

            // Products list
            expect(response.text).toContain('Laptop');
            expect(response.text).toContain('High-performance laptop');
            expect(response.text).toContain('€999.99');

            // Discount calculation
            expect(response.text).toContain('Sconto: 10%');
            expect(response.text).toContain('€899.99'); // 999.99 - 10%

            // Mouse without discount
            expect(response.text).toContain('Mouse');
            expect(response.text).toContain('€29.99');

            // Keyboard out of stock
            expect(response.text).toContain('Keyboard');
            expect(response.text).toContain('Non disponibile');

            // Total count
            expect(response.text).toContain('Totale prodotti: 3');
        });

        test('Should have correct product data attributes', async () => {
            const response = await request.get('/ejs-templates/complex.ejs');

            expect(response.text).toContain('data-id="1"');
            expect(response.text).toContain('data-id="2"');
            expect(response.text).toContain('data-id="3"');
        });

        test('Should show "Add to cart" button only for in-stock items', async () => {
            const response = await request.get('/ejs-templates/complex.ejs');

            // Count "Aggiungi al carrello" buttons - should be 2 (Laptop and Mouse)
            const buttonMatches = response.text.match(/Aggiungi al carrello/g);
            expect(buttonMatches).toHaveLength(2);

            // Count "Non disponibile" - should be 1 (Keyboard)
            const outOfStockMatches = response.text.match(/Non disponibile/g);
            expect(outOfStockMatches).toHaveLength(1);
        });
    });

    describe('Index Template - index.ejs', () => {
        test('Should render index page with links', async () => {
            const response = await request.get('/ejs-templates/index.ejs');

            expect(response.status).toBe(200);
            expect(response.text).toContain('Test Templates EJS');
            expect(response.text).toContain('simple.ejs');
            expect(response.text).toContain('with-loop.ejs');
            expect(response.text).toContain('with-conditional.ejs');
            expect(response.text).toContain('with-escaping.ejs');
            expect(response.text).toContain('complex.ejs');
        });
    });

    describe('Existing EJS file - testEjs.ejs', () => {
        test('Should render existing testEjs.ejs file', async () => {
            const response = await request.get('/cartella/sottocartella/provaEjs/testEjs.ejs');

            expect(response.status).toBe(200);
            expect(response.type).toBe('text/html');
            expect(response.text).toContain('<h1>hello world</h1>');
        });
    });

    describe('Error Handling', () => {
        test('Should return 404 for non-existent .ejs file', async () => {
            const response = await request.get('/ejs-templates/non-existent.ejs');

            expect(response.status).toBe(404);
        });
    });

    describe('Performance', () => {
        test('Should render complex template in reasonable time', async () => {
            const start = Date.now();
            const response = await request.get('/ejs-templates/complex.ejs');
            const duration = Date.now() - start;

            expect(response.status).toBe(200);
            expect(duration).toBeLessThan(100); // Should render in less than 100ms
        });

        test('Should render simple template very quickly', async () => {
            const start = Date.now();
            const response = await request.get('/ejs-templates/simple.ejs');
            const duration = Date.now() - start;

            expect(response.status).toBe(200);
            expect(duration).toBeLessThan(50); // Should render in less than 50ms
        });
    });
});
