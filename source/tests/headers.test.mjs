import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HSTS} from '../server/world-api.ts';
import {MARKET_URL} from '../src/world/market.ts';
// public/_headers is what Workers Static Assets applies to every static response (Vite copies it into dist/). This reads
// it the way Cloudflare's parser does (a path line, then indented "Name: value" lines; # comments) and rejects anything
// that parser would drop, then checks the headers each kind of URL ends up with.
function parseHeaders(text){
  const rules=[];let rule=null;
  text.split('\n').forEach((raw,i)=>{
    const line=raw.trim();if(!line||line.startsWith('#'))return;
    assert.ok(line.length<=2000,'line '+(i+1)+' exceeds the 2,000 character limit');
    if(line.startsWith('/')){assert.ok((line.match(/\*/g)??[]).length<=1,'one splat per rule');rule={path:line,headers:{}};rules.push(rule);return;}
    const at=line.indexOf(':');
    assert.ok(rule&&at>0&&!line.slice(0,at).trim().includes(' ')&&raw.startsWith(' '),'line '+(i+1)+' is not an indented "Name: value" pair under a path: '+line);
    rule.headers[line.slice(0,at).trim().toLowerCase()]=line.slice(at+1).trim();
  });
  assert.ok(rules.length<=100&&rules.every(r=>Object.keys(r.headers).length>0));
  return rules;
}
const rules=parseHeaders(readFileSync(new URL('../public/_headers',import.meta.url),'utf8'));
const escape=s=>s.replace(/[.+?^${}()|[\]\\]/g,'\\$&');
const matches=(pattern,path)=>new RegExp('^'+pattern.split('*').map(escape).join('.*')+'$').test(path);
const headersFor=path=>Object.assign({},...rules.filter(r=>matches(r.path,path)).map(r=>r.headers));
const csp=value=>Object.fromEntries(value.split(';').map(d=>d.trim().split(/\s+/)).filter(d=>d[0]).map(([name,...sources])=>[name,sources]));

test('every static response and the SPA fallback carry the security headers',()=>{
  for(const path of ['/','/some/route','/models/houses/house_timber_l.glb','/assets/index-abc.js','/references/imd/pepe.webp']){
    const h=headersFor(path);
    assert.equal(h['x-content-type-options'],'nosniff',path);assert.equal(h['x-frame-options'],'DENY',path);
    assert.equal(h['referrer-policy'],'strict-origin-when-cross-origin',path);
    assert.equal(h['strict-transport-security'],HSTS,path);
    assert.ok(h['content-security-policy'],path);
  }
});
test('the CSP allows the GLB texture path (blob:) and nothing that would let an injected script run',()=>{
  const p=csp(headersFor('/')['content-security-policy']);
  assert.deepEqual(p['default-src'],["'self'"]);
  // Scripts: this origin only (no Web Analytics beacon is injected, so its host is not allowed either).
  assert.deepEqual(p['script-src'],["'self'"]);
  // The only cross-origin read is the market quote, at the origin the client really calls (market.ts MARKET_URL).
  assert.deepEqual(p['connect-src'],["'self'",'blob:',new URL(MARKET_URL).origin]);
  // GLTFLoader reads each embedded texture from a blob: URL with fetch() or <img>; without these every model loads untextured.
  assert.ok(p['connect-src'].includes('blob:'));assert.ok(p['img-src'].includes('blob:'));
  assert.ok(p['connect-src'].includes("'self'"),'the world API is same-origin');
  // NFT images in "My wallet" come only from Alchemy's CDN (the Worker drops every other image URL); no other image host.
  assert.deepEqual(p['img-src'],["'self'",'data:','blob:','https://nft-cdn.alchemy.com']);
  assert.ok(!p['connect-src'].some(s=>s.includes('alchemy')),'the browser never calls Alchemy');
  for(const [name,sources] of Object.entries(p))for(const bad of ["'unsafe-eval'",'*','https:','http:'])assert.ok(!sources.includes(bad),name+' '+bad);
  assert.ok(!p['script-src'].includes("'unsafe-inline'"));
  assert.deepEqual(p['frame-ancestors'],["'none'"]);assert.deepEqual(p['object-src'],["'none'"]);assert.deepEqual(p['base-uri'],["'none'"]);
});
test('hashed build output is cached for a week, never immutable; everything else keeps the default revalidation',()=>{
  const cache=headersFor('/assets/index-abc.js')['cache-control'],maxAge=Number(/max-age=(\d+)/.exec(cache)?.[1]);
  assert.ok(maxAge>=86400&&maxAge<=604800,cache);assert.ok(!cache.includes('immutable'),'a fallback index.html under /assets/ must not stick');
  for(const path of ['/','/models/houses/house_timber_l.glb','/references/imd/pepe.webp','/favicon.svg'])assert.equal(headersFor(path)['cache-control'],undefined,path);
});
test('the world music is cached for a week like the hashed build, and the CSP lets it play from this origin only',()=>{
  const h=headersFor('/audio/music/rain_window.1a05eeec3b.mp3'),maxAge=Number(/max-age=(\d+)/.exec(h['cache-control'])?.[1]);
  assert.ok(maxAge>=86400&&maxAge<=604800,h['cache-control']);assert.ok(!h['cache-control'].includes('immutable'));
  assert.equal(h['x-content-type-options'],'nosniff');
  // No media-src: <audio> falls back to default-src 'self', so no other host can be played from.
  const p=csp(h['content-security-policy']);assert.equal(p['media-src'],undefined);assert.deepEqual(p['default-src'],["'self'"]);
});
test('HSTS: a year or more, every subdomain, no preload, and the same value on static files and Worker responses',()=>{
  const d=HSTS.split(';').map(s=>s.trim()),h=headersFor('/');
  assert.ok(Number(/^max-age=(\d+)$/.exec(d[0])?.[1])>=31536000,HSTS);
  assert.ok(d.includes('includeSubDomains'),HSTS);assert.ok(!d.some(x=>/^preload$/i.test(x)),'no preload');
  assert.equal(h['strict-transport-security'],HSTS);
});
