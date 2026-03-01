# Changelog

All notable changes to koa-classic-server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.1] - 2026-03-01

### 📝 Documentation

- Added dedicated usage example for `useOriginalUrl` (Section 7) with realistic i18n middleware scenario (/it/, /en/, /fr/)
- Added "Advanced hideExtension Scenarios" section (Section 8):
  - Recommended file/directory structure (ASCII tree)
  - Combined `hideExtension` + i18n middleware example with `useOriginalUrl: false`
  - Temporary redirect (302) variant with guidance on 301 vs 302 usage
- Added `hideExtension` and `useOriginalUrl` to the Complete Production Example (Section 11)

### 📦 Package Changes
- **Version**: `2.5.0` → `2.5.1`
- **Semver**: Patch version bump (documentation only, no code changes)

---

## [2.5.0] - 2026-02-28

### ✨ New Feature

#### hideExtension - Clean URLs (mod_rewrite-like)
- **New Option**: `hideExtension: { ext: '.ejs', redirect: 301 }`
- **Purpose**: Hide file extensions from URLs for SEO-friendly clean URLs
- **Clean URL Resolution**: `/about` → serves `about.ejs` (when file exists)
- **Extension Redirect**: `/about.ejs` → 301 redirect to `/about` (preserves query string)
- **Index File Redirect**: `/index.ejs` → redirect to `/`, `/section/index.ejs` → redirect to `/section/`
- **Conflict Resolution**: `.ejs` file wins over both directories and extensionless files with same base name
- **Case-Sensitive**: Extension matching is case-sensitive (`.ejs` ≠ `.EJS`)
- **No Interference**: URLs with other extensions (`.css`, `.png`, etc.) pass through normally
- **Trailing Slash**: `/about/` always means directory, never resolves to file
- **Redirect uses `ctx.originalUrl`**: Preserves URL prefixes from upstream middleware (i18n, routing)

#### Input Validation
- `hideExtension: true` → throws Error (must be an object)
- `hideExtension: {}` → throws Error (missing `ext`)
- `hideExtension: { ext: '' }` → throws Error (empty ext)
- `hideExtension: { ext: 'ejs' }` → warning + auto-normalizes to `.ejs`
- `hideExtension: { ext: '.ejs', redirect: 'abc' }` → throws Error (redirect must be number)

#### Integration with Existing Options
- **urlsReserved**: Checked before `hideExtension`, no interference
- **urlPrefix**: `hideExtension` works on path after prefix removal
- **useOriginalUrl**: Resolution follows setting; redirect always uses `ctx.originalUrl`
- **template**: Resolved files pass through template engine normally
- **method**: `hideExtension` only applies to allowed HTTP methods

### 🧪 Testing
- Added `__tests__/hideExtension.test.js` with 31 tests covering:
  - Clean URL resolution (single and multi-level paths)
  - Extension redirect (301/302, query string preservation)
  - Directory/file conflict resolution
  - Trailing slash behavior
  - Extensionless file conflict
  - Index file redirect (`/index.ejs` → `/`)
  - `urlsReserved` interaction
  - `useOriginalUrl` interaction (redirect preserves prefix)
  - Case-sensitive matching
  - No interference with other extensions
  - Template engine integration
  - Input validation (7 validation tests)
- All 278 existing tests still pass (zero regressions)

### 📦 Package Changes
- **Version**: `2.4.0` → `2.5.0`
- **Semver**: Minor version bump (new feature, backward compatible)

---

## [2.4.0] - 2026-02-28

### 🐛 Bug Fix

#### Fixed Symlink Support in Index File Discovery and Directory Listing
- **Issue**: On systems where served files are symbolic links (NixOS buildFHSEnv, Docker bind mounts, `npm link`, Capistrano-style deploys), `findIndexFile()` failed because `dirent.isFile()` returns `false` for symlinks. This caused `GET /` to show directory listing instead of rendering the index file, and `GET /index.ejs` to return 404.
- **Impact**: HIGH - Server unusable on NixOS/buildFHSEnv and similar environments
- **Fix**: Added `isFileOrSymlinkToFile()` / `isDirOrSymlinkToDir()` helpers that follow symlinks via `fs.promises.stat()` only when `dirent.isSymbolicLink()` is true, adding zero overhead for regular files.
- **Code**: `index.cjs` - new helpers + `findIndexFile()` + `show_dir()`

### ✨ Improvements

#### Directory Listing Symlink Indicators
- Symlinks to files/directories show `( Symlink )` label next to the name
- Broken/circular symlinks show `( Broken Symlink )` label (name visible but not clickable)
- Symlinks resolved to effective type for MIME and size display (e.g. symlink to dir shows `DIR`)
- Sorting uses effective type (symlink-to-dir sorts with directories)

