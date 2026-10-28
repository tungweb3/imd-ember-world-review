import {WorkerEntrypoint} from '#worker-entrypoint';
import {ReadGateway} from '../server/gateway.ts';
import {createWorker,upstreamFetch,createGenesisGoldService,type Env} from './app.ts';
// Worker entry: the default export plus one named RPC entrypoint (see worker/app.ts: every named export of the entry is
// an entrypoint, so helpers stay out of this file). Module scope means one gateway per isolate, so its caches serve
// every request that isolate handles; they hold plain JSON only, never Response objects.
export default createWorker(new ReadGateway(upstreamFetch));

/** Service binding for the Genesis signer of the same Cloudflare account (no public route). A binding can only be
 *  configured inside the account, which is the caller's authentication; the wallet's own EIP-712 consent is still
 *  required for every hold, and settlement only follows finalized chain facts. */
export class GenesisGold extends WorkerEntrypoint<Env>{
  reserve(request:unknown){return createGenesisGoldService(this.env).reserve(request);}
  order(request:unknown){return createGenesisGoldService(this.env).order(request);}
  reconcile(request:unknown){return createGenesisGoldService(this.env).reconcile(request);}
}
