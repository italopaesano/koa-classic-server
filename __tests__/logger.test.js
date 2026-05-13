const Koa = require('koa');
const fs = require('fs');
const os = require('os');
const path = require('path');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

const fixturesDir = path.join(__dirname, 'publicWwwTest');

function makeLogger() {
    return {
        error: jest.fn(),
        warn: jest.fn(),
    };
}

describe('options.logger', () => {
    describe('Factory validation', () => {
        test('accepts undefined (defaults to console)', () => {
            expect(() => koaClassicServer(fixturesDir, {})).not.toThrow();
        });

        test('rejects null', () => {
            expect(() => koaClassicServer(fixturesDir, { logger: null }))
                .toThrow(/options\.logger must be an object/);
        });

        test('rejects false', () => {
            expect(() => koaClassicServer(fixturesDir, { logger: false }))
                .toThrow(/options\.logger must be an object/);
        });

        test('rejects array', () => {
            expect(() => koaClassicServer(fixturesDir, { logger: [] }))
                .toThrow(/options\.logger must be an object/);
        });

        test('rejects object missing error()', () => {
            expect(() => koaClassicServer(fixturesDir, { logger: { warn: () => {} } }))
                .toThrow(/must implement both error\(\) and warn\(\)/);
        });

        test('rejects object missing warn()', () => {
            expect(() => koaClassicServer(fixturesDir, { logger: { error: () => {} } }))
                .toThrow(/must implement both error\(\) and warn\(\)/);
        });

        test('accepts object with both error() and warn()', () => {
            expect(() => koaClassicServer(fixturesDir, {
                logger: { error: () => {}, warn: () => {} }
            })).not.toThrow();
        });

        test('accepts a logger with extra methods (pino/winston style)', () => {
            const logger = {
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
                debug: jest.fn(),
                fatal: jest.fn(),
            };
            expect(() => koaClassicServer(fixturesDir, { logger })).not.toThrow();
        });
    });

    describe('Custom logger receives events', () => {
        test('template render error routes to logger.error', async () => {
            const logger = makeLogger();
            const app = new Koa();
            app.silent = true;
            app.use(koaClassicServer(fixturesDir, {
                logger,
                template: {
                    ext: ['ejs'],
                    render: () => { throw new Error('boom'); }
                }
            }));
            const server = app.listen();

            try {
                const res = await supertest(server).get('/ejs-templates/simple.ejs');
                expect(res.status).toBe(500);
                expect(logger.error).toHaveBeenCalledTimes(1);
                expect(logger.error.mock.calls[0][0]).toBe('Template rendering error:');
                expect(logger.error.mock.calls[0][1]).toBeInstanceOf(Error);
            } finally {
                server.close();
            }
        });

        test('template render timeout routes to logger.error', async () => {
            const logger = makeLogger();
            const app = new Koa();
            app.silent = true;
            app.use(koaClassicServer(fixturesDir, {
                logger,
                template: {
                    ext: ['ejs'],
                    renderTimeout: 50,
                    render: async () => {
                        await new Promise(resolve => {
                            const t = setTimeout(resolve, 5000);
                            if (typeof t.unref === 'function') t.unref();
                        });
                    }
                }
            }));
            const server = app.listen();

            try {
                const res = await supertest(server).get('/ejs-templates/simple.ejs');
                expect(res.status).toBe(504);
                expect(logger.error).toHaveBeenCalledTimes(1);
                expect(logger.error.mock.calls[0][0]).toMatch(/Template render timeout after 50ms/);
            } finally {
                server.close();
            }
        });

        test('hideExtension misuse warning routes to logger.warn', () => {
            const logger = makeLogger();
            koaClassicServer(fixturesDir, {
                logger,
                hidden: { dotFiles: { default: 'hidden' }, dotDirs: { default: 'visible' } },
                hideExtension: { ext: 'ejs' } // missing leading dot → warn
            });
            expect(logger.warn).toHaveBeenCalledTimes(1);
            // Custom logger receives the plain message, no ANSI escape wrapper.
            expect(logger.warn.mock.calls[0]).toHaveLength(1);
            expect(logger.warn.mock.calls[0][0]).toMatch(/hideExtension\.ext should start with a dot/);
        });

        // Note: prior to v3.0.0 there was an "implicit hidden default" warning
        // that fired when hidden.dotFiles.default was left unset. The default
        // was reverted to 'visible' (design philosophy: file server first),
        // and the warning was removed. Test removed accordingly.

        test('LFU eviction warning routes to logger.warn', async () => {
            const logger = makeLogger();
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-logger-lfu-'));
            // Three 64-byte files, cache fits only ~128 bytes → eviction guaranteed.
            for (const name of ['a.txt', 'b.txt', 'c.txt']) {
                fs.writeFileSync(path.join(tmpDir, name), 'x'.repeat(64));
            }

            const app = new Koa();
            app.silent = true;
            app.use(koaClassicServer(tmpDir, {
                logger,
                hidden: { dotFiles: { default: 'hidden' }, dotDirs: { default: 'visible' } },
                dirListing: { enabled: false },
                serverCache: {
                    rawFile: { enabled: true, maxSize: 128, warnInterval: 0 }
                }
            }));
            const server = app.listen();

            try {
                await supertest(server).get('/a.txt').set('Accept-Encoding', 'identity');
                await supertest(server).get('/b.txt').set('Accept-Encoding', 'identity');
                await supertest(server).get('/c.txt').set('Accept-Encoding', 'identity');
                expect(logger.warn).toHaveBeenCalled();
                expect(logger.warn.mock.calls.some(call =>
                    /maxSize reached, evicting LFU entries/.test(call[0] || '')
                )).toBe(true);
            } finally {
                server.close();
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });

    describe('ANSI escape handling', () => {
        test('console (default) receives ANSI-wrapped warnings', () => {
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                koaClassicServer(fixturesDir, {
                    hideExtension: { ext: 'ejs' } // missing leading dot
                });
                // First call args: ['%s with ANSI', 'WARNING message']
                const args = consoleWarnSpy.mock.calls.find(call =>
                    typeof call[0] === 'string' && call[0].includes('\x1b[33m')
                );
                expect(args).toBeDefined();
                expect(args[1]).toMatch(/hideExtension\.ext should start with a dot/);
            } finally {
                consoleWarnSpy.mockRestore();
            }
        });

        test('custom logger receives plain message without ANSI wrapper', () => {
            const logger = makeLogger();
            koaClassicServer(fixturesDir, {
                logger,
                hideExtension: { ext: 'ejs' },
                hidden: { dotFiles: { default: 'hidden' }, dotDirs: { default: 'visible' } }
            });
            for (const call of logger.warn.mock.calls) {
                for (const arg of call) {
                    if (typeof arg === 'string') {
                        expect(arg).not.toMatch(/\x1b\[/); // no ESC escape codes
                    }
                }
            }
        });
    });

    describe('Backward compatibility', () => {
        test('without options.logger, console.error spies still intercept errors', async () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const app = new Koa();
            app.silent = true;
            app.use(koaClassicServer(fixturesDir, {
                hidden: { dotFiles: { default: 'hidden' }, dotDirs: { default: 'visible' } },
                template: {
                    ext: ['ejs'],
                    render: () => { throw new Error('boom-default'); }
                }
            }));
            const server = app.listen();

            try {
                const res = await supertest(server).get('/ejs-templates/simple.ejs');
                expect(res.status).toBe(500);
                expect(consoleErrorSpy).toHaveBeenCalled();
            } finally {
                consoleErrorSpy.mockRestore();
                server.close();
            }
        });
    });
});
