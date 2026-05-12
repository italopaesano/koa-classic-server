const Koa = require('koa');
const koaClassicServer = require('../index.cjs');
const supertest = require('supertest');
const path = require('path');

const ROOT = path.join(__dirname, 'publicWwwTest');
const TEMPLATE_URL = '/ejs-templates/simple.ejs';

function buildServer(renderFn, opts = {}) {
    const app = new Koa();
    app.silent = true;
    app.use(koaClassicServer(ROOT, {
        method: ['GET'],
        hidden: { dotFiles: { default: 'hidden' }, dotDirs: { default: 'visible' } },
        template: {
            ext: ['ejs'],
            render: renderFn,
            ...(opts.renderTimeout !== undefined ? { renderTimeout: opts.renderTimeout } : {})
        }
    }));
    const server = app.listen();
    return { server, request: supertest(server) };
}

// Sleep that does not keep the event loop alive — used to simulate
// non-cooperative long-running work without leaving orphan timers behind.
function unrefSleep(ms) {
    return new Promise(resolve => {
        const t = setTimeout(resolve, ms);
        if (typeof t.unref === 'function') t.unref();
    });
}

describe('template.renderTimeout', () => {
    let consoleErrorSpy;

    beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    describe('Factory validation', () => {
        test('rejects negative renderTimeout', () => {
            expect(() => koaClassicServer(ROOT, {
                template: { ext: ['ejs'], render: () => {}, renderTimeout: -1 }
            })).toThrow(/renderTimeout must be a finite number/);
        });

        test('rejects non-number renderTimeout', () => {
            expect(() => koaClassicServer(ROOT, {
                template: { ext: ['ejs'], render: () => {}, renderTimeout: '5000' }
            })).toThrow(/renderTimeout must be a finite number/);
        });

        test('rejects NaN renderTimeout', () => {
            expect(() => koaClassicServer(ROOT, {
                template: { ext: ['ejs'], render: () => {}, renderTimeout: NaN }
            })).toThrow(/renderTimeout must be a finite number/);
        });

        test('rejects Infinity renderTimeout', () => {
            expect(() => koaClassicServer(ROOT, {
                template: { ext: ['ejs'], render: () => {}, renderTimeout: Infinity }
            })).toThrow(/renderTimeout must be a finite number/);
        });

        test('accepts 0 (disabled)', () => {
            expect(() => koaClassicServer(ROOT, {
                template: { ext: ['ejs'], render: () => {}, renderTimeout: 0 }
            })).not.toThrow();
        });

        test('accepts positive integer', () => {
            expect(() => koaClassicServer(ROOT, {
                template: { ext: ['ejs'], render: () => {}, renderTimeout: 1000 }
            })).not.toThrow();
        });

        test('defaults to 30000 when undefined', () => {
            const opts = { template: { ext: ['ejs'], render: () => {} } };
            koaClassicServer(ROOT, opts);
            expect(opts.template.renderTimeout).toBe(30000);
        });
    });

    describe('Successful render within timeout', () => {
        let env;
        afterEach(() => env && env.server.close());

        test('returns 200 when render completes before timeout', async () => {
            env = buildServer(async (ctx) => {
                await new Promise(r => setTimeout(r, 20));
                ctx.type = 'text/html';
                ctx.body = '<p>ok</p>';
            }, { renderTimeout: 500 });

            const res = await env.request.get(TEMPLATE_URL);
            expect(res.status).toBe(200);
            expect(res.text).toContain('ok');
        });
    });

    describe('Timeout behaviour', () => {
        let env;
        afterEach(() => env && env.server.close());

        test('returns 504 when render exceeds timeout', async () => {
            env = buildServer(async () => {
                await unrefSleep(5000);
            }, { renderTimeout: 100 });

            const res = await env.request.get(TEMPLATE_URL);
            expect(res.status).toBe(504);
            expect(res.text).toContain('Gateway Timeout');
            expect(res.text).toContain('took too long to render');
        });

        test('504 response carries security headers', async () => {
            env = buildServer(async () => {
                await unrefSleep(5000);
            }, { renderTimeout: 50 });

            const res = await env.request.get(TEMPLATE_URL);
            expect(res.status).toBe(504);
            expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
            expect(res.headers['x-content-type-options']).toBe('nosniff');
            expect(res.headers['x-frame-options']).toBe('DENY');
        });

        test('renderTimeout: 0 disables the timer (render is allowed to run long)', async () => {
            env = buildServer(async (ctx) => {
                await new Promise(r => setTimeout(r, 200));
                ctx.type = 'text/html';
                ctx.body = '<p>slow but ok</p>';
            }, { renderTimeout: 0 });

            const res = await env.request.get(TEMPLATE_URL);
            expect(res.status).toBe(200);
            expect(res.text).toContain('slow but ok');
        });
    });

    describe('Render argument contract', () => {
        let env;
        afterEach(() => env && env.server.close());

        test('render is called with (ctx, next, filePath, rawBuffer, signal) in that order', async () => {
            let received;
            env = buildServer(async (...args) => {
                received = args;
                args[0].body = 'ok';
            }, { renderTimeout: 1000 });

            await env.request.get(TEMPLATE_URL);

            expect(received).toHaveLength(5);
            // ctx: Koa context — must expose req/res/state
            expect(received[0]).toBeDefined();
            expect(received[0].req).toBeDefined();
            expect(received[0].res).toBeDefined();
            expect(received[0].state).toBeDefined();
            // next: function (downstream middleware)
            expect(typeof received[1]).toBe('function');
            // filePath: absolute path to the requested file
            expect(typeof received[2]).toBe('string');
            expect(path.isAbsolute(received[2])).toBe(true);
            expect(received[2]).toMatch(/simple\.ejs$/);
            // rawBuffer: Buffer or null depending on serverCache.rawFile state
            expect(received[3] === null || Buffer.isBuffer(received[3])).toBe(true);
            // signal: AbortSignal
            expect(received[4]).toBeInstanceOf(AbortSignal);
        });
    });

    describe('AbortSignal contract', () => {
        let env;
        afterEach(() => env && env.server.close());

        test('passes an AbortSignal as 5th argument', async () => {
            let receivedSignal;
            env = buildServer(async (ctx, _next, _path, _buf, signal) => {
                receivedSignal = signal;
                ctx.body = 'ok';
            }, { renderTimeout: 1000 });

            await env.request.get(TEMPLATE_URL);
            expect(receivedSignal).toBeInstanceOf(AbortSignal);
            expect(receivedSignal.aborted).toBe(false);
        });

        test('signal aborts when render times out', async () => {
            let signalAtTimeout = null;
            env = buildServer(async (ctx, _next, _path, _buf, signal) => {
                await unrefSleep(300);
                signalAtTimeout = signal.aborted;
            }, { renderTimeout: 50 });

            const res = await env.request.get(TEMPLATE_URL);
            expect(res.status).toBe(504);
            await new Promise(r => setTimeout(r, 400));
            expect(signalAtTimeout).toBe(true);
        });

        test('cooperative render that honours signal terminates early', async () => {
            const renderDuration = jest.fn();
            env = buildServer(async (ctx, _next, _path, _buf, signal) => {
                const start = Date.now();
                try {
                    await new Promise((resolve, reject) => {
                        const t = setTimeout(resolve, 5000);
                        signal.addEventListener('abort', () => {
                            clearTimeout(t);
                            reject(new Error('aborted'));
                        });
                    });
                } finally {
                    renderDuration(Date.now() - start);
                }
            }, { renderTimeout: 50 });

            const res = await env.request.get(TEMPLATE_URL);
            expect(res.status).toBe(504);
            await new Promise(r => setTimeout(r, 200));
            const elapsed = renderDuration.mock.calls[0]?.[0] ?? 9999;
            expect(elapsed).toBeLessThan(1000);
        });
    });

    describe('Error handling integrity', () => {
        let env;
        afterEach(() => env && env.server.close());

        test('late rejection after timeout does not crash the process', async () => {
            const unhandledHandler = jest.fn();
            process.on('unhandledRejection', unhandledHandler);

            env = buildServer(async () => {
                await new Promise(r => setTimeout(r, 100));
                throw new Error('late failure');
            }, { renderTimeout: 30 });

            const res = await env.request.get(TEMPLATE_URL);
            expect(res.status).toBe(504);

            await new Promise(r => setTimeout(r, 250));
            process.off('unhandledRejection', unhandledHandler);
            expect(unhandledHandler).not.toHaveBeenCalled();
        });

        test('synchronous render returning rejected promise still produces 500', async () => {
            env = buildServer(() => Promise.reject(new Error('boom')), { renderTimeout: 1000 });

            const res = await env.request.get(TEMPLATE_URL);
            expect(res.status).toBe(500);
            expect(res.text).toContain('Internal Server Error');
        });

        test('synchronous throw in render produces 500', async () => {
            env = buildServer(() => { throw new Error('sync boom'); }, { renderTimeout: 1000 });

            const res = await env.request.get(TEMPLATE_URL);
            expect(res.status).toBe(500);
            expect(res.text).toContain('Internal Server Error');
        });
    });

    describe('Client disconnect', () => {
        let env;
        afterEach(() => env && env.server.close());

        test('signal aborts when client closes the connection before render finishes', async () => {
            let abortObserved = false;
            env = buildServer(async (ctx, _next, _path, _buf, signal) => {
                signal.addEventListener('abort', () => { abortObserved = true; });
                await unrefSleep(1000);
                ctx.body = 'late';
            }, { renderTimeout: 0 });

            const addr = env.server.address();
            const http = require('http');
            await new Promise((resolve) => {
                const req = http.request({
                    host: addr.address === '::' ? '127.0.0.1' : addr.address,
                    port: addr.port,
                    path: TEMPLATE_URL,
                    method: 'GET'
                }, () => {});
                req.on('error', () => {});
                req.end();
                setTimeout(() => { req.destroy(); resolve(); }, 50);
            });

            await new Promise(r => setTimeout(r, 100));
            expect(abortObserved).toBe(true);
        });
    });
});
