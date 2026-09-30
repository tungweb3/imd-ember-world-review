// Child process for tests/wallet-client.test.mjs (A-8): "My wallet" as the page renders it. WalletPanel.tsx and the .tsx
// files it imports are compiled on load by the project's own TypeScript (jsx react-jsx, as tsconfig.json says) and
// rendered with react-dom/server, once per {state, lang, now} read from stdin: the AuthState the real client reached in
// the parent, its language, and the parent's clock. The page's host is imdember.com. Prints the markup as a JSON array.
// Nothing here decides what the panel says: the component, and the walletView.ts texts it renders, do.
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
// The page's globals the panel reads: location (the pre-sign line's host, the language) and the window the wallet
// registry listens on for EIP-6963 announcements (none here: no wallet extension).
const win=new EventTarget();
Object.assign(globalThis,{location:{host:'imdember.com',origin:'https://imdember.com',search:''},
  addEventListener:win.addEventListener.bind(win),removeEventListener:win.removeEventListener.bind(win),dispatchEvent:win.dispatchEvent.bind(win)});
const {createElement:h}=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
const {WalletPanel}=await import('../../src/world/WalletPanel.tsx'),{LanguageProvider}=await import('../../src/world/i18n.tsx');
const noop=()=>{},realNow=Date.now;
const out=cases.map(({state,lang,now})=>{
  globalThis.location.search='?lang='+lang;Date.now=()=>now;
  try{return renderToStaticMarkup(h(LanguageProvider,null,h(WalletPanel,{client:{},state,address:state.session?.address??state.account,canSign:!!state.account,
    home:null,agents:new Map(),error:null,onUseAddress:noop,onForget:noop,onTravel:noop,onMove:noop,onLocate:noop})));}
  finally{Date.now=realNow;}
});
process.stdout.write(JSON.stringify(out));
