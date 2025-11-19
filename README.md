# koa-classic-server

🚀 **Production-ready Koa middleware** for serving static files with Apache2-like directory listing, sortable columns, HTTP caching, template engine support, and enterprise-grade security.

[![npm version](https://img.shields.io/npm/v/koa-classic-server.svg)](https://www.npmjs.com/package/koa-classic-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-153%20passing-brightgreen.svg)]()

---

## 🎉 Version 2.1.2 - Production Release

Version 2.1.2 is a **major production release** featuring performance optimizations, enhanced directory listing, and critical bug fixes.

### What's New in 2.1.2

✅ **Sortable Directory Columns** - Click Name/Type/Size to sort (Apache2-like)
✅ **Navigation Bug Fixed** - Directory navigation now works correctly after sorting
✅ **File Size Display** - Human-readable file sizes (B, KB, MB, GB, TB)
✅ **HTTP Caching** - 80-95% bandwidth reduction with ETag and Last-Modified
✅ **Async/Await** - Non-blocking I/O for high performance
✅ **153 Tests Passing** - Comprehensive test coverage
✅ **Flow Documentation** - Complete execution flow diagrams
✅ **Code Review** - Standardized operators and best practices

### What's New in 2.0

✅ **Performance Optimizations** - 50-70% faster directory listings
✅ **Enhanced Index Option** - Array format with RegExp support
✅ **Template Engine Guide** - Complete documentation with examples
✅ **Security Hardened** - Path traversal, XSS, race condition fixes

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
- 🧪 **Well-Tested** - 153 passing tests with comprehensive coverage
- 📦 **Dual Module Support** - CommonJS and ES Modules

---

## Installation

```bash
npm install koa-classic-server
```

**Requirements:**
- Node.js >= 12.0.0
- Koa >= 2.0.0

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
  cacheMaxAge: 3600,
  enableCaching: true
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

### 6. With HTTP Caching

Enable aggressive caching for static files:

```javascript
app.use(koaClassicServer(__dirname + '/public', {
  enableCaching: true,       // Enable ETag and Last-Modified
  cacheMaxAge: 86400,        // Cache for 24 hours (in seconds)
}));
```

**Benefits:**
- 80-95% bandwidth reduction
- 304 Not Modified responses for unchanged files
- Faster page loads for returning visitors

**See details:** [HTTP Caching Optimization →](./docs/OPTIMIZATION_HTTP_CACHING.md)

### 7. Multiple Index Files with Priority

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

### 8. Complete Production Example

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
  enableCaching: true,
  cacheMaxAge: 86400,  // 24 hours
}));

// Serve dynamic templates
app.use(koaClassicServer(path.join(__dirname, 'views'), {
  showDirContents: false,
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

  // HTTP caching configuration
  enableCaching: true,      // Enable ETag & Last-Modified (default: true)
  cacheMaxAge: 3600,        // Cache-Control max-age in seconds (default: 3600 = 1 hour)
}
```

### Options Details

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `method` | Array | `['GET']` | Allowed HTTP methods |
| `showDirContents` | Boolean | `true` | Show directory listing |
| `index` | Array/String | `[]` | Index file patterns (array format recommended) |
| `urlPrefix` | String | `''` | URL path prefix |
| `urlsReserved` | Array | `[]` | Reserved directory paths (first-level only) |
| `template.render` | Function | `undefined` | Template rendering function |
| `template.ext` | Array | `[]` | Extensions for template rendering |
| `enableCaching` | Boolean | `true` | Enable HTTP caching headers |
| `cacheMaxAge` | Number | `3600` | Cache duration in seconds |

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
- ✅ 153 tests passing
- ✅ Security tests (path traversal, XSS, race conditions)
- ✅ EJS template integration tests
- ✅ Index option tests (strings, arrays, RegExp)
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

### From v1.x to v2.x

**Breaking Changes:**
- `index` option: String format deprecated (still works), use array format

**Migration:**

```javascript
// v1.x (deprecated)
{
  index: 'index.html'
}

// v2.x (recommended)
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
