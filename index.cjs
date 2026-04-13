
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mime = require("mime-types");

// CSS for the directory listing page — extracted so its SHA-256 hash can be
// computed once at module load time and placed in the Content-Security-Policy header.
const LISTING_CSS = `
    body {
        font-family: Arial, sans-serif;
        margin: 20px;
    }
    h1 {
        border-bottom: 1px solid #ddd;
        padding-bottom: 10px;
    }
    table {
        border-collapse: collapse;
        width: 100%;
        max-width: 800px;
    }
    thead {
        background-color: #f5f5f5;
        border-bottom: 2px solid #ddd;
    }
    th {
        text-align: left;
        padding: 10px;
        font-weight: bold;
        border-bottom: 2px solid #ddd;
    }
    td {
        padding: 8px 10px;
        border-bottom: 1px solid #eee;
    }
    tr:hover {
        background-color: #f9f9f9;
    }
    a {
        color: #0066cc;
        text-decoration: none;
    }
    a:hover {
        text-decoration: underline;
    }
    th:nth-child(1), td:nth-child(1) { width: 50%; }
    th:nth-child(2), td:nth-child(2) { width: 30%; }
    th:nth-child(3), td:nth-child(3) { width: 20%; text-align: right; }
`;

// SHA-256 hash of the listing CSS, computed once at startup (zero per-request overhead).
const _listingCssHash = 'sha256-' + crypto.createHash('sha256').update(LISTING_CSS, 'utf8').digest('base64');

