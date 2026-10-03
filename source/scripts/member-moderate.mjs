// Name moderation by hand (the owner's 2026-09-30 decision (c): no admin panel; an unsuitable name is handled by command).
// `node scripts/member-moderate.mjs <action> <publicMemberId> [reason] > out.sql` writes the SQL for one member, which is
// then run with: npx wrangler d1 execute imd-world --remote --file=out.sql (after the owner agrees, with a backup export).
//   rename  the name is taken away: the member shows as 會員-<code> and must pick a new name (needs_rename; no cooldown
//           applies to that rename); the old name key becomes 'quarantined' (nobody, the member included, can take it)
//   lock    no name change at all until unlock (PROFILE_LOCKED); the current name stays
//   unlock  back to the state the name implies (ready, needs_name or needs_rename)
// Each action is one file of statements that touch that member only, with a profile_history row (actor 'admin') for a
// rename. Values are validated, never free text: the member id must be a public id (u_ + 20 base32) and the reason
// one of REASONS, so nothing typed here can change the SQL. The member is named by the public id from the member's
// own wallet panel or from a lookup by address [REDACTED], never by the name.
import {fileURLToPath} from 'node:url';
export const REASONS=['impersonation','offensive','spam','other'];
const DAY=86_400_000,HISTORY_KEPT_MS=180*DAY;
/** The SQL text for `action` on member `publicId` at time `now` (ms). Throws on any value outside its pattern. */
export function moderationSql(action,publicId,reason='other',now=Date.now()){
  if(!/^u_[a-z2-9]{20}$/.test(publicId))throw new Error('not a public member id: '+publicId);
  if(!REASONS.includes(reason))throw new Error('reason must be one of '+REASONS.join(', '));
  if(!Number.isSafeInteger(now))throw new Error('bad time');
  const m=`(SELECT member_id FROM members WHERE public_member_id='${publicId}')`,until=now+HISTORY_KEPT_MS;
  const history=(kind,newName)=>`INSERT INTO profile_history(member_id,actor,kind,old_name,new_name,reason,version,at,expires_at)
  SELECT member_id,'admin','${kind}',display_name,${newName},'${reason}',version+1,${now},${until} FROM member_profiles WHERE member_id=${m};`;
  if(action==='rename'){
    const placeholder=`'會員-'||substr('${publicId}',3,6)`;
    return [`-- rename ${publicId} (${reason})`,
      `UPDATE nickname_claims SET claim_type='quarantined',reserved_until=NULL,reason='${reason}',updated_at=${now}
  WHERE claim_type='active' AND member_id=${m};`,
      history('moderation',placeholder),
      `UPDATE member_profiles SET display_name=${placeholder},active_name_key=NULL,profile_state='needs_rename',version=version+1,
  next_name_change_at=NULL,updated_at=${now} WHERE member_id=${m};`].join('\n')+'\n';
  }
  if(action==='lock')return [`-- lock ${publicId} (${reason})`,
    `UPDATE member_profiles SET profile_state='locked',version=version+1,updated_at=${now} WHERE member_id=${m} AND profile_state<>'locked';`].join('\n')+'\n';
  if(action==='unlock')return [`-- unlock ${publicId} (${reason})`,
    `UPDATE member_profiles SET profile_state=CASE WHEN active_name_key IS NOT NULL THEN 'ready' WHEN display_name IS NULL THEN 'needs_name' ELSE 'needs_rename' END,
  version=version+1,updated_at=${now} WHERE member_id=${m} AND profile_state='locked';`].join('\n')+'\n';
  throw new Error('action must be rename, lock or unlock');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const [action,publicId,reason]=process.argv.slice(2);
  try{process.stdout.write(moderationSql(action,publicId,reason));}
  catch(e){console.error(String(e.message)+'\nusage: node scripts/member-moderate.mjs rename|lock|unlock <u_…> ['+REASONS.join('|')+']');process.exit(1);}
}
