// Node (tests, scripts) cannot load cloudflare:workers. Same shape as workerd's WorkerEntrypoint, so the entry module
// imports under node:test; package.json "imports" #worker-entrypoint picks this file for every non-workerd condition.
export abstract class WorkerEntrypoint<Env=unknown>{
  protected ctx:{waitUntil(promise:Promise<unknown>):void};
  protected env:Env;
  constructor(ctx:{waitUntil(promise:Promise<unknown>):void},env:Env){this.ctx=ctx;this.env=env;}
}
