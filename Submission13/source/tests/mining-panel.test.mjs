import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as rules from '../src/world/miningRules.ts';
const source=readFileSync(new URL('../src/world/MiningPanel.tsx',import.meta.url),'utf8'),native=createRequire(import.meta.url),exports={};
const media=ts.transpileModule(readFileSync(new URL('../src/world/MinerMedia.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,mediaExports={};
const resolve=name=>name==='./miningRules.ts'?rules:name==='./miningAssets.json'?{default:native('../src/world/miningAssets.json')}:name.endsWith('.css')?{}:name==='./MinerMedia.tsx'?mediaExports:native(name);
runInNewContext(media,{exports:mediaExports,require:resolve});
const product=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
runInNewContext(product,{exports,Date,BigInt,require:resolve});
const T=Date.UTC(2026,9,24),policy={rule:rules.MINING_RULE,effectiveDayMs:T};
const miner=shares=>{const n=BigInt(shares),r=rules.miningReward(n);return {totalShares:String(n),tier:r.tier,bonusPercent:r.bonusPercent,dailyGoldTenths:String(r.earnedTenths),remainderTenths:1,effectiveDayMs:T};};
const html=(props={})=>renderToStaticMarkup(React.createElement(exports.MiningPanel,{language:'zh',policy,now:T+86400000,miner:miner(11),...props}));
test('actual component renders one miner, wallet total and exact fraction separately from daily output',()=>{
 const output=html();assert.equal((output.match(/<img/g)||[]).length,1);for(const s of ['中型礦機','1,100,000','12.1','0.1','再質押 8,900,000','滿 1 GOLD 入帳'])assert.ok(output.includes(s),s);
 assert.ok(output.includes('aria-current="step"'));assert.ok(!output.includes('查看 3D'),'the 3D viewer was removed (2026-10-27)');assert.ok(!output.includes('核對質押'),'media control does not send a financial action');assert.ok(!output.includes('<canvas'));
});
test('a mined stake waiting for the ledger shows in gold as confirming and the empty miner as starting',()=>{
 const output=html({miner:miner(0),pendingShares:1n});
 for(const s of ['確認中：+100,000 EMBEO','約 15 分鐘後計入礦機','啟動中','mining-pending'])assert.ok(output.includes(s),s);assert.ok(!output.includes('等待啟動'));
 const none=html({miner:miner(0)});assert.ok(!none.includes('mining-pending'));assert.ok(none.includes('等待啟動'));
 assert.ok(html({miner:miner(1),pendingShares:2n}).includes('確認中：+200,000 EMBEO'),'a running miner also shows the stake being added');
});
test('all tiers and empty miner render correctly, existing fractions remain visible with no stake',()=>{
 for(const [n,label,daily]of [[0,'尚無礦機','0'],[1,'小型礦機','1'],[10,'中型礦機','11'],[100,'大型礦機','120']]){const output=html({miner:miner(n)});assert.ok(output.includes(label));assert.ok(output.includes(daily));assert.ok(output.includes('0.1'));}
});
test('signed-out and unsynced states never invent zero holdings or output; halt hides output and stops rotor',()=>{
 for(const status of ['signed-out','loading','unsynced']){const output=html({miner:null,status});assert.ok(output.includes('—'));assert.ok(!output.includes('is-running'));}
 const halted=html({status:'halted'});assert.ok(halted.includes('同步暫停'));assert.ok(!halted.includes('12.1'));assert.ok(!halted.includes('is-running'));
});
test('future scheduled policy and English content avoid implying active bonus',()=>{
 const scheduled=html({now:T-1});assert.ok(scheduled.includes('即將啟用'));assert.ok(scheduled.includes('之前的獎勵維持原規則'));assert.ok(!scheduled.includes('is-running'));
 const en=html({language:'en'});for(const s of ['My miner','Medium miner','Estimated daily output','Fractions carry forward'])assert.ok(en.includes(s));
});
