import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import assets from '../src/world/miningAssets.json' with {type:'json'};
// The miner media (src/world/MinerMedia.tsx): a still image, or the miner's film once it runs. The 3D viewer was removed
// on 2026-10-27 (owner request): nothing here loads a model, a viewer or a canvas.
const code=ts.transpileModule(readFileSync(new URL('../src/world/MinerMedia.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function render(props,{films,reduced=false}={}){
 const list=films?{...assets,videos:films}:assets,exports={},jsx=(type,p)=>({type,props:p});
 const require=name=>name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='./miningAssets.json'?{default:list}:assert.fail('unexpected import '+name);
 runInNewContext(code,{exports,require,window:{matchMedia:q=>({matches:q.includes('reduce')&&reduced})}});
 const out=[],visit=n=>{if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(visit);return;}out.push(n);visit(n.props?.children);};visit(exports.MinerMedia(props));return out;
}
const of=(nodes,type)=>nodes.filter(n=>n.type===type);
test('the miner films shipped with the site are pinned: one per tier, the hashed file, its exact size and SHA-256',async()=>{
 const {createHash}=await import('node:crypto');
 assert.deepEqual(Object.keys(assets.videos),['small','medium','large']);
 for(const [tier,v]of Object.entries(assets.videos)){
  assert.match(v.src,new RegExp('^/assets/miners/'+tier+'\\.[a-f0-9]{12}\\.mp4$'));const bytes=readFileSync(new URL('../public'+v.src,import.meta.url));
  const sha=createHash('sha256').update(bytes).digest('hex');assert.equal(sha,v.sha256);assert.equal(bytes.length,v.bytes);assert.ok(v.src.includes(sha.slice(0,12)));
  assert.ok(v.bytes<600_000,'a light web film (no audio, 720 px)');assert.ok(v.bytes<v.sourceBytes*.2);
 }
});
test('a running miner shows the film shipped for its tier; a miner not running keeps the image',()=>{
 const n=render({tier:'medium',language:'zh',active:true},{films:assets.videos});assert.equal(of(n,'video')[0].props.src,assets.videos.medium.src);
 assert.equal(of(render({tier:'medium',language:'zh',active:false},{films:assets.videos}),'video').length,0);
});
test('the miner shows its still image and offers no 3D control',()=>{
 const n=render({tier:'small',language:'zh'});assert.equal(of(n,'img').length,1);assert.equal(of(n,'img')[0].props.src,assets.models.small.poster);
 assert.equal(of(n,'button').length,0);assert.equal(of(n,'video').length,0);assert.doesNotMatch(code,/miningViewer|3D/);
});
test('a running miner plays its film, muted and looping, when one is listed and motion is allowed',()=>{
 const films={small:{src:'/assets/miners/small-run.mp4'}},n=render({tier:'small',language:'zh',active:true},{films});
 const [v]=of(n,'video');assert.equal(v.props.src,films.small.src);assert.equal(v.props.muted,true);assert.equal(v.props.loop,true);assert.equal(v.props.autoPlay,true);assert.equal(v.props.poster,assets.models.small.poster);
 assert.equal(of(render({tier:'small',language:'zh',active:false},{films}),'video').length,0,'a miner not yet running keeps the image');
 assert.equal(of(render({tier:'medium',language:'zh',active:true},{films}),'video').length,0,'no film listed for this tier: image');
 assert.equal(of(render({tier:'small',language:'zh',active:true},{films,reduced:true}),'video').length,0,'reduced motion keeps the image');
});
