import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import http from 'node:http';
import {loopbackOrigin,cameraReadPath,mirrorMiddleware} from './proxy.mjs';
let upstream,mirror,middleware,origin,received=[];
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const close=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
const rawGet=(url,headers)=>new Promise((resolve,reject)=>{http.get(url,{headers},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));}).on('error',reject);});
before(async()=>{
 upstream=http.createServer((req,res)=>{
  received.push({url:req.url,authorization:req.headers.authorization});
  if(req.url==='/api/status?deny=1'){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Private"'});res.end();return;}
  if(req.url==='/api/status?redirect=1'){res.writeHead(302,{Location:'https://example.invalid'});res.end();return;}
  res.setHeader('Content-Type','application/json');res.end('{"ok":true}');
 });await listen(upstream);
 mirror=http.createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end();}));await listen(mirror);
 origin=`http://127.0.0.1:${mirror.address().port}`;
 middleware=mirrorMiddleware({target:`http://127.0.0.1:${upstream.address().port}`,authorization:'Basic test-only',mirrorOrigin:origin});
});
after(async()=>{await close(mirror);await close(upstream);});
test('upstream credentials can only target a canonical HTTP loopback origin',()=>{
 for(const value of ['https://example.com','http://example.com','http://127.0.0.1/','http://user:pass@127.0.0.1','http://127.0.0.1:8788/path'])assert.throws(()=>loopbackOrigin(value));
 assert.equal(loopbackOrigin('http://127.0.0.1:8788').port,'8788');
});
test('only camera read routes are allowed',()=>{
 for(const path of ['/api/status','/api/live?camera=kitchen-1','/api/frame/0000000001-0001_1'])assert(cameraReadPath(path));
 for(const path of ['/api/delete','//evil.invalid/api/status','/api/frame/../../secret','/api/status#bad'])assert(!cameraReadPath(path));
});
test('proxy strips browser authorization and forwards only the server credential',async()=>{
 const r=await fetch(origin+'/camera-api/api/status',{headers:{Authorization:'Bearer local-preview',Origin:origin}});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});
 assert.equal(received.at(-1).authorization,'Basic test-only');
 assert.equal(r.headers.get('cache-control'),'no-store, private');
 assert.equal(r.headers.get('cross-origin-resource-policy'),'same-origin');
 assert.equal(r.headers.get('access-control-allow-origin'),null);
});
test('cross-origin browser requests and rebinding hosts cannot use the proxy',async()=>{
 assert.equal((await fetch(origin+'/camera-api/api/status',{headers:{Origin:'https://evil.invalid'}})).status,403);
 assert.equal(await rawGet(origin+'/camera-api/api/status',{Host:'evil.invalid'}),403);
 assert.equal(await rawGet(origin+'/camera-api/api/status',{'Sec-Fetch-Site':'cross-site'}),403);
});
test('writes and arbitrary backend paths are denied before contacting the Pi',async()=>{
 const before=received.length;
 assert.equal((await fetch(origin+'/camera-api/api/status',{method:'POST'})).status,405);
 assert.equal((await fetch(origin+'/camera-api/api/purge')).status,405);
 assert.equal(received.length,before);
});
test('failed upstream login and redirects never prompt for or forward credentials',async()=>{
 for(const query of ['deny=1','redirect=1']){
  const r=await fetch(origin+'/camera-api/api/status?'+query);assert.equal(r.status,503);
  assert.equal(r.headers.get('www-authenticate'),null);assert.equal(r.headers.get('location'),null);
 }
});
