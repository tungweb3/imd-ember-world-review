// The Swarm Audit Record block of "My wallet" (remediation 2026-09-29 §6): collapsed at the foot of the panel in every
// state, before sign-in too. What was reviewed and when, where to read it, and where each finding stands; the data and
// the wording are reviewRecord.ts. Written with createElement (no JSX) so tests/review-record renders this very markup.
import {createElement as h} from 'react';
import {REVIEW_RECORD,REVIEW_CHANGED,FINDINGS,recordLabels,versionText,matchText,rereviewText,dateText,findingLine,outLink} from './reviewRecord.ts';

export function AuditRecord({say}:{say:(zh:string,en:string)=>string}){
  const l=recordLabels(say),r=REVIEW_RECORD,row=(k:string,v:unknown)=>[h('dt',{key:k+'t'},k),h('dd',{key:k+'d'},v as string)];
  return h('details',{className:'audit-record'},
    h('summary',null,l.title),
    REVIEW_CHANGED&&h('p',{className:'small-note audit-changed'},l.changed),
    h('dl',null,...row(l.scope,say(r.scope.zh,r.scope.en)),...row(l.version,versionText(say)),...row(l.date,dateText(say)),...row(l.match,matchText(say)),
      ...row(l.job,h('a',outLink(r.jobUrl),r.job.slice(0,8)+'… ↗')),...row(l.report,h('a',outLink(r.reportUrl),'report.md ↗')),...row(l.rereview,rereviewText(say))),
    h('p',{className:'small-note'},l.only),
    h('p',{className:'small-note audit-head'},l.findings),
    h('ul',null,FINDINGS.map(f=>h('li',{key:f.id},findingLine(f,say)))));
}
