## 🎨 Template Engine Documentation - Beta 6

### What's New

✅ **Complete Template Engine Guide** - New comprehensive documentation
✅ **146 Tests Passing** - Full test coverage including EJS integration
✅ **Improved README** - Better examples and updated badges
✅ **Koa v2 & v3 Compatible** - Works with both versions via peerDependencies

---

## 📚 Documentation Improvements

### New Documentation

**TEMPLATE_ENGINE_GUIDE.md** - Complete guide (~800 lines) including:

- **EJS Integration** - 10+ practical examples
  - Simple templates with variables
  - Loops and conditionals
  - HTML escaping and XSS protection
  - Complex e-commerce templates
  - Database integration
  - Layout system

- **Other Template Engines**
  - Pug integration guide
  - Handlebars integration guide
  - Nunjucks integration guide

- **Best Practices**
  - Error handling
  - Template caching
  - Common data patterns
  - File-based routing

- **Advanced Topics**
  - Database integration examples
  - Layout inheritance
  - Performance optimization
  - Troubleshooting guide

### README Updates

- ✓ Test badge: 71 → 146 passing tests
- ✓ Enhanced EJS example with detailed code
- ✓ Link to new template engine guide
- ✓ Updated feature descriptions

---

## 🧪 Test Coverage

**146 tests passing:**
- 105 original tests (index, security, performance)
- 13 EJS template engine tests
- 28 auto-generated file tests

**Test Categories:**
- ✓ Security tests (path traversal, XSS, race conditions)
- ✓ EJS rendering tests (variables, loops, conditionals, escaping)
- ✓ Index option tests (string, array, RegExp)
- ✓ Performance benchmarks

---

## 📦 Features

- 🗂️ **Directory Listing** - Apache-style browseable directories
- 📄 **Static File Serving** - Automatic MIME type detection
- 🎨 **Template Engine Support** - EJS, Pug, Handlebars, Nunjucks
- 🔒 **Security** - Path traversal protection, XSS prevention
- ⚙️ **Configurable** - URL prefixes, reserved paths, index files
- 🧪 **Well-Tested** - 146 comprehensive tests
- 📦 **Koa v2 & v3** - Compatible with both major versions

---

## 🚀 Installation

```bash
# Install latest prerelease
npm install koa-classic-server@next

# Or install specific beta version
npm install koa-classic-server@2.0.0-beta.6
```

## 📖 Quick Start with EJS

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');
const ejs = require('ejs');
const fs = require('fs').promises;

const app = new Koa();

app.use(koaClassicServer(__dirname + '/views', {
  template: {
    ext: ['ejs'],
    render: async (ctx, next, filePath) => {
      const templateContent = await fs.readFile(filePath, 'utf-8');
      const html = ejs.render(templateContent, {
        title: 'My App',
        user: ctx.state.user || { name: 'Guest' }
      });
      ctx.type = 'text/html';
      ctx.body = html;
    }
  }
}));

app.listen(3000);
```

---

## 📚 Complete Documentation

- [DOCUMENTATION.md](./docs/DOCUMENTATION.md) - Complete API reference
- [TEMPLATE_ENGINE_GUIDE.md](./docs/TEMPLATE_ENGINE_GUIDE.md) - Template engine integration guide
- [INDEX_OPTION_PRIORITY.md](./docs/INDEX_OPTION_PRIORITY.md) - Index option behavior
- [EXAMPLES_INDEX_OPTION.md](./docs/EXAMPLES_INDEX_OPTION.md) - RegExp examples
- [PERFORMANCE_ANALYSIS.md](./docs/PERFORMANCE_ANALYSIS.md) - Performance analysis

---

## 🔄 Changes Since Beta 5

### Added
- Complete template engine documentation guide (TEMPLATE_ENGINE_GUIDE.md)
- Advanced EJS examples (database, layouts, routing)
- Integration guides for Pug, Handlebars, Nunjucks
- Best practices section for template engines
- Troubleshooting section
- Performance optimization tips

### Changed
- Updated README.md with 146 test badge
- Improved EJS example in README with detailed implementation
- Enhanced feature descriptions
- Added link to template engine guide

### Version History
- **v2.0.0-beta.6** - Template engine documentation
- **v2.0.0-beta.5** - EJS integration and tests (6 templates + 13 tests)
- **v2.0.0-beta.4** - Koa v2 & v3 compatibility (peerDependencies)

---

**Note:** This is a prerelease version. Install with `npm install koa-classic-server@next`

**Full Changelog**: https://github.com/italopaesano/koa-classic-server/compare/v2.0.0-beta.5...v2.0.0-beta.6
