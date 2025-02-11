// quivi sarnno elencato in un array le varie possibili configurzioni di koaClassicServer in modo po sa poterle testare

// servers.js
const Koa = require('koa');
const koaClassicServer = require('../index.cjs');
const { join } = require('path');

/**
 * Array (o raccolta) delle configurazioni disponibili.
 * Aggiungendo nuovi oggetti qui potrai testare ulteriori configurazioni.
 */
rootDir = join(__dirname, '../' , '__tests__','publicWwwTest');
console.log( 'rootDir', rootDir);
const configurations = [
  {
    name: 'test generico',
    description: ' urlPrefix: \',',
    // Per i test, i file da servire sono quelli della cartella __tests__/publicWwwTest
    rootDir: rootDir,
    options: {
      //urlPrefix: '/',
      method: ['GET'],
      showDirContents: true,
    },
  },
  {
    name: 'test indicando l\'index file ',
    description: "nelle  urlPrefix: \'/public\', : //index: 'index.html',",
    // In produzione potresti servire i file dalla cartella "public"
    rootDir: rootDir,
    options: {
      urlPrefix: '/public',
      method: ['GET'],
      showDirContents: true,
      index: 'index.html',
    },
  },
  {
    name: 'test generico',
    description: ' urlPrefix: \'/public\',',
    // Per i test, i file da servire sono quelli della cartella __tests__/publicWwwTest
    rootDir: rootDir,
    options: {
      urlPrefix: '/public',
      method: ['GET'],
      showDirContents: true,
    },
  },
  {
    name: 'test con percorso riservato ',
    description: "urlsReserved : Array('percorso_riservato/', 'percorso riservato con spazi')",
    // Per i test, i file da servire sono quelli della cartella __tests__/publicWwwTest
    rootDir: rootDir,
    options: {
      urlPrefix: '',
      method: ['GET'],
      showDirContents: true,
      urlsReserved : Array('/percorso_riservato', '/percorso riservato con spazi')
    },
  },
  // Puoi aggiungere ulteriori configurazioni qui
];

/**
 * Cerca e restituisce la configurazione in base al nome.
 * Se non viene trovata, restituisce la prima (default).
 *
 * @param {string} configName - Il nome della configurazione da usare.
 * @returns {object} La configurazione trovata.
 */
function getConfig(configName) {
  return configurations.find(config => config.name === configName) || configurations[0];
}

/**
 * Crea un'istanza di Koa configurata in base alla configurazione scelta.
 *
 * @param {string} configName - Il nome della configurazione da utilizzare (default: 'default').
 * @returns {Koa} L'istanza dell'applicazione Koa.
 */
function createServer( configName ) {
  const config = getConfig(configName);
  const app = new Koa();
  console.log('config.options', config.options, 'config.rootDir' , config.rootDir);
  app.use(koaClassicServer(config.rootDir, config.options));
  return app;
}

module.exports = {
  configurations,
  getConfig,
  createServer,
};