### 🧪 Testing
- Added `__tests__/symlink.test.js` with 17 tests covering:
  - Regular file as index (regression)
  - Symlink to file as index (string and RegExp patterns)
  - Direct GET to symlinked file
  - EJS template via symlink
  - Symlink to directory (listing and file access)
  - Broken and circular symlinks
  - Directory listing indicators (`( Symlink )`, `( Broken Symlink )`)
  - Regular file regression (no false symlink indicator)
- All 187 existing tests still pass (zero regressions)

### 📦 Package Changes
- **Semver**: Minor version bump (new feature, backward compatible)

---

## [2.3.0] - 2026-01-03

### 🔄 Renamed Options (with Backward Compatibility)

#### Renamed Caching Options for Clarity
- **Old Names** (DEPRECATED): `enableCaching`, `cacheMaxAge`
- **New Names**: `browserCacheEnabled`, `browserCacheMaxAge`
- **Reason**: Improved clarity - these options specifically control browser-side HTTP caching
- **Backward Compatible**: Old names still work but display deprecation warnings

#### Deprecation Warnings
When using deprecated option names, a warning is displayed on the terminal:
```
[koa-classic-server] DEPRECATION WARNING: The "enableCaching" option is deprecated and will be removed in future versions.
  Current usage: enableCaching: true
  Recommended:   browserCacheEnabled: true
  Please update your configuration to use the new option name.
```

### 📝 Documentation Updates

- Updated README.md with new option names
- Updated JSDoc comments in index.cjs
- Added deprecation notes in Options table
- All examples updated to use new names

### 🔧 Changes

- **index.cjs**: Lines 109-135 - Added backward compatibility logic with deprecation warnings
- **index.cjs**: Lines 47-58 - Updated JSDoc comments
- **index.cjs**: Lines 350, 361 - Updated code to use new option names
- **README.md**: Updated all references to use new names, added deprecation notes
- **package.json**: Version bumped from `2.2.0` to `2.3.0`

### ⚠️ Migration Guide

**No immediate changes required** - old option names still work.

**Recommended migration:**

```javascript
// Old (still works, but deprecated)
app.use(koaClassicServer('/public', {
  enableCaching: true,
  cacheMaxAge: 3600
}));

// New (recommended)
app.use(koaClassicServer('/public', {
  browserCacheEnabled: true,
  browserCacheMaxAge: 3600
}));
```

**Timeline:**
- **v2.3.0**: Old names work with deprecation warnings
- **Future versions**: Old names may be removed (will be announced in advance)

### 📦 Package Changes

- **Version**: `2.2.0` → `2.3.0`
- **Semver**: Minor version bump (new feature names, backward compatible)

---

## [2.2.0] - 2026-01-03

### ✨ Features

#### Added useOriginalUrl Option
- **New Option**: `useOriginalUrl` (Boolean, default: `true`)
- **Purpose**: Controls URL resolution for file serving - use `ctx.originalUrl` (immutable) or `ctx.url` (mutable)
- **Use Case**: Compatibility with URL rewriting middleware (i18n, routing)
- **Backward Compatible**: Default value `true` maintains existing behavior

#### URL Rewriting Middleware Support
- **Problem Solved**: koa-classic-server previously used `ctx.href` (based on `ctx.originalUrl`), which caused 404 errors when middleware rewrites URLs by modifying `ctx.url`
- **Solution**: Set `useOriginalUrl: false` to use the rewritten URL from `ctx.url` instead
- **Example**: i18n middleware that strips language prefixes (`/it/page.html` → `/page.html`)

### 📝 Documentation

- Added comprehensive `useOriginalUrl` documentation in README.md
- Added JSDoc comments in index.cjs
- Included practical i18n middleware example
- Added option to API reference table

### 🔧 Changes

- **index.cjs**: Line 108 - Added `useOriginalUrl` option initialization
- **index.cjs**: Lines 117-125 - Modified URL construction logic to support both `ctx.originalUrl` and `ctx.url`
- **README.md**: Added detailed section explaining `useOriginalUrl` with examples
- **package.json**: Version bumped from `2.1.4` to `2.2.0`

### 💡 Usage Example

```javascript
// i18n middleware example
app.use(async (ctx, next) => {
  if (ctx.path.match(/^\/it\//)) {
    ctx.url = ctx.path.replace(/^\/it/, ''); // /it/page.html → /page.html
  }
  await next();
});

app.use(koaClassicServer('/www', {
  useOriginalUrl: false // Use rewritten URL
}));
```

### ⚠️ Migration Notes

**No breaking changes** - this is a backward-compatible release.

- **Default behavior unchanged**: `useOriginalUrl` defaults to `true`
- **No code changes required** for existing implementations
- **New feature**: Set `useOriginalUrl: false` if you use URL rewriting middleware

