import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {createElement as h} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
registerHooks({load(url,context,next){if(url.endsWith('.css'))return {format:'module',source:'export {};',shortCircuit:true};if(!url.startsWith('file:')||!url.endsWith('.tsx'))return next(url,context);const file=fileURLToPath(url);return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};}});
const {Admin}=await import('../src/world/WorldGoldPanel.tsx');
const data={products:[],controls:[],campaign:{version:0,active:false,startsMs:null,endsMs:null,stopped:false}};
const html=patch=>renderToStaticMarkup(h(Admin,{client:{},data:{...data,...patch},refresh:async()=>{},zh:true}));
test('the send button says why it is closed, and the real panel hands the form its wallet and this site',()=>{
 const form=patch=>renderToStaticMarkup(h(Admin,{client:{},data:{...data,canGrant:true,grantLeft:'15000',grantsLeft:'90',...patch},refresh:async()=>{},zh:true,signGrant:async()=>''}));
 assert.match(html({canGrant:true,grantLeft:'15000'}),/錢包還沒準備好/);assert.doesNotMatch(form({}),/錢包還沒準備好/);
 assert.match(form({}),/還可發 15000 GOLD、90 筆/);assert.match(form({}),/每筆都要用錢包簽章/);
 const source=readFileSync(new URL('../src/world/WorldGoldPanel.tsx',import.meta.url),'utf8');
 assert.ok(source.includes('signGrant={controller?message=>controller.signGrant(message):undefined}'));assert.ok(source.includes('signedGrantCommand({origin:location.origin,admin:data.wallet,to,gold:grantGold,reason,requestId:id,now:Date.now(),sign:signGrant})'));assert.ok(source.includes("||data.grantLeft==='0'||!signGrant}"));
});
test('the send form appears only for a wallet the server allows, and shows what is left',()=>{
 assert.doesNotMatch(html({}),/發放 GOLD/);
 assert.doesNotMatch(html({canGrant:false,grantLeft:'20000'}),/發放 GOLD/);
 const form=html({canGrant:true,grantLeft:'15000'});
 assert.match(form,/發放 GOLD/);assert.match(form,/每次最多 5000 GOLD；24 小時內還可發 15000 GOLD/);assert.match(form,/發出後無法收回/);
 assert.match(form,/確認發放/);assert.match(form,/<button disabled="">確認發放/);
 assert.doesNotMatch(form,/最近發放/);
 const listed=html({canGrant:true,grantLeft:'15000',recentGrants:[{id:'g',wallet:'0x'+'c'.repeat(40),gold:'1000',actor:'0x'+'a'.repeat(40),created_ms:Date.UTC(2026,10,4)}]});
 assert.match(listed,/最近發放/);assert.match(listed,/1000 GOLD/);assert.ok(listed.includes('0x'+'c'.repeat(40)));
});
