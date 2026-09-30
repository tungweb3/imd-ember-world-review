// The Swarm Audit Record block of "My wallet" (remediation 2026-09-29 §6): collapsed at the foot of the panel in every
// state, before sign-in too. What was reviewed and when, where to read it, and where each finding stands; then the two
// re-reviews of Worker 50c688c9, what they found and where that stands. The data and the wording are reviewRecord.ts.
// Written with createElement (no JSX) so tests/review-record renders this very markup.
import {createElement as h} from 'react';
import {REVIEW_RECORD,REVIEW_CHANGED,FINDINGS,recordLabels,versionText,matchText,dateText,findingLine,outLink,
  rereviewName,rereviewVersionText,rereviewMatchText,type Finding} from './reviewRecord.ts';

export function AuditRecord({say}:{say:(zh:string,en:string)=>string}){
  const l=recordLabels(say),r=REVIEW_RECORD,row=(k:string,v:unknown)=>[h('dt',{key:k+'t'},k),h('dd',{key:k+'d'},v as string)];
  const list=(key:string,findings:readonly Finding[])=>h('ul',{key},findings.map(f=>h('li',{key:f.id},findingLine(f,say))));
  return h('details',{className:'audit-record'},
    h('summary',null,l.title),
    REVIEW_CHANGED&&h('p',{className:'small-note audit-changed'},l.changed),
    h('dl',null,...row(l.scope,say(r.scope.zh,r.scope.en)),...row(l.version,versionText(say)),...row(l.date,dateText(say)),...row(l.match,matchText(say)),
      ...row(l.job,h('a',outLink(r.jobUrl),r.job.slice(0,8)+'… ↗')),...row(l.report,h('a',outLink(r.reportUrl),'report.md ↗')),
      ...row(l.rereview,r.rereviews.flatMap((x,i)=>[i?' · ':null,h('a',{key:x.job,...outLink(x.jobUrl)},rereviewName(x,say)+' ↗')]))),
    h('p',{className:'small-note'},l.only),
    h('p',{className:'small-note audit-head'},l.findings),
    list('F',FINDINGS),
    h('p',{className:'small-note audit-head'},l.rereviews),
    h('dl',null,...row(l.version,rereviewVersionText(say))),
    REVIEW_CHANGED&&h('p',{className:'small-note audit-changed'},l.rereviewOnly),
    ...r.rereviews.flatMap(x=>[
      h('p',{key:x.job+'h',className:'small-note audit-head'},rereviewName(x,say)+' · '+rereviewMatchText(x,say)+' · ',
        x.reportUrl?h('a',outLink(x.reportUrl),'report.md ↗'):say('沒有發布報告檔','no report file published')),
      list(x.job,x.findings)]));
}
