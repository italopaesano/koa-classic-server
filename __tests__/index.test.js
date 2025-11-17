//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  ATTENZIONE QUESTO TEST NON COPRE SE NEL VISUALIZARE IL CONTENUTO DELLE CARTELLE TUTTO VIENE MOSTRATO COME SI DEVE
//  ATTENZIONE MANCA IL TEST PER TESTARE I MOTORI DI RENDERING COME .ejs
//  ERRORI NOTI:
//  1)QUANDO UNA RISORSA NON VIENE TROVATA IN UNA CARTELLO LO STATO NON È SETTATO SU 404 MA SU 200
//  2)IL PERCORSO RISERVATO UNZIONA SOLO SE NON VI SONO SPAZI NEL NOME 
//  FURURES:
//  A) IMPLEMENTARE UNA ARRAY DI FILE INDEX ,MAGAI DANDO LA POSSIBILITA DI NON DISTINGURE FRA MINUSCOLE EMAIUSCOLE 
//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const Koa = require('koa');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types'); //serve alla funzione getFilesRecursivelySync();
//const {configurations} = require('../customTest/serversToLoad.util'); --> inutile questo serve solo per testari manualmente 

const rootDir = path.join(__dirname, 'publicWwwTest');

// Legge tutti i file ricorsivamente e li memorizza in un array
const filesAndDirArray = getFilesRecursivelySync(rootDir);

// Visualizza l'array risultante
//console.log(filesAndDirArray);

//START option0

// Configuriamo le opzioni per koa-classic-server
const options0 = {  
  urlPrefix: '/public', // Il prefisso URL che il middleware dovrà intercettare
  method: ['GET'],// I metodi HTTP ammessi (default 'GET')
  showDirContents: true,// Se mostrare il contenuto della directory in caso di richiesta ad una cartella
  //index: 'index.html', // Nome del file index da cercare all'interno di una directory (se presente)
};

describe(` koaClassicServer options0: ${JSON.stringify(options0)}`, () => {
  let app;
  let server;

  // Avvia il server prima di eseguire i test
  beforeAll(() => {
    app = new Koa();
    app.use(koaClassicServer(rootDir, options0));    // Monta il middleware
    server = app.listen();// Avvia il server in modo che Supertest possa inviare richieste HTTP
  });
  
  test('controllo che se chiamo un percorso che non esiste mi venga restituito l\'errore apropiato ', async () => {
    // Effettua una richiesta GET sull'endpoint configurato (il prefisso)
    const res = await supertest(server).get('/public/percorso_di_una_cartella_o_file_che_non_esiste_fbrojngbornbo/gbrtbbbrbr/tbrbr/rtbrtbrt');
    expect(res.status).toBe(404); // FIX: Now returns proper 404 status
    expect(res.type).toMatch(/text\/html/);// type sta per mimetype .... restituisce text/plain anche se dovrebbe essere text/html
    expect(res.text.replace(/\s/g, '')).toBe(requestedUrlNotFound().replace(/\s/g, '')); //.replace(/\s/g, '') --> rimuoce gli spazi bianchi e le tabulazioni , il server agiunge degli spazi all'inizio facendo fallire il controllo
  });

  test('controllo che se l\'indirizzo non ricade nel urlPrefix allora debba essere passato al midlware successivo e se non c\'e allora errore 404 not founf', async () => {
    // Effettua una richiesta GET sull'endpoint configurato (il prefisso)
    const res = await supertest(server).get('/percorso al di fuori di url prefix public/gbrtbbbrbr/tbrbr/rtbrtbrt');
    expect(res.status).toBe(404);
    expect(res.type).toMatch("text/plain");// type sta per mimetype .... restituisce text/plain anche se dovrebbe essere text/html
    expect(res.text.replace(/\s/g, '')).toBe("Not Found".replace(/\s/g, '')); //.replace(/\s/g, '') --> rimuoce gli spazi bianchi e le tabulazioni , il server agiunge degli spazi all'inizio facendo fallire il controllo 
  });

  
  // queste rige generaranno test per ogni ile presente nella cartella di test 
  const testFnCallbacks = testAllPathByFileList(filesAndDirArray, () => server, options0);//Genera l'array di callback per i test
  testFnCallbacks.forEach(cb => cb());// Esegui ogni callback per registrare il test nello scope del describe

  afterAll(() => {// Chiude il server dopo aver completato tutti i test
    server.close();
  });  
});

