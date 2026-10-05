// Credential-free, optional anonymous readback. Default validates/displays the plan and makes NO network request.
// Run: node verify-served-readback.mjs --execute [--expectations ./SERVED_EXPECTATIONS.json]
// Output is metadata only. No response body, wallet/session credential, Cloudflare token, model or media is saved.
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const sha=body=>createHash('sha256').update(body).digest('hex');
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const ORIGIN='https://imdember.com',MAX_BYTES=8*1024*1024;
const args=process.argv.slice(2);let execute=false,path=resolve(dirname(fileURLToPath(import.meta.url)),'SERVED_EXPECTATIONS.json');
for(let i=0;i<args.length;i++){
  if(args[i]==='--execute')execute=true;else if(args[i]==='--expectations')path=resolve(args[++i]);else throw new Error('Unknown option');
}
const manifestBytes=readFileSync(path),expected=JSON.parse(manifestBytes);
check(expected.schema==='imd.submission9.anonymous-readback-expectations/v1'&&expected.origin===ORIGIN&&/^[0-9a-f]{40}$/.test(expected.sourceCommit??'')&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(expected.workerVersion??''),'Unexpected expected manifest identity');
check(Array.isArray(expected.requests)&&expected.requests.length===5,'Exactly five requests are required');
const rows=expected.requests,assets=rows.filter(row=>row.kind==='asset'),html=rows.filter(row=>row.kind==='html'),sessions=rows.filter(row=>row.kind==='anonymous-session');
check(html.length===1&&html[0].path==='/'&&sessions.length===1&&sessions[0].path==='/api/auth/session'&&assets.length===3,'Unexpected route scope');
check(assets.filter(row=>/^\/assets\/index-[A-Za-z0-9_-]+\.js$/.test(row.path)).length===1&&assets.filter(row=>/^\/assets\/index-[A-Za-z0-9_-]+\.css$/.test(row.path)).length===1&&assets.filter(row=>/^\/assets\/InteriorView-[A-Za-z0-9_-]+\.js$/.test(row.path)).length===1,'Only main JS/CSS and InteriorView may be read');
check(new Set(rows.map(row=>row.path)).size===5,'Duplicate route');
const staticNames=['x-content-type-options','referrer-policy','permissions-policy','strict-transport-security','x-frame-options','content-security-policy'];
for(const row of [...html,...assets]){
  check(/^[0-9a-f]{64}$/.test(row.expectedSha256??'')&&Number.isSafeInteger(row.expectedBytes)&&row.expectedBytes>0&&row.expectedBytes<=MAX_BYTES,'Invalid bounded expected asset identity');
  check(Object.keys(row.securityHeaders??{}).length===6&&staticNames.every(name=>typeof row.securityHeaders[name]==='string')&&row.setCookieExpected===false,'Invalid static security-header expectations');
  check(['text/html','text/javascript','text/css'].includes(row.expectedContentTypePrefix),'Unexpected content type');
}
const apiNames=['content-type','cache-control','strict-transport-security','x-content-type-options','referrer-policy','cross-origin-resource-policy','content-security-policy'];
check(sessions[0].signedInExpected===false&&sessions[0].setCookieExpected===false&&sessions[0].corsHeaderExpected===false&&sessions[0].headers?.['cache-control']==='no-store','Anonymous session scope changed');
check(Object.keys(sessions[0].headers).length===apiNames.length&&Object.keys(sessions[0].headers).every(name=>apiNames.includes(name))&&apiNames.every(name=>typeof sessions[0].headers[name]==='string'&&sessions[0].headers[name].length<=2000),'Only the seven declared non-secret API response headers may be read');
const output={schema:'imd.submission9.caller-anonymous-https-readback/v1',status:execute?'RUNNING':'VALIDATED_NO_NETWORK_REQUESTS',origin:ORIGIN,sourceCommit:expected.sourceCommit,
  teamClaimedWorkerVersion:expected.workerVersion,expectedManifestSha256:sha(manifestBytes),startedAtUtc:new Date().toISOString(),requests:[],
  provenance:'Expected hashes/headers are TEAM claims from the pinned build record. Measurements below are produced by this invocation; the caller must report who ran it.',
  limits:'This anonymous verifier cannot identify the active Worker UUID, Cloudflare bindings/traffic, D1 state, authenticated-cookie behavior, wallet control, production WAF/limiter/concurrency, cron execution, or upstream ownership correctness. It establishes only the five served response checks at the measurement time.'};
