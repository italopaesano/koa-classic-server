# koa-classic-server

🔒 **Secure Koa middleware for serving static files** with Apache-like directory listing, template engine support, and comprehensive security fixes.

[![npm version](https://img.shields.io/npm/v/koa-classic-server.svg)](https://www.npmjs.com/package/koa-classic-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-71%20passing-brightgreen.svg)]()

## ⚠️ Version 1.2.0 - Critical Security Update

Version 1.2.0 includes **critical security fixes** for path traversal vulnerabilities and other important improvements. **Upgrade immediately** if you're using version 1.1.0 or earlier.

### What's New in 1.2.0

✅ **Fixed Path Traversal Vulnerability** - No more unauthorized file access
✅ **Proper HTTP 404 Status Codes** - Standards-compliant error handling
✅ **Template Error Handling** - No more server crashes
✅ **XSS Protection** - HTML escaping in directory listings
✅ **Race Condition Fixes** - Robust file access
✅ **71 Tests Passing** - Comprehensive test coverage

[See full changelog](./CHANGELOG.md)

## Features

koa-classic-server is a middleware for serving static files from a directory with Apache 2-like behavior. The contents of a folder on the server will be shown remotely and if you want to access a file, click on it.

**Key Features:**

- 🗂️ **Directory Listing** - Apache-style browseable directories
- 📄 **Static File Serving** - Automatic MIME type detection
- 🎨 **Template Engine Support** - Integrate EJS, Pug, Handlebars, etc.
- 🔒 **Security** - Path traversal protection, XSS prevention
- ⚙️ **Configurable** - URL prefixes, reserved paths, index files
- 🧪 **Well-Tested** - 71 tests with security coverage
- 📦 **Dual Module Support** - CommonJS and ES Modules

## Installation

```bash
npm install koa-classic-server
```

## Quick Start

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// Serve files from "public" directory
app.use(koaClassicServer(__dirname + '/public'));

app.listen(3000);
console.log('Server running on http://localhost:3000');
```

## Usage

### Import

```javascript
// CommonJS
const koaClassicServer = require('koa-classic-server');

// ES Modules
import koaClassicServer from 'koa-classic-server';
```

### Basic Examples

#### Example 1: Simple File Server

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

app.use(koaClassicServer(__dirname + '/public', {
  showDirContents: true,
  index: 'index.html'
}));

app.listen(3000);
```

#### Example 2: With URL Prefix

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// Files accessible under /static
// e.g., http://localhost:3000/static/image.png
app.use(koaClassicServer(__dirname + '/public', {
  urlPrefix: '/static',
  showDirContents: true
}));

app.listen(3000);
```

#### Example 3: With Template Engine (EJS)

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');
const ejs = require('ejs');

const app = new Koa();

app.use(koaClassicServer(__dirname + '/views', {
  template: {
    render: async (ctx, next, filePath) => {
      ctx.body = await ejs.renderFile(filePath, {
        title: 'My App',
        user: ctx.state.user
      });
    },
    ext: ['ejs', 'html']
  }
}));

app.listen(3000);
```

## API

### koaClassicServer(rootDir, options)

Creates a Koa middleware for serving static files.

**Parameters:**

- `rootDir` (String, required): Absolute path to the directory containing static files
- `options` (Object, optional): Configuration options

**Returns:** Koa middleware function

## Options

```javascript
const options = {
  // HTTP methods allowed (default: ['GET'])
  method: ['GET', 'HEAD'],

  // Show directory contents (default: true)
  showDirContents: true,

  // Index file name (default: '')
  // If present in a directory, it's served automatically
  index: 'index.html',

  // URL path prefix (default: '')
  // Files will be served under this prefix
  urlPrefix: '/static',

  // Reserved paths (default: [])
  // These directories won't be accessible
  // Note: Only works for first-level directories
  urlsReserved: ['/admin', '/private'],

  // Template engine configuration
  template: {
    // Template rendering function
    render: async (ctx, next, filePath) => {
      // Your rendering logic
      ctx.body = await yourTemplateEngine.render(filePath, data);
    },

    // File extensions to process with template.render
    ext: ['ejs', 'pug', 'hbs']
  }
};
```

### Options Details

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `method` | Array | `['GET']` | Allowed HTTP methods |
| `showDirContents` | Boolean | `true` | Show directory listing |
| `index` | String | `''` | Index file name |
| `urlPrefix` | String | `''` | URL path prefix |
| `urlsReserved` | Array | `[]` | Reserved directory paths |
| `template.render` | Function | `undefined` | Template rendering function |
| `template.ext` | Array | `[]` | Extensions for template rendering |

## Security

### Path Traversal Protection

koa-classic-server 1.2.0 protects against path traversal attacks:

```javascript
// ❌ These requests are blocked (return 403 Forbidden)
GET /../../../etc/passwd
GET /../config/database.yml
GET /%2e%2e%2fpackage.json
```

### Protected Directories

Use `urlsReserved` to protect sensitive directories:

```javascript
app.use(koaClassicServer(__dirname + '/www', {
  urlsReserved: ['/config', '/private', '/.git', '/node_modules']
}));
```

### XSS Protection

All filenames and paths in directory listings are HTML-escaped to prevent XSS attacks.

## Error Handling

koa-classic-server properly handles errors:

- **404** - File/directory not found
- **403** - Forbidden (path traversal attempts, reserved directories)
- **500** - Template rendering errors, file access errors

## Testing

```bash
# Run all tests
npm test

# Run security tests only
npm run test:security
```

## Middleware Behavior

### Directory Handling

1. If `index` file exists → serve index file
2. If `showDirContents: true` → show directory listing
3. If `showDirContents: false` → return 404

### File Handling

1. Check if file extension matches `template.ext`
2. If yes → call `template.render()`
3. If no → serve static file with appropriate MIME type

### Reserved URLs

Requests to reserved paths are passed to the next middleware.

## Migration from 1.1.0

Upgrading is simple! No code changes required:

```bash
npm update koa-classic-server
```

**What changed:**
- 404 status codes now correct (was 200)
- Path traversal blocked (was allowed)
- Template errors return 500 (was crash)

See [CHANGELOG.md](./CHANGELOG.md) for detailed information.

## Complete Documentation

For complete documentation with all features, examples, troubleshooting, and best practices, see [DOCUMENTATION.md](./DOCUMENTATION.md).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Known Limitations

- Reserved URLs only work for first-level directories
- Single index file name (no fallback array)

See [DEBUG_REPORT.md](./DEBUG_REPORT.md) for technical details.

## License

MIT

## Author

Italo Paesano

## Changelog

See [CHANGELOG.md](./CHANGELOG.md)

## Links

- [Full Documentation](./DOCUMENTATION.md)
- [Debug Report](./DEBUG_REPORT.md)
- [Changelog](./CHANGELOG.md)
- [Repository](https://github.com/italopaesano/koa-classic-server)
- [npm Package](https://www.npmjs.com/package/koa-classic-server)

---

**⚠️ Security Notice:** Version 1.2.0 fixes critical vulnerabilities. Update immediately if using 1.1.0 or earlier.
