// Player names [REDACTED]: one validator for the naming form and the
// server (server/member.ts), so the form can say exactly what the server will refuse. The server is the authority: it
// runs this again and the database decides who gets a name (nickname_claims).
export const NAME_MIN=2,NAME_MAX=20,RAW_BYTES_MAX=256,NAME_BYTES_MAX=128;
export const RENAME_COOLDOWN_MS=7*86_400_000,OLD_NAME_KEPT_MS=30*86_400_000;
/** The profile states the server keeps (migrations/0006 member_profiles.profile_state). */
export type ProfileState='needs_name'|'ready'|'needs_rename'|'locked';
export type NameReason='type'|'bytes'|'controls'|'length'|'chars'|'shape';
export type NameCheck={ok:true;display:string;key:string}|{ok:false;reason:NameReason};

const bytes=(s:string)=>new TextEncoder().encode(s).length;
/** A lone surrogate (not valid Unicode text). */
const LONE=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** Refused before anything else and never stripped: stripping them would "wash" a name into a legal one. [REDACTED]
 *  C0/C1 controls (newlines, tabs), zero-width and joiners, bidi marks and overrides, soft hyphen, combining grapheme
 *  joiner, Mongolian vowel separator, Hangul fillers, variation selectors, interlinear annotations and tag characters. */
const CONTROLS=/[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u2028-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB]|\uDB40[\uDC00-\uDDEF]/;
/** After NFKC: Han ideographs (Script=Han letters: no radicals, no Han numerals or iteration marks), ASCII letters and
 *  digits, underscore. Spaces, emoji, '@', '.', '/', '<' and every other script are outside it (URLs, mentions and
 *  HTML cannot be written). */
const ALLOWED=/^(?:(?=\p{Script=Han})\p{Lo}|[A-Za-z0-9_])+$/u;
const VISIBLE=/[A-Za-z0-9]|(?=\p{Script=Han})\p{Lo}/u;
const segmenter=typeof Intl!=='undefined'&&'Segmenter' in Intl?new Intl.Segmenter('und',{granularity:'grapheme'}):null;
/** Visible length in extended grapheme clusters (not UTF-16 units). */
export function graphemes(s:string):number{
  if(!segmenter)return Array.from(s).length;
  let n=0;for(const _ of segmenter.segment(s))n++;return n;
}
/** The name as it will be saved (`display`, its letters' case kept) and its uniqueness key (`key`: the same text with
 *  ASCII letters lowercased; full-width forms already folded by NFKC), or why it cannot be a name. Leading and trailing
 *  ordinary whitespace is trimmed; whitespace inside is refused. Does not check reserved names (isReservedName). */
export function checkName(raw:unknown):NameCheck{
  if(typeof raw!=='string')return {ok:false,reason:'type'};
  if(bytes(raw)>RAW_BYTES_MAX)return {ok:false,reason:'bytes'};
  if(LONE.test(raw)||CONTROLS.test(raw))return {ok:false,reason:'controls'};
  const trimmed=raw.trim();
  if(!trimmed)return {ok:false,reason:'length'};
  const display=trimmed.normalize('NFKC');
  if(!ALLOWED.test(display))return {ok:false,reason:'chars'};
  const n=graphemes(display);
  if(n<NAME_MIN||n>NAME_MAX)return {ok:false,reason:'length'};
  if(bytes(display)>NAME_BYTES_MAX)return {ok:false,reason:'bytes'};
  if(!VISIBLE.test(display))return {ok:false,reason:'shape'};
  return {ok:true,display,key:display.replace(/[A-Z]/g,c=>c.toLowerCase())};
}

/** Reserved-name rules v1 [REDACTED]. BRAND and AUTHORITY parts make a
 *  reserved name alone or in any combination of up to three parts; COMBO parts only together with one of those. A name
 *  is compared whole (never "contains"): after removing underscores and trailing digits and folding look-alikes
 *  (skeleton), it must be exactly such a combination. So Admin, ADMIN_01, Adm1n, IMDEmber_Official, 管理员 and
 *  官方_客服 are reserved, while Badminton, Modern, IMDFan and EmberCat are not. The seven names of migrations/0006 are
 *  also 'system' rows in nickname_claims. */
export const RESERVED_RULES_VERSION='reserved-v1';
export const RESERVED_NAMES=['Admin','Administrator','Moderator','IMDEmber','IMDEmberOfficial','官方客服','管理員'] as const;
const BRAND=['imdember','imd'];
const AUTHORITY=['admin','administrator','moderator','mod','official','staff','support','owner','system','官方','客服','管理','管理員','管理者','站長','系統','版主','官方客服'];
const COMBO=['ember','team','gm','bot','help','helpdesk','service','crew','dev'];
/** Look-alike folding for the reserved check only (never for uniqueness): rn→m, vv→w, i/l/1→l, 0→o, 3→e, 4→a, 5→s, 7→t,
 *  8→b, 9→g, and the simplified forms of the reserved Han words. */
const FOLD:[RegExp,string][]=[[/rn/g,'m'],[/vv/g,'w'],[/[il1]/g,'l'],[/0/g,'o'],[/3/g,'e'],[/4/g,'a'],[/5/g,'s'],[/7/g,'t'],[/8/g,'b'],[/9/g,'g'],
  [/员/g,'員'],[/统/g,'統'],[/长/g,'長'],[/务/g,'務'],[/团/g,'團']];
export function skeleton(s:string):string{let k=s.toLowerCase().replace(/_/g,'');for(const [re,to] of FOLD)k=k.replace(re,to);return k;}
const strong=[...BRAND,...AUTHORITY].map(skeleton),weak=COMBO.map(skeleton);
/** Whether `s` is exactly 1–3 parts, at least one strong (and a lone part must be strong). */
function parts(s:string,left:number,hasStrong:boolean):boolean{
  if(!s)return hasStrong;
  if(!left)return false;
  for(const p of strong)if(s.startsWith(p)&&parts(s.slice(p.length),left-1,true))return true;
  for(const p of weak)if(s.startsWith(p)&&parts(s.slice(p.length),left-1,hasStrong))return true;
  return false;
}
/** `key` as checkName returns it. */
export function isReservedName(key:string):boolean{
  const bare=key.replace(/_/g,''),forms=new Set([skeleton(bare),skeleton(bare.replace(/\d+$/,''))]);
  for(const f of forms)if(f&&parts(f,3,false))return true;
  return false;
}
