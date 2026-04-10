# koa-classic-server

🚀 **Production-ready Koa middleware** for serving static files with Apache2-like directory listing, sortable columns, HTTP caching, template engine support, and enterprise-grade security.

[![npm version](https://img.shields.io/npm/v/koa-classic-server.svg)](https://www.npmjs.com/package/koa-classic-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-309%20passing-brightgreen.svg)]()

---

## 🎉 Version 2.X - Production-Ready Release

The 2.X series brings major performance improvements, enhanced security, and powerful new features while maintaining full backward compatibility.

### Key Features in Version 2.X

✅ **URL Rewriting Support** - Compatible with i18n and routing middleware via `useOriginalUrl` option
✅ **Improved Caching Controls** - Clear `browserCacheEnabled` and `browserCacheMaxAge` options
✅ **Development-Friendly Defaults** - Caching disabled by default for easier development
✅ **Production Optimized** - Enable caching in production for 80-95% bandwidth reduction
✅ **Sortable Directory Columns** - Click Name/Type/Size to sort (Apache2-like)
✅ **File Size Display** - Human-readable file sizes (B, KB, MB, GB, TB)
✅ **HTTP Caching** - ETag and Last-Modified headers with 304 responses
✅ **Async/Await** - Non-blocking I/O for high performance
✅ **Performance Optimized** - 50-70% faster directory listings
✅ **Enhanced Index Option** - Array format with RegExp support
✅ **Template Engine Support** - EJS, Pug, Handlebars, Nunjucks, and more
✅ **Enterprise Security** - Path traversal, XSS, race condition protection
✅ **Clean URLs** - Hide file extensions with `hideExtension` (mod_rewrite-like behavior)
✅ **Symlink Support** - Full symbolic link support (NixOS, Docker, npm link, Capistrano)
✅ **Comprehensive Testing** - 309 tests passing with extensive coverage
✅ **Complete Documentation** - Detailed guides and examples

[See full changelog →](./docs/CHANGELOG.md)

---

## Features

**koa-classic-server** is a high-performance middleware for serving static files with Apache2-like behavior, making file browsing intuitive and powerful.

### Core Features

- 🗂️ **Apache2-like Directory Listing** - Sortable columns (Name, Type, Size)
- 📄 **Static File Serving** - Automatic MIME type detection with streaming
- 📊 **Sortable Columns** - Click headers to sort ascending/descending
- 📏 **File Sizes** - Human-readable display (B, KB, MB, GB, TB)
- ⚡ **HTTP Caching** - ETag, Last-Modified, 304 responses
- 🎨 **Template Engine Support** - EJS, Pug, Handlebars, Nunjucks, etc.
- 🔒 **Enterprise Security** - Path traversal, XSS, race condition protection
- ⚙️ **Highly Configurable** - URL prefixes, reserved paths, index files
- 🚀 **High Performance** - Async/await, non-blocking I/O, optimized algorithms
- 🔗 **Symlink Support** - Transparent symlink resolution with directory listing indicators
- 🌐 **Clean URLs** - Hide file extensions for SEO-friendly URLs via `hideExtension`
- 🧪 **Well-Tested** - 309 passing tests with comprehensive coverage
- 📦 **Dual Module Support** - CommonJS and ES Modules

---

## Installation

```bash
npm install koa-classic-server
```

**Requirements:**
- Node.js >= 18.0.0
- Koa >= 2.0.0 (Koa 3 requires >= 3.1.2)

---

## Quick Start

### Basic Usage

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// Serve files from "public" directory
app.use(koaClassicServer(__dirname + '/public'));

app.listen(3000);
console.log('Server running on http://localhost:3000');
```

### With Options

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

app.use(koaClassicServer(__dirname + '/public', {
  showDirContents: true,
  index: ['index.html', 'index.htm'],
  urlPrefix: '/static',
  browserCacheMaxAge: 3600,
  browserCacheEnabled: true
}));

app.listen(3000);
```

---

## Complete Usage Guide

### 1. Import

```javascript
// CommonJS
const koaClassicServer = require('koa-classic-server');

// ES Modules
import koaClassicServer from 'koa-classic-server';
```

### 2. Basic File Server

Serve static files from a directory:

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

app.use(koaClassicServer(__dirname + '/public', {
  showDirContents: true,
  index: ['index.html']
}));

app.listen(3000);
```

**What it does:**
- Serves files from `/public` directory
- Shows directory listing when accessing folders
- Looks for `index.html` in directories
- Sortable columns (Name, Type, Size)
- File sizes displayed in human-readable format

### 3. With URL Prefix

Serve files under a specific URL path:

```javascript
app.use(koaClassicServer(__dirname + '/assets', {
  urlPrefix: '/static',
  showDirContents: true
}));
```

**Result:**
- `http://localhost:3000/static/image.png` → serves `/assets/image.png`
- `http://localhost:3000/static/` → shows `/assets` directory listing

### 4. With Reserved Paths

Protect specific directories from being accessed:

```javascript
app.use(koaClassicServer(__dirname + '/www', {
  urlsReserved: ['/admin', '/config', '/.git', '/node_modules']
}));
```

**Result:**
- `/admin/*` → passed to next middleware (not served)
- `/config/*` → protected
- Other paths → served normally

### 5. With Template Engine (EJS)

Dynamically render templates with data:

```javascript
const ejs = require('ejs');

app.use(koaClassicServer(__dirname + '/views', {
  template: {
    ext: ['ejs', 'html.ejs'],
    render: async (ctx, next, filePath) => {
      const data = {
        title: 'My App',
        user: ctx.state.user || { name: 'Guest' },
        items: ['Item 1', 'Item 2', 'Item 3'],
        timestamp: new Date().toISOString()
      };

      ctx.body = await ejs.renderFile(filePath, data);
      ctx.type = 'text/html';
    }
  }
}));
```

**Template example (`views/dashboard.ejs`):**
```html
<!DOCTYPE html>
<html>
<head>
    <title><%= title %></title>
</head>
<body>
    <h1>Welcome, <%= user.name %>!</h1>
    <ul>
    <% items.forEach(item => { %>
        <li><%= item %></li>
    <% }); %>
    </ul>
    <p>Generated at: <%= timestamp %></p>
</body>
</html>
```

**See complete guide:** [Template Engine Documentation →](./docs/template-engine/TEMPLATE_ENGINE_GUIDE.md)

### 6. Clean URLs with hideExtension

Hide file extensions from URLs, similar to Apache's `mod_rewrite`:

```javascript
const ejs = require('ejs');

app.use(koaClassicServer(__dirname + '/public', {
  showDirContents: true,
  index: ['index.ejs'],
  hideExtension: {
    ext: '.ejs',      // Extension to hide (required)
    redirect: 301     // HTTP redirect code (optional, default: 301)
  },
  template: {
    ext: ['ejs'],
    render: async (ctx, next, filePath) => {
      ctx.body = await ejs.renderFile(filePath, data);
      ctx.type = 'text/html';
    }
  }
}));
```

**URL Behavior:**

| Request URL | Action | Result |
|-------------|--------|--------|
| `/about` | Resolves `about.ejs` | Serves file (200) |
| `/blog/article` | Resolves `blog/article.ejs` | Serves file (200) |
| `/about.ejs` | Redirect | 301 → `/about` |
| `/about.ejs?lang=it` | Redirect | 301 → `/about?lang=it` |
| `/index.ejs` | Redirect | 301 → `/` |
| `/section/index.ejs` | Redirect | 301 → `/section/` |
| `/style.css` | No interference | Normal flow |
| `/about/` | No interference | Shows directory listing |

**Conflict Resolution:**

- **Directory vs file**: When both `about/` directory and `about.ejs` file exist, `/about` serves the file. Use `/about/` to access the directory.
- **Extensionless vs extension**: When both `about` (no ext) and `about.ejs` exist, `/about` always serves `about.ejs`. The extensionless file becomes unreachable.

> **Note**: This conflict resolution behavior differs from Apache/Nginx, where directories typically take priority over files with the same base name.

### 7. URL Rewriting Support (useOriginalUrl)

When using URL rewriting middleware (i18n, routing), set `useOriginalUrl: false` so koa-classic-server resolves files from the rewritten URL instead of the original one:

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// i18n middleware: strips language prefix and rewrites ctx.url
app.use(async (ctx, next) => {
  const langMatch = ctx.path.match(/^\/(it|en|fr|de|es)\//);
  if (langMatch) {
    ctx.state.lang = langMatch[1];       // Save language for templates
    ctx.url = ctx.path.replace(/^\/(it|en|fr|de|es)/, '') + ctx.search;
  }
  await next();
});

// Serve files using the rewritten URL
app.use(koaClassicServer(__dirname + '/public', {
  useOriginalUrl: false  // Use ctx.url (rewritten) instead of ctx.originalUrl
}));

app.listen(3000);
```

**How it works:**

| Request | `ctx.originalUrl` | `ctx.url` (rewritten) | File resolved |
|---------|-------------------|----------------------|---------------|
| `/it/page.html` | `/it/page.html` | `/page.html` | `public/page.html` |
| `/en/page.html` | `/en/page.html` | `/page.html` | `public/page.html` |
| `/page.html` | `/page.html` | `/page.html` | `public/page.html` |

- With `useOriginalUrl: true` (default): the server would look for `public/it/page.html` (which doesn't exist)
- With `useOriginalUrl: false`: the server looks for `public/page.html` (correct)

### 8. Advanced hideExtension Scenarios

#### Recommended file structure

```
views/
├── index.ejs              ← / (home page)
├── about.ejs              ← /about
├── contact.ejs            ← /contact
├── blog/
│   ├── index.ejs          ← /blog/
│   ├── first-post.ejs     ← /blog/first-post
│   └── second-post.ejs    ← /blog/second-post
├── docs/
│   ├── index.ejs          ← /docs/
│   ├── getting-started.ejs ← /docs/getting-started
│   └── api-reference.ejs  ← /docs/api-reference
└── assets/
    ├── style.css          ← /assets/style.css (served normally)
    └── script.js          ← /assets/script.js (served normally)
```

#### hideExtension with i18n middleware

Combine `hideExtension` with `useOriginalUrl: false` for multilingual sites with clean URLs:

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');
const ejs = require('ejs');

const app = new Koa();

// i18n middleware: /it/about → ctx.url = /about, ctx.state.lang = 'it'
app.use(async (ctx, next) => {
  const langMatch = ctx.path.match(/^\/(it|en|fr)\//);
  if (langMatch) {
    ctx.state.lang = langMatch[1];
    ctx.url = ctx.path.replace(/^\/(it|en|fr)/, '') + ctx.search;
  } else {
    ctx.state.lang = 'en';  // Default language
  }
  await next();
});

app.use(koaClassicServer(__dirname + '/views', {
  index: ['index.ejs'],
  useOriginalUrl: false,     // Resolve files from rewritten URL
  hideExtension: {
    ext: '.ejs',
    redirect: 301
  },
  template: {
    ext: ['ejs'],
    render: async (ctx, next, filePath) => {
      ctx.body = await ejs.renderFile(filePath, { lang: ctx.state.lang });
      ctx.type = 'text/html';
    }
  }
}));

app.listen(3000);
```

**Result:**

| Request | Rewritten URL | File resolved | Redirect target |
|---------|---------------|---------------|-----------------|
| `/it/about` | `/about` | `views/about.ejs` | — |
| `/en/blog/first-post` | `/blog/first-post` | `views/blog/first-post.ejs` | — |
| `/it/about.ejs` | `/about.ejs` | — | 301 → `/it/about` (preserves `/it/` prefix) |

> **Note**: Redirects always use `ctx.originalUrl` to preserve the language prefix, regardless of the `useOriginalUrl` setting.

#### Temporary redirect (302)

Use `redirect: 302` instead of 301 when the URL mapping may change (staging, A/B testing, or during migration):

```javascript
hideExtension: {
  ext: '.ejs',
  redirect: 302   // Temporary redirect — browsers won't cache it
}
```

> **When to use 302**: A 301 (permanent) tells browsers and search engines to cache the redirect. Use 302 (temporary) during development, staging, or when you're not yet sure the clean URL structure is final.

### 9. With HTTP Caching

Enable aggressive caching for static files:

```javascript
app.use(koaClassicServer(__dirname + '/public', {
  browserCacheEnabled: true,       // Enable ETag and Last-Modified
  browserCacheMaxAge: 86400,        // Cache for 24 hours (in seconds)
}));
```

**⚠️ Important: Production Recommendation**

The default value for `browserCacheEnabled` is `false` to facilitate development (where you want changes to be immediately visible). **For production environments, it is strongly recommended to set `browserCacheEnabled: true`** to benefit from:

- 80-95% bandwidth reduction
- 304 Not Modified responses for unchanged files
- Faster page loads for returning visitors
- Reduced server load

**See details:** [HTTP Caching Optimization →](./docs/OPTIMIZATION_HTTP_CACHING.md)

### 10. Multiple Index Files with Priority

Search for multiple index files with custom order:

```javascript
app.use(koaClassicServer(__dirname + '/public', {
  index: [
    'index.html',           // First priority
    'index.htm',            // Second priority
    /index\.[eE][jJ][sS]/,  // Third: index.ejs (case-insensitive)
    'default.html'          // Last priority
  ]
}));
```

**See details:** [Index Option Priority →](./docs/INDEX_OPTION_PRIORITY.md)

### 11. Complete Production Example

Real-world configuration for production:

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');
const ejs = require('ejs');
const path = require('path');

const app = new Koa();

// Serve static assets with caching
app.use(koaClassicServer(path.join(__dirname, 'public'), {
  method: ['GET', 'HEAD'],
  showDirContents: false,  // Disable directory listing in production
  index: ['index.html', 'index.htm'],
  urlPrefix: '/assets',
  urlsReserved: ['/admin', '/api', '/.git'],
  browserCacheEnabled: true,
  browserCacheMaxAge: 86400,  // 24 hours
}));

// Serve dynamic templates with clean URLs
app.use(koaClassicServer(path.join(__dirname, 'views'), {
  showDirContents: false,
  index: ['index.ejs'],
  useOriginalUrl: false,  // Use ctx.url (for i18n or routing middleware)
  hideExtension: {
    ext: '.ejs',           // /about → serves about.ejs
    redirect: 301          // /about.ejs → 301 redirect to /about
  },
  template: {
    ext: ['ejs'],
    render: async (ctx, next, filePath) => {
      const data = {
        env: process.env.NODE_ENV,
        user: ctx.state.user,
        config: ctx.state.config
      };

      try {
        ctx.body = await ejs.renderFile(filePath, data);
        ctx.type = 'text/html';
      } catch (error) {
        console.error('Template error:', error);
        ctx.status = 500;
        ctx.body = 'Internal Server Error';
      }
    }
  }
}));

app.listen(3000);
```

---

## API Reference

### koaClassicServer(rootDir, options)

Creates a Koa middleware for serving static files.

**Parameters:**

- **`rootDir`** (String, required): Absolute path to the directory containing files
- **`options`** (Object, optional): Configuration options

**Returns:** Koa middleware function

### Options

```javascript
{
  // HTTP methods allowed (default: ['GET'])
  method: ['GET', 'HEAD'],

  // Show directory contents (default: true)
  showDirContents: true,

  // Index file configuration
  // Array format (recommended):
  //   - Strings: exact matches ['index.html', 'default.html']
  //   - RegExp: pattern matches [/index\.html/i]
  //   - Mixed: ['index.html', /INDEX\.HTM/i]
  // Priority determined by array order (first match wins)
  // See docs/INDEX_OPTION_PRIORITY.md for details
  index: ['index.html', 'index.htm'],

  // URL path prefix (default: '')
  // Files served under this prefix
  urlPrefix: '/static',

  // Reserved paths (default: [])
  // First-level directories passed to next middleware
  urlsReserved: ['/admin', '/api', '/.git'],

  // Template engine configuration
  template: {
    // Template rendering function
    render: async (ctx, next, filePath) => {
      // Your rendering logic
      ctx.body = await yourEngine.render(filePath, data);
    },

    // File extensions to process
    ext: ['ejs', 'pug', 'hbs']
  },

  // Browser HTTP caching configuration
  // NOTE: Default is false for development. Set to true in production for better performance!
  browserCacheEnabled: false,     // Enable ETag & Last-Modified (default: false)
  browserCacheMaxAge: 3600,        // Cache-Control max-age in seconds (default: 3600 = 1 hour)

  // URL resolution
  useOriginalUrl: true,     // Use ctx.originalUrl (default) or ctx.url
                            // Set false for URL rewriting middleware (i18n, routing)

  // Clean URLs - hide file extension from URLs (mod_rewrite-like)
  hideExtension: {
    ext: '.ejs',            // Extension to hide (required, must start with '.')
    redirect: 301           // HTTP redirect code (optional, default: 301)
  },

}
```

### Options Details

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `method` | Array | `['GET']` | Allowed HTTP methods |
| `showDirContents` | Boolean | `true` | Show directory listing |
| `index` | Array | `[]` | Index file patterns (strings, RegExp, or mixed) |
| `urlPrefix` | String | `''` | URL path prefix |
| `urlsReserved` | Array | `[]` | Reserved directory paths (first-level only) |
| `template.render` | Function | `undefined` | Template rendering function |
| `template.ext` | Array | `[]` | Extensions for template rendering |
| `browserCacheEnabled` | Boolean | `false` | Enable browser HTTP caching headers (recommended: `true` in production) |
| `browserCacheMaxAge` | Number | `3600` | Browser cache duration in seconds |
| `useOriginalUrl` | Boolean | `true` | Use `ctx.originalUrl` (default) or `ctx.url` for URL resolution |
| `hideExtension.ext` | String | - | Extension to hide (e.g. `'.ejs'`). Enables clean URL feature |
| `hideExtension.redirect` | Number | `301` | HTTP redirect code for URLs with extension |

#### useOriginalUrl (Boolean, default: true)

Controls which URL property is used for file resolution:
- **`true` (default)**: Uses `ctx.originalUrl` (immutable, reflects the original request)
- **`false`**: Uses `ctx.url` (mutable, can be modified by middleware)

**When to use `false`:**

Set `useOriginalUrl: false` when using URL rewriting middleware such as i18n routers or path rewriters that modify `ctx.url`. This allows koa-classic-server to serve files based on the rewritten URL instead of the original request URL.

**Example with i18n middleware:**

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// i18n middleware that rewrites URLs
app.use(async (ctx, next) => {
  if (ctx.path.match(/^\/it\//)) {
    ctx.url = ctx.path.replace(/^\/it/, ''); // /it/page.html → /page.html
  }
  await next();
});

// Serve files using rewritten URL
app.use(koaClassicServer(__dirname + '/www', {
  useOriginalUrl: false  // Use ctx.url (rewritten) instead of ctx.originalUrl
}));

app.listen(3000);
```

**How it works:**
- Request: `GET /it/page.html`
- `ctx.originalUrl`: `/it/page.html` (unchanged)
- `ctx.url`: `/page.html` (rewritten by middleware)
- With `useOriginalUrl: false`: Server looks for `/www/page.html` ✅
- With `useOriginalUrl: true` (default): Server looks for `/www/it/page.html` ❌ 404

---

## Directory Listing Features

### Sortable Columns

Click on column headers to sort:

- **Name** - Alphabetical sorting (A-Z or Z-A)
- **Type** - Sort by MIME type (directories always first)
- **Size** - Sort by file size (directories always first)

Visual indicators:
- **↑** - Ascending order
- **↓** - Descending order

### File Size Display

Human-readable format:
- `1.5 KB` - Kilobytes
- `2.3 MB` - Megabytes
- `1.2 GB` - Gigabytes
- `-` - Directories (no size)

### Navigation

- **Click folder name** - Enter directory
- **Click file name** - Download/view file
- **Parent Directory** - Go up one level

### Symlink Support

The middleware fully supports symbolic links, which is essential for environments where served files are symlinks rather than regular files:

- **NixOS buildFHSEnv** - Files in www/ appear as symlinks to the Nix store
- **Docker bind mounts** - Mounted files may appear as symlinks
- **npm link** - Linked packages are symlinks
- **Capistrano-style deploys** - The `current` directory is a symlink to the active release

**How it works:**

Symlinks are followed transparently via `fs.promises.stat()`, but only when `dirent.isSymbolicLink()` is true. Regular files incur zero additional overhead.

**Directory listing indicators:**

| Entry type | Indicator | Clickable | Type shown |
|------------|-----------|-----------|------------|
| Symlink to file | `( Symlink )` | Yes | Target MIME type |
| Symlink to directory | `( Symlink )` | Yes | `DIR` |
| Broken/circular symlink | `( Broken Symlink )` | No | `unknown` |
| Regular file/directory | none | Yes | Real type |

**Edge cases handled:**
- Broken symlinks (missing target) return 404 on direct access
- Circular symlinks (A → B → A) are treated as broken, no infinite loops
- Symlinks to directories are fully navigable

---

## Security

### Built-in Protection

koa-classic-server includes enterprise-grade security:

#### 1. Path Traversal Protection

Prevents access to files outside `rootDir`:

```javascript
// ❌ Blocked requests
GET /../../../etc/passwd       → 403 Forbidden
GET /../config/database.yml    → 403 Forbidden
GET /%2e%2e%2fpackage.json     → 403 Forbidden
```

#### 2. XSS Protection

All filenames and paths are HTML-escaped:

```javascript
// Malicious filename: <script>alert('xss')</script>.txt
// Displayed as: &lt;script&gt;alert('xss')&lt;/script&gt;.txt
// ✅ Safe - script doesn't execute
```

#### 3. Reserved URLs

Protect sensitive directories:

```javascript
app.use(koaClassicServer(__dirname, {
  urlsReserved: ['/admin', '/config', '/.git', '/node_modules']
}));
```

#### 4. Race Condition Protection

File access is verified before streaming:

```javascript
// File deleted between check and access?
// ✅ Returns 404 instead of crashing
```

**See full security audit:** [Security Tests →](./__tests__/security.test.js)

---

## Performance

### Optimizations

Version 2.x includes major performance improvements:

- **Async/Await** - Non-blocking I/O, event loop never blocked
- **Array Join** - 30-40% less memory vs string concatenation
- **HTTP Caching** - 80-95% bandwidth reduction
- **Single stat() Call** - No double file system access
- **Streaming** - Large files streamed efficiently

### Benchmarks

Performance results on directory with 1,000 files:

```
Before (v1.x):     ~350ms per request
After (v2.x):      ~190ms per request
Improvement:       46% faster
```

**See detailed benchmarks:** [Performance Analysis →](./docs/PERFORMANCE_ANALYSIS.md)

---

## Testing

Run the comprehensive test suite:

```bash
# Run all tests
npm test

# Run security tests only
npm run test:security

# Run performance benchmarks
npm run test:performance
```

**Test Coverage:**
- ✅ 309 tests passing
- ✅ Security tests (path traversal, XSS, race conditions)
- ✅ EJS template integration tests
- ✅ Index option tests (arrays, RegExp)
- ✅ hideExtension tests (clean URLs, redirects, conflicts, validation)
- ✅ Symlink tests (file, directory, broken, circular, indicators)
- ✅ Performance benchmarks
- ✅ Directory sorting tests

---

## Complete Documentation

### Core Documentation

- **[DOCUMENTATION.md](./docs/DOCUMENTATION.md)** - Complete API reference and usage guide
- **[FLOW_DIAGRAM.md](./docs/FLOW_DIAGRAM.md)** - Visual flow diagrams and code execution paths
- **[CHANGELOG.md](./docs/CHANGELOG.md)** - Version history and release notes

### Template Engine

- **[TEMPLATE_ENGINE_GUIDE.md](./docs/template-engine/TEMPLATE_ENGINE_GUIDE.md)** - Complete guide to template engine integration
  - Progressive examples (simple to enterprise)
  - EJS, Pug, Handlebars, Nunjucks support
  - Best practices and troubleshooting

### Configuration

- **[INDEX_OPTION_PRIORITY.md](./docs/INDEX_OPTION_PRIORITY.md)** - Detailed priority behavior for `index` option
  - String vs Array vs RegExp formats
  - Priority order examples
  - Migration guide from v1.x

- **[EXAMPLES_INDEX_OPTION.md](./docs/EXAMPLES_INDEX_OPTION.md)** - 10 practical examples of `index` option with RegExp
  - Case-insensitive matching
  - Multiple extensions
  - Complex patterns

### Performance

- **[PERFORMANCE_ANALYSIS.md](./docs/PERFORMANCE_ANALYSIS.md)** - Performance optimization analysis
  - Before/after comparisons
  - Memory usage analysis
  - Bottleneck identification

- **[PERFORMANCE_COMPARISON.md](./docs/PERFORMANCE_COMPARISON.md)** - Detailed performance benchmarks
  - Request latency
  - Throughput metrics
  - Concurrent request handling

- **[OPTIMIZATION_HTTP_CACHING.md](./docs/OPTIMIZATION_HTTP_CACHING.md)** - HTTP caching implementation details
  - ETag generation
  - Last-Modified headers
  - 304 Not Modified responses

- **[BENCHMARKS.md](./docs/BENCHMARKS.md)** - Benchmark results and methodology

### Code Quality

- **[CODE_REVIEW.md](./docs/CODE_REVIEW.md)** - Code quality analysis and review
  - Security audit
  - Best practices
  - Standardization improvements

- **[DEBUG_REPORT.md](./docs/DEBUG_REPORT.md)** - Known limitations and debugging info
  - Reserved URLs behavior
  - Edge cases
  - Troubleshooting tips

---

## Migration Guide

### From v2.x to v3.x

**Breaking Changes:**
- `index` option: String format removed — passing a non-empty string now throws an Error
- `cacheMaxAge` option: removed — use `browserCacheMaxAge`
- `enableCaching` option: removed — use `browserCacheEnabled`

**Migration:**

```javascript
// v2.x (now throws in v3)
{ index: 'index.html' }

// v3.x
{ index: ['index.html'] }
```

---

### From v1.x to v2.x

**Breaking Changes:**
- `index` option: String format deprecated (use array format)

**Migration:**

```javascript
// v1.x
{
  index: 'index.html'
}

// v2.x+
{
  index: ['index.html']
}
```

**New Features:**
- HTTP caching (enabled by default)
- Sortable directory columns
- File size display
- Enhanced index option with RegExp

**See full migration guide:** [CHANGELOG.md](./docs/CHANGELOG.md)

---

## Examples

### Example 1: Simple Static Server

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();
app.use(koaClassicServer(__dirname + '/public'));
app.listen(3000);
```

### Example 2: Multi-Directory Server

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// Serve static assets
app.use(koaClassicServer(__dirname + '/public', {
  urlPrefix: '/static',
  showDirContents: false
}));

// Serve user uploads
app.use(koaClassicServer(__dirname + '/uploads', {
  urlPrefix: '/files',
  showDirContents: true
}));

app.listen(3000);
```

### Example 3: Development Server with Templates

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');
const ejs = require('ejs');

const app = new Koa();

// Development mode - show directories
app.use(koaClassicServer(__dirname + '/src', {
  showDirContents: true,
  template: {
    ext: ['ejs'],
    render: async (ctx, next, filePath) => {
      ctx.body = await ejs.renderFile(filePath, {
        dev: true,
        timestamp: Date.now()
      });
      ctx.type = 'text/html';
    }
  }
}));

app.listen(3000);
```

---

## Troubleshooting

### Common Issues

**Issue: 404 errors for all files**

Check that `rootDir` is an absolute path:

```javascript
// ❌ Wrong (relative path)
koaClassicServer('./public')

// ✅ Correct (absolute path)
koaClassicServer(__dirname + '/public')
koaClassicServer(path.join(__dirname, 'public'))
```

**Issue: Reserved URLs not working**

Reserved URLs only work for first-level directories:

```javascript
urlsReserved: ['/admin']  // ✅ Blocks /admin/*
urlsReserved: ['/admin/users']  // ❌ Doesn't work (nested)
```

**Issue: Directory sorting not working**

Make sure you're accessing directories without query params initially. The sorting is applied when you click headers.

**See full troubleshooting:** [DEBUG_REPORT.md](./docs/DEBUG_REPORT.md)

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass (`npm test`)
5. Submit a pull request

---

## Known Limitations

- Reserved URLs only work for first-level directories
- Template rendering is synchronous per request

See [DEBUG_REPORT.md](./docs/DEBUG_REPORT.md) for technical details.

---

## License

MIT License - see LICENSE file for details

---

## Author

Italo Paesano

---

## Links

- **[npm Package](https://www.npmjs.com/package/koa-classic-server)** - Official npm package
- **[GitHub Repository](https://github.com/italopaesano/koa-classic-server)** - Source code
- **[Issue Tracker](https://github.com/italopaesano/koa-classic-server/issues)** - Report bugs
- **[Full Documentation](./docs/DOCUMENTATION.md)** - Complete reference

---

## Changelog

See [CHANGELOG.md](./docs/CHANGELOG.md) for version history.

---

**⚠️ Security Notice:** Always use the latest version for security updates and bug fixes.
