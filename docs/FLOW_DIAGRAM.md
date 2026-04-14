# Flow Diagram - koa-classic-server

## Table of Contents
- [Overview](#overview)
- [Main Flow Diagram](#main-flow-diagram)
- [Initialization Phase](#initialization-phase)
- [Request Handling Phase](#request-handling-phase)
- [File Loading Flow](#file-loading-flow)
- [Directory Listing Flow](#directory-listing-flow)
- [Code Examples](#code-examples)

---

## Overview

**koa-classic-server** is a Koa middleware that serves static files with Apache2-like directory listing, template engine support, and HTTP caching optimization.

**Key Features:**
- Static file serving with streaming
- Directory listing with sortable columns (Name, Type, Size)
- Template engine integration (EJS, Pug, etc.)
- HTTP caching (ETag, Last-Modified, 304 responses)
- Security (path traversal protection, XSS protection)
- Async/await (non-blocking I/O)

---

## Main Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    HTTP REQUEST RECEIVED                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. METHOD CHECK                                                │
│     Is method allowed? (default: GET)                           │
│     ├─ NO  → await next() → EXIT                               │
│     └─ YES → Continue                                           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. URL NORMALIZATION                                           │
│     Remove trailing slash from URL                              │
│     Create URL object from ctx.href                             │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. URL PREFIX CHECK                                            │
│     Does URL match configured urlPrefix?                        │
│     ├─ NO  → await next() → EXIT                               │
│     └─ YES → Continue                                           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. RESERVED URL CHECK                                          │
│     Is URL in reserved paths list?                              │
│     ├─ YES → await next() → EXIT                               │
│     └─ NO  → Continue                                           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. PATH TRAVERSAL PROTECTION                                   │
│     Normalize path & verify it's within rootDir                 │
│     ├─ INVALID → 403 Forbidden → EXIT                          │
│     └─ VALID   → Continue                                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. FILE/DIRECTORY EXISTS CHECK                                 │
│     await fs.promises.stat(fullPath)                            │
│     ├─ ERROR → 404 Not Found → EXIT                            │
│     └─ OK    → Continue                                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
                  ┌──────┴──────┐
                  │             │
                  ▼             ▼
         ┌─────────────┐  ┌──────────┐
         │  DIRECTORY  │  │   FILE   │
         └──────┬──────┘  └────┬─────┘
                │              │
                │              └──────────────────┐
                │                                 │
                ▼                                 ▼
┌──────────────────────────────┐   ┌────────────────────────────┐
│  DIRECTORY LISTING FLOW      │   │  FILE LOADING FLOW         │
│  (See detailed diagram)      │   │  (See detailed diagram)    │
└──────────────────────────────┘   └────────────────────────────┘
```

---

## Initialization Phase

This phase happens when you call `koaClassicServer(rootDir, options)` to create the middleware.

```javascript
// index.cjs:25-102
module.exports = function koaClassicServer(rootDir, opts = {}) {
    // 1. Validate rootDir
    if (!rootDir || typeof rootDir !== 'string') {
        throw new TypeError('rootDir must be a non-empty string');
    }
    if (!path.isAbsolute(rootDir)) {
        throw new Error('rootDir must be an absolute path');
    }

    // 2. Normalize rootDir
    const normalizedRootDir = path.resolve(rootDir);

    // 3. Set default options
    const options = opts || {};
    options.template = opts.template || {};

    // 4. Configure options with defaults
    options.method = Array.isArray(options.method) ? options.method : ['GET'];
    options.showDirContents = typeof options.showDirContents === 'boolean'
        ? options.showDirContents
        : true;

    // 5. Normalize index option to array format
    if (typeof options.index === 'string') {
        options.index = options.index ? [options.index] : [];
    }

    // 6. Configure template engine
    options.template.render = (options.template.render === undefined ||
                               typeof options.template.render === 'function')
        ? options.template.render
        : undefined;
    options.template.ext = Array.isArray(options.template.ext)
        ? options.template.ext
        : [];

    // 7. Configure HTTP caching
    options.browserCacheMaxAge = typeof options.browserCacheMaxAge === 'number' &&
                                 options.browserCacheMaxAge >= 0
        ? options.browserCacheMaxAge
        : 3600;
    options.browserCacheEnabled = typeof options.browserCacheEnabled === 'boolean'
        ? options.browserCacheEnabled
        : false;

    // 8. Return Koa middleware function
    return async (ctx, next) => {
        // Request handling phase starts here...
    };
}
```

**Flow:**
```
START
  │
  ├─> Validate rootDir (must be absolute path string)
  │
  ├─> Normalize rootDir with path.resolve()
  │
  ├─> Set default options:
  │   ├─ method: ['GET']
  │   ├─ showDirContents: true
  │   ├─ index: [] (array format)
  │   ├─ urlPrefix: ""
  │   ├─ urlsReserved: []
  │   ├─ template.render: undefined
  │   ├─ template.ext: []
  │   ├─ browserCacheMaxAge: 3600 (1 hour)
  │   └─ browserCacheEnabled: false
  │
  └─> Return async middleware function
```

---

## Request Handling Phase

This phase processes each incoming HTTP request.

### 1. Method Check
```javascript
// index.cjs:104-108
if (!options.method.includes(ctx.method)) {
    await next();  // Not our method, pass to next middleware
    return;
}
```

**Flow:**
```
Request Method = GET, POST, etc.
  │
  ├─ Is method in options.method array?
  │  ├─ NO  → Call next middleware (await next())
  │  └─ YES → Continue processing
```

### 2. URL Normalization
```javascript
// index.cjs:110-116
let pageHref = '';
if (ctx.href.charAt(ctx.href.length - 1) === '/') {
    pageHref = new URL(ctx.href.slice(0, -1));
} else {
    pageHref = new URL(ctx.href);
}
```

**Flow:**
```
Original URL: http://localhost:3000/path/to/file/
  │
  ├─> Remove trailing slash
  │
  └─> Result: http://localhost:3000/path/to/file
```

### 3. URL Prefix Check
```javascript
// index.cjs:118-127
const a_pathname = pageHref.pathname.split("/");
const a_urlPrefix = options.urlPrefix.split("/");

for (const key in a_urlPrefix) {
    if (a_urlPrefix[key] !== a_pathname[key]) {
        await next();  // Prefix doesn't match
        return;
    }
}
```

**Example:**
```
options.urlPrefix = "/api/static"
Request pathname   = "/api/static/file.txt"

Split urlPrefix: ["", "api", "static"]
Split pathname:  ["", "api", "static", "file.txt"]

Compare:
  [0] "" === ""           ✓
  [1] "api" === "api"     ✓
  [2] "static" === "static" ✓

→ Match! Continue processing
```

### 4. Reserved URLs Check
```javascript
// index.cjs:138-147
if (Array.isArray(options.urlsReserved) && options.urlsReserved.length > 0) {
    const a_pathnameOutPrefix = pageHrefOutPrefix.pathname.split("/");
    for (const value of options.urlsReserved) {
        if (a_pathnameOutPrefix[1] === value.substring(1)) {
            await next();  // Reserved URL, pass to another handler
            return;
        }
    }
}
```

**Example:**
```
options.urlsReserved = ["/admin", "/api"]
Request pathname     = "/admin/users"

Split: ["", "admin", "users"]
Check: a_pathnameOutPrefix[1] === "admin"

→ Match! Call next middleware (reserved for other handlers)
```

### 5. Path Traversal Protection
```javascript
// index.cjs:149-167
let requestedPath = "";
if (pageHrefOutPrefix.pathname === "/") {
    requestedPath = "";
} else {
    requestedPath = decodeURIComponent(pageHrefOutPrefix.pathname);
}

// Normalize path and prevent path traversal
const normalizedPath = path.normalize(requestedPath);
const fullPath = path.join(normalizedRootDir, normalizedPath);

// Security check: ensure resolved path is within rootDir
if (!fullPath.startsWith(normalizedRootDir)) {
    ctx.status = 403;
    ctx.body = 'Forbidden';
    return;
}
```

**Security Example:**
```
rootDir = "/var/www/public"
Request = "/../../../etc/passwd"

normalize("/../../../etc/passwd") → "../../../etc/passwd"
join("/var/www/public", "../../../etc/passwd") → "/var/etc/passwd"

Check: "/var/etc/passwd".startsWith("/var/www/public") → FALSE

→ 403 Forbidden (Path Traversal Attack Blocked!)
```

### 6. File/Directory Exists Check
```javascript
// index.cjs:171-180
let stat;
try {
    stat = await fs.promises.stat(toOpen);
} catch (error) {
    ctx.status = 404;
    ctx.body = requestedUrlNotFound();
    return;
}
```

**Flow:**
```
await fs.promises.stat(fullPath)
  │
  ├─ SUCCESS → stat object (isFile(), isDirectory(), size, mtime)
  │
  └─ ERROR → 404 Not Found
```

### 7. Route to File or Directory Handler
```javascript
// index.cjs:182-207
if (stat.isDirectory()) {
    // Directory handling
    if (options.showDirContents) {
        // Look for index file first
        if (options.index && options.index.length > 0) {
            const indexFile = await findIndexFile(toOpen, options.index);
            if (indexFile) {
                await loadFile(indexPath, indexFile.stat);
                return;
            }
        }
        // No index file, show directory listing
        ctx.body = await show_dir(toOpen, ctx);
    } else {
        ctx.status = 404;
        ctx.body = requestedUrlNotFound();
    }
    return;
} else {
    // File handling
    await loadFile(toOpen, stat);
    return;
}
```

**Flow:**
```
stat.isDirectory()?
  │
  ├─ YES (Directory)
  │   │
  │   ├─> showDirContents = true?
  │   │   │
  │   │   ├─> Has index option?
  │   │   │   │
  │   │   │   ├─> findIndexFile()
  │   │   │   │   │
  │   │   │   │   ├─ Found  → loadFile(index)
  │   │   │   │   └─ Not found → show_dir()
  │   │   │   │
  │   │   │   └─> No index → show_dir()
  │   │   │
  │   │   └─> showDirContents = false → 404 Not Found
  │   │
  │   └─ NO (File) → loadFile()
```

---

## File Loading Flow

Handles serving individual files with caching, template rendering, and streaming.

```
┌─────────────────────────────────────────────────────────────────┐
│                    loadFile(toOpen, fileStat)                   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Get file stat (if not provided)                             │
│     await fs.promises.stat(toOpen)                              │
│     ├─ ERROR → 404 Not Found → EXIT                            │
│     └─ OK    → Continue                                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Check if file is a template                                 │
│     fileExt in options.template.ext?                            │
│     ├─ YES → Call template.render(ctx, next, toOpen)           │
│     │        ├─ SUCCESS → EXIT (template rendered)             │
│     │        └─ ERROR   → 500 Internal Server Error → EXIT     │
│     └─ NO  → Continue (serve as static file)                   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. HTTP Caching (if browserCacheEnabled = true)                │
│     Generate ETag: "mtime-size"                                 │
│     Set Last-Modified: mtime.toUTCString()                      │
│     Set Cache-Control: public, max-age=3600                     │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Conditional Request Check                                   │
│     Client sent If-None-Match header?                           │
│     ├─ YES → clientEtag === serverEtag?                        │
│     │        ├─ YES → 304 Not Modified → EXIT                  │
│     │        └─ NO  → Continue                                  │
│     └─ NO  → Continue                                           │
│                                                                  │
│     Client sent If-Modified-Since header?                       │
│     ├─ YES → fileDate <= clientDate?                           │
│     │        ├─ YES → 304 Not Modified → EXIT                  │
│     │        └─ NO  → Continue                                  │
│     └─ NO  → Continue                                           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. File Access Check (Race Condition Protection)               │
│     await fs.promises.access(toOpen, fs.constants.R_OK)         │
│     ├─ ERROR → 404 Not Found → EXIT                            │
│     └─ OK    → Continue                                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. Stream File to Client                                       │
│     - Get MIME type                                             │
│     - Create read stream                                        │
│     - Set Content-Type, Content-Length, Content-Disposition     │
│     - ctx.body = stream                                         │
│     → EXIT (file streaming to client)                           │
└─────────────────────────────────────────────────────────────────┘
```

### Code Example: Template Rendering
```javascript
// index.cjs:296-311
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
```

**Example:**
```
File: /public/index.ejs
options.template.ext = ["ejs", "EJS"]

fileExt = "ejs"
fileExt in template.ext? → YES

→ Call template.render(ctx, next, "/public/index.ejs")
  → EJS renders HTML
  → ctx.body = rendered HTML
```

### Code Example: HTTP Caching
```javascript
// index.cjs:313-350
if (options.browserCacheEnabled) {
    // Generate ETag
    const etag = `"${fileStat.mtime.getTime()}-${fileStat.size}"`;

    // Format Last-Modified
    const lastModified = fileStat.mtime.toUTCString();

    // Set headers
    ctx.set('ETag', etag);
    ctx.set('Last-Modified', lastModified);
    ctx.set('Cache-Control', `public, max-age=${options.browserCacheMaxAge}, must-revalidate`);

    // Check If-None-Match (ETag validation)
    const clientEtag = ctx.get('If-None-Match');
    if (clientEtag && clientEtag === etag) {
        ctx.status = 304;  // Not Modified
        return;
    }

    // Check If-Modified-Since (date validation)
    const clientModifiedSince = ctx.get('If-Modified-Since');
    if (clientModifiedSince) {
        const clientDate = new Date(clientModifiedSince);
        const fileDate = new Date(fileStat.mtime);

        if (fileDate.getTime() <= clientDate.getTime()) {
            ctx.status = 304;  // Not Modified
            return;
        }
    }
}
```

**Caching Flow:**
```
First Request:
  Client → GET /file.txt
  Server → 200 OK
           ETag: "1699887654321-1024"
           Last-Modified: Mon, 13 Nov 2023 10:20:54 GMT
           Cache-Control: public, max-age=3600
           [file content]

Second Request (file unchanged):
  Client → GET /file.txt
           If-None-Match: "1699887654321-1024"
  Server → 304 Not Modified
           (no body sent - saves bandwidth!)
```

---

## Directory Listing Flow

Generates Apache2-like directory listing with sortable columns.

```
┌─────────────────────────────────────────────────────────────────┐
│                   show_dir(toOpen, ctx)                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Read directory contents                                     │
│     await fs.promises.readdir(toOpen, {withFileTypes: true})    │
│     ├─ ERROR → 500 Internal Server Error → EXIT                │
│     └─ OK    → Continue with dir entries                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Get sorting parameters from query string                    │
│     sortBy = ctx.query.sort || 'name'  // name, type, size     │
│     sortOrder = ctx.query.order || 'asc'  // asc, desc         │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Build HTML header                                           │
│     - Page title                                                │
│     - CSS styles                                                │
│     - Create sortable column headers (Name, Type, Size)         │
│     - Show sort indicators (↑↓)                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Collect item data for each directory entry                  │
│     For each file/directory:                                    │
│       - Get name                                                │
│       - Get type (1=file, 2=directory, 3=symlink)               │
│       - Get MIME type                                           │
│       - Get file size (await fs.promises.stat)                  │
│       - Store in items array                                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Sort items array based on sortBy and sortOrder              │
│     sortBy = 'name'  → a.name.localeCompare(b.name)            │
│     sortBy = 'type'  → directories first, then by MIME type     │
│     sortBy = 'size'  → directories first, then by bytes         │
│                                                                  │
│     sortOrder = 'desc' → reverse comparison                     │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. Generate HTML table rows from sorted items                  │
│     For each item:                                              │
│       - Escape HTML (XSS protection)                            │
│       - Create clickable link                                   │
│       - Add icon (📁 for directories, 📄 for files)            │
│       - Show MIME type                                          │
│       - Show formatted size                                     │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. Close HTML tags and return HTML string                      │
│     → EXIT (directory listing displayed)                        │
└─────────────────────────────────────────────────────────────────┘
```

### Code Example: Reading Directory
```javascript
// index.cjs:401-418
async function show_dir(toOpen, ctx) {
    let dir;
    try {
        dir = await fs.promises.readdir(toOpen, { withFileTypes: true });
    } catch (error) {
        console.error('Directory read error:', error);
        ctx.status = 500;
        ctx.body = 'Error reading directory';
        return;
    }

    if (dir.length === 0) {
        return `
            <!DOCTYPE html>
            <html><head><title>Empty Directory</title></head>
            <body><h1>Empty Directory</h1></body></html>
        `;
    }

    // Continue processing...
}
```

### Code Example: Sorting Logic
```javascript
// index.cjs:524-552
items.sort((a, b) => {
    let comparison = 0;

    if (sortBy === 'name') {
        // Alphabetical sort
        comparison = a.name.localeCompare(b.name);
    } else if (sortBy === 'type') {
        // Directories first, then by MIME type
        if (a.type === 2 && b.type !== 2) {
            comparison = -1;  // a is directory, b is not
        } else if (a.type !== 2 && b.type === 2) {
            comparison = 1;   // b is directory, a is not
        } else {
            comparison = a.mimeType.localeCompare(b.mimeType);
        }
    } else if (sortBy === 'size') {
        // Directories first, then by file size
        if (a.type === 2 && b.type !== 2) {
            comparison = -1;
        } else if (a.type !== 2 && b.type === 2) {
            comparison = 1;
        } else {
            comparison = a.sizeBytes - b.sizeBytes;
        }
    }

    // Apply sort order (asc/desc)
    return sortOrder === 'desc' ? -comparison : comparison;
});
```

**Sorting Examples:**

**1. Sort by Name (ascending):**
```
URL: /?sort=name&order=asc

Before: [zebra.txt, apple.txt, banana.txt]
After:  [apple.txt, banana.txt, zebra.txt]
```

**2. Sort by Type (ascending):**
```
URL: /?sort=type&order=asc

Before: [file.txt (text/plain), image.jpg (image/jpeg), docs/ (directory)]
After:  [docs/ (directory), image.jpg (image/jpeg), file.txt (text/plain)]

(Directories always first when sorting by type)
```

**3. Sort by Size (descending):**
```
URL: /?sort=size&order=desc

Before: [small.txt (1 KB), large.zip (10 MB), docs/ (directory)]
After:  [docs/ (-), large.zip (10 MB), small.txt (1 KB)]

(Directories always first, then largest to smallest)
```

### Code Example: XSS Protection
```javascript
// index.cjs:586-598
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

// Usage in HTML generation
const escapedName = escapeHtml(item.name);
parts.push(`<a href="${escapeHtml(item.itemUri)}">${escapedName}</a>`);
```

**Security Example:**
```
Malicious filename: <script>alert('XSS')</script>.txt

Without escaping:
  <a href="/files/<script>alert('XSS')</script>.txt">
  → XSS Attack! Script executes in browser

With escaping:
  <a href="/files/&lt;script&gt;alert('XSS')&lt;/script&gt;.txt">
  → Safe! Displays as text, doesn't execute
```

---

## Code Examples

### Complete Usage Example

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');
const ejs = require('ejs');

const app = new Koa();

// Configure static file server with all features
app.use(koaClassicServer('/var/www/public', {
    // Only handle GET requests
    method: ['GET'],

    // Show directory listings
    showDirContents: true,

    // Look for index files (priority order)
    index: ['index.html', 'index.htm', /index\.[eE][jJ][sS]/],

    // Serve under /static prefix
    urlPrefix: '/static',

    // Reserve /api for other handlers
    urlsReserved: ['/api', '/admin'],

    // Template engine (EJS)
    template: {
        ext: ['ejs', 'EJS'],
        render: async (ctx, next, filePath) => {
            ctx.body = await ejs.renderFile(filePath, {
                user: 'John Doe',
                items: ['A', 'B', 'C']
            });
            ctx.type = 'text/html';
        }
    },

    // HTTP caching (1 hour)
    browserCacheMaxAge: 3600,
    browserCacheEnabled: true
}));

app.listen(3000);
```

**Flow for this configuration:**

```
Request: GET http://localhost:3000/static/docs/index.ejs

1. Method check: GET ✓
2. URL prefix: /static ✓
3. Reserved URLs: /docs not in [/api, /admin] ✓
4. Path traversal: /var/www/public/docs/index.ejs is safe ✓
5. File exists: ✓
6. Is directory? NO (it's a file)
7. Is template? .ejs in ["ejs", "EJS"] ✓
8. Call template.render()
   → EJS renders with data {user: 'John Doe', items: ['A', 'B', 'C']}
   → ctx.body = rendered HTML
9. Send response to client
```

### Example: Directory Listing with Sorting

```
Request: GET http://localhost:3000/docs/?sort=size&order=desc

HTML Response:
┌───────────────────────────────────────────────────────┐
│ Index of /docs/                                       │
├────────────────────┬──────────────┬───────────────────┤
│ Name ↑             │ Type ↑       │ Size ↓           │
├────────────────────┼──────────────┼───────────────────┤
│ 📁 images/         │ directory    │ -                │
│ 📄 guide.pdf       │ application/ │ 2.5 MB           │
│                    │ pdf          │                  │
│ 📄 readme.txt      │ text/plain   │ 1.2 KB           │
└────────────────────┴──────────────┴───────────────────┘

Click "Size ↓" to toggle between ascending/descending
Click "Name" to sort alphabetically
Click "Type" to sort by MIME type
```

---

## Performance Optimizations

### 1. Async/Await (Non-blocking I/O)
```javascript
// ❌ BAD (blocking)
const files = fs.readdirSync(dir);  // Blocks event loop!

// ✅ GOOD (non-blocking)
const files = await fs.promises.readdir(dir);  // Event loop continues
```

### 2. String Concatenation → Array Join
```javascript
// ❌ BAD (slow, memory-intensive)
let html = "";
html += "<html>";
html += "<body>";
html += "</body>";
html += "</html>";

// ✅ GOOD (30-40% less memory)
const parts = [];
parts.push("<html>");
parts.push("<body>");
parts.push("</body>");
parts.push("</html>");
const html = parts.join("");
```

### 3. HTTP Caching (80-95% bandwidth reduction)
```javascript
// Client sends:
GET /file.txt
If-None-Match: "1699887654321-1024"

// Server responds:
HTTP/1.1 304 Not Modified
(No body sent - file unchanged)

// Bandwidth saved: 100% of file size!
```

### 4. Single stat() Call
```javascript
// ❌ BAD (double stat call)
if (fs.existsSync(file)) {              // 1st stat
    const stat = fs.statSync(file);     // 2nd stat
}

// ✅ GOOD (single stat call)
try {
    const stat = await fs.promises.stat(file);  // Only 1 stat
    // Use stat object
} catch (error) {
    // File doesn't exist
}
```

---

## Security Features

### 1. Path Traversal Protection
```javascript
const normalizedPath = path.normalize(requestedPath);
const fullPath = path.join(normalizedRootDir, normalizedPath);

if (!fullPath.startsWith(normalizedRootDir)) {
    ctx.status = 403;
    ctx.body = 'Forbidden';
    return;
}
```

### 2. XSS Protection
```javascript
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
```

### 3. Race Condition Protection
```javascript
// Verify file is still readable before streaming
try {
    await fs.promises.access(toOpen, fs.constants.R_OK);
} catch (error) {
    ctx.status = 404;
    return;
}
```

### 4. Proper Content-Disposition
```javascript
const filename = path.basename(toOpen);
const safeFilename = filename.replace(/"/g, '\\"');  // Escape quotes
ctx.response.set("content-disposition", `inline; filename="${safeFilename}"`);
```

---

## Summary

**koa-classic-server** is a production-ready static file server middleware with:

- ✅ **7-step request validation** (method, prefix, security, etc.)
- ✅ **Apache2-like directory listing** with sortable columns
- ✅ **Template engine support** (EJS, Pug, Nunjucks, etc.)
- ✅ **HTTP caching** (ETag, Last-Modified, 304 responses)
- ✅ **Security** (path traversal, XSS, race conditions)
- ✅ **Performance** (async/await, array join, single stat calls)
- ✅ **146 passing tests** (comprehensive test coverage)

**Total middleware flow: 7 validation steps → 2 handlers (file/directory) → optimized delivery**