//END option0

//START option1
const options1 = {
  method: ['GET'],
  showDirContents: true,
};

describe(` koaClassicServer options1: ${JSON.stringify(options1)}`, () => {
  let app;
  let server;

  // Avvia il server prima di eseguire i test
  beforeAll(() => {
    app = new Koa();
    app.use(koaClassicServer(rootDir, options1));    // Monta il middleware
    server = app.listen();// Avvia il server in modo che Supertest possa inviare richieste HTTP
  });

  test('controllo che se chiamo un percorso che non esiste mi venga restituito l\'errore apropiato [ANCHE SENZA URL PREFIX] ', async () => {
    // Effettua una richiesta GET sull'endpoint configurato (il prefisso)
    const res = await supertest(server).get('/BTBg h gh /percorso_di_una_cartella_o_file_che_non_esiste_fbrojngbornbo/gbrtbbbrbr/tbrbr/rtbrtbrt');
    expect(res.status).toBe(404); // FIX: Now returns proper 404 status
    expect(res.type).toMatch(/text\/html/);// type sta per mimetype .... restituisce text/plain anche se dovrebbe essere text/html
    expect(res.text.replace(/\s/g, '')).toBe(requestedUrlNotFound().replace(/\s/g, '')); //.replace(/\s/g, '') --> rimuoce gli spazi bianchi e le tabulazioni , il server agiunge degli spazi all'inizio facendo fallire il controllo
  });
  
  const testFnCallbacks = testAllPathByFileList(filesAndDirArray, () => server, options1);//Genera l'array di callback per i test
  testFnCallbacks.forEach(cb => cb());// Esegui ogni callback per registrare il test nello scope del describe

  afterAll(() => {// Chiude il server dopo aver completato tutti i test
    server.close();
  });  
});

//END option1

//STASRT option2
const options2 = {
  method: ['GET'],
  showDirContents: false,
  index: 'index.html',
};

describe(` koaClassicServer options2: ${JSON.stringify(options2)}`, () => {
  let app;
  let server;

  // Avvia il server prima di eseguire i test
  beforeAll(() => {
    app = new Koa();
    app.use(koaClassicServer(rootDir, options2));    // Monta il middleware
    server = app.listen();// Avvia il server in modo che Supertest possa inviare richieste HTTP
  });
  
  const testFnCallbacks = testAllPathByFileList(filesAndDirArray, () => server, options2);//Genera l'array di callback per i test
  testFnCallbacks.forEach(cb => cb());// Esegui ogni callback per registrare il test nello scope del describe

  afterAll(() => {// Chiude il server dopo aver completato tutti i test
    server.close();
  });  
});
//END option2

//STASRT option3
const options3 = {
  method: ['GET'],
  showDirContents: false,
  urlsReserved : Array('/percorso_riservato', '/percorso riservato con spazi')
};

