
// index.js (ESM)
// index.esm.js

// Importa il modulo principale (anche se è scritto in CommonJS)
// Node gestirà l'interoperabilità e restituirà il valore presente in module.exports.
import koaClassicServer from './index.cjs';
export default koaClassicServer;

