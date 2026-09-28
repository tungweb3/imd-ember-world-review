import type {Plugin} from 'vite';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {ReadGateway} from './gateway.ts';
import {handleWorldApi} from './world-api.ts';
import {handleAccountApi} from './auth.ts';
import {Ownership} from './ownership.ts';
// Dev and `vite preview` adapter: Node req/res around the same handler the Cloudflare Worker runs. There is no D1 here,
// so sign-in and /api/me answer 503 AUTH_UNAVAILABLE (local sign-in runs on wrangler dev --local, see README).
export function imdGatewayPlugin():Plugin {
  const gateway=new ReadGateway(),ownership=new Ownership(gateway);
  const middleware=async(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
    const url=new URL(req.url??'/', 'http://localhost');
    const response=await handleAccountApi(new Request(url.href,{method:req.method??'GET'}),{ownership,chain:{key:process.env.ALCHEMY_API_KEY||undefined,fetch}})??
      await handleWorldApi({method:req.method??'',url:url.href},gateway,{floorKey:process.env.ALCHEMY_API_KEY||undefined});
    if(!response)return next();
    res.statusCode=response.status;
    response.headers.forEach((value,name)=>res.setHeader(name,value));
    res.end(await response.text());
  };
  return {name:'imd-read-gateway',configureServer(server){server.middlewares.use(middleware);},configurePreviewServer(server){server.middlewares.use(middleware);}};
}
