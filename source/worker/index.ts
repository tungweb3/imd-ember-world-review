import {ReadGateway} from '../server/gateway.ts';
import {createWorker,upstreamFetch} from './app.ts';
// Worker entry: only a default export (see worker/app.ts). Module scope means one gateway per isolate, so its caches
// serve every request that isolate handles; they hold plain JSON only, never Response objects.
export default createWorker(new ReadGateway(upstreamFetch));
