# Changelog

All notable changes to koa-smart-server (formerly koa-classic-server) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-11-17

### 🎉 MAJOR RELEASE: koa-classic-server → koa-smart-server

This is a major release with significant security fixes and improvements. The module has been renamed from `koa-classic-server` to `koa-smart-server` to reflect the enhanced security and reliability.

### 🔒 Security Fixes (CRITICAL)

#### Fixed Path Traversal Vulnerability
- **Issue**: Attackers could access files outside the served directory using `../` sequences
- **Impact**: CRITICAL - Unauthorized file access
- **Fix**: Added path normalization and validation to ensure all file access stays within `rootDir`
- **Code**: `index.cjs:106-124`

#### Fixed Template Rendering Crash
- **Issue**: Unhandled errors in template rendering could crash the entire server
- **Impact**: CRITICAL - Denial of Service
- **Fix**: Added try-catch around template render calls with proper error handling
- **Code**: `index.cjs:195-205`

### ✅ Bug Fixes

#### Fixed HTTP Status Code 404
- **Issue**: Missing files returned HTML "Not Found" with HTTP 200 status instead of 404
- **Impact**: HIGH - Violates HTTP standards, affects SEO, breaks caching
- **Fix**: Properly set `ctx.status = 404` when resources are not found
- **Locations**:
  - `index.cjs:130` - File/directory not found
  - `index.cjs:158` - Directory listing disabled

#### Fixed Race Condition in File Access
- **Issue**: Files could be deleted between existence check and reading, causing uncaught errors
- **Impact**: HIGH - Server crashes on file access errors
- **Fix**: Added `fs.promises.access()` check before streaming files with error handling
- **Code**: `index.cjs:208-216`

#### Fixed File Extension Extraction
- **Issue**: Using `split(".")` failed for:
  - Files without extension (`README`)
  - Hidden files (`.gitignore`)
  - Paths with dots (`/folder.backup/file`)
- **Impact**: HIGH - Template rendering activated incorrectly
- **Fix**: Use `path.extname()` for robust extension extraction
- **Code**: `index.cjs:192`

#### Fixed Directory Read Errors
- **Issue**: `fs.readdirSync()` could throw unhandled errors (permissions, deleted directories)
- **Impact**: MEDIUM - Server crashes on directory access errors
- **Fix**: Added try-catch with user-friendly error message
- **Code**: `index.cjs:245-264`

#### Fixed Content-Disposition Header
- **Issue**: Filename in Content-Disposition header was not quoted and included full path
- **Impact**: MEDIUM - Download issues with special characters in filenames
- **Fix**:
  - Use only basename (not full path)
  - Quote filename and escape quotes
- **Code**: `index.cjs:234-239`

### 🎨 Improvements

#### Added Input Validation
- Validate `rootDir` is a non-empty string
- Validate `rootDir` is an absolute path
- Throw meaningful errors for invalid input

#### Added XSS Protection
- HTML-escape all user-controlled content in directory listings
- Escapes filenames, paths, and MIME types
- Prevents XSS attacks through malicious filenames

#### Improved Error Messages
- More descriptive error messages
- Console logging for debugging
- Stream error handling

#### Code Quality
- Fixed usage of `Array()` constructor to literal syntax `[]`
- Better code organization and comments
- Improved HTML output formatting

### 📝 Added Files

- **`__tests__/security.test.js`**: Comprehensive security and bug tests
- **`DEBUG_REPORT.md`**: Detailed analysis of all bugs and fixes
- **`DOCUMENTATION.md`**: Complete documentation (1500+ lines)
- **`CHANGELOG.md`**: This file

### 🧪 Testing

- All 71 tests passing
- Added security test suite
- Path traversal tests
- Template error handling tests
- Status code validation tests
- Race condition tests
- Content-Disposition tests

### 📦 Package Changes

- **Name**: `koa-classic-server` → `koa-smart-server`
- **Version**: `1.1.0` → `2.0.0`
- **Description**: Enhanced with security focus
- **Keywords**: Added `secure`, `middleware`, `file-server`, `directory-listing`
- **Scripts**: Added `test:security` command

### ⚠️ Breaking Changes

#### Package Name
```bash
# Old
npm install koa-classic-server

# New
npm install koa-smart-server
```

#### Behavior Changes
1. **404 Status Codes**: Now properly returns 404 instead of 200 for missing resources
2. **Path Traversal**: Requests with `../` now return 403 Forbidden instead of allowing access
3. **Error Handling**: Template errors return 500 instead of crashing the server

These are breaking changes only if you relied on the buggy behavior. The new behavior is correct and standards-compliant.

### 🔄 Migration Guide

#### From koa-classic-server 1.x to koa-smart-server 2.0

**Step 1**: Update package.json
```diff
{
  "dependencies": {
-   "koa-classic-server": "^1.1.0"
+   "koa-smart-server": "^2.0.0"
  }
}
```

**Step 2**: Update imports (no change needed if using same import name)
```javascript
// Both work the same way
const koaClassicServer = require('koa-smart-server');
// or
import koaClassicServer from 'koa-smart-server';
```

**Step 3**: Verify rootDir is absolute
```javascript
// ❌ Old (relative path)
app.use(koaClassicServer('./public'));

// ✅ New (absolute path required)
app.use(koaClassicServer(__dirname + '/public'));
// or
app.use(koaClassicServer(path.join(__dirname, 'public')));
```

**Step 4**: Update error handling expectations
```javascript
// Status codes now correct
// 404 for missing files (was 200)
// 403 for forbidden paths (was 200)
// 500 for server errors (was crash)
```

**Step 5**: Test your application
```bash
npm test
```

### 📊 Statistics

- **Lines of code fixed**: ~200
- **Security vulnerabilities fixed**: 2 critical
- **Bugs fixed**: 6
- **Tests added**: 12 security tests
- **Documentation added**: 1500+ lines
- **Test coverage**: 71 tests passing

### 🙏 Credits

- **Original Author**: Italo Paesano
- **Security Audit**: Claude Code Analysis
- **Testing**: Comprehensive test suite with Jest & Supertest

---

## [1.1.0] - Previous Release

### Features
- Basic static file serving
- Directory listing
- Template engine support
- URL prefixes
- Reserved URLs

### Known Issues (Fixed in 2.0.0)
- Path traversal vulnerability
- Missing 404 status codes
- Unhandled template errors
- Race condition in file access
- Fragile file extension extraction
- Missing error handling

---

## Links

- [Full Documentation](./DOCUMENTATION.md)
- [Debug Report](./DEBUG_REPORT.md)
- [Repository](https://github.com/italopaesano/koa-classic-server)
- [npm Package](https://www.npmjs.com/package/koa-smart-server)

---

**Note**: Version 2.0.0 is a recommended security update. All users should upgrade immediately.
