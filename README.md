# koa-classic-file

koa-cleassic-server is a mildwere aiming for similar but not identical behavior to apache2 . the contents of a folder on the server will be shown remotely and if you want to access a file, click on it. note: not a highly inexperienced programmer use this code with caution, suggestions are welcome

## Installation
```js
npm i koa-classic-server
```

next import 

```js
const koaClassicServer = require('koa-classic-server');
```

## API

## Options

```js
opts = {
  method: Array("GET"), // methods enabled, otherwise it will have called the next() function
  showDirContents: true, //show or not the contents of the current directory
  index: "", // the index file , if a file with this name is found it will be loaded automatically Es index.html
  //indexExt: array(),// futures supported extensions for the index file
  urlPrefix: "", // prefix of the URL that will be skipped
  urlsReserved: Array(), //paths on disk that will not be accessible remotely e.g. array('/api','/views') warning nested folders are not allowed
  template: {
    render: undefined, //function that will take care of the rendering if there is a template engine  ES --> const templateRender = async ( ctx, next, filePath) => {
    Ext: Array(), // template engine file extension ES :Array("ejs", "EJS"),
  }, // emd template
}; // end optio
```

## Exsample

# exsaple0

```js
const Koa = require("koa");
const koaClassicServer = require("koa-classic-server");

const app = new Koa();

app.use(koaClassicServer(__dirname + "/public"));

app.listen(3000);
```

# exsample1

```js
const koa = require("koa");
const app = new koa();
const port = 3000;

const classicServer = require("koa-classic-server");

const ejs = require("ejs");

app.use(
  classicServer(
    __dirname + "/public",
    (opt = {
      showDirContents: true,
      template: {
        render: async (ctx, next, filePath) => {
          ctx.body = await ejs.renderFile(filePath, {
            filePath: filePath,
            href: ctx.href,
            query: ctx.query,
          });
        },
        ext: Array("ejs", "EJS"),
      },
    })
  )
);

app.listen(port, console.log("server started on port:" + port));
```

# exsample2

```js
const koa = require("koa");
const app = new koa();
const port = 3000;

const classicServer = require("koa-classic-server");

const ejs = require("ejs");

const templateRender = async (ctx, next, filePath) => {
  ctx.body = await ejs.renderFile(filePath, { filePath: filePath });
};

app.use(
  classicServer(
    __dirname + "/public",
    (opt = {
      showDirContents: true,
      template: {
        render: templateRender,
        ext: Array("ejs", "EJS"),
      },
    })
  )
);

app.listen(port, console.log("server started on port:" + port));
```

## License

MIT
