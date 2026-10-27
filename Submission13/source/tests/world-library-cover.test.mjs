import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Extract the actual shipped hook statements; the adapter supplies React effect
// scheduling and a scene spy, never a separate implementation of cover rules.
const source=readFileSync(new URL('../src/world/WorldApp.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('WorldApp.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const content=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='WorldContent');
const declarations=[];for(const statement of content.body.statements)if(ts.isVariableStatement(statement))declarations.push(...statement.declarationList.declarations);
const declaration=name=>declarations.find(node=>ts.isIdentifier(node.name)&&node.name.text===name);
const portal=declaration('portalOpen');assert.ok(portal);
const sceneCovered=declaration('sceneCovered');assert.ok(sceneCovered);
const effects=content.body.statements.filter(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(ast)==='useEffect'&&/scene\.current\?\.(?:setPaused|suspend)\(/.test(node.getText(ast)));
assert.equal(effects.length,2);
const audioEffects=content.body.statements.filter(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(ast)==='useEffect'&&/libraryAudio\.current\?\.setPaused\(/.test(node.getText(ast)));
assert.equal(audioEffects.length,1);const audioCovered=declaration('audioCovered');assert.ok(audioCovered);
const insideOpen=declaration('insideOpen');assert.ok(insideOpen);
const program=ts.transpileModule(`function render({research=false,library=false,game=false,gold=false,economy=false,inventory=false,drawer=null,selfie=false,avatar=false,opening=false,sceneReady=true,inside=null}){const ${portal.getText(ast)},${audioCovered.getText(ast)},${sceneCovered.getText(ast)},${insideOpen.getText(ast)};${[...effects,...audioEffects].map(node=>node.getText(ast)).join('\n')}return portalOpen;}
var openLibrary=${declaration('openLibrary').initializer.getText(ast)};
var openResearch=${declaration('openResearch').initializer.getText(ast)};
var openGame=${declaration('openGame').initializer.getText(ast)};
var closeGame=${declaration('closeGame').initializer.getText(ast)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function fixture(){
 const calls=[],effects=[],changes=[];let cursor=0;
 const scene={current:{setPaused:value=>calls.push(['paused',value]),clearSelection:()=>calls.push(['clear']),suspend:()=>calls.push(['suspend']),resume:()=>calls.push(['resume'])}};
 const context={scene,libraryAudio:{current:{setPaused:value=>calls.push(['audioPaused',value])}},useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||deps.some((v,n)=>v!==old.deps[n])){old?.cleanup?.();effects[i]={deps,cleanup:fn()};}},useCallback:fn=>fn,
  setInventory:value=>changes.push(['inventory',value]),setGold:value=>changes.push(['gold',value]),setEconomy:value=>changes.push(['economy',value]),setDrawer:value=>changes.push(['drawer',value]),setMini:value=>changes.push(['map',value]),setSelfie:value=>changes.push(['selfie',value]),setAvatar:value=>changes.push(['avatar',value]),setResearch:value=>changes.push(['research',value]),setLibrary:value=>changes.push(['library',value]),setGame:value=>changes.push(['game',value]),collapse:()=>changes.push(['collapse']),URL,location:{href:'https://imdember.com/?portal=ember-clash&lang=zh&keep=1'},history:{replaceState:(_state,_title,url)=>changes.push(['url',String(url)])},requestAnimationFrame:fn=>fn(),host:{current:{querySelector:selector=>selector==='canvas'?{focus:()=>changes.push(['focus'])}:null}}};
 vm.createContext(context);vm.runInContext(program,context);
 return {calls,changes,render(value){cursor=0;return context.render(value);},openLibrary:context.openLibrary,openResearch:context.openResearch,openGame:context.openGame,closeGame:context.closeGame,setLocation:href=>context.location.href=href,dispose(){for(const effect of effects)effect.cleanup?.();}};
}
test('a pane opened from inside the house (Inventory) never resumes the world the interior suspended',()=>{
 const f=fixture(),room={home:null};f.render({inside:room});const before=f.calls.length;
 f.render({inside:room,inventory:true});f.render({inside:room,inventory:false});
 assert.equal(f.calls.slice(before).some(([name])=>name==='suspend'||name==='resume'),false,'the interior keeps ownership of the suspended world');
 // outside again, a pane suspends and resumes as before
 f.render({inside:null});f.render({inventory:true});f.render({inventory:false});
 assert.equal(f.calls.filter(([name])=>name==='suspend').length,1);assert.equal(f.calls.filter(([name])=>name==='resume').length,1);f.dispose();
});
test('actual World hooks suspend once across library/research/game swaps, preserve a drawer hold and resume only on leaving all',()=>{
 const f=fixture();f.render({research:false,library:false});assert.equal(f.calls.some(([name])=>name==='suspend'),false);
 f.render({research:false,library:true});assert.equal(f.calls.filter(([name])=>name==='suspend').length,1);assert.ok(f.calls.some(([name])=>name==='clear'));
 f.render({research:true,library:false});f.render({game:true});f.render({research:false,library:true});assert.equal(f.calls.filter(([name])=>name==='suspend').length,1);assert.equal(f.calls.some(([name])=>name==='resume'),false);
 f.render({research:false,library:false,drawer:{kind:'help'}});assert.equal(f.calls.filter(([name])=>name==='resume').length,1);assert.ok(f.calls.some(([name,value])=>name==='paused'&&value===true));f.render({research:false,library:false});assert.deepEqual(f.calls.slice(-2),[['paused',false],['clear']]);f.dispose();assert.equal(f.calls.filter(([name])=>name==='resume').length,1);
});
test('actual opening callbacks keep research, library and game mutually exclusive and close the original optional tools',()=>{
 const f=fixture();f.openLibrary();assert.ok(f.changes.some(([name,value])=>name==='research'&&value===false));assert.deepEqual(f.changes.at(-1),['library',true]);assert.ok(f.changes.some(([name,value])=>name==='drawer'&&value===null));assert.ok(f.changes.some(([name,value])=>name==='map'&&value===false));
 assert.ok(f.changes.some(([name,value])=>name==='game'&&value===false));
 f.changes.length=0;f.openResearch();assert.ok(f.changes.some(([name,value])=>name==='library'&&value===false));assert.ok(f.changes.some(([name,value])=>name==='game'&&value===false));assert.deepEqual(f.changes.at(-1),['research',true]);assert.ok(f.changes.some(([name,value])=>name==='selfie'&&value===false));assert.ok(f.changes.some(([name,value])=>name==='avatar'&&value===false));
 f.changes.length=0;f.openGame();assert.deepEqual(f.changes.at(-1),['game',true]);for(const other of ['research','library','selfie','avatar','map'])assert.ok(f.changes.some(([name,value])=>name===other&&value===false));f.dispose();
});

test('actual game audio cover pauses World audio across library/game swaps and releases it without changing speaker preferences',()=>{
 const f=fixture();f.render({});f.render({game:true});assert.deepEqual(f.calls.filter(([name])=>name==='audioPaused'),[['audioPaused',false],['audioPaused',true]]);
 f.render({library:true});assert.equal(f.calls.filter(([name])=>name==='audioPaused').length,2);f.render({game:true});assert.equal(f.calls.filter(([name])=>name==='audioPaused').length,2);
 f.render({research:true});assert.deepEqual(f.calls.filter(([name])=>name==='audioPaused').at(-1),['audioPaused',false]);f.dispose();
});

test('inventory preserves one shared scene/audio hold and each existing hall callback closes it before opening another pane',()=>{
 const f=fixture();f.render({});f.render({inventory:true});assert.equal(f.calls.filter(([k])=>k==='suspend').length,1);assert.deepEqual(f.calls.filter(([k])=>k==='audioPaused').at(-1),['audioPaused',true]);
 f.render({library:true});assert.equal(f.calls.filter(([k])=>k==='suspend').length,1);assert.equal(f.calls.filter(([k])=>k==='resume').length,0);
 f.render({});assert.equal(f.calls.filter(([k])=>k==='resume').length,1);
 for(const open of [f.openResearch,f.openLibrary,f.openGame]){f.changes.length=0;open();assert.deepEqual(f.changes[0],['inventory',false]);}
 f.dispose();
});

test('the actual opening holds input/audio during loading but suspends frames only after the first ready frame',()=>{
 const f=fixture();f.render({opening:true,sceneReady:false});assert.ok(f.calls.some(([k,v])=>k==='paused'&&v===true));assert.ok(f.calls.some(([k,v])=>k==='audioPaused'&&v===true));assert.equal(f.calls.some(([k])=>k==='suspend'),false);
 f.render({opening:true,sceneReady:true});assert.equal(f.calls.filter(([k])=>k==='suspend').length,1);
 f.render({opening:false,sceneReady:true});assert.equal(f.calls.filter(([k])=>k==='resume').length,1);assert.deepEqual(f.calls.filter(([k])=>k==='audioPaused').at(-1),['audioPaused',false]);f.dispose();
});

test('opening/portal overlap never resumes hidden frames or audio until the final cover is gone',()=>{
 const f=fixture();f.render({opening:true});f.render({opening:true,library:true});f.render({opening:false,library:true});f.render({game:true});
 assert.equal(f.calls.filter(([k])=>k==='suspend').length,1);assert.equal(f.calls.some(([k])=>k==='resume'),false);assert.equal(f.calls.filter(([k])=>k==='audioPaused').length,1);
 f.render({});assert.equal(f.calls.filter(([k])=>k==='resume').length,1);assert.deepEqual(f.calls.filter(([k])=>k==='audioPaused').at(-1),['audioPaused',false]);f.dispose();
});

test('actual game close removes only its own portal query and returns focus to the World canvas',()=>{
 const f=fixture();f.closeGame();assert.deepEqual(f.changes,[['game',false],['url','https://imdember.com/?lang=zh&keep=1'],['focus']]);
 f.changes.length=0;f.setLocation('https://imdember.com/?portal=stickember&lang=en');f.closeGame();assert.deepEqual(f.changes,[['game',false],['focus']]);f.dispose();
});

test('actual portal state opens a deep link once, closes it persistently and can reopen from the hall without URL-driven loops',()=>{
 const stateDeclaration=name=>declarations.find(node=>ts.isArrayBindingPattern(node.name)&&node.name.elements[0]?.name?.text===name);
 const library=stateDeclaration('library'),game=stateDeclaration('game');assert.ok(library);assert.ok(game);
 const lifecycle=ts.transpileModule(`function render(){const ${library.getText(ast)},${game.getText(ast)};
 const openGame=${declaration('openGame').initializer.getText(ast)};
 const closeGame=${declaration('closeGame').initializer.getText(ast)};
 return {library,game,openGame,closeGame};}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const mount=href=>{const hooks=[];let cursor=0,focused=0;const location={href,search:new URL(href).search};const context={URL,URLSearchParams,location,useCallback:fn=>fn,
  useState(initial){const i=cursor++;if(!(i in hooks))hooks[i]=typeof initial==='function'?initial():initial;return [hooks[i],value=>{hooks[i]=value;}];},
  setInventory:()=>{},setGold:()=>{},setEconomy:()=>{},setResearch:()=>{},setDrawer:()=>{},setMini:()=>{},setSelfie:()=>{},setAvatar:()=>{},collapse:()=>{},requestAnimationFrame:fn=>fn(),
  host:{current:{querySelector:()=>({focus(){focused++;}})}},history:{replaceState(_state,_title,url){location.href=String(url);location.search=new URL(url).search;}}};
  vm.createContext(context);vm.runInContext(lifecycle,context);return {location,render(){cursor=0;return context.render();},get focused(){return focused;}};
 };
 const f=mount('https://imdember.com/?portal=ember-clash&lang=zh'),first=f.render();assert.equal(first.game,true);assert.equal(first.library,false);first.closeGame();assert.equal(f.render().game,false);assert.equal(f.location.href,'https://imdember.com/?lang=zh');assert.equal(f.focused,1);
 f.render().openGame();assert.equal(f.render().game,true);assert.equal(f.render().library,false);assert.equal(f.location.search,'?lang=zh');f.render().closeGame();assert.equal(f.render().game,false);assert.equal(mount(f.location.href).render().game,false);
 assert.equal(mount('https://imdember.com/?portal=stickember&lang=en').render().game,false);assert.equal(mount('https://imdember.com/?portal=unknown').render().game,false);
});
