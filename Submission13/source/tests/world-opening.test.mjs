import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const entry=readFileSync(new URL('../public/opening-entry.js',import.meta.url),'utf8');
const signal=ts.transpileModule(readFileSync(new URL('../src/world/opening.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
class Node extends EventTarget{
  constructor(){super();this.dataset={};this.attrs=new Map();this.hidden=false;this.inert=false;this.textContent='';this.focused=0;this.listeners=new Map();}
  setAttribute(k,v){this.attrs.set(k,String(v));}removeAttribute(k){this.attrs.delete(k);if(k==='src')this.src='';}
  addEventListener(k,f){super.addEventListener(k,f);this.listeners.set(k,(this.listeners.get(k)??0)+1);}
  removeEventListener(k,f){super.removeEventListener(k,f);this.listeners.set(k,(this.listeners.get(k)??0)-1);}
  emit(type){this.dispatchEvent(new Event(type));}focus(){this.focused++;}
}
function fixture({search='?lang=zh',pathname='/',mobile=false,reduced=false,saveData=false,blocked=false,throwPlay=false,playing=true,preReady=false,storageThrows=false,blockedAudible=false,soundPref=null,worldSoundPref=null}={}){
  const overlay=new Node(),root=new Node(),video=new Node(),skip=new Node(),sound=new Node(),retry=new Node(),status=new Node(),canvas=new Node(),motion=new Node();
  motion.matches=reduced;let removed=false,closed=0,now=0,serial=0,reloads=0;const timers=new Map();
  sound.hidden=true;const preferences=new Map([['ember-world-opening-sound-v1',soundPref],['ember-world-sound-v1',worldSoundPref]]);
  const elements={'#root':root,video,'[data-opening-sound]':sound,'[data-opening-retry]':retry,'[data-opening-status]':status};
  overlay.querySelector=s=>elements[s];overlay.remove=()=>{removed=true;};overlay.contains=e=>[video,skip,sound,retry].includes(e);root.querySelector=()=>canvas;
  video.src='';video.playCalls=0;video.pauseCalls=0;video.loads=0;video.pause=()=>video.pauseCalls++;video.load=()=>video.loads++;
  video.play=()=>{video.playCalls++;if(throwPlay)throw Error('no codec');return blocked||blockedAudible&&!video.muted?Promise.reject(Object.assign(Error('NotAllowedError'),{name:'NotAllowedError'})):Promise.resolve();};
  if(preReady)root.dataset.worldReady='ready';
  const doc=new Node();Object.assign(doc,{getElementById:id=>id==='root'?root:id==='world-opening'&&!removed?overlay:null,activeElement:null});
  const win=new Node();Object.assign(win,{navigator:{connection:{saveData}},location:{search,pathname,reload(){reloads++;}},localStorage:{getItem(key){if(storageThrows)throw Error('denied');return preferences.get(key)??null;},setItem(key,value){if(storageThrows)throw Error('denied');preferences.set(key,value);}},matchMedia:q=>q.includes('reduced-motion')?motion:{matches:mobile},setTimeout(fn,delay){const id=++serial;timers.set(id,{at:now+delay,fn});return id;},clearTimeout(id){timers.delete(id);}});
  Object.defineProperty(win,'ethereum',{get(){throw Error('Opening must never inspect a wallet');}});
  win.addEventListener('ember-world-opening-closed',()=>closed++);
  const exports={};vm.runInNewContext(signal,{exports,document:doc,window:win,Event});
  vm.runInNewContext(entry,{document:doc,window:win,URLSearchParams,Event});
  if(playing&&video.playCalls&&!blocked&&!throwPlay&&!(blockedAudible&&!video.muted))video.emit('playing');
  const advance=ms=>{const end=now+ms;for(;;){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;timers.delete(due[0]);now=due[1].at;due[1].fn();}now=end;};
  return {overlay,root,video,skip,sound,retry,status,motion,win,doc,timers,preferences,advance,ready:exports.worldOpeningReady,active:exports.worldOpeningActive,get removed(){return removed;},get closed(){return closed;},get reloads(){return reloads;}};
}
test('fast World waits for the actual movie end, then releases input once and cleans up',()=>{
  const f=fixture();assert.equal(f.active(),true);assert.equal(f.root.inert,true);assert.equal(f.video.muted,false);assert.match(f.video.src,/720\./);
  f.ready();f.advance(7999);assert.equal(f.active(),true);assert.equal(f.closed,0);f.video.emit('ended');assert.equal(f.closed,1);assert.equal(f.root.inert,false);assert.equal(f.active(),false);f.video.emit('ended');assert.equal(f.closed,1);f.advance(360);assert.equal(f.removed,true);assert.equal(f.video.src,'');assert.equal(f.timers.size,0);
});
test('slow World retains the final movie frame until readiness; no looping or premature entry',()=>{
  const f=fixture();f.advance(8000);f.video.emit('ended');assert.equal(f.active(),true);assert.equal(f.root.inert,true);assert.ok(f.video.src);assert.equal(f.video.hidden,false);assert.match(f.status.textContent,/正在準備/);f.advance(9000);assert.equal(f.closed,0);f.ready();assert.equal(f.closed,1);f.advance(360);assert.equal(f.removed,true);
});
test('the opening works without a skip control and still waits for film completion',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');assert.doesNotMatch(html,/data-opening-skip|world-opening__controls/);assert.doesNotMatch(entry,/data-opening-skip/);const f=fixture();f.skip.emit('click');assert.equal(f.closed,0);f.ready();assert.equal(f.closed,0);assert.equal(f.root.inert,true);f.video.emit('ended');assert.equal(f.closed,1);
});
test('a World failure exposes the existing error interface immediately',()=>{const f=fixture();f.ready(true);assert.equal(f.closed,1);assert.equal(f.removed,true);assert.equal(f.root.inert,false);assert.equal(f.timers.size,0);});
test('autoplay rejection falls back to a poster without blocking a ready World',async()=>{const f=fixture({blocked:true});await Promise.resolve();await Promise.resolve();assert.equal(f.video.hidden,true);assert.equal(f.closed,0);assert.equal(f.video.src,'');f.ready();assert.equal(f.closed,1);});
test('video decoder failure or a synchronous play failure cannot trap entry',()=>{for(const throwing of [false,true]){const f=fixture({throwPlay:throwing});if(!throwing)f.video.emit('error');assert.equal(f.video.hidden,true);assert.equal(f.closed,0);f.ready();assert.equal(f.closed,1);}});
test('initial movie download stalls are bounded independently from World readiness',()=>{const f=fixture({playing:false});f.advance(12000);assert.equal(f.video.hidden,true);assert.equal(f.closed,0);f.ready();assert.equal(f.closed,1);});
test('a recovered buffering interval cancels its fallback; a prolonged one releases the video download',()=>{
  const f=fixture();f.video.emit('waiting');f.advance(4000);f.video.emit('playing');f.advance(2000);assert.equal(f.video.hidden,false);f.video.emit('stalled');f.advance(5000);assert.equal(f.video.hidden,true);assert.equal(f.video.src,'');f.ready();assert.equal(f.closed,1);
});
test('reduced motion and data saving avoid fetching the film and enter when ready',()=>{for(const options of [{reduced:true},{saveData:true}]){const f=fixture(options);assert.equal(f.video.playCalls,0);assert.equal(f.video.src,'');assert.equal(f.video.hidden,true);assert.equal(f.closed,0);f.ready();assert.equal(f.closed,1);assert.equal(f.removed,!!options.reduced);}});
test('switching to reduced motion during the clip stops it without bypassing loading',()=>{const f=fixture();f.motion.matches=true;f.motion.emit('change');assert.equal(f.closed,0);assert.equal(f.video.hidden,true);f.ready();assert.equal(f.removed,true);});
test('mobile fetches only its lighter source, defaults sound on and exposes one small mute control',()=>{
 const f=fixture({mobile:true});assert.match(f.video.src,/540\./);assert.equal(f.video.playCalls,1);assert.equal(f.video.muted,false);assert.equal(f.sound.hidden,false);
 f.sound.emit('click');assert.equal(f.video.muted,true);assert.equal(f.sound.attrs.get('aria-pressed'),'false');assert.equal(f.preferences.get('ember-world-opening-sound-v1'),'off');
 f.sound.emit('click');assert.equal(f.video.muted,false);assert.equal(f.sound.attrs.get('aria-pressed'),'true');assert.equal(f.preferences.get('ember-world-opening-sound-v1'),'on');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');assert.match(html,/data-opening-sound/);assert.doesNotMatch(html,/data-opening-skip/);
});
test('audible autoplay refusal retries the same movie muted without skipping its eight-second gate',async()=>{
 const f=fixture({blockedAudible:true});await Promise.resolve();await Promise.resolve();assert.equal(f.video.playCalls,2);assert.equal(f.video.hidden,false);assert.equal(f.video.muted,true);assert.ok(f.video.src);
 assert.match(f.sound.attrs.get('aria-label'),/開啟/);assert.equal(f.preferences.get('ember-world-opening-sound-v1'),null,'policy fallback does not save a user mute');
 f.video.emit('playing');f.ready();assert.equal(f.closed,0);f.sound.emit('click');assert.equal(f.video.muted,false);f.video.emit('ended');assert.equal(f.closed,1);assert.equal(f.sound.hidden,true);
});
test('saved opening mute and existing player mute are respected without changing World preferences',()=>{
 for(const options of [{soundPref:'off'},{worldSoundPref:'off'}]){const f=fixture(options);assert.equal(f.video.muted,true);f.sound.emit('click');assert.equal(f.video.muted,false);assert.equal(f.preferences.get('ember-world-sound-v1'),options.worldSoundPref??null);}
 const on=fixture({soundPref:'on'});assert.equal(on.video.muted,false);
});
test('late autoplay failures and sound clicks cannot restart or unmute a closed opening',async()=>{
 const f=fixture({blockedAudible:true});f.ready(true);await Promise.resolve();await Promise.resolve();const count=f.video.playCalls;f.sound.emit('click');assert.equal(f.video.playCalls,count);assert.equal(f.video.src,'');assert.equal(f.closed,1);
});
test('direct services bypass the opening and do not fetch a movie',()=>{for(const options of [{search:'?portal=aimarket&lang=zh'},{search:'?portal=stickember'},{search:'?portal=ember-clash'},{pathname:'/aimarket/'}]){const f=fixture(options);assert.equal(f.removed,true);assert.equal(f.video.playCalls,0);assert.equal(f.root.inert,false);assert.equal(f.timers.size,0);}});
test('a ready signal before the independent startup script is retained, including reduced motion',()=>{const f=fixture({preReady:true});assert.equal(f.closed,0);f.video.emit('ended');assert.equal(f.closed,1);const reduced=fixture({preReady:true,reduced:true});assert.equal(reduced.removed,true);assert.equal(reduced.root.inert,false);});
test('slow app recovery offers reload without automatically reloading or claiming readiness',()=>{const f=fixture();f.advance(30000);assert.equal(f.retry.hidden,false);assert.match(f.status.textContent,/載入較久/);assert.equal(f.closed,0);assert.equal(f.reloads,0);f.retry.emit('click');assert.equal(f.reloads,1);});
test('pagehide cleans media/timers and informs the cached World to resume on return',()=>{const f=fixture();f.win.emit('pagehide');assert.equal(f.removed,true);assert.equal(f.closed,1);assert.equal(f.root.inert,false);assert.equal(f.timers.size,0);for(const node of [f.video,f.skip,f.sound,f.retry,f.motion,f.doc])assert.ok([...node.listeners.values()].every(n=>n===0));for(const type of ['ember-world-ready','pagehide','pageshow','focus'])assert.equal(f.win.listeners.get(type),0);});
test('English works even with unavailable storage and no wallet capability',()=>{const f=fixture({search:'?lang=en',storageThrows:true});assert.equal(f.retry.textContent,'Reload');f.video.emit('ended');assert.equal(f.status.textContent,'Preparing the world…');f.ready();assert.equal(f.closed,1);});
test('a film paused while the window was away resumes on return and still waits for its end',()=>{
 const f=fixture();f.video.paused=true;f.doc.hidden=true;f.doc.emit('visibilitychange');assert.equal(f.video.playCalls,1,'no restart while still hidden');
 f.doc.hidden=false;f.doc.emit('visibilitychange');assert.equal(f.video.playCalls,2);f.video.paused=false;f.video.emit('playing');f.advance(3000);assert.equal(f.video.hidden,false);assert.ok(f.video.src);
 f.ready();assert.equal(f.closed,0,'the film still has its remaining seconds');f.video.emit('ended');assert.equal(f.closed,1);
});
test('a film the browser will not resume after a frozen tab hands over to loading instead of trapping entry',async()=>{
 const f=fixture();f.ready();f.video.paused=true;f.doc.emit('resume');assert.equal(f.video.playCalls,2);await Promise.resolve();f.advance(2999);assert.equal(f.closed,0);f.advance(1);assert.equal(f.video.hidden,true);assert.equal(f.video.src,'');assert.equal(f.closed,1);
 const g=fixture();g.video.paused=true;g.video.play=()=>{g.video.playCalls++;return Promise.reject(Object.assign(Error('NotAllowedError'),{name:'NotAllowedError'}));};g.win.emit('pageshow');for(let i=0;i<4;i++)await Promise.resolve();assert.equal(g.video.playCalls,3,'one muted retry, then the poster');assert.equal(g.video.hidden,true);assert.equal(g.closed,0);g.ready();assert.equal(g.closed,1);
});
test('a film that ended while the window was away enters on return without replaying',()=>{const f=fixture();f.video.paused=true;f.video.ended=true;f.win.emit('focus');assert.equal(f.video.playCalls,1);assert.match(f.status.textContent,/正在準備/);f.ready();assert.equal(f.closed,1);});
test('returning to a playing, finished or closed opening never restarts the film',()=>{
 const f=fixture();f.video.paused=false;f.doc.emit('visibilitychange');assert.equal(f.video.playCalls,1);f.video.paused=true;f.video.emit('ended');f.win.emit('focus');assert.equal(f.video.playCalls,1);
 const g=fixture();g.ready(true);g.video.paused=true;g.doc.emit('visibilitychange');g.win.emit('pageshow');assert.equal(g.video.playCalls,1);assert.equal(g.timers.size,0);
});
// 2026-10-26 owner request: switching windows must not hold the film back. The browser pauses a muted film in a hidden
// tab; on return it continues from where it would be after the time away, or the World opens if it would have ended.
const away=(f,seconds)=>{let t=1000;f.win.performance={now:()=>t};f.doc.hidden=true;f.doc.emit('visibilitychange');f.video.paused=true;t+=seconds*1000;f.doc.hidden=false;f.doc.emit('visibilitychange');};
test('a film paused while hidden continues from where it would be after the time away',()=>{
 const f=fixture();f.video.duration=8;f.video.currentTime=2;away(f,3);
 assert.equal(f.video.currentTime,5);assert.equal(f.video.playCalls,2,'resumed once');f.ready();assert.equal(f.closed,0,'three seconds of film remain');f.video.emit('ended');assert.equal(f.closed,1);
});
test('a film that would have ended while hidden opens the World on return instead of playing on',()=>{
 const f=fixture();f.video.duration=8;f.video.currentTime=2;away(f,20);
 assert.equal(f.video.playCalls,1,'not restarted');assert.match(f.status.textContent,/正在準備/);f.ready();assert.equal(f.closed,1);
});
test('a film the browser kept playing while hidden is not moved again',()=>{
 const f=fixture();f.video.duration=8;f.video.currentTime=2;let t=1000;f.win.performance={now:()=>t};
 f.doc.hidden=true;f.doc.emit('visibilitychange');t+=3000;f.video.currentTime=5;f.doc.hidden=false;f.doc.emit('visibilitychange');
 assert.equal(f.video.currentTime,5);assert.equal(f.video.playCalls,1,'it never stopped');
});// 2026-10-27: a backgrounded film was paused a few frames before its end with no visibility event; `ended` never fired
// and the ready World stayed behind the opening. A 2 s check while the film runs treats "paused at the end" as ended.
test('a film paused at its end with no event still opens the ready World',()=>{
 const f=fixture();f.video.duration=8;f.ready();assert.equal(f.closed,0);
 f.video.currentTime=7.9;f.video.paused=true;f.advance(2000);assert.equal(f.closed,1,'treated as ended');assert.equal(f.video.playCalls,1,'not restarted');
});
test('a film paused mid-way with no event gets one resume, and nothing acts before the film has started',()=>{
 const f=fixture();f.video.duration=8;f.video.currentTime=3;f.video.paused=true;f.advance(2000);assert.equal(f.video.playCalls,1,'one check is not enough');
 f.advance(2000);assert.equal(f.video.playCalls,2,'second check resumes');assert.equal(f.closed,0);
 const g=fixture({playing:false});g.video.duration=8;g.video.paused=true;g.advance(6000);assert.equal(g.video.playCalls,1,'a film that never started is left to the existing load/stall timers');
});