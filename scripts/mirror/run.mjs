import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer, loadConfigFromFile, mergeConfig } from 'vite';
import { loopbackOrigin, mirrorMiddleware } from './proxy.mjs';

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');
const args=process.argv.slice(2),value=(flag,fallback)=>{const n=args.indexOf(flag);return n<0?fallback:args[n+1];};
const port=Number(value('--port','5173')),target=value('--pi-origin','http://127.0.0.1:8788');
const passwordFile=value('--password-file',process.env.KITCHENCAM_LOCAL_PASSWORD_FILE);
const user=value('--user',process.env.KITCHENCAM_LOCAL_USER??'reviewer');
if (!Number.isInteger(port)||port<1024||port>65535) throw Error('Invalid mirror port.');
loopbackOrigin(target);
if(!passwordFile)throw Error('Supply --password-file pointing to the existing private Pi reviewer password.');
const password=readFileSync(passwordFile,'utf8').trim();
if(!password||/[\r\n:]/.test(user))throw Error('Invalid existing reviewer credentials.');
const authorization='Basic '+Buffer.from(user+':'+password).toString('base64');
const mirrorOrigin=`http://127.0.0.1:${port}`;
const config=await loadConfigFromFile({command:'serve',mode:'development'},resolve(root,'vite.config.ts'));
const mirrorPlugin={name:'local-read-only-mirror',enforce:'pre',
  resolveId(source){
    if(source==='@clerk/clerk-react')return resolve(here,'clerk.tsx');
    if(source==='convex/react')return resolve(here,'convex.ts');
    if(/(?:^|\/)useAuthStatus(?:\.tsx)?$/.test(source))return resolve(here,'auth.ts');
  },
  transformIndexHtml(html){return html.replace('/src/main.tsx','/scripts/mirror/main.tsx');},
  configureServer(server){
    server.middlewares.use((req,res,next)=>{
      res.setHeader('X-Wokenet-Mirror','read-only');
      // This development server is never a public preview or relay.
      if(req.headers.host!==new URL(mirrorOrigin).host){res.writeHead(403);res.end('Use '+mirrorOrigin);return;}
      next();
    });
    server.middlewares.use(mirrorMiddleware({target,authorization,mirrorOrigin}));
  },
};
const server=await createServer(mergeConfig(config?.config??{}, {
  configFile:false,root,clearScreen:false,plugins:[mirrorPlugin],
  define:{'import.meta.env.VITE_CAMERA_ORIGIN':JSON.stringify('/camera-api')},
  server:{host:'127.0.0.1',port,strictPort:true,allowedHosts:['127.0.0.1'],fs:{strict:true,allow:[root]}},
  optimizeDeps:{entries:['scripts/mirror/main.tsx'],exclude:['@clerk/clerk-react','convex/react']},
}));
await server.listen();
console.log(`Local read-only Wokenet mirror: ${mirrorOrigin}/kitchen-cameras`);
console.log('Real Pi footage; other Wokenet data and account state are preview fixtures. Production login is not simulated as an acceptance test.');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
