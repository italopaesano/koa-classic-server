# Release Notes - koa-classic-server v2.1.4

**Release Date:** December 4, 2025
**Type:** Patch Release (Bug Fix)

---

## 🐛 Bug Fixes

### Critical Fix: Browser Heuristic Caching Issue

**Problem:**
When `enableCaching: false` was set, the server did not send explicit anti-cache headers. This caused modern browsers to use heuristic caching, serving stale content even though caching was explicitly disabled. Users reported not seeing updated files despite having caching disabled.

**Solution:**
Added explicit anti-cache HTTP headers when `enableCaching: false`:
```http
Cache-Control: no-cache, no-store, must-revalidate
Pragma: no-cache
Expires: 0
```

**Impact:**
- ✅ Files are now always fresh when caching is disabled (development environments)
- ✅ No impact on production when `enableCaching: true`
- ✅ Fixes reported issue with stale file content

**Code Changes:**
`index.cjs` lines 355-361

---

## ✅ Testing Improvements

### Comprehensive Caching Test Suite

Added **14 new test cases** (total: 22 tests) covering all caching scenarios:

#### 1. Custom `cacheMaxAge` Values (3 tests)
- `cacheMaxAge: 7200` (2 hours)
- `cacheMaxAge: 0` (immediate revalidation)
- `cacheMaxAge: 86400` (1 day)

#### 2. ETag Generation & Validation (2 tests)
- ETag changes when file content is modified
- ETag changes when file size changes

#### 3. Bandwidth Savings (2 tests)
- 304 responses have no body
- Multiple 304 responses correctly save bandwidth

#### 4. MIME Type Support (4 tests)
- HTML files with cache headers
- JSON files with cache headers
- CSS files with cache headers
- JavaScript files with cache headers

#### 5. Template Rendering (1 test)
- Caching does not interfere with template rendering

#### 6. Concurrent Requests (2 tests)
- Multiple concurrent requests generate identical ETags
- Concurrent 304 responses work correctly

**All tests pass:** ✅ 22/22

---

## 📦 Upgrade Instructions

### From v2.1.3 to v2.1.4

```bash
npm update koa-classic-server
```

**No breaking changes.** This is a patch release that fixes a bug and improves test coverage.

---

## 🔄 Before & After Behavior

### Before v2.1.4 (Bug)

```javascript
app.use(koaClassicServer('/public', {
    enableCaching: false  // ❌ Browser may still cache files
}));
```

**Result:** Browser uses heuristic caching → stale files served

### After v2.1.4 (Fixed)

```javascript
app.use(koaClassicServer('/public', {
    enableCaching: false  // ✅ Browser never caches files
}));
```

**Result:** Anti-cache headers sent → fresh files always served

---

## 📊 Recommended Configuration

### Development Environment

```javascript
const koaClassicServer = require('koa-classic-server');

app.use(koaClassicServer(__dirname + '/public', {
    enableCaching: false,  // Always fresh files during development
    showDirContents: true
}));
```

### Production Environment

```javascript
const koaClassicServer = require('koa-classic-server');

app.use(koaClassicServer(__dirname + '/public', {
    enableCaching: true,   // Enable caching for performance
    cacheMaxAge: 86400,    // 24 hours
    showDirContents: false
}));
```

---

## 🔗 Related Issues

This release fixes the issue reported by users where file updates were not visible in the browser despite `enableCaching: false`.

---

## 📝 Full Changelog

### Added
- Explicit anti-cache headers when `enableCaching: false`
- Comprehensive test suite for HTTP caching (22 tests)
- Test coverage for ETag generation and validation
- Test coverage for different MIME types
- Test coverage for concurrent requests with caching

### Fixed
- Browser heuristic caching when `enableCaching: false`
- Stale content being served in development environments

### Changed
- Improved test coverage from 8 to 22 tests for caching functionality

---

## 🙏 Contributors

Special thanks to all users who reported the caching issue and helped identify the problem.

---

## 📚 Documentation

For complete documentation, visit:
- [GitHub Repository](https://github.com/italopaesano/koa-classic-server)
- [npm Package](https://www.npmjs.com/package/koa-classic-server)

---

## 🐛 Report Issues

Found a bug? Please report it at:
https://github.com/italopaesano/koa-classic-server/issues

---

**Previous Release:** [v2.1.3](https://github.com/italopaesano/koa-classic-server/releases/tag/v2.1.3)
**Next Release:** TBA
