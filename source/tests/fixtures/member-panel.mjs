// Child process for tests/member-client.test.mjs: the player-name part of My wallet (MemberBlock) and the house panel's
// heading (HouseholdBlock) as the page renders them, compiled by the project's TypeScript and rendered with
// react-dom/server once per case read from stdin ({kind, state, lang, now, owner?}). The MemberClient is a stand-in that
// only holds the given state: nothing here decides what is shown, the components do. Prints the markup as a JSON array.
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
registerHooks({load(url,context,next){
  if(!url.startsWith('file:')||!url.endsWith('.tsx'))return next(url,context);
  const file=fileURLToPath(url),{outputText}=ts.transpileModule(readFileSync(file,'utf8'),
    {fileName:file,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
  return {format:'module',source:outputText,shortCircuit:true};
}});
const cases=JSON.parse(await new Promise(resolve=>{let s='';process.stdin.on('data',d=>s+=d).on('end',()=>resolve(s));}));
Object.assign(globalThis,{location:{host:'imdember.com',origin:'https://imdember.com',search:''}});
const {createElement:h}=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
const {MemberBlock,MemberContext}=await import('../../src/world/MemberPanel.tsx'),{HouseholdBlock}=await import('../../src/world/HomePanels.tsx');
const {LanguageProvider}=await import('../../src/world/i18n.tsx');
const noop=()=>{},realNow=Date.now;
const out=cases.map(({kind,state,lang,now,owner})=>{
  globalThis.location.search='?lang='+lang;Date.now=()=>now;
  const client={state,subscribe:()=>noop,load:noop,skip:noop,save:async()=>false,clearError:noop};
  try{
    if(kind==='house')return renderToStaticMarkup(h(LanguageProvider,null,h(MemberContext.Provider,{value:client},
      h(HouseholdBlock,{home:{owner,size:'m',agents:[]},agents:new Map(),mine:true,onLocate:noop}))));
    return renderToStaticMarkup(h(LanguageProvider,null,h(MemberBlock,{client})));
  }finally{Date.now=realNow;}
});
process.stdout.write(JSON.stringify(out));