describe(` koaClassicServer options2: ${JSON.stringify(options2)}`, () => {
  let app;
  let server;

  // Avvia il server prima di eseguire i test
  beforeAll(() => {
    app = new Koa();
    app.use(koaClassicServer(rootDir, options3));    // Monta il middleware
    server = app.listen();// Avvia il server in modo che Supertest possa inviare richieste HTTP
  });

  test('controllo che se l\'indirizzo ricate di un percorso riservato allora venga passato il tutto al midlware successivo e in questo caso errore not ound', async () => {
    // Effettua una richiesta GET sull'endpoint configurato (il prefisso)
    const res = await supertest(server).get('/percorso_riservato/ciao.txt');
    expect(res.status).toBe(404);
    expect(res.type).toMatch("text/plain");// type sta per mimetype .... restituisce text/plain anche se dovrebbe essere text/html
    expect(res.text.replace(/\s/g, '')).toBe("Not Found".replace(/\s/g, '')); //.replace(/\s/g, '') --> rimuoce gli spazi bianchi e le tabulazioni , il server agiunge degli spazi all'inizio facendo fallire il controllo 
  });

/*   test('lo stesso del precedente ma questa volta il percorso riservato con spazi', async () => {
    // Effettua una richiesta GET sull'endpoint configurato (il prefisso)
    const res = await supertest(server).get('/percorso riservato con spazi/ciao.txt');
    expect(res.status).toBe(404);
    expect(res.type).toMatch("text/plain");// type sta per mimetype .... restituisce text/plain anche se dovrebbe essere text/html
    expect(res.text.replace(/\s/g, '')).toBe("Not Found".replace(/\s/g, '')); //.replace(/\s/g, '') --> rimuoce gli spazi bianchi e le tabulazioni , il server agiunge degli spazi all'inizio facendo fallire il controllo 
  }); */

  
  const testFnCallbacks = testAllPathByFileList(filesAndDirArray, () => server, options2);//Genera l'array di callback per i test
  testFnCallbacks.forEach(cb => cb());// Esegui ogni callback per registrare il test nello scope del describe

  afterAll(() => {// Chiude il server dopo aver completato tutti i test
    server.close();
  });  
});
//END option3

/* const options0 = {
  // Il prefisso URL che il middleware dovrà intercettare
  urlPrefix: '/public',
  // I metodi HTTP ammessi (default 'GET')
  method: ['GET'],
  // Se mostrare il contenuto della directory in caso di richiesta ad una cartella
  showDirContents: true,
  // Nome del file index da cercare all'interno di una directory (se presente)
  //index: 'index.html',
}; */




// questa funzione serve per leggere ricorsivamente il contenuto di una cartella in modo da leggere il contenuto oferto via __tests__/publicWwwTest e confrontarlo con quello via http
//in linux anhe le directory sono file quindi mi salvo  :)
function getFilesRecursivelySync(dir) {
  let results = [];
  // Leggiamo il contenuto della directory, ottenendo anche informazioni sui file e le cartelle
  const list = fs.readdirSync(dir, { withFileTypes: true });
  
  list.forEach((entry) => {
    const fullPath = path.join(dir, entry.name);
    entry.fullPath = fullPath;
    if (entry.isDirectory()) {
      // Se l'entry è una cartella, la elaboriamo ricorsivamente
      entry.type = 'directory';
      results.push(entry);// inserisco anche la directory stessa nell'elenco
      results = results.concat(getFilesRecursivelySync(fullPath));
    } else if (entry.isFile()) {
      // Se l'entry è un file, lo aggiungiamo all'array dei risultati
      const mimeType = mime.lookup(entry.name) || 'false';//false --> mimetype non riconosciuto , cosi lo trasmette il server , da approfondire
      entry.type = 'file';
      entry.mimeType = mimeType;
      results.push(entry);
    }
  });
  
  return results;
}

//ATTENZIONE questa funzione è esattamente identicaa a quella contenuta nel file index.cjs serve per confrontarla e vedere se il risultato combacia
function requestedUrlNotFound() {
  return `
      <!DOCTYPE html>
          <html>
          <head>
              <meta charset="UTF-8">
              <meta http-equiv="X-UA-Compatible" content="IE=edge">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>URL not found</title>
          </head>
          <body>
          <h1>Not Found</h1>
          <h3>The requested URL was not found on this server.</h3>
          </body>
          </html>
      `;
} // function requestedUrlNotFound(){

//ATENZIONE per questa funzione guardare la descrizione sotto : per funzionare deve evvere chiamata nel seguente modo : 
// const testFnCallbacks = testAllPathByFileList(filesAndDirArray, () => server, options0);//Genera l'array di callback per i test
// testFnCallbacks.forEach(cb => cb());// Esegui ogni callback per registrare il test nello scope del describe

