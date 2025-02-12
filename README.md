# koa-classic-file

koa-cleassic-server is a mildwere aiming for similar but not identical behavior to apache2 . the contents of a folder on the server will be shown remotely and if you want to access a file, click on it. note: not a highly inexperienced programmer use this code with caution, suggestions are welcome.

middleware serving static files from a directory. The middleware accepts an options object that allows customization of the serving behavior. For example, it allows setting the supported HTTP methods, whether to show the contents of a directory, the name of the index file, an array of URLs that are reserved and not accessible, and an optional template rendering function for certain file types.

    The middleware takes in two arguments: rootDir which is the directory that contains the static files and opts which is the options object.

    In the options object, the following properties are set to default values if they are not provided:
        method: an array of supported HTTP methods. Default is ['GET'].
        showDirContents: a boolean value indicating whether the contents of a directory should be shown. Default is true.
        index: the name of the index file. Default is an empty string.
        urlPrefix: the prefix of the path , such as localhost:3000/views. Default is an empty string.
        urlsReserved: an array of reserved URLs that files cannot be read from. Default is an empty array.
        template: an object with two properties:
            render: a function for rendering templates. Default is undefined.
            ext: an array of file extensions for which the render function should be used. Default is an empty array.

    The middleware then checks if the requested HTTP method is in the list of supported methods. If it is not, the middleware calls next and returns.

    The middleware then checks if the pageHref is a sub-path of the urlPrefix. If it is not, the middleware calls next and returns.

    The middleware checks if the requested URL is in the urlsReserved array. If it is, the middleware calls next and returns.

    The middleware then generates the file path by combining the rootDir and the pathname of the pageHref.

    The middleware then checks if the file exists, and if it does, it sets the content type of the response and sends the file contents. If the file is a directory and showDirContents is true, the contents of the directory are shown. If the index file exists in the directory, it is shown instead.

    If the file does not exist, the middleware calls next to let the next middleware handle the request.

    If the file extension is in the template.ext array and the template.render function is provided, the function is called to render the file contents.

## Installation

```js
npm i koa-classic-server
```

next import 

```js
const koaClassicServer = require('koa-classic-server');
```
or
```js
import koaClassicServer from "koa-classic-server";
'''

## API

## Options

```js
opts = {
  method: Array("GET"), // methods enabled, otherwise it will have called the next() function
  showDirContents: true, //show or not the contents of the current directory
  index: "", // the index file , if a file with this name is found it will be loaded automatically Es index.html
  //indexExt: array(),// futures supported extensions for the index file
  urlPrefix: "", // prefix of the URL that will be skipped es "/admin" 
  urlsReserved: Array(), //paths on disk that will not be accessible remotely e.g. array('/api','/views') warning nested folders are not allowed
  template: {
    render: undefined, //function that will take care of the rendering if there is a template engine  ES --> const templateRender = async ( ctx, next, filePath) => {
    ext: Array(), // template engine file extension ES :Array("ejs", "EJS"),
  }, // emd template
}; // end optio
```

## Exsample

### exsaple0

```js
const Koa = require("koa");
const koaClassicServer = require("koa-classic-server");

const app = new Koa();

app.use(koaClassicServer(__dirname + "/public"));

app.listen(3000);
```

### exsample1

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

### exsample2

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
