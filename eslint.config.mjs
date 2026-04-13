export default [
    {
        files: ['index.cjs', 'index.mjs'],
        rules: {
            // Enforce strict equality — prevents type coercion bugs.
            // null exception: allows `x == null` as a safe idiom for (x === null || x === undefined).
            'eqeqeq': ['error', 'always', { 'null': 'ignore' }],

            // Forbid var — use const/let for block-scoped, predictable declarations.
            'no-var': 'error',

            // Flag unused variables — catch dead code and typos in variable names.
            // args: 'after-used' allows unused leading args (e.g. (_, used) callbacks).
            'no-unused-vars': ['error', { 'vars': 'all', 'args': 'after-used' }],
        },
    },
];