function testAllPathByFileList(filesAndDirArray, getServer, options) {
  return filesAndDirArray.map((entry, index) => {
    const relativePath = path.relative(rootDir, entry.fullPath);
    // Restituisci una funzione che, se chiamata, definisce un test.
    return () => {
      test(
        `testo l'elemento ${index} (type: ${entry.type}, name: ${entry.name}) con percorso: ${relativePath}`,
        async () => {
          const server = getServer(); // Usa il getter per ottenere il server al momento dell'esecuzione
          const url = path.join(options.urlPrefix || '/', relativePath);
          const res = await supertest(server).get(url);

          // Se l'entry è un file, controlla il contenuto e il MIME type
          if (entry.type === 'file') {
            expect(res.status).toBe(200);
            const content = fs.readFileSync(entry.fullPath, 'utf8');
            expect(res.type).toBe(entry.mimeType);
            expect(res.text).toBe(content);
          } else {//è una directory
            if( options.showDirContents === false ){
              // FIX: Quando directory listing è disabilitato, restituisce 404
              expect(res.status).toBe(404);
              expect(res.type).toBe('text/html');
              expect(res.text.replace(/\s/g, '')).toBe(requestedUrlNotFound().replace(/\s/g, '')); //.replace(/\s/g, '') --> rimuoce gli spazi bianchi e le tabulazioni , il server agiunge degli spazi all'inizio facendo fallire il controllo
            } else {
              expect(res.status).toBe(200);
              expect(res.type).toBe('text/html');
              expect(res.text).toContain('<!DOCTYPE html>');
            }
          }
        }
      );
    };
  });
}

/* ATTENZIONE QUESTA FUNZIONE [function testAllPathByFileList] È FATTA IN MANIERA STRANA PER AVER RISOLTO IL PROBLEMA DOPO LUNGA DISCUSSIONE CON CHATGPT

Spiegazione

    Incapsulamento:
    In testAllPathByFileList usiamo map per creare un array in cui ogni elemento è una funzione (callback) che, se invocata, definisce un test usando test().
    Così facendo, non eseguiamo subito test(), ma ne restituiamo la definizione da chiamare in seguito.

    Uso del Getter:
    Passando () => server come secondo argomento, assicuriamo che al momento dell'esecuzione di ogni callback il server sia già inizializzato.

    Registrazione dei Test:
    Quando chiamiamo testFnCallbacks.forEach(cb => cb()); nello scope del blocco describe, ogni callback viene invocata e i test vengono definiti correttamente per Jest.

Idea di Base

    Genera un array di callback:
    Crea una funzione che, dato l'array dei file e directory (o dati dinamici), restituisca un array di funzioni. Ogni funzione (callback) quando invocata definirà un test tramite test() ed eseguirà le relative asserzioni con expect().

    Esegui le callback nello scope del describe:
    All'interno del blocco describe (dove Jest raccoglie i test) iteri sull'array di callback e invochi ciascuna, in modo che i test vengano registrati correttamente. In questo modo, l'errore "Your test suite must contain at least one test" non si verificherà perché i test saranno già stati definiti nello scope globale del describe

//END CONSIDERAZIONE IMPORTANTE
    */


/* 
OLD//


function testAllPathByFileList(filesAndDirArray, getServer, options) {
  return filesAndDirArray.map((entry, index) => {
    const relativePath = path.relative(rootDir, entry.fullPath);
    // Restituisci una funzione che, se chiamata, definisce un test.
    return () => {
      test(
        `testo l'elemento ${index} (type: ${entry.type}, name: ${entry.name}) con percorso: ${relativePath}`,
        async () => {
          const server = getServer(); // Usa il getter per ottenere il server al momento dell'esecuzione
          const url = path.join(options.urlPrefix || '/', relativePath);
          const res = await supertest(server).get(url);
          expect(res.status).toBe(200);
          // Se l'entry è un file, controlla il contenuto e il MIME type
          if (entry.type === 'file') {
            const content = fs.readFileSync(entry.fullPath, 'utf8');
            expect(res.type).toBe(entry.mimeType);
            expect(res.text).toBe(content);
          } else {
            expect(res.type).toBe('text/html');
            expect(res.text).toContain('<!DOCTYPE html>');
          }
        }
      );
    };
  });
}
*/
