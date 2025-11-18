const koa = require("koa");
const app = new koa();
const port = 3000;
const classicServer = require("./index.cjs");
const ejs = require("ejs");
const path = require("path");

// ============================================================
// ESEMPIO 1: Nessun dato passato
// ============================================================
// Template: esempio1-nessun-dato.ejs
// Uso: Non serve passare nessun dato
// URL: http://localhost:3000/esempio1-nessun-dato.ejs

const esempio1 = async (ctx, next, filePath) => {
  try {
    // Nessun dato passato - il template non usa variabili
    ctx.body = await ejs.renderFile(filePath, {});
    ctx.type = 'text/html';
  } catch (error) {
    console.error('Errore:', error.message);
    ctx.status = 500;
    ctx.body = `<h1>Errore</h1><pre>${error.message}</pre>`;
  }
};

// ============================================================
// ESEMPIO 2: Una sola variabile
// ============================================================
// Template: esempio2-una-variabile.ejs
// Uso: Passa solo "nome"
// URL: http://localhost:3000/esempio2-una-variabile.ejs

const esempio2 = async (ctx, next, filePath) => {
  try {
    // Passa UNA variabile
    ctx.body = await ejs.renderFile(filePath, {
      nome: 'Mario'
    });
    ctx.type = 'text/html';
  } catch (error) {
    console.error('Errore:', error.message);
    ctx.status = 500;
    ctx.body = `<h1>Errore</h1><pre>${error.message}</pre>`;
  }
};

// ============================================================
// ESEMPIO 3: Più variabili
// ============================================================
// Template: esempio3-piu-variabili.ejs
// Uso: Passa "nome", "eta", "citta"
// URL: http://localhost:3000/esempio3-piu-variabili.ejs

const esempio3 = async (ctx, next, filePath) => {
  try {
    // Passa PIÙ variabili
    ctx.body = await ejs.renderFile(filePath, {
      nome: 'Mario',
      eta: 30,
      citta: 'Roma'
    });
    ctx.type = 'text/html';
  } catch (error) {
    console.error('Errore:', error.message);
    ctx.status = 500;
    ctx.body = `<h1>Errore</h1><pre>${error.message}</pre>`;
  }
};

// ============================================================
// ESEMPIO 4: Condizionale (if/else)
// ============================================================
// Template: esempio4-condizionale.ejs
// Uso: Passa "autenticato" e "nome"
// URL: http://localhost:3000/esempio4-condizionale.ejs

const esempio4 = async (ctx, next, filePath) => {
  try {
    // Passa variabili per logica condizionale
    ctx.body = await ejs.renderFile(filePath, {
      autenticato: true,  // Cambia in false per vedere il messaggio diverso
      nome: 'Mario'
    });
    ctx.type = 'text/html';
  } catch (error) {
    console.error('Errore:', error.message);
    ctx.status = 500;
    ctx.body = `<h1>Errore</h1><pre>${error.message}</pre>`;
  }
};

// ============================================================
// ESEMPIO 5: Loop (forEach)
// ============================================================
// Template: esempio5-loop.ejs
// Uso: Passa array "prodotti"
// URL: http://localhost:3000/esempio5-loop.ejs

const esempio5 = async (ctx, next, filePath) => {
  try {
    // Passa un array per il loop
    ctx.body = await ejs.renderFile(filePath, {
      prodotti: ['Laptop', 'Mouse', 'Tastiera', 'Monitor']
    });
    ctx.type = 'text/html';
  } catch (error) {
    console.error('Errore:', error.message);
    ctx.status = 500;
    ctx.body = `<h1>Errore</h1><pre>${error.message}</pre>`;
  }
};

// ============================================================
// FUNZIONE RENDER UNIVERSALE
// ============================================================
// Questa funzione sceglie quale esempio usare in base al file

const templateRender = async (ctx, next, filePath) => {
  const fileName = path.basename(filePath);

  // Sceglie la funzione giusta in base al nome del file
  switch(fileName) {
    case 'esempio1-nessun-dato.ejs':
      return esempio1(ctx, next, filePath);

    case 'esempio2-una-variabile.ejs':
      return esempio2(ctx, next, filePath);

    case 'esempio3-piu-variabili.ejs':
      return esempio3(ctx, next, filePath);

    case 'esempio4-condizionale.ejs':
      return esempio4(ctx, next, filePath);

    case 'esempio5-loop.ejs':
      return esempio5(ctx, next, filePath);

    default:
      // Per altri file .ejs, non passa dati
      try {
        ctx.body = await ejs.renderFile(filePath, {});
        ctx.type = 'text/html';
      } catch (error) {
        console.error('Errore:', error.message);
        ctx.status = 500;
        ctx.body = `<h1>Errore</h1><pre>${error.message}</pre>`;
      }
  }
};

// ============================================================
// CONFIGURAZIONE SERVER
// ============================================================

app.use(
  classicServer(
    __dirname + "/public",
    {
      showDirContents: true,
      template: {
        render: templateRender,
        ext: ["ejs", "EJS"],
      },
    }
  )
);

app.listen(port, () => {
  console.log("\n" + "=".repeat(60));
  console.log("✅ SERVER AVVIATO");
  console.log("=".repeat(60));
  console.log(`URL: http://localhost:${port}\n`);

  console.log("📚 ESEMPI DISPONIBILI:");
  console.log("─".repeat(60));
  console.log("1️⃣  Nessun dato:");
  console.log("    http://localhost:3000/esempio1-nessun-dato.ejs");
  console.log("");
  console.log("2️⃣  Una variabile:");
  console.log("    http://localhost:3000/esempio2-una-variabile.ejs");
  console.log("");
  console.log("3️⃣  Più variabili:");
  console.log("    http://localhost:3000/esempio3-piu-variabili.ejs");
  console.log("");
  console.log("4️⃣  Condizionale (if/else):");
  console.log("    http://localhost:3000/esempio4-condizionale.ejs");
  console.log("");
  console.log("5️⃣  Loop (forEach):");
  console.log("    http://localhost:3000/esempio5-loop.ejs");
  console.log("=".repeat(60) + "\n");
});
