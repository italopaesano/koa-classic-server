## 🐛 Bug Fix: Browser Heuristic Caching

Fixed critical issue where browsers cached files even with `enableCaching: false`.

### What's Fixed
When caching was disabled, browsers still cached files using heuristic caching, causing stale content to be served. Now explicit anti-cache headers are sent:
- `Cache-Control: no-cache, no-store, must-revalidate`
- `Pragma: no-cache`
- `Expires: 0`

### Impact
- ✅ Fresh files always served in development (`enableCaching: false`)
- ✅ No changes to production behavior (`enableCaching: true`)
- ✅ Fixes reported stale content issue

## ✅ Testing

Added comprehensive caching test suite:
- **22 tests total** (was 8)
- ETag generation and validation
- Multiple MIME types (HTML, CSS, JS, JSON)
- Concurrent request handling
- Bandwidth savings with 304 responses

**All tests pass:** ✅ 22/22

## 📦 Installation

```bash
npm install koa-classic-server@2.1.4
```

## 🔄 Upgrade

```bash
npm update koa-classic-server
```

**No breaking changes** - safe to upgrade from v2.1.3

## 📚 Full Release Notes

- [English](./RELEASE_NOTES_2.1.4.md)
- [Italiano](./RELEASE_NOTES_2.1.4_IT.md)

---

**Full Changelog**: v2.1.3...v2.1.4
