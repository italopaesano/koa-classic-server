const Koa = require('koa');
const koaClassicServer = require('./index.cjs');
const ejs = require('ejs');
const path = require('path');

const app = new Koa();
const port = 3000;

// IMPORTANTE: Cambia questo path con la directory dove hai i tuoi file
const publicDir = path.join(__dirname, 'public');

// Template render function
const templateRender = async (ctx, next, filePath) => {
  try {
    // Renderizza il file EJS
    const html = await ejs.renderFile(filePath, {
      // Dati passati al template
      filePath: filePath,
      title: 'My Application',
      user: ctx.state.user || { name: 'Guest' },
      path: ctx.path,
      query: ctx.query,
      timestamp: new Date().toISOString()
    });

    ctx.type = 'text/html';
    ctx.body = html;
  } catch (error) {
    // Log dell'errore per debugging
    console.error('❌ Template rendering error:', error);

    ctx.status = 500;
    ctx.type = 'text/html';
    ctx.body = `
      <h1>Template Error</h1>
      <pre>${error.message}</pre>
      <p>File: ${filePath}</p>
    `;
  }
};

// Configurazione middleware
app.use(koaClassicServer(publicDir, {
  showDirContents: true,
  template: {
    render: templateRender,
    ext: ['ejs', 'EJS']  // ✅ CORRETTO - array con parentesi quadre
  }
}));

app.listen(port, () => {
  console.log(`✅ Server started on http://localhost:${port}`);
  console.log(`📁 Serving files from: ${publicDir}`);
  console.log(`🎨 EJS templates enabled for .ejs and .EJS files`);
});
