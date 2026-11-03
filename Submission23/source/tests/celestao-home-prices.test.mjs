import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// Runs the real integrations/celestao/web/world-wallet.js against a minimal fake DOM that mirrors the native reception page:
//   home:  nav#world-choices (four desk signs) and section.reception-welcome (annual-report button)
//   menu:  section#chart-picker > nav#chart-picker-links (shown after "choose a chart")
// Prices belong in the menu (and the confirmation step); the home view must stay price-free.
const source=readFileSync(new URL('../integrations/celestao/web/world-wallet.js',import.meta.url),'utf8');

function matches(el,selector){
 let rest=selector.trim(),m;
 if((m=/^[a-z][a-z0-9]*/i.exec(rest))){if(el.tagName!==m[0].toUpperCase())return false;rest=rest.slice(m[0].length);}
 while(rest){
  if((m=/^#([\w-]+)/.exec(rest))){if(el.id!==m[1])return false;}
  else if((m=/^\.([\w-]+)/.exec(rest))){if(!el.className.split(/\s+/).includes(m[1]))return false;}
  else if((m=/^\[([\w-]+)(?:(\^?=)"([^"]*)")?\]/.exec(rest))){const v=el.getAttribute(m[1]);if(v===null)return false;if(m[2]==='='&&v!==m[3])return false;if(m[2]==='^='&&!v.startsWith(m[3]))return false;}
  else throw Error('fake DOM does not support selector '+selector);
  rest=rest.slice(m[0].length);
 }
 return true;
}
const matchesAny=(el,list)=>list.split(',').some(part=>matches(el,part));
class El{
 constructor(tag){this.tagName=tag.toUpperCase();this.id='';this.className='';this.children=[];this.parent=null;this.attrs={};this.dataset={};this.listeners={};this.textContent='';this.role='';}
 getAttribute(name){return name==='id'?(this.id||null):name==='class'?(this.className||null):name in this.attrs?this.attrs[name]:null;}
 setAttribute(name,value){this.attrs[name]=String(value);}
 set href(value){this.attrs.href=String(value);}
 get href(){return this.attrs.href;}
 get isConnected(){let e=this;while(e.parent)e=e.parent;return e.tagName==='HTML';}
 adopt(child){child.remove();child.parent=this;return child;}
 append(...nodes){for(const n of nodes)this.children.push(this.adopt(n));}
 prepend(...nodes){this.children.unshift(...nodes.map(n=>this.adopt(n)));}
 replaceChildren(...nodes){for(const c of this.children)c.parent=null;this.children=[];this.append(...nodes);}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}}
 descendants(){return this.children.flatMap(c=>[c,...c.descendants()]);}
 querySelectorAll(selector){return this.descendants().filter(e=>matchesAny(e,selector));}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
 closest(selector){for(let e=this;e;e=e.parent)if(matchesAny(e,selector))return e;return null;}
 addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
 get text(){return this.textContent+this.children.map(c=>c.text).join('');}
}
const el=(tag,{id='',cls='',href,children=[]}={})=>{const e=new El(tag);e.id=id;e.className=cls;if(href!==undefined)e.attrs.href=href;e.append(...children);return e;};
const link=(id,href,cls='')=>el('a',{id,href,cls});

const CATALOG={walletEnabled:true,paymentsEnabled:true,billingInstalled:true,products:[
 {system:'bazi',gold:'1000',listGold:'1000',nameZh:'八字',nameEn:'BaZi'},{system:'ziwei',gold:'1000',listGold:'1000',nameZh:'紫微',nameEn:'Zi Wei'},
 {system:'annual_ziwei',gold:'1000',listGold:'1000',nameZh:'流年運勢',nameEn:'Zi Wei Year'},
{system:'western',gold:'800',listGold:'800',nameZh:'西洋',nameEn:'Western'},{system:'human',gold:'600',listGold:'600',nameZh:'人類圖',nameEn:'Human Design'},
 {system:'profile',gold:'3000',listGold:'3400',nameZh:'年度',nameEn:'Annual'}]};

async function load({catalog=CATALOG,page}){
 const html=el('html'),head=el('head'),body=el('body'),main=el('main',{id:'main'});html.append(head,body);body.append(main);
 const {home,menu}=page(main);
 const windowListeners={};
 const document={head,body,createElement:tag=>new El(tag),getElementById:id=>[html,...html.descendants()].find(e=>e.id===id)??null,
  querySelectorAll:selector=>html.querySelectorAll(selector),querySelector:selector=>html.querySelector(selector),addEventListener(){},visibilityState:'visible'};
 const window={addEventListener:(type,fn)=>{(windowListeners[type]??=[]).push(fn);}};
 const fetch=async url=>url==='/api/world/catalog'?{ok:true,status:200,json:async()=>catalog}:{ok:false,status:401,json:async()=>({error:'AUTH_REQUIRED'})};
 vm.runInNewContext(source,{document,window,fetch,location:{hostname:'celestao.com',search:'',assign(){}},URLSearchParams,URL,console,setTimeout,clearTimeout,Date,Number,Error,WeakMap,Map});
 await new Promise(r=>setTimeout(r,10));   // boot(): catalog + session fetches, then the app script is injected
 const route=(path='/',lang='zh')=>{for(const fn of windowListeners['celestial:route']??[])fn({detail:{lang,path}});};
 return {route,home,menu,main,badgesIn:root=>root.querySelectorAll('.world-price-badge').map(b=>b.text)};
}

// Mirrors the native reception markup observed in the running site.
function receptionPage(main){
 const signs=el('nav',{id:'world-choices',children:[link('world-bazi','#/system/bazi','world-choice'),link('world-ziwei','#/system/ziwei','world-choice'),link('world-western','#/system/western','world-choice'),link('world-human','#/system/human','world-choice')]});
 const welcome=el('section',{cls:'reception-welcome',children:[el('div',{cls:'reception-secondary',children:[link('','#/annual','btn primary small')]})]});
 const picker=el('section',{id:'chart-picker',cls:'chart-picker',children:[el('nav',{id:'chart-picker-links',children:[link('picker-bazi','#/system/bazi'),link('picker-ziwei','#/system/ziwei'),link('picker-western','#/system/western'),link('picker-human','#/system/human')]})]});
 main.append(signs,welcome,picker);return {home:[signs,welcome],menu:picker};
}

test('the reception home shows no GOLD price: desk signs and the annual-report button stay clean',async()=>{
 const w=await load({page:receptionPage});w.route('/');
 for(const part of w.home)assert.deepEqual(w.badgesIn(part),[],part.id||part.className);
 assert.equal(w.main.querySelectorAll('.world-price-badge').length,4);   // nothing else on the page lost its badge
});

test('the chart menu keeps the per-reading GOLD prices',async()=>{
 const w=await load({page:receptionPage});w.route('/');
 assert.deepEqual(w.badgesIn(w.menu),['1,000 GOLD／次','1,000 GOLD／次','800 GOLD／次','600 GOLD／次']);
});

test('prices follow the language and are not added twice when the route event repeats',async()=>{
 const w=await load({page:receptionPage});w.route('/','en');w.route('/','en');
 assert.deepEqual(w.badgesIn(w.menu),['1,000 GOLD／reading','1,000 GOLD／reading','800 GOLD／reading','600 GOLD／reading']);
 for(const part of w.home)assert.deepEqual(w.badgesIn(part),[]);
});

test('a price badge that is already sitting in the home view is removed, not just skipped',async()=>{
 const w=await load({page:receptionPage});
 const sign=w.main.querySelector('#world-bazi'),cta=w.main.querySelector('a[href="#/annual"]');
 for(const a of [sign,cta]){const stale=el('small',{cls:'world-price-badge'});stale.textContent='stale';a.append(stale);}
 w.route('/');
 for(const part of w.home)assert.deepEqual(w.badgesIn(part),[]);
});

test('an annual-report link outside the reception view (for example inside the menu) still shows its special price',async()=>{
 const w=await load({page:main=>{const page=receptionPage(main);const annual=link('picker-annual','#/annual');page.menu.querySelector('#chart-picker-links').append(annual);return page;}});
 w.route('/');
 assert.deepEqual(w.badgesIn(w.menu).at(-1),'合計 3,400 · 特價 3,000 GOLD／次');
});

test('without billing no price appears anywhere',async()=>{
 const w=await load({catalog:{...CATALOG,billingInstalled:false},page:receptionPage});w.route('/');
 assert.equal(w.main.querySelectorAll('.world-price-badge').length,0);
});
