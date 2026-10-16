// World time (owner, 2026-09-28): the world has ONE clock, UTC+0 for every visitor. Bands (UTC): dawn 05–07, day 07–17,
// dusk 17–19, night 19–05, each boundary blended over an hour (±30 min, smoothstep) so nothing pops. The sky is a
// fixed-latitude equinox arc: the sun rises due east at 06:00, stands highest (due south) at 12:00 and sets due west at
// 18:00; the moon rides the same arc, transiting phase × 24 h later (a full moon at midnight). The phase is the mean
// synodic month from a known new moon (good to ~half a day). Pure: no three.js, no DOM (tests/daynight.test.mjs).

export type Band='dawn'|'day'|'dusk'|'night';
export type BandWeights=Record<Band,number>;
/** Sky position: a unit vector in world axes (x east, y up, z south: north = -Z, layout.ts) and the altitude (rad). */
export type SkyPos={x:number;y:number;z:number;altitude:number};

export const HOUR_MS=3600000,DAY_MS=86400000;
/** The world's latitude (Emberford is Lisbon's, ~38.7° N): the sun's noon altitude is 90° − this. */
export const LATITUDE=38.7*Math.PI/180;
/** Band boundaries (UTC hours) and the half-width of each blend (h). */
export const BOUNDS={dawn:5,day:7,dusk:17,night:19} as const,BLEND=.5;
/** Mean synodic month (days) and a known new moon (2000-01-06 18:14 UTC). */
export const SYNODIC=29.530588853,NEW_MOON_EPOCH=Date.UTC(2000,0,6,18,14);

/** Fractional UTC hour of the day (0 ≤ h < 24) for a timestamp. */
export function utcHour(ms:number){return (((ms%DAY_MS)+DAY_MS)%DAY_MS)/HOUR_MS;}
/** "hh:mm" of the world clock (UTC) for a timestamp. */
export function worldClock(ms:number){const m=Math.floor(utcHour(ms)*60+1e-6)%1440;return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;}
const smooth=(a:number,b:number,x:number)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
/** Band weights (sum 1) at a fractional UTC hour; midnight wraps. */
export function bandWeights(hour:number):BandWeights {
  const h=((hour%24)+24)%24,s=(b:number)=>smooth(b-BLEND,b+BLEND,h);
  const dawn=s(BOUNDS.dawn)-s(BOUNDS.day),day=s(BOUNDS.day)-s(BOUNDS.dusk),dusk=s(BOUNDS.dusk)-s(BOUNDS.night);
  return {dawn,day,dusk,night:Math.max(0,1-dawn-day-dusk)};
}
/** A body on the equinox arc `hours` after its transit (negative: before), in world axes. */
function arc(hours:number):SkyPos {
  const H=hours/24*2*Math.PI,x=-Math.sin(H),y=Math.cos(H)*Math.cos(LATITUDE),z=Math.cos(H)*Math.sin(LATITUDE);
  return {x,y,z,altitude:Math.asin(Math.max(-1,Math.min(1,y)))};
}
/** The sun's sky position at a UTC timestamp. */
export function sunPosition(ms:number):SkyPos{return arc(utcHour(ms)-12);}
/** Moon phase (0 new, .25 first quarter, .5 full, .75 last quarter) and its illuminated share (0..1). */
export function moonPhase(ms:number):{phase:number;lit:number} {
  const phase=((((ms-NEW_MOON_EPOCH)/DAY_MS/SYNODIC)%1)+1)%1;
  return {phase,lit:(1-Math.cos(2*Math.PI*phase))/2};
}
/** The moon's sky position: the sun's arc, transiting phase × 24 h after noon. */
export function moonPosition(ms:number):SkyPos{return arc(utcHour(ms)-12-moonPhase(ms).phase*24);}

/** The world time shown: live (preview null) or the same UTC day at a previewed hour (the time slider, ?hour=). */
export function worldNow(realMs:number,preview:number|null){
  if(preview===null||!Number.isFinite(preview))return realMs;
  const h=((preview%24)+24)%24;return realMs-(((realMs%DAY_MS)+DAY_MS)%DAY_MS)+h*HOUR_MS;
}
/** ?hour=HH or HH:MM (DEV or ?debug=1) forces the world time's hour; otherwise null (live). */
export function hourOverride(search:string,dev:boolean):number|null {
  const q=new URLSearchParams(search),v=q.get('hour');if((!dev&&q.get('debug')!=='1')||v===null)return null;
  const m=/^(\d{1,2})(?::(\d{2}))?$/.exec(v.trim());if(!m)return null;
  const h=Number(m[1]),min=Number(m[2]??0);return h<24&&min<60?h+min/60:null;
}

// The time slider (WorldApp.tsx): quarter-hour stops over one UTC day; null is live, anything else a previewed hour.
export const SLIDER_STEP=.25,SLIDER_MAX=24-SLIDER_STEP;
/** Where the slider's thumb sits: the shown world time's hour, snapped to a stop (23:53 → 23.75, never 24). */
export function sliderValue(realMs:number,preview:number|null){return Math.min(SLIDER_MAX,Math.round(utcHour(worldNow(realMs,preview))/SLIDER_STEP)*SLIDER_STEP);}
/** The preview a slider value asks for (clamped to the day; not a number: back to live). */
export function previewFromSlider(value:number):number|null{return Number.isFinite(value)?Math.min(SLIDER_MAX,Math.max(0,value)):null;}
