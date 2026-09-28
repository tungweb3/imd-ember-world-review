// The slice of Cloudflare D1's binding the wallet routes use (no @cloudflare/workers-types dependency). batch() runs
// its statements as one transaction: all commit or none (tests/d1-sqlite.mjs gives node:sqlite the same shape).
export type D1Result<T=Record<string,unknown>>={results:T[];success:boolean;meta:{changes?:number;[key:string]:unknown}};
export interface D1PreparedStatement{
  bind(...values:unknown[]):D1PreparedStatement;
  first<T=Record<string,unknown>>():Promise<T|null>;
  all<T=Record<string,unknown>>():Promise<D1Result<T>>;
  run():Promise<D1Result>;
}
export interface D1Database{prepare(sql:string):D1PreparedStatement;batch(statements:D1PreparedStatement[]):Promise<D1Result[]>;}