// CSP for the directory listing page (has inline CSS → hash-based allowance).
const LISTING_CSP = `default-src 'none'; style-src '${_listingCssHash}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;

// CSP for error/404 pages (no inline CSS → fully restrictive).
const NOT_FOUND_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

// Sets security headers on all middleware-generated HTML pages (listing + error).
// Must NOT be called for user files served from disk.
function setGeneratedPageHeaders(ctx, csp) {
    ctx.set('Content-Security-Policy', csp);
    ctx.set('X-Content-Type-Options', 'nosniff');
    ctx.set('X-Frame-Options', 'DENY');
    ctx.set('Referrer-Policy', 'no-referrer');
    ctx.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
}

module.exports = function koaClassicServer(
    rootDir,
    opts = {}
    /*
    opts STRUCTURE
     opts = {
        method: ['GET'], // Supported methods, otherwise next() will be called
        showDirContents: true, // Show or hide directory contents
        index: ["index.html"], // Index file name(s) - must be an ARRAY:
                               //   - Array of strings: ["index.html", "index.htm", "default.html"]
                               //   - Array of RegExp:  [/index\.html/i, /default\.(html|htm)/i]
                               //   - Mixed array:      ["index.html", /index\.[eE][jJ][sS]/]
                               // Priority is determined by array order (first match wins)
        urlPrefix: "", // URL path prefix
        urlsReserved: [], // Reserved paths (first level only)
        template: {
            render: undefined, // Template rendering function: async (ctx, next, filePath) => {}
            ext: [], // File extensions to process with template.render
        },
        browserCacheMaxAge: 3600, // Browser Cache-Control max-age in seconds (default: 1 hour)
        browserCacheEnabled: false, // Enable browser HTTP caching headers (ETag, Last-Modified)
                                    // NOTE: Default is false for development.
                                    // In production, it's recommended to set browserCacheEnabled: true
                                    // to reduce bandwidth usage and improve performance.
        useOriginalUrl: true, // Use ctx.originalUrl (default) or ctx.url
                              // Set false for URL rewriting middleware (i18n, routing)
        hideExtension: {     // Hide file extension from URLs (clean URLs like mod_rewrite)
            ext: '.ejs',     // Extension to hide (required, string, case-sensitive, must start with '.')
            redirect: 301    // HTTP redirect code for URLs with extension (optional, default: 301)
        },
        hidden: {            // Block files/dirs from listing and serving (HTTP 404)
            dotFiles: {      // Dot-files (names starting with '.'): hidden by default
                default: 'hidden',   // 'hidden' | 'visible' — system default: 'hidden'
                whitelist: [],       // Always visible (string exact/glob or RegExp). Overrides default and alwaysHide.
                blacklist: [],       // Always hidden (string or RegExp). Overrides whitelist.
            },
            dotDirs: {       // Dot-directories: visible by default
                default: 'visible',  // 'hidden' | 'visible' — system default: 'visible'
                whitelist: [],
                blacklist: [],
            },
            alwaysHide: [],  // Path-aware patterns (string glob or RegExp) for any file/dir.
                             // Secondary to dotFiles/dotDirs whitelist and blacklist.
                             // Examples: ['*.secret', 'config/secrets/**', /\.key$/]
        },

    }
    */
) {
    if (!rootDir || typeof rootDir !== 'string') {
        throw new TypeError('rootDir must be a non-empty string');
    }
    if (!path.isAbsolute(rootDir)) {
        throw new Error('rootDir must be an absolute path');
    }

    const normalizedRootDir = path.resolve(rootDir);

    const options = opts || {};
    options.template = opts.template || {};

    options.method = Array.isArray(options.method) ? options.method : ['GET'];
    options.showDirContents = typeof options.showDirContents === 'boolean' ? options.showDirContents : true;

    // Normalize index option to array format
    if (typeof options.index === 'string') {
        if (options.index) {
            // v3.0.0: non-empty string format removed
            throw new Error(
                '[koa-classic-server] The "index" option no longer accepts a string in v3.0.0.\n' +
                `  Replace with: index: ["${options.index}"]`
            );
        }
        // Empty string → silently treat as no index (empty array)
        options.index = [];
    } else if (Array.isArray(options.index)) {
        // Already an array → validate elements are strings or RegExp
        options.index = options.index.filter(item =>
            typeof item === 'string' || item instanceof RegExp
        );
    } else {
        // Invalid type → default to empty array
        options.index = [];
    }

    options.urlPrefix = typeof options.urlPrefix === 'string' ? options.urlPrefix : "";
    options.urlsReserved = Array.isArray(options.urlsReserved) ? options.urlsReserved : [];
    options.template.render = (options.template.render === undefined || typeof options.template.render === 'function') ? options.template.render : undefined;
    options.template.ext = Array.isArray(options.template.ext) ? options.template.ext : [];

    // v3.0.0: removed legacy option names — throw to surface the breaking change clearly
    if ('cacheMaxAge' in opts) {
        throw new Error(
            '[koa-classic-server] The "cacheMaxAge" option was removed in v3.0.0.\n' +
            '  Replace with: browserCacheMaxAge: ' + opts.cacheMaxAge
        );
    }
    if ('enableCaching' in opts) {
        throw new Error(
            '[koa-classic-server] The "enableCaching" option was removed in v3.0.0.\n' +
            '  Replace with: browserCacheEnabled: ' + opts.enableCaching
        );
    }

    options.browserCacheMaxAge = typeof options.browserCacheMaxAge === 'number' && options.browserCacheMaxAge >= 0 ? options.browserCacheMaxAge : 3600;
    options.browserCacheEnabled = typeof options.browserCacheEnabled === 'boolean' ? options.browserCacheEnabled : false;
    options.useOriginalUrl = typeof options.useOriginalUrl === 'boolean' ? options.useOriginalUrl : true;

    // Validate and normalize hideExtension option
    if (options.hideExtension !== undefined && options.hideExtension !== null) {
        if (typeof options.hideExtension !== 'object' || Array.isArray(options.hideExtension)) {
            throw new Error('[koa-classic-server] hideExtension must be an object with an "ext" property. Example: { ext: ".ejs" }');
        }
        if (!options.hideExtension.ext || typeof options.hideExtension.ext !== 'string') {
            throw new Error('[koa-classic-server] hideExtension.ext is required and must be a non-empty string. Example: { ext: ".ejs" }');
        }
        // Normalize ext: add leading dot if missing
        if (!options.hideExtension.ext.startsWith('.')) {
            console.warn(
                '\x1b[33m%s\x1b[0m',
                '[koa-classic-server] WARNING: hideExtension.ext should start with a dot.\n' +
                `  Current usage: ext: "${options.hideExtension.ext}"\n` +
                `  Corrected to:  ext: ".${options.hideExtension.ext}"\n` +
                '  Please update your configuration.'
            );
            options.hideExtension.ext = '.' + options.hideExtension.ext;
        }
        // Validate redirect code
        if (options.hideExtension.redirect !== undefined) {
            if (typeof options.hideExtension.redirect !== 'number') {
                throw new Error('[koa-classic-server] hideExtension.redirect must be a number (e.g. 301, 302). Got: ' + typeof options.hideExtension.redirect);
            }
        } else {
            options.hideExtension.redirect = 301;
        }
    }

    // Normalize and validate the hidden option into a clean internal structure.
    function normalizeHiddenConfig(hidden) {
        if (!hidden || typeof hidden !== 'object' || Array.isArray(hidden)) {
            return {
                dotFiles: { default: 'hidden', whitelist: [], blacklist: [] },
                dotDirs:  { default: 'visible', whitelist: [], blacklist: [] },
                alwaysHide: []
            };
        }

        const filterPatternList = (arr) =>
            Array.isArray(arr)
                ? arr.filter(p => typeof p === 'string' || p instanceof RegExp)
                : [];

        function normalizeCategory(input, systemDefault, categoryName) {
            if (!input || typeof input !== 'object' || Array.isArray(input)) {
                return { default: systemDefault, whitelist: [], blacklist: [] };
            }
            if (input.default !== undefined && input.default !== 'hidden' && input.default !== 'visible') {
                throw new Error(
                    `[koa-classic-server] hidden.${categoryName}.default must be "hidden" or "visible". Got: "${input.default}"`
                );
            }
            return {
                default: input.default !== undefined ? input.default : systemDefault,
                whitelist: filterPatternList(input.whitelist),
                blacklist: filterPatternList(input.blacklist),
            };
        }

        return {
            dotFiles: normalizeCategory(hidden.dotFiles, 'hidden', 'dotFiles'),
            dotDirs:  normalizeCategory(hidden.dotDirs,  'visible', 'dotDirs'),
            alwaysHide: filterPatternList(hidden.alwaysHide),
        };
    }

    const hiddenConfig = normalizeHiddenConfig(options.hidden);

    // Returns true if `name` matches any pattern in the list.
    // Patterns are matched against the bare filename (case-sensitive).
    // Each entry can be a string (exact match or simple glob with * and ?) or a RegExp.
    function matchesNameList(name, patterns) {
        for (const pattern of patterns) {
            if (pattern instanceof RegExp) {
                if (pattern.test(name)) return true;
            } else if (typeof pattern === 'string') {
                if (nameGlobMatch(name, pattern)) return true;
            }
        }
        return false;
    }

    // Matches a bare filename against a simple glob pattern (* = any chars except /, ? = one char).
    function nameGlobMatch(name, pattern) {
        if (!pattern.includes('*') && !pattern.includes('?')) {
            return name === pattern;
        }
        const regexStr = '^' +
            pattern
                .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                .replace(/\*/g, '[^/]*')
                .replace(/\?/g, '[^/]')
            + '$';
        return new RegExp(regexStr).test(name);
    }

    // Returns true if `relPath` matches any pattern in the list.
    // Patterns are matched against the full relative path from rootDir (case-sensitive).
    // Each entry can be a string glob or a RegExp.
    function matchesPathList(relPath, patterns) {
        for (const pattern of patterns) {
            if (pattern instanceof RegExp) {
                if (pattern.test(relPath)) return true;
            } else if (typeof pattern === 'string') {
                if (pathGlobMatch(relPath, pattern)) return true;
            }
        }
        return false;
    }

    /**
     * Matches a relative path against a glob pattern (path-aware).
     *   - Pattern without '/': matches the basename at any depth  (e.g. '*.secret')
     *   - Pattern with '/':    anchored to rootDir               (e.g. 'config/secrets/**')
     *   - '*'  matches any characters except '/'
     *   - '**' matches any characters including '/'
     *   - '?'  matches any single character except '/'
     */
    function pathGlobMatch(relPath, pattern) {
        const hasSlash = pattern.includes('/');
        const escaped = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '\x00')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '[^/]')
            .replace(/\x00/g, '.*');

        const regexStr = hasSlash
            ? '^' + escaped + '($|/)'    // path-anchored from root
            : '(^|/)' + escaped + '$';   // basename match at any depth

        return new RegExp(regexStr).test(relPath);
    }

    /**
     * Returns true if a filesystem entry should be hidden (blocked from listing and serving).
     *
     * Priority (highest to lowest):
     *   1. blacklist  (dotFiles/dotDirs) — always hidden, beats everything
     *   2. whitelist  (dotFiles/dotDirs) — always visible, overrides alwaysHide and default
     *   3. alwaysHide                    — path-aware, overrides default
     *   4. default    (dotFiles/dotDirs) — 'hidden' or 'visible' for unmatched dot-entries
     *
     * Non-dot entries are only affected by alwaysHide.
     *
     * @param {string}  name    - Basename of the file or directory
     * @param {string}  relPath - Relative path from rootDir (e.g. "subdir/.env")
     * @param {boolean} isDir   - True if the entry is a directory
     */
    function isHiddenEntry(name, relPath, isDir) {
        const isDot = name.startsWith('.');

        if (isDot) {
            const category = isDir ? hiddenConfig.dotDirs : hiddenConfig.dotFiles;

            if (matchesNameList(name, category.blacklist)) return true;
            if (matchesNameList(name, category.whitelist)) return false;
            if (matchesPathList(relPath, hiddenConfig.alwaysHide)) return true;

            return category.default === 'hidden';
        }

        return matchesPathList(relPath, hiddenConfig.alwaysHide);
    }

    /**
     * Returns true if dirent is a regular file or a symlink pointing to a regular file.
     * Uses fs.promises.stat (which follows symlinks) when dirent.isSymbolicLink() is true,
     * or when the dirent type is unknown (DT_UNKNOWN / type 0).
     *
     * DT_UNKNOWN occurs on overlayfs, NFS, FUSE, NixOS buildFHSEnv, ecryptfs,
     * and any filesystem that doesn't fill d_type in the kernel's getdents64 syscall.
     * On standard filesystems (ext4, btrfs, xfs, APFS, NTFS), d_type is always
     * filled correctly, so the stat() fallback is never reached.
     */
    async function isFileOrSymlinkToFile(dirent, dirPath) {
        if (dirent.isFile()) return true;
        if (dirent.isSymbolicLink()) {
            try {
                const realStat = await fs.promises.stat(path.join(dirPath, dirent.name));
                return realStat.isFile();
            } catch {
                return false; // Broken or circular symlink
            }
        }
        // DT_UNKNOWN fallback: when none of the type methods return true,
        // the filesystem didn't report d_type — resolve via stat()
        if (!dirent.isDirectory() && !dirent.isBlockDevice() && !dirent.isCharacterDevice() && !dirent.isFIFO() && !dirent.isSocket()) {
            try {
                const realStat = await fs.promises.stat(path.join(dirPath, dirent.name));
                return realStat.isFile();
            } catch {
                return false;
            }
        }
        return false;
    }

    return async (ctx, next) => {
        if (!options.method.includes(ctx.method)) {
            await next();
            return;
        }

        // Construct full URL based on useOriginalUrl option
        const urlToUse = options.useOriginalUrl ? ctx.originalUrl : ctx.url;
        const fullUrl = ctx.protocol + '://' + ctx.host + urlToUse;
        let pageHref = '';
        if (fullUrl.charAt(fullUrl.length - 1) === '/') {
            pageHref = new URL(fullUrl.slice(0, -1));
        } else {
            pageHref = new URL(fullUrl);
        }

        // Check URL prefix
        const a_pathname = pageHref.pathname.split("/");
        const a_urlPrefix = options.urlPrefix.split("/");

        for (const key in a_urlPrefix) {
            if (a_urlPrefix[key] !== a_pathname[key]) {
                await next();
                return;
            }
        }

        // Create pageHrefOutPrefix without URL prefix
        let pageHrefOutPrefix = pageHref;
        if (options.urlPrefix !== "") {
            let a_pathnameOutPrefix = a_pathname.slice(a_urlPrefix.length);
            let s_pathnameOutPrefix = a_pathnameOutPrefix.join("/");
            let hrefOutPrefix = pageHref.origin + '/' + s_pathnameOutPrefix;
            pageHrefOutPrefix = new URL(hrefOutPrefix);
        }

        // Check reserved URLs (first level only)
        if (Array.isArray(options.urlsReserved) && options.urlsReserved.length > 0) {
            const a_pathnameOutPrefix = pageHrefOutPrefix.pathname.split("/");
            for (const value of options.urlsReserved) {
                if (a_pathnameOutPrefix[1] === value.substring(1)) {
                    await next();
                    return;
                }
            }
        }

        // Path traversal protection: build and validate safe file path
        let requestedPath = "";
        if (pageHrefOutPrefix.pathname === "/") {
            requestedPath = "";
        } else {
            requestedPath = decodeURIComponent(pageHrefOutPrefix.pathname);
        }

        const normalizedPath = path.normalize(requestedPath);
        const fullPath = path.join(normalizedRootDir, normalizedPath);

        // Security check: ensure resolved path is within rootDir
        if (!fullPath.startsWith(normalizedRootDir)) {
            ctx.status = 403;
            ctx.body = 'Forbidden';
            return;
        }

        // Hidden check: block requests that traverse a hidden directory
        if (requestedPath !== '') {
            const segments = normalizedPath.split(path.sep).filter(Boolean);
            for (let i = 0; i < segments.length - 1; i++) {
                const segName = segments[i];
                const segRelPath = segments.slice(0, i + 1).join('/');
                if (isHiddenEntry(segName, segRelPath, true)) {
                    sendNotFound(ctx);
                    return;
                }
            }
        }

        let toOpen = fullPath;

        // hideExtension logic: redirect URLs with extension and resolve clean URLs
        // Track if original URL had trailing slash (stripped by pageHref construction above)
        const originalUrlPath = new URL(ctx.protocol + '://' + ctx.host + urlToUse).pathname;
        const hadTrailingSlash = originalUrlPath.length > 1 && originalUrlPath.endsWith('/');

        if (options.hideExtension) {
            const hideExt = options.hideExtension.ext;
            const hideRedirect = options.hideExtension.redirect;

            // Check if URL ends with the configured extension → redirect to clean URL
            // Use the original path (before trailing slash stripping) for accurate matching
            const pathForExtCheck = hadTrailingSlash ? originalUrlPath.slice(0, -1) : requestedPath;
            if (pathForExtCheck.endsWith(hideExt)) {
                // Build redirect target using ctx.originalUrl (always, regardless of useOriginalUrl)
                const originalUrlObj = new URL(ctx.protocol + '://' + ctx.host + ctx.originalUrl);
                let redirectPath = originalUrlObj.pathname;

                redirectPath = redirectPath.slice(0, redirectPath.length - hideExt.length);

                // Special case: /index.ejs → /, /sezione/index.ejs → /sezione/
                const baseName = path.basename(redirectPath);
                // Check if the remaining path points to an index file
                if (options.index && options.index.length > 0) {
                    for (const pattern of options.index) {
                        if (typeof pattern === 'string' && (baseName + hideExt) === pattern) {
                            // Redirect to the directory (with trailing slash)
                            redirectPath = redirectPath.slice(0, redirectPath.length - baseName.length);
                            break;
                        }
                    }
                }

                // Preserve query string
                const redirectUrl = redirectPath + (originalUrlObj.search || '');

                ctx.status = hideRedirect;
                ctx.redirect(redirectUrl);
                return;
            }

            // Check if URL has no extension → try adding the configured extension
            // Skip if original URL had trailing slash (trailing slash = directory intent)
            const extOfRequested = path.extname(requestedPath);
            if (!extOfRequested && requestedPath !== '' && !requestedPath.endsWith('/') && !hadTrailingSlash) {
                const pathWithExt = fullPath + hideExt;

                // Security check: ensure resolved path is still within rootDir
                if (pathWithExt.startsWith(normalizedRootDir)) {
                    try {
                        const statWithExt = await fs.promises.stat(pathWithExt);
                        if (statWithExt.isFile()) {
                            // File with extension exists, serve it
                            toOpen = pathWithExt;
                        }
                    } catch {
                        // File with extension doesn't exist, continue normal flow
                    }
                }
            }
        }

        // Check if path exists
        let stat;
        try {
            stat = await fs.promises.stat(toOpen);
        } catch {
            // File/directory doesn't exist or can't be accessed
            sendNotFound(ctx);
            return;
        }

        // Hidden check: block access to the requested file or directory itself
        if (requestedPath !== '') {
            const entryName = path.basename(toOpen);
            const entryRelPath = path.relative(normalizedRootDir, toOpen).split(path.sep).join('/');
            if (isHiddenEntry(entryName, entryRelPath, stat.isDirectory())) {
                sendNotFound(ctx);
                return;
            }
        }

        if (stat.isDirectory()) {
            // Handle directory
            if (options.showDirContents) {
                // Search for index file matching configured patterns
                if (options.index && options.index.length > 0) {
                    const indexFile = await findIndexFile(toOpen, options.index);
                    if (indexFile) {
                        const indexRelPath = path.relative(normalizedRootDir, path.join(toOpen, indexFile.name)).split(path.sep).join('/');
                        if (!isHiddenEntry(indexFile.name, indexRelPath, false)) {
                            const indexPath = path.join(toOpen, indexFile.name);
                            await loadFile(indexPath, indexFile.stat);
                            return;
                        }
                    }
                }

                // No index file found, show directory listing
                ctx.body = await show_dir(toOpen, ctx);
            } else {
                // Directory listing disabled
                sendNotFound(ctx);
            }
            return;
        } else {
            await loadFile(toOpen, stat);
            return;
        }

        // Internal functions

        /**
         * Find index file in directory with priority support
         * @param {string} dirPath - Directory path to search
         * @param {Array<string|RegExp>} indexPatterns - Array of patterns (strings or RegExp)
         * @returns {Promise<{name: string, stat: fs.Stats}|null>} - First matching file or null
         */
        async function findIndexFile(dirPath, indexPatterns) {
            try {
                const files = await fs.promises.readdir(dirPath, { withFileTypes: true });

                // Filter files, following symlinks to determine effective type
                const fileCheckResults = await Promise.all(
                    files.map(async dirent => ({
                        name: dirent.name,
                        isFile: await isFileOrSymlinkToFile(dirent, dirPath)
                    }))
                );
                const fileNames = fileCheckResults
                    .filter(entry => entry.isFile)
                    .map(entry => entry.name);

                // Search with priority order (first pattern wins)
                for (const pattern of indexPatterns) {
                    let matchedFile = null;

                    if (typeof pattern === 'string') {
                        // Exact string match (case-sensitive)
                        if (fileNames.includes(pattern)) {
                            matchedFile = pattern;
                        }
                    } else if (pattern instanceof RegExp) {
                        // RegExp match (supports case-insensitive with /i flag)
                        matchedFile = fileNames.find(fileName => pattern.test(fileName));
                    }

                    // If match found, verify it's a file and return it
                    if (matchedFile) {
                        try {
                            const filePath = path.join(dirPath, matchedFile);
                            const fileStat = await fs.promises.stat(filePath);
                            if (fileStat.isFile()) {
                                return { name: matchedFile, stat: fileStat };
                            }
                        } catch {
                            // File was deleted between readdir and stat, continue to next pattern
                            continue;
                        }
                    }
                }

                return null;
            } catch (error) {
                console.error('Error finding index file:', error);
                return null;
            }
        }

        // Sets 404 security headers and body in one call.
        function sendNotFound(ctx) {
            setGeneratedPageHeaders(ctx, NOT_FOUND_CSP);
            ctx.status = 404;
            ctx.body = requestedUrlNotFound();
        }

        function requestedUrlNotFound() {
            return `
                <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta http-equiv="X-UA-Compatible" content="IE=edge">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>URL not found</title>
                    </head>
                    <body>
                    <h1>Not Found</h1>
                    <h3>The requested URL was not found on this server.</h3>
                    </body>
                    </html>
                `;
        }

        // Accepts a pre-fetched stat to avoid a redundant stat call
        async function loadFile(toOpen, fileStat) {
            // Get file stat if not provided
            if (!fileStat) {
                try {
                    fileStat = await fs.promises.stat(toOpen);
                } catch (error) {
                    console.error('File stat error:', error);
                    sendNotFound(ctx);
                    return;
                }
            }

            // Template rendering
            if (options.template.ext.length > 0 && options.template.render) {
                const fileExt = path.extname(toOpen).slice(1); // Remove leading dot

                if (fileExt && options.template.ext.includes(fileExt)) {
                    try {
                        await options.template.render(ctx, next, toOpen);
                        return;
                    } catch (error) {
                        console.error('Template rendering error:', error);
                        ctx.status = 500;
                        ctx.body = 'Internal Server Error - Template Rendering Failed';
                        return;
                    }
                }
            }

            // HTTP caching headers
            if (options.browserCacheEnabled) {
                // ETag: mtime + size — changes on file modification or resize
                const etag = `"${fileStat.mtime.getTime()}-${fileStat.size}"`;

                // Format Last-Modified header (RFC 7231)
                const lastModified = fileStat.mtime.toUTCString();

                ctx.set('ETag', etag);
                ctx.set('Last-Modified', lastModified);
                ctx.set('Cache-Control', `public, max-age=${options.browserCacheMaxAge}, must-revalidate`);

                // Check If-None-Match header (ETag validation)
                const clientEtag = ctx.get('If-None-Match');
                if (clientEtag && clientEtag === etag) {
                    // File hasn't changed - return 304 Not Modified
                    ctx.status = 304;
                    return;
                }

                // Check If-Modified-Since header (date validation)
                const clientModifiedSince = ctx.get('If-Modified-Since');
                if (clientModifiedSince) {
                    const clientDate = new Date(clientModifiedSince);
                    const fileDate = new Date(fileStat.mtime);

                    // Compare timestamps (ignore milliseconds for better compatibility)
                    if (fileDate.getTime() <= clientDate.getTime()) {
                        // File hasn't been modified - return 304 Not Modified
                        ctx.status = 304;
                        return;
                    }
                }
            } else {
                // Explicitly disable caching: without these headers browsers may use heuristic caching
                ctx.set('Cache-Control', 'no-cache, no-store, must-revalidate');
                ctx.set('Pragma', 'no-cache'); // HTTP 1.0 compatibility
                ctx.set('Expires', '0'); // Proxies
            }

            // Verify file is still readable (race condition protection)
            try {
                await fs.promises.access(toOpen, fs.constants.R_OK);
            } catch (error) {
                console.error('File access error:', error);
                sendNotFound(ctx);
                return;
            }

            let mimeType = mime.lookup(toOpen);
            const src = fs.createReadStream(toOpen);

            // Handle stream errors
            src.on('error', (err) => {
                console.error('Stream error:', err);
                if (!ctx.headerSent) {
                    ctx.status = 500;
                    ctx.body = 'Error reading file';
                }
            });

            ctx.response.set("content-type", mimeType);
            ctx.response.set("content-length", fileStat.size);

            // Content-Disposition properly quoted with only basename
            const filename = path.basename(toOpen);
            const safeFilename = filename.replace(/"/g, '\\"'); // Escape quotes
            ctx.response.set(
                "content-disposition",
                `inline; filename="${safeFilename}"`
            );

            ctx.body = src;
        }

        // Helper function to format file size in human-readable format
        function formatSize(bytes) {
            if (bytes === 0) return '0 B';
            if (bytes === undefined || bytes === null) return '-';

            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));

            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        }

        async function show_dir(toOpen, ctx) {
            let dir;
            try {
                dir = await fs.promises.readdir(toOpen, { withFileTypes: true });
            } catch (error) {
                console.error('Directory read error:', error);
                ctx.status = 500;
                setGeneratedPageHeaders(ctx, NOT_FOUND_CSP);
                return `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>Error</title>
                    </head>
                    <body>
                        <h1>Error Reading Directory</h1>
                        <p>Unable to access directory contents.</p>
                    </body>
                    </html>
                `;
            }

            // Relative path of this directory from rootDir (used for alwaysHide path matching)
            const rawDirRel = path.relative(normalizedRootDir, toOpen);
            const dirRelPath = (rawDirRel === '' || rawDirRel === '.') ? '' : rawDirRel.split(path.sep).join('/');

            // Get sorting parameters from query string
            const sortBy = ctx.query.sort || 'name';
            const sortOrder = ctx.query.order || 'asc';

            // Build base URL for sorting links (without query params)
            const baseUrl = pageHrefOutPrefix.pathname;

            // Helper to create sorting URL
            function getSortUrl(column) {
                let newOrder = 'asc';
                if (sortBy === column && sortOrder === 'asc') {
                    newOrder = 'desc';
                }
                return `${baseUrl}?sort=${column}&order=${newOrder}`;
            }

            // Helper to get sort indicator
            function getSortIndicator(column) {
                if (sortBy === column) {
                    return sortOrder === 'asc' ? ' ↑' : ' ↓';
                }
                return '';
            }

            const parts = [];
            parts.push("<table>");
            parts.push("<thead>");
            parts.push("<tr>");
            parts.push(`<th><a href="${escapeHtml(getSortUrl('name'))}">Name${getSortIndicator('name')}</a></th>`);
            parts.push(`<th><a href="${escapeHtml(getSortUrl('type'))}">Type${getSortIndicator('type')}</a></th>`);
            parts.push(`<th><a href="${escapeHtml(getSortUrl('size'))}">Size${getSortIndicator('size')}</a></th>`);
            parts.push("</tr>");
            parts.push("</thead>");
            parts.push("<tbody>");

            // Parent directory link
            const currentPath = pageHref.origin + pageHref.pathname;
            if (currentPath !== pageHrefOutPrefix.origin + "/") {
                // Build parent directory URL without query parameters
                const a_pD = currentPath.split("/");
                a_pD.pop();
                const parentDirectory = a_pD.join("/");
                // Escape HTML to prevent XSS
                parts.push(`<tr><td><a href="${escapeHtml(parentDirectory)}"><b>.. Parent Directory</b></a></td><td>DIR</td><td>-</td></tr>`);
            }

            if (dir.length === 0) {
                parts.push(`<tr><td>empty folder</td><td></td><td></td></tr>`);
            } else {
                let a_sy = Object.getOwnPropertySymbols(dir[0]);
                const sy_type = a_sy[0];

                // Collect all items data first (for sorting)
                const items = [];
                for (const item of dir) {
                    const s_name = item.name.toString();
                    const type = item[sy_type];

                    if (type !== 0 && type !== 1 && type !== 2 && type !== 3) {
                        console.error("Unknown file type:", type);
                        continue;
                    }

                    const itemPath = path.join(toOpen, s_name);
                    let itemUri = "";
                    // Build item URI without query parameters
                    const baseUrl = pageHref.origin + pageHref.pathname;
                    if (baseUrl === pageHref.origin + options.urlPrefix + "/" || baseUrl === pageHref.origin + options.urlPrefix) {
                        itemUri = `${pageHref.origin + options.urlPrefix}/${encodeURIComponent(s_name)}`;
                    } else {
                        itemUri = `${baseUrl}/${encodeURIComponent(s_name)}`;
                    }

                    // Resolve symlinks and DT_UNKNOWN entries to their effective type
                    let effectiveType = type;
                    let isBrokenSymlink = false;
                    if (type === 3 || type === 0) {
                        // type 3 = symlink, type 0 = DT_UNKNOWN (overlayfs, NFS, FUSE, NixOS buildFHSEnv, ecryptfs)
                        try {
                            const realStat = await fs.promises.stat(itemPath);
                            if (realStat.isFile()) effectiveType = 1;
                            else if (realStat.isDirectory()) effectiveType = 2;
                        } catch {
                            if (type === 3) {
                                isBrokenSymlink = true; // Broken or circular symlink
                            } else {
                                continue; // DT_UNKNOWN entry that can't be stat'd — skip it
                            }
                        }
                    }

                    // Hidden check: skip entries that should not appear in directory listing
                    {
                        const itemIsDir = effectiveType === 2;
                        const itemRelPath = dirRelPath ? dirRelPath + '/' + s_name : s_name;
                        if (isHiddenEntry(s_name, itemRelPath, itemIsDir)) continue;
                    }

                    // Get file size
                    let sizeStr = '-';
                    let sizeBytes = 0;
                    if (!isBrokenSymlink) {
                        try {
                            const itemStat = await fs.promises.stat(itemPath);
                            if (effectiveType === 1) {
                                sizeBytes = itemStat.size;
                                sizeStr = formatSize(sizeBytes);
                            } else {
                                sizeStr = '-';
                            }
                        } catch {
                            sizeStr = '-';
                        }
                    }

                    const mimeType = effectiveType === 2 ? "DIR" : (mime.lookup(itemPath) || 'unknown');
                    const isReserved = pageHrefOutPrefix.pathname === '/' && options.urlsReserved.includes('/' + s_name) && (effectiveType === 2 || type === 3);

                    items.push({
                        name: s_name,
                        type: type,
                        effectiveType: effectiveType,
                        isSymlink: type === 3,
                        isBrokenSymlink: isBrokenSymlink,
                        mimeType: mimeType,
                        sizeStr: sizeStr,
                        sizeBytes: sizeBytes,
                        itemUri: itemUri,
                        isReserved: isReserved
                    });
                }

                // Sort items based on query parameters
                items.sort((a, b) => {
                    let comparison = 0;

                    if (sortBy === 'name') {
                        comparison = a.name.localeCompare(b.name);
                    } else if (sortBy === 'type') {
                        // Sort directories first, then by mime type (using effectiveType for symlinks)
                        if (a.effectiveType === 2 && b.effectiveType !== 2) {
                            comparison = -1;
                        } else if (a.effectiveType !== 2 && b.effectiveType === 2) {
                            comparison = 1;
                        } else {
                            comparison = a.mimeType.localeCompare(b.mimeType);
                        }
                    } else if (sortBy === 'size') {
                        // Directories always at top when sorting by size (using effectiveType for symlinks)
                        if (a.effectiveType === 2 && b.effectiveType !== 2) {
                            comparison = -1;
                        } else if (a.effectiveType !== 2 && b.effectiveType === 2) {
                            comparison = 1;
                        } else {
                            comparison = a.sizeBytes - b.sizeBytes;
                        }
                    }

                    return sortOrder === 'desc' ? -comparison : comparison;
                });

                // Generate HTML for sorted items
                for (const item of items) {
                    let rowStart = '';
                    if (item.effectiveType === 1) {
                        rowStart = `<tr><td> FILE `;
                    } else {
                        rowStart = `<tr><td>`;
                    }

                    // Symlink indicator label
                    const symlinkLabel = item.isBrokenSymlink
                        ? ' ( Broken Symlink )'
                        : item.isSymlink
                            ? ' ( Symlink )'
                            : '';

                    if (item.isReserved) {
                        parts.push(`${rowStart} ${escapeHtml(item.name)}${symlinkLabel}</td> <td> DIR BUT RESERVED</td><td>${item.sizeStr}</td></tr>`);
                    } else if (item.isBrokenSymlink) {
                        // Broken symlink: name visible but not clickable
                        parts.push(`${rowStart} ${escapeHtml(item.name)}${symlinkLabel}</td> <td> ${escapeHtml(item.mimeType)} </td><td>${item.sizeStr}</td></tr>`);
                    } else {
                        parts.push(`${rowStart} <a href="${escapeHtml(item.itemUri)}">${escapeHtml(item.name)}</a>${symlinkLabel} </td> <td> ${escapeHtml(item.mimeType)} </td><td>${item.sizeStr}</td></tr>`);
                    }
                }
            }

            parts.push("</tbody>");
            parts.push("</table>");

            const tableHtml = parts.join('');

            const html = `
                        <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta http-equiv="X-UA-Compatible" content="IE=edge">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Index of ${escapeHtml(pageHrefOutPrefix.pathname)}</title>
                        <style>${LISTING_CSS}</style>
                    </head>
                    <body>
                    <h1>Index of ${escapeHtml(pageHrefOutPrefix.pathname)}</h1>
                    ${tableHtml}
                    </body>
                    </html>
                `;

            setGeneratedPageHeaders(ctx, LISTING_CSP);
            return html;
        }

        // Helper function to escape HTML and prevent XSS
        function escapeHtml(unsafe) {
            if (typeof unsafe !== 'string') {
                return unsafe;
            }
            return unsafe
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }
    };
};
