//const request = require('supertest');
//const Koa = require('koa');
const classicServer = require('koa-classic-server');

const testDir = __dirname + '/test' ;

const fakeApp = classicServer( testDir );

const fakeCtx = {
  method: 'GET',
  href: 'http://localhost:3000/', // da controllare
  body: '',
  response: {} 
}

const fakeNext = () => {};

///console.log(fakeApp( fakeCtx, fakeNext));

test('prima prova', () => {
  fakeApp( fakeCtx, fakeNext).then((result) => {
    console.log('resuuultttttt',result);
    expect( result ).not.toBe(3);
  })//)).not.toBe(3);
});

/* const app = new Koa();
app.use(classicServer( __dirname + '/test'));

const server = app.listen();

request(server)
  .get('/')
  .expect('Content-Type', 'text/html')
  //.expect('Content-Length', '15')
  .expect(200)
  .end(function(err, res) {
    if (err) throw err;
  }); */



/* describe('koa-classic-server', () => {
  let app;

  beforeEach(() => {
    app = new Koa();
    app.use(classicServer());
  });

  it('should return Hello World!', async () => {
    const res = await request(app.callback()).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toBe('Hello World!');
  });

  it('should return 404 for invalid route', async () => {
    const res = await request(app.callback()).get('/invalid');
    expect(res.status).toBe(404);
    expect(res.text).toBe('Not Found');
  });
});
 */