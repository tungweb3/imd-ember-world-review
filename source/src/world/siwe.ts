// The SIWE (EIP-4361) sign-in message, shared by the server that builds it (server/auth.ts) and the page that checks it
// before any wallet is asked to sign (auth.ts, swarm review F-7a). No viem here: this module ships in the client bundle.
// It names what signing does not grant: no transfers, no token or NFT approvals (ERC-20 approve, setApprovalForAll), no
// transactions (swarm review F-1, 2026-09-29). The page accepts only this text; the server also verifies challenges it
// issued with the previous wording (server/auth.ts SIWE_PREVIOUS_STATEMENTS).
export const SIWE_STATEMENT='Sign in to IMD Ember World to access your home for 7 days. This does not authorize asset transfers, token or NFT approvals, or transactions.';
/** How far the message's Issued At may be from this device's clock (either way): a wrong clock of a few minutes still
 *  signs in; a message issued at another time than now is refused. Its Expiration Time may be at most MAX_WINDOW_MS
 *  after Issued At (the server's CHALLENGE_TTL_MS). */
export const SIWE_CLOCK_SKEW_MS=10*60_000,SIWE_MAX_WINDOW_MS=5*60_000;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const time=(line:string,label:string)=>{const v=line.startsWith(label)?line.slice(label.length):'';return ISO.test(v)?Date.parse(v):NaN;};
/** Defence in depth before personal_sign: true only for exactly the message this page's server builds, line for line:
 *  this page's host and origin, the account being signed with (any letter case), version 1, chain 1, the statement, the
 *  challenge's own 32-hex nonce, Issued At near `now`, Expiration Time after it by at most 5 min, and no other line
 *  (no Resources, Request ID or Not Before). Anything else is not shown to the wallet at all. */
export function checkSignInMessage(message:string,{origin,account,nonce,now}:{origin:string;account:string;nonce:string;now:number}):boolean{
  let host:string;try{host=new URL(origin).host;}catch{return false;}                 // a non-canonical origin fails the URI line
  const l=message.split('\n');
  if(l.length!==11)return false;                                                  // every line is compared whole: a CR or a look-alike fails it
  const issued=time(l[9],'Issued At: '),expires=time(l[10],'Expiration Time: ');
  return l[0]===host+' wants you to sign in with your Ethereum account:'&&/^0x[\da-fA-F]{40}$/.test(l[1])&&l[1].toLowerCase()===account.toLowerCase()&&
    l[2]===''&&l[3]===SIWE_STATEMENT&&l[4]===''&&l[5]==='URI: '+origin+'/'&&l[6]==='Version: 1'&&l[7]==='Chain ID: 1'&&
    /^[\da-f]{32}$/.test(nonce)&&l[8]==='Nonce: '+nonce&&Math.abs(issued-now)<=SIWE_CLOCK_SKEW_MS&&expires>issued&&expires-issued<=SIWE_MAX_WINDOW_MS;
}
export type SignInSummary={domain:string;network:string;address:string};
const NETWORKS:Record<string,string>={'1':'Ethereum'};
/** What the panel shows while the wallet's prompt is open (F-1 UX), read back from the message itself (never from other
 *  fields of the server's answer): the domain the wallet should also show, the network, the account, and that the
 *  statement is this sign-in's own. Null for any other text; the client calls it only on a message checkSignInMessage passed. */
export function signInSummary(message:string):SignInSummary|null{
  const l=message.split('\n'),d=/^(\S+) wants you to sign in with your Ethereum account:$/.exec(l[0]??''),c=/^Chain ID: (\d+)$/.exec(l[7]??'');
  if(l.length!==11||!d||!c||!NETWORKS[c[1]]||l[3]!==SIWE_STATEMENT||!/^0x[\da-fA-F]{40}$/.test(l[1]))return null;
  return {domain:d[1],network:NETWORKS[c[1]],address:l[1]};
}
