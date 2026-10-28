// Type of the one workerd runtime export this repo uses (worker/entrypoint-workerd.ts), declared here because the
// project does not depend on @cloudflare/workers-types.
declare module 'cloudflare:workers'{
  export abstract class WorkerEntrypoint<Env=unknown>{
    protected ctx:{waitUntil(promise:Promise<unknown>):void};
    protected env:Env;
    constructor(ctx:{waitUntil(promise:Promise<unknown>):void},env:Env);
  }
}
