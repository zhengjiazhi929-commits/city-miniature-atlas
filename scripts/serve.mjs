import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT||4173);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.geojson':'application/geo+json','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf'};
http.createServer((req,res)=>{
  try{
    const requestPath=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const filename=path.resolve(root,'.'+requestPath+(requestPath.endsWith('/')?'index.html':''));
    if(!filename.startsWith(root+path.sep)){res.writeHead(403);res.end('Forbidden');return;}
    fs.stat(filename,(error,stat)=>{
      if(error||!stat.isFile()){res.writeHead(404);res.end('Not found');return;}
      res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
      fs.createReadStream(filename).pipe(res);
    });
  }catch{res.writeHead(400);res.end('Bad request');}
}).listen(port,'127.0.0.1',()=>console.log(`China Miniature Atlas: http://127.0.0.1:${port}`));