### 📦 Package Changes

- **Version**: `2.1.4` → `2.2.0`
- **Semver**: Minor version bump (new feature, backward compatible)

---

## [2.1.3] - 2025-11-25

### 🔧 Configuration Changes

#### Changed Default Caching Behavior
- **Change**: `enableCaching` default value changed from `true` to `false`
- **Rationale**: Better development experience - changes are immediately visible without cache invalidation
- **Production Impact**: **Users should explicitly set `enableCaching: true` in production environments**
- **Benefits in Production**:
  - 80-95% bandwidth reduction
  - Faster page loads with 304 Not Modified responses
  - Reduced server load
- **Code**: `index.cjs:107`

### 📝 Documentation Improvements

#### Enhanced Caching Documentation
- Added comprehensive production recommendations in README.md
- Added inline code comments explaining the default behavior
- Clear guidance on when to enable caching (development vs production)
- **Files**: `README.md`, `index.cjs`

### ⚠️ Migration Notice

**IMPORTANT**: If you are upgrading from 2.1.2 or earlier and rely on HTTP caching:

```javascript
// You must now explicitly enable caching in production
app.use(koaClassicServer(__dirname + '/public', {
  enableCaching: true  // ← Add this for production environments
}));
```

**Development**: No changes needed - the new default (`false`) is better for development.

**Production**: Explicitly set `enableCaching: true` to maintain previous behavior and performance benefits.

### 📦 Package Changes

- **Version**: `2.1.2` → `2.1.3`

---

## [2.1.2] - 2025-11-24

### 🎨 Features

#### Sortable Directory Columns
- Apache2-like directory listing with clickable column headers
- Sort by Name, Type, or Size (ascending/descending)
- Fixed navigation bug after sorting

#### File Size Display
- Human-readable file sizes (B, KB, MB, GB, TB)
- Proper formatting and precision

#### HTTP Caching
- ETag and Last-Modified headers
- 304 Not Modified responses
- 80-95% bandwidth reduction

### 🧪 Testing
- 153 tests passing
- Comprehensive test coverage

---

## [2.1.1] - 2025-11-23

### 🚀 Production Release

- Async/await implementation
- Non-blocking I/O
- Performance optimizations
- Flow documentation

---

## [1.2.0] - 2025-11-17

### 🎉 SECURITY & BUG FIX RELEASE

This release contains **critical security fixes** and important bug fixes. All users should upgrade immediately.

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

- **Version**: `1.1.0` → `1.2.0`
- **Description**: Enhanced with security fixes
- **Keywords**: Added `secure`, `middleware`, `file-server`, `directory-listing`
- **Scripts**: Added `test:security` command

### ⚠️ Breaking Changes

**None** - This is a backwards-compatible release. However, behavior changes for security:

1. **404 Status Codes**: Now properly returns 404 instead of 200 for missing resources
2. **Path Traversal**: Requests with `../` now return 403 Forbidden instead of allowing access
3. **Error Handling**: Template errors return 500 instead of crashing the server

These changes fix bugs and security issues. The new behavior is correct and standards-compliant.

### 🔄 Migration Guide

No code changes required! Simply update:

```bash
npm update koa-classic-server
```

**Recommended**: Verify that:
1. `rootDir` is an absolute path (e.g., `__dirname + '/public'`)
2. Your error handling expects proper 404/403/500 status codes
3. Your tests pass with the new behavior

### 📊 Statistics

- **Lines of code fixed**: ~200
- **Security vulnerabilities fixed**: 2 critical
- **Bugs fixed**: 6
- **Tests added**: 12 security tests
- **Documentation added**: 2000+ lines
- **Test coverage**: 71 tests passing

### 🙏 Credits

- **Author**: Italo Paesano
- **Security Audit**: Comprehensive code analysis
- **Testing**: Jest & Supertest

---

## [1.1.0] - Previous Release

### Features
- Basic static file serving
- Directory listing
- Template engine support
- URL prefixes
- Reserved URLs

### Known Issues (Fixed in 1.2.0)
- Path traversal vulnerability ⚠️ CRITICAL
- Missing 404 status codes
- Unhandled template errors ⚠️ CRITICAL
- Race condition in file access
- Fragile file extension extraction
- Missing error handling

---

## Links

- [Full Documentation](./DOCUMENTATION.md)
- [Debug Report](./DEBUG_REPORT.md)
- [Repository](https://github.com/italopaesano/koa-classic-server)
- [npm Package](https://www.npmjs.com/package/koa-classic-server)

---

**⚠️ Security Notice**: Version 1.2.0 fixes critical vulnerabilities. Update immediately if using 1.1.0 or earlier.