if(!execute){output.requestPlan=rows.map(row=>({path:row.path,kind:row.kind}));console.log(JSON.stringify(output,null,2));}
else{
  for(const expectedRow of rows){
    if(output.requests.length)await new Promise(resolve=>setTimeout(resolve,1500));
    const row={path:expectedRow.path,startedAtUtc:new Date().toISOString()};
    try{
      const response=await fetch(ORIGIN+expectedRow.path,{method:'GET',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30_000),headers:{'User-Agent':'IMDEmber-Submission9-Public-Anonymous-Readback'}});
      const length=response.headers.get('content-length');check(!length||Number(length)<=MAX_BYTES,'Readback exceeds body size bound');
      const chunks=[];let total=0;for await(const chunk of response.body){total+=chunk.length;check(total<=MAX_BYTES,'Readback exceeds body size bound');chunks.push(Buffer.from(chunk));}const body=Buffer.concat(chunks,total);
      Object.assign(row,{status:response.status,bytes:body.length,sha256:sha(body),contentType:response.headers.get('content-type'),cacheControl:response.headers.get('cache-control'),setCookiePresent:response.headers.has('set-cookie')});
      if(expectedRow.kind==='anonymous-session'){
        row.headers=Object.fromEntries(Object.keys(expectedRow.headers).map(name=>[name,response.headers.get(name)]));row.headersMatch=Object.entries(expectedRow.headers).every(([name,value])=>row.headers[name]===value);
        row.corsHeaderPresent=response.headers.has('access-control-allow-origin');row.signedIn=JSON.parse(body).signedIn;
        row.matches=row.status===200&&row.headersMatch&&row.signedIn===false&&!row.setCookiePresent&&!row.corsHeaderPresent;
      }else{
        row.expectedSha256=expectedRow.expectedSha256;row.expectedBytes=expectedRow.expectedBytes;row.exactBytesMatch=row.sha256===expectedRow.expectedSha256&&body.length===expectedRow.expectedBytes;
        row.securityHeaders=Object.fromEntries(Object.keys(expectedRow.securityHeaders).map(name=>[name,response.headers.get(name)]));row.securityHeadersMatch=Object.entries(expectedRow.securityHeaders).every(([name,value])=>row.securityHeaders[name]===value);
        row.contentTypeMatches=(row.contentType??'').split(';')[0].trim()===expectedRow.expectedContentTypePrefix;row.cacheControlMatch=expectedRow.cacheControl===undefined||row.cacheControl===expectedRow.cacheControl;
        if(expectedRow.kind==='html'&&!row.exactBytesMatch&&expectedRow.qualifiedSingleManagedAnalyticsRemoval===true){
          const text=body.toString('utf8'),beacons=[...text.matchAll(/<script\b(?=[^>]*\bsrc="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js\/[^"\s]+")(?=[^>]*\bdata-cf-beacon=)[^>]*><\/script>/g)];
          row.managedAnalyticsScripts=beacons.length;
          if(beacons.length===1){const cleaned=Buffer.from(text.replace(beacons[0][0],''));row.analyticsRemovedBytes=cleaned.length;row.analyticsRemovedSha256=sha(cleaned);row.analyticsOnlyDifference=cleaned.length===expectedRow.expectedBytes&&row.analyticsRemovedSha256===expectedRow.expectedSha256;}
        }
        row.matches=row.status===200&&(row.exactBytesMatch||expectedRow.kind==='html'&&row.analyticsOnlyDifference===true)&&row.securityHeadersMatch&&row.contentTypeMatches&&row.cacheControlMatch&&!row.setCookiePresent;
      }
    }catch(error){row.matches=false;row.error={name:String(error.name),category:'request-or-response-check-failed'};}
    output.requests.push(row);
  }
  output.finishedAtUtc=new Date().toISOString();output.allPassed=output.requests.every(row=>row.matches);output.status=output.allPassed?'PASS_SERVED_RESPONSES_WITH_STATED_LIMITS':'FAIL_OR_UNAVAILABLE';
  console.log(JSON.stringify(output,null,2));if(!output.allPassed)process.exitCode=1;
}
