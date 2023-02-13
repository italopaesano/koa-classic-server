const { URL } = require("url");
const fs = require("fs");
const mime = require("mime-types");
const { throws } = require("assert");
const { error } = require("console");

// è la funzione che avierà il server rootDir = cartella dei file statici, UrlPrefix = prefisso del path dove guardare es localhost:3000\views
// questa funzione deve restituire un midlware
module.exports = function koaClassicServer(
    rootDir,
    opts = {}

    /*
    opts SRUCTURE
     opts = {
        method: Array("GET"), // metodisupportati altrimenti verràchiamata la funzione next()
        showDirContents: true, // mostrare o meno il contenuto della cartella
        index: "", // index file name
        indexExt: array(),// futures possibili estensioni ammesse
        //setHeaders: Array(), // Futures Function to set custom headers on response.
        urlPrefix: "",
        urlsReserved: Array(), //carelle riservate sulle quali i filenon vengono letti Ps solo cartelle di primo livello gli annidamenti non sono supportati
        template: {
            render: undefined, // ES --> const templateRender = async ( ctx, next, filePath) => {
            ext: Array(),
        }, // emd template 
    } // end option */
){
    // controllo i valori di default options 
    const options = opts || {};
    options.template = opts.template || {template:{}};// necessario per rendere possibili i controlli di typo su options.template.render ecc

    options.method = Array.isArray( options.method ) ? options.method : Array('GET');// metod 
    options.showDirContents = typeof options.showDirContents == 'boolean' ? options.showDirContents : true;// di default le cartelle vengono mostrate
    options.index = typeof options.index == 'string' ? options.index : "";// index filefile che viene caricato se trovato dentro la cartella
    options.urlPrefix = typeof options.urlPrefix == 'string' ? options.urlPrefix : "";// urlPrefix 
    options.urlsReserved = Array.isArray( options.urlsReserved ) ? options.urlsReserved : Array();// array di url riservati e non accessibile
    options.template.render = (options.template.render == undefined || typeof options.template.render == 'function' ) ? options.template.render : undefined;// metod 
    options.template.ext = ( Array.isArray(options.template.ext) ) ? options.template.ext : Array();// metod 


    return async (ctx, next) => {
        
 
        // controlla se il metodo richiesto è presente nella lista di quelli ammessi
        if (!options.method.includes(ctx.method)) {
            next();
            return;
        }  

        //faccio in modo che la formula finale sia senza il "/" finale es 'http://localhost:3000/manage' e non 'http://localhost:3000/manage/' questo per non generare risultati diversi
        // attenione questo vale anche per la rotto che passa da http://localhost:3000/ a http://localhost:3000 però questa cosa verràcorretta portando il caso base con il '/'  in più da :  new URL(ctx.href)
        let pageHref = ''; //conterrà l'href della pagina
        if(ctx.href.charAt(ctx.href.length - 1) == '/'){
            pageHref = new URL(ctx.href.slice(0, -1));// slice(0, -1); rimuovo l'ultimo carattere '/'
        }else{
            pageHref = new URL(ctx.href);
        }
        
        //console.log( "rootDir="+rootDir+" UrlPrefix="+options.urlPrefix+" pageHref.pathname="+pageHref.pathname );

        // adesso controllo se pageHref rientraun urlPrefix
        const a_pathname = pageHref.pathname.split("/");// nome sbagliato dovrebbe cheamarsi a_pathname
        const a_urlPrefix = options.urlPrefix.split("/");

        //controllo urlPrefix
        for (const key in a_urlPrefix) {
            if (a_urlPrefix[key] != a_pathname[key]) {
                next(); // allora non è un sottoinsieme valido e quindi il percorso non riguarda questomidlwzare            }
                return;
            }
        }
        // superato questotolgo tutti gli urlprefix dai PageHref

        // creao pageHrefOutPrefix che non conterrà ilprefixnelsuoindirizzo
        let pageHrefOutPrefix = pageHref;
        if (options.urlPrefix != "") { // se siste un urlPrefix non nullo costruisco un nuovo pageHref
            let a_pathnameAutPrefix = a_pathname.slice(a_urlPrefix.length);//elimino tutte le parti del prefix , ho controllatoprima che queste parti coincidano
            let s_pathnameAutPrefix = a_pathnameAutPrefix.join("/"); //stringa href senza urlPrefix
            let hrefOutPrefix = pageHref.origin + '/' + s_pathnameAutPrefix;
            pageHrefOutPrefix = new URL(hrefOutPrefix);//
        }

        //DA MIGLIORARE
        // inizio controllo urlReserved // vale solo per il primo livello di cartelle non quelle annidate
        if (Array.isArray(options.urlsReserved)) {
            const a_pathnameOutPrefix = pageHrefOutPrefix.pathname.split("/");
            for (const value of options.urlsReserved) {
                if (a_pathnameOutPrefix[1] == value.substring(1)) {
                    // allora siamo nella cartella riservata //.substring(1) = taglia lo / iniziale
                    next();
                    return;
                }
            }
        }
        //controllo urlReserved

        // questo if impedirà che ilnome della cartella finisca con "/"
        let toOpen = ""; // sarà il percorso del file o della directori da aprire
        if (pageHrefOutPrefix.pathname == "/") {
            toOpen = rootDir;
        } else {
            toOpen = rootDir + decodeURIComponent(pageHrefOutPrefix.pathname);
        }

        if (!fs.existsSync(toOpen)) {
            // il filein questione non esiste quindi si può tornare niente
            //notfound The requested URL was not found on this server.
            ctx.body = requestedUrlNotFound();
            return;
        }
        const stat = fs.statSync(toOpen);
        let dir = ""; //solo segnaposto da migliorare
        if (stat.isDirectory()) {
            // is directory
            if ( options.showDirContents ) {
                if (options.index) {
                    //quindi esiste un nome di file index da cercare
                    if (fs.existsSync(toOpen + "/" + options.index)) {
                        loadFile(toOpen + "/" + options.index);
                        return;
                    }
                }
                ctx.body = show_dir(toOpen);
            } else {
                // allora non devo mostrare il contenuto della directory
                ctx.body = requestedUrlNotFound();
            }
            return;
        } else {
            //is file
            loadFile(toOpen);
            return;
        }

        // funzioni interne

        function requestedUrlNotFound() {
            return `
                <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta http-equiv="X-UA-Compatible">
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

        async function loadFile(toOpen) {
            if (options.template.ext.length > 0) {
                // esiste il metodo options.template.render quindi controlliamo i templatengine
                // ricavo l'estenzione del file
                const a_path = toOpen.split(".");
                const fileExt = a_path[a_path.length - 1]; // prendol'ultmo elemento che sarà l'estensione
                if (options.template.ext.includes(fileExt)) {
                    // se l'estenzione è nell'elenco si esegue altrimenti mostrerà il file normalmente
                    await options.template.render(ctx, next, toOpen);
                    return;
                }
            }
            let mimeType = mime.lookup(toOpen);
            const src = fs.createReadStream(toOpen);
            ctx.response.set("content-type", mimeType);
            ctx.response.set(
                "content-disposition",
                `inline; filename=${pageHrefOutPrefix.pathname.substring(1)}`
            ); //pageHref.pathname.substring(1) = taglia l' / iniziale ;//https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Disposition
            ctx.body = src;
        }

        //adesso devo andarenel rootDir e caricare i file e mostrarli al server
        function show_dir(toOpen) {
            dir = fs.readdirSync(toOpen, { withFileTypes: true }); // possibile error error.code == "ENOENT" ???
            let s_dir = "<table>";

            // START PARENT directory
            if (pageHrefOutPrefix.origin + "/" != pageHrefOutPrefix.href) {
                // allora non sei nella cartella base e bisogn visualizzare il link alla Parent Directory
                const a_pD = pageHref.href.split("/"); // array che conterrà il link della parent directori e che poi verrà ricostruito in stringa
                a_pD.pop(); // rimuovo l'ultimo elemento per trasormarla dell parent directory
                const parentDirectory = a_pD.join("/");
                s_dir += `<tr><td><a href="${parentDirectory}"><b>.. Parent Directory</b></a></td><td>DIR</td></tr>`;
            }
            // END PARENT directory

            if (dir.length == 0) {
                // cartella vuolta

                s_dir += `<tr><td>empty folder</td><td></td></tr>`;
                s_dir += `</table>`;
            } else {
                //la cartella non è vuota per questo si mostrerà il contenuto

                let a_sy = Object.getOwnPropertySymbols(dir[0]); // recupero l'array dei symbol
                const sy_type = a_sy[0]; // recupero il symbol Symbol(type)
                //let test = sy_type.description; test == 'type
                for (const item of dir) {
                    const s_name = item.name.toString();
                    const type = item[sy_type];

                    // item["Symbol(type)"] == type == ( 1 == file , 2 == cartella )
                    if (type == 1) {
                        // 1 == file
                        s_dir += `<tr><td> FILE `;
                    } else if (type == 2 || type == 3) {
                        //2 == cartella , 3 == symbolic link
                        s_dir += `<tr><td>`;
                    } else {
                        // ne file ne cartella , errore ?
                        throw new Error("unknown file type  type="+type);
                    }

                    const itemPath = `${toOpen}/${s_name}`;
                    let itemUri = "";
                    if ( pageHref.href == pageHref.origin + options.urlPrefix + "/" ) {
                        // senza questo if else vi rarà sempre un "/" in più o in meno alla fine dell'origin
                        itemUri = `${
                            pageHref.origin + options.urlPrefix
                        }/${encodeURIComponent(s_name)}`;
                    } else {
                        itemUri = `${pageHref.href}/${encodeURIComponent(
                            s_name
                        )}`;
                        //in questo caso non mi trovo nella root ed
                    }

                    // prendo in considerazione il casoin cui sia presente una cartella poireserved options.urlsReserved coniderare inoltre che queste cartelle posso essere presenti solo nella radice ci pageHrefOutPrefix   type == 2 -->  cartella || type == 3 -->  sybolik link
                    if(pageHrefOutPrefix.pathname == '/' &&  options.urlsReserved.includes( '/' + s_name ) && (type == 2 || type == 3) ){
                        s_dir += ` ${s_name}</td> <td> DIR BUT RESERVED</td></tr>`;
                    }else{// mostro le directori ed i file normalmente
                        s_dir += ` <a href="${itemUri}">${s_name}</a> </td> <td> ${
                            type == 2 // type == 2 è una cartellla
                                ? "DIR"
                                : ( mime.lookup(itemPath) == false ) ? 'unknow' : mime.lookup(itemPath)
                        } </td></tr>`;
                    }
                } // end for
            } // end if else

            s_dir += "</table>";
            //ctx.is('text/html');
            let toReturn = `
                        <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta http-equiv="X-UA-Compatible">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Document</title>
                    </head>
                    <body>`;

            toReturn += s_dir;
            // for test
            //toReturn += s_dir + " \n <br>  rootDir="+rootDir+" UrlPrefix="+options.urlPrefix+" pageHref.pathname="+pageHref.pathname ;

            toReturn += `
                    </body>
                    </html>
                `;
            return toReturn;
        } // function show_dir( dir ){
    }; // return (ctx, next) => {
};