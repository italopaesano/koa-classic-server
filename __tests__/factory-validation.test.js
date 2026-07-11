/**
 * Factory-time rootDir validation — 2026-07 coverage review.
 *
 * The two rootDir guards are the first thing the factory does; they existed
 * since v2 but had no direct tests. A misconfigured rootDir must fail LOUDLY
 * at startup, not surface as per-request 404s/500s in production.
 */

const path = require('path');
const koaClassicServer = require('../index.cjs');

describe('rootDir validation', () => {
    test.each([
        ['undefined', undefined],
        ['null', null],
        ['empty string', ''],
        ['a number', 42],
        ['an object', { dir: '/srv/www' }],
        ['an array', ['/srv/www']],
    ])('rootDir = %s → TypeError at factory time', (_label, rootDir) => {
        expect(() => koaClassicServer(rootDir))
            .toThrow('rootDir must be a non-empty string');
    });

    test('relative rootDir → Error with an explicit message', () => {
        expect(() => koaClassicServer('public/www'))
            .toThrow('rootDir must be an absolute path');
        expect(() => koaClassicServer('./www'))
            .toThrow('rootDir must be an absolute path');
    });

    test('absolute rootDir is accepted and returns a middleware function', () => {
        const mw = koaClassicServer(path.resolve(__dirname));
        expect(typeof mw).toBe('function');
        expect(mw.length).toBe(2); // (ctx, next)
    });
});
