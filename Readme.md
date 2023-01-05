#koa-classic-file

## Installation

## API

###Options


##Exsample

const koa = require('koa');
const app = new koa();
const port = 3000;

const classicServer = require('koa-classic-server');

const ejs = require('ejs');

app.use( classicServer(
    __dirname + "/public",    
    (opt = {
        showDirContents: true,
        template:{
            render: async ( ctx, next, filePath) => {
                ctx.body = await ejs.renderFile(filePath, { filePath: filePath, href: ctx.href, query: ctx.query});
            },
            ext: Array('ejs','EJS')
        }
    }))
    );

app.listen(port, console.log("server started on port:" + port));

## License

GPL V3