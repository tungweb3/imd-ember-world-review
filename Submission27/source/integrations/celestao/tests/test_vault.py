"""Synthetic storage contracts only, not a live chart or payment certification."""
import copy, sqlite3, tempfile, unittest
from pathlib import Path
from celestao_world.vault import Vault,VaultError,Missing,UNPAID_GRACE_MS,FAILED_ATTEMPTS_SPAN_MS,FAILED_RETENTION_MS,PRUNE_BATCH

ROOT=Path(__file__).resolve().parents[1]
TEMP=ROOT/'.test-temp'
KEY=bytes(range(32))
A='0x'+'a'*40;B='0x'+'b'*40
ORDER='0x'+'1'*64
INPUT={'name':'合成旅人','date':'1990-01-02','time':'03:04','consent':True}
RESULT={'schema_version':'1.1','mode':'live','system':'bazi','input':dict(INPUT),'data':{'synthetic':True},'report':{'body':'合成驗證資料，並非真人命盤。'}}

class VaultFixture(unittest.TestCase):
    def setUp(self):
        TEMP.mkdir(exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(dir=TEMP)
        self.path=Path(self.temp.name).resolve()/'vault.sqlite'
        self.assertTrue(self.path.parent.is_relative_to(TEMP.resolve()))
        self.vault=Vault(self.path,KEY)
    def tearDown(self):
        self.vault.close()
        target=Path(self.temp.name)
        self.assertFalse(target.is_symlink())
        self.assertTrue(target.resolve().is_relative_to(TEMP.resolve()))
        self.assertNotEqual(target.resolve(),TEMP.resolve())
        self.temp.cleanup()
    def prepared(self,rid='request_fixture_0001'):
        r=self.vault.prepare(A,rid,'bazi',INPUT,True,1000)
        self.vault.bind_order(A,r['id'],ORDER)
        c=self.vault.claim(A,r['id'],ORDER,1100)
        return r,c
    def saved(self):
        r,c=self.prepared();record=self.vault.complete(A,r['id'],c['attempt'],RESULT,1200)
        return r,c,record

class VaultTests(VaultFixture):
    def test_encrypted_roundtrip_preserves_native_document_member_order(self):
        r,c=self.prepared()
        result={**RESULT,'document':{'z_projection':{'last':1,'first':2},'a_projection':{'y':3,'x':4}}}
        record=self.vault.complete(A,r['id'],c['attempt'],result,1200)
        saved=self.vault.read(A,record)
        self.assertEqual(list(saved),list(result))
        self.assertEqual(list(saved['document']),['z_projection','a_projection'])
        self.assertEqual(list(saved['document']['z_projection']),['last','first'])
    def test_online_backup_restore_and_keyset_pagination(self):
        for i in range(103):
            r=self.vault.prepare(A,'request_page_'+str(i).zfill(6),'bazi',{**INPUT,'name':'page '+str(i)},True,1000+i)
            order='0x'+format(i+1,'064x');self.vault.bind_order(A,r['id'],order)
            c=self.vault.claim(A,r['id'],order,2000)
            self.vault.complete(A,r['id'],c['attempt'],RESULT,3000)
        first=self.vault.page(A);second=self.vault.page(A,before=first['nextCursor'])
        self.assertEqual(len(first['records']),100);self.assertEqual(len(second['records']),3)
        ids=[r['id'] for r in first['records']+second['records']];self.assertEqual(len(set(ids)),103)
        with self.assertRaises(Missing):self.vault.page(B,before=first['nextCursor'])
        backup=self.path.parent/'snapshot.sqlite';self.vault.backup(backup)
        restored=Vault(backup,KEY)
        try:self.assertEqual(restored.read(A,ids[-1]),RESULT)
        finally:restored.close()
        with self.assertRaisesRegex(VaultError,'BACKUP_TARGET_EXISTS'):self.vault.backup(backup)
    def test_a_run_world_never_admitted_leaves_at_its_expiry_and_an_admitted_one_after_the_grace(self):
        bound=self.vault.prepare(A,'request_bound_000001','bazi',INPUT,True,1000);self.vault.admit(A,bound['id']);self.vault.bind_order(A,bound['id'],ORDER)
        admitted=self.vault.prepare(A,'request_admitted_001','bazi',{**INPUT,'name':'admitted'},True,1000);self.vault.admit(A,admitted['id'])
        self.assertEqual(UNPAID_GRACE_MS,30*86400000)
        unadmitted=self.vault.prepare(A,'request_unadmitted_1','bazi',{**INPUT,'name':'unadmitted'},True,1000)
        self.vault.prepare(A,'request_other_000001','bazi',{**INPUT,'name':'other 1'},True,unadmitted['expires_ms']-1)
        self.assertEqual(self.vault.run(A,unadmitted['id'])['id'],unadmitted['id'])
        self.vault.prepare(A,'request_other_000002','bazi',{**INPUT,'name':'other 2'},True,unadmitted['expires_ms'])
        with self.assertRaises(Missing):self.vault.run(A,unadmitted['id'])
        end=admitted['expires_ms']+UNPAID_GRACE_MS
        self.vault.prune_unpaid(end-1);self.assertEqual(self.vault.run(A,admitted['id'])['id'],admitted['id'])
        self.vault.prune_unpaid(end)
        with self.assertRaises(Missing):self.vault.run(A,admitted['id'])
        self.assertEqual(self.vault.run(A,bound['id'])['order_id'],ORDER)
    def test_forgetting_removes_only_a_run_no_request_had_admitted(self):
        run=self.vault.prepare(A,'request_admitted_001','bazi',INPUT,True,1000);self.vault.admit(A,run['id'])
        self.vault.forget_unpaid(A,run['id']);self.assertEqual(self.vault.run(A,run['id'])['id'],run['id'])
        new=self.vault.prepare(A,'request_unadmitted_1','bazi',{**INPUT,'name':'unadmitted'},True,1000)
        self.vault.forget_unpaid(A,new['id'])
        with self.assertRaises(Missing):self.vault.run(A,new['id'])
        with self.assertRaises(Missing):self.vault.admit(A,new['id'])
    def test_a_run_without_the_mark_counts_as_admitted_whichever_version_wrote_it(self):
        run=self.vault.prepare(A,'request_legacy_00001','bazi',INPUT,True,1000)
        self.vault.db.execute('ALTER TABLE runs DROP COLUMN unadmitted');self.vault.close()
        self.vault=Vault(self.path,KEY)
        self.vault.prepare(A,'request_other_000001','bazi',INPUT,True,run['expires_ms'])
        self.assertEqual(self.vault.run(A,run['id'])['id'],run['id'])
    def test_a_repeated_request_reopens_an_expired_unpaid_run_and_not_a_bound_one(self):
        unpaid=self.vault.prepare(A,'request_unpaid_00001','bazi',INPUT,True,1000);self.vault.admit(A,unpaid['id'])
        self.assertTrue(unpaid['fresh'])
        same=self.vault.prepare(A,'request_unpaid_00001','bazi',INPUT,True,2000)
        self.assertNotIn('fresh',same);self.assertEqual(same['expires_ms'],unpaid['expires_ms'])
        again=self.vault.prepare(A,'request_unpaid_00001','bazi',INPUT,True,unpaid['expires_ms'])
        self.assertEqual(again['id'],unpaid['id']);self.assertEqual(again['expires_ms'],unpaid['expires_ms']+900000)
        bound=self.vault.prepare(A,'request_bound_000001','bazi',{**INPUT,'name':'bound'},True,1000);self.vault.bind_order(A,bound['id'],ORDER)
        self.assertEqual(self.vault.prepare(A,'request_bound_000001','bazi',{**INPUT,'name':'bound'},True,5000000)['expires_ms'],bound['expires_ms'])
    def test_a_new_request_for_the_same_reading_reopens_its_run_and_keeps_it_as_it_is_otherwise(self):
        unpaid=self.vault.prepare(A,'request_unpaid_00001','bazi',INPUT,True,1000);self.vault.admit(A,unpaid['id'])
        late=self.vault.prepare(A,'request_reloaded_001','bazi',INPUT,True,unpaid['expires_ms'])
        self.assertEqual(late['id'],unpaid['id']);self.assertNotIn('fresh',late);self.assertEqual(late['expires_ms'],unpaid['expires_ms']+900000)
        self.vault.bind_order(A,unpaid['id'],ORDER);bound=self.vault.prepare(A,'request_reloaded_002','bazi',INPUT,True,9000000)
        self.assertEqual(bound['id'],unpaid['id']);self.assertEqual(bound['expires_ms'],late['expires_ms'])
    def test_old_duplicates_resolve_to_the_run_the_buyer_holds_most_of(self):
        rows=[]
        for i,state in enumerate(('prepared','prepared','complete','prepared')):
            rows.append(self.vault.prepare(A,'request_dup_00000'+str(i),'bazi',{**INPUT,'name':str(i)},True,1000+i))
        digest=rows[0]['input_hash']
        self.vault.db.execute('UPDATE runs SET input_hash=?',(digest,))
        self.assertEqual(self.vault.prepare(A,'request_dup_lookup_0','bazi',{**INPUT,'name':'0'},True,1100)['id'],rows[3]['id'])
        self.vault.db.execute("UPDATE runs SET order_id=? WHERE id=?",(ORDER,rows[1]['id']))
        self.assertEqual(self.vault.prepare(A,'request_dup_lookup_1','bazi',{**INPUT,'name':'0'},True,1100)['id'],rows[1]['id'])
        self.vault.db.execute("UPDATE runs SET state='complete' WHERE id=?",(rows[2]['id'],))
        self.assertEqual(self.vault.prepare(A,'request_dup_lookup_2','bazi',{**INPUT,'name':'0'},True,1100)['id'],rows[2]['id'])
    def test_failed_attempts_need_both_the_count_and_the_span_and_survive_a_restart(self):
        run=self.vault.prepare(A,'request_strikes_0001','bazi',INPUT,True,1000);self.vault.bind_order(A,run['id'],ORDER);claim=self.vault.claim(A,run['id'],ORDER,1100);attempt=claim['attempt']
        self.assertFalse(self.vault.strike(A,run['id'],attempt,2000));self.vault.close();self.vault=Vault(self.path,KEY)
        self.assertFalse(self.vault.strike(A,run['id'],attempt,2000+FAILED_ATTEMPTS_SPAN_MS))
        self.assertTrue(self.vault.strike(A,run['id'],attempt,2000+FAILED_ATTEMPTS_SPAN_MS));self.assertEqual(self.vault.run(A,run['id'])['state'],'failed')
        other=self.vault.prepare(A,'request_strikes_0002','bazi',{**INPUT,'name':'quick'},True,1000);order='0x'+'3'*64;self.vault.bind_order(A,other['id'],order);attempt=self.vault.claim(A,other['id'],order,1100)['attempt']
        for i in range(5):self.assertFalse(self.vault.strike(A,other['id'],attempt,2000+i))
        self.assertTrue(self.vault.strike(A,other['id'],attempt,1999+FAILED_ATTEMPTS_SPAN_MS+1));self.assertEqual(FAILED_ATTEMPTS_SPAN_MS,3600000)
    def failed(self,request='request_failed_00001',order=ORDER):
        run=self.vault.prepare(A,request,'bazi',INPUT,True,1000);self.vault.admit(A,run['id']);self.vault.bind_order(A,run['id'],order)
        claim=self.vault.claim(A,run['id'],order,1100);self.vault.fail(A,run['id'],claim['attempt'],'CHART_NOT_GENERATED');return run
    def test_the_failed_retention_is_the_30_days_the_privacy_page_states(self):
        self.assertEqual(FAILED_RETENTION_MS,30*86400000)
    def test_a_failed_run_keeps_its_birth_details_until_the_retention_ends_and_only_then_goes(self):
        run=self.failed();self.assertEqual(self.vault.prune_failed(5000),0)
        self.assertEqual(self.vault.prune_failed(5000+FAILED_RETENTION_MS-1),0);self.assertEqual(self.vault.run(A,run['id'])['state'],'failed');self.assertFalse(self.vault.was_pruned(A,run['id']))
        self.assertEqual(self.vault.prune_failed(5000+FAILED_RETENTION_MS),1);self.assertTrue(self.vault.was_pruned(A,run['id']));self.assertFalse(self.vault.was_pruned(B,run['id']))
        with self.assertRaises(Missing):self.vault.run(A,run['id'])
        self.assertEqual(self.vault.db.execute('SELECT COUNT(*) FROM runs').fetchone()[0],0)
    def test_the_retention_counts_from_when_a_failure_is_first_seen_so_old_rows_are_not_removed_at_once(self):
        run=self.failed();self.assertEqual(self.vault.prune_failed(10**13),0);self.assertEqual(self.vault.run(A,run['id'])['state'],'failed')
    def test_a_later_pass_does_not_restart_the_retention(self):
        self.failed();self.vault.prune_failed(5000);self.vault.prune_failed(6000);self.assertEqual(self.vault.prune_failed(5000+FAILED_RETENTION_MS),1)
    def test_every_way_of_failing_is_counted_and_the_tool_can_end_one(self):
        run=self.vault.prepare(A,'request_failed_00002','bazi',INPUT,True,1000);self.vault.admit(A,run['id']);self.vault.bind_order(A,run['id'],ORDER);self.vault.abandon(ORDER)
        self.vault.prune_failed(5000);self.assertEqual(self.vault.prune_failed(5000+FAILED_RETENTION_MS),1)
    def test_only_a_failed_run_is_removed(self):
        old=10**13
        unpaid=self.vault.prepare(A,'request_keep_unpaid_1','bazi',INPUT,True,1000);self.vault.admit(A,unpaid['id'])
        paid=self.vault.prepare(A,'request_keep_paid_001','ziwei',INPUT,True,1000);self.vault.admit(A,paid['id']);self.vault.bind_order(A,paid['id'],'0x'+'1'*64)
        working=self.vault.prepare(A,'request_keep_work_001','western',INPUT,True,1000);self.vault.bind_order(A,working['id'],'0x'+'2'*64);self.vault.claim(A,working['id'],'0x'+'2'*64,1100)
        done=self.vault.prepare(A,'request_keep_done_001','human',INPUT,True,1000);self.vault.bind_order(A,done['id'],'0x'+'3'*64);claim=self.vault.claim(A,done['id'],'0x'+'3'*64,1100)
        self.vault.complete(A,done['id'],claim['attempt'],{**RESULT,'system':'human'},1200)
        self.vault.prune_failed(old);self.assertEqual(self.vault.prune_failed(old+FAILED_RETENTION_MS),0)
        self.assertEqual(self.vault.db.execute('SELECT COUNT(*) FROM runs').fetchone()[0],4);self.assertEqual(self.vault.db.execute('SELECT COUNT(*) FROM pruned_runs').fetchone()[0],0)
    def test_a_pass_removes_one_batch_at_a_time(self):
        rows=[self.failed('request_batch_%06d'%i,'0x%064x'%(i+1)) for i in range(PRUNE_BATCH+1)];self.assertEqual(len(rows),PRUNE_BATCH+1)
        self.vault.prune_failed(5000);self.assertEqual(self.vault.prune_failed(5000+FAILED_RETENTION_MS),PRUNE_BATCH);self.assertEqual(self.vault.prune_failed(5000+FAILED_RETENTION_MS),1)
    def test_an_older_database_gets_the_new_column(self):
        run=self.failed();self.vault.db.execute('ALTER TABLE runs DROP COLUMN failed_ms');self.vault.close();self.vault=Vault(self.path,KEY)
        self.vault.prune_failed(5000);self.assertEqual(self.vault.prune_failed(5000+FAILED_RETENTION_MS),1);self.assertTrue(self.vault.was_pruned(A,run['id']))
    def test_a_pruned_run_is_remembered_by_id_and_owner_only(self):
        run=self.vault.prepare(A,'request_pruned_00001','bazi',INPUT,True,1000);self.vault.admit(A,run['id'])
        self.vault.prune_unpaid(run['expires_ms']+UNPAID_GRACE_MS-1);self.assertFalse(self.vault.was_pruned(A,run['id']))
        self.vault.prune_unpaid(run['expires_ms']+UNPAID_GRACE_MS);self.assertTrue(self.vault.was_pruned(A,run['id']));self.assertFalse(self.vault.was_pruned(B,run['id']))
        self.assertEqual([r[0] for r in self.vault.db.execute('PRAGMA table_info(pruned_runs)')],[0,1]);self.assertEqual(self.vault.db.execute('SELECT COUNT(*) FROM runs').fetchone()[0],0)
    def test_retiring_a_lapsed_run_is_repeatable_and_refuses_a_run_with_an_order(self):
        run=self.vault.prepare(A,'request_lapsed_00001','bazi',INPUT,True,1000);self.vault.admit(A,run['id'])
        key=lambda:self.vault.db.execute('SELECT request_id FROM runs WHERE id=?',(run['id'],)).fetchone()['request_id']
        self.vault.retire_lapsed(A,run['id']);once=key();self.vault.retire_lapsed(A,run['id']);self.assertEqual(key(),once)
        new=self.vault.prepare(A,'request_lapsed_00001','bazi',INPUT,True,2000);self.assertNotEqual(new['id'],run['id']);self.assertTrue(new['fresh'])
        with self.assertRaises(Missing):self.vault.retire_lapsed(B,new['id'])
        self.vault.bind_order(A,new['id'],ORDER)
        with self.assertRaisesRegex(VaultError,'ORDER_CONFLICT'):self.vault.retire_lapsed(A,new['id'])
        working=self.vault.prepare(A,'request_lapsed_00002','bazi',{**INPUT,'name':'working'},True,2000);order='0x'+'2'*64;self.vault.bind_order(A,working['id'],order);self.vault.claim(A,working['id'],order,2100)
        with self.assertRaisesRegex(VaultError,'ORDER_CONFLICT'):self.vault.retire_lapsed(A,working['id'])
        odd=self.vault.prepare(A,'request_lapsed_00003','bazi',{**INPUT,'name':'odd'},True,2000);self.vault.db.execute("UPDATE runs SET state='working' WHERE id=?",(odd['id'],))
        with self.assertRaisesRegex(VaultError,'ORDER_CONFLICT'):self.vault.retire_lapsed(A,odd['id'])
    def test_an_older_vault_file_gains_the_new_column_and_keeps_its_runs(self):
        run=self.vault.prepare(A,'request_upgrade_0001','bazi',INPUT,True,1000);self.vault.db.execute('DROP INDEX runs_input');self.vault.db.execute('ALTER TABLE runs DROP COLUMN retired');self.vault.db.execute('ALTER TABLE runs DROP COLUMN failed_attempts');self.vault.db.execute('ALTER TABLE runs DROP COLUMN first_failed_ms');self.vault.db.execute('DROP TABLE pruned_runs');self.vault.close()
        self.vault=Vault(self.path,KEY);self.assertEqual(self.vault.prepare(A,'request_upgrade_0002','bazi',INPUT,True,1000)['id'],run['id'])
        self.vault.bind_order(A,run['id'],ORDER);claim=self.vault.claim(A,run['id'],ORDER,2000);self.assertFalse(self.vault.strike(A,run['id'],claim['attempt'],2000));self.assertFalse(self.vault.was_pruned(A,run['id']))
    def test_a_failed_run_gives_its_request_to_a_new_run_and_keeps_its_order(self):
        # Audit 447bb70d: a page restored from history still sends the request id of the refunded run.
        r,c=self.prepared();self.vault.fail(A,r['id'],c['attempt'],'CHART_NOT_GENERATED')
        with self.assertRaisesRegex(VaultError,'IDEMPOTENCY_CONFLICT'):self.vault.prepare(A,'request_fixture_0001','bazi',{**INPUT,'time':'04:00'},True,2000)
        self.assertEqual(self.vault.run(A,r['id'])['state'],'failed')
        new=self.vault.prepare(A,'request_fixture_0001','bazi',INPUT,True,2000)
        self.assertNotEqual(new['id'],r['id']);self.assertTrue(new['fresh'])
        self.assertEqual(self.vault.prepare(A,'request_fixture_0001','bazi',INPUT,True,2001)['id'],new['id'])
        old=self.vault.run(A,r['id']);self.assertEqual((old['state'],old['order_id'],old['input_hash']),('failed',ORDER,r['input_hash']))
        self.assertEqual(self.vault.db.execute('SELECT request_id FROM runs WHERE id=?',(r['id'],)).fetchone()['request_id'],'request_fixture_0001~'+r['id'])
        with self.assertRaisesRegex(VaultError,'IDEMPOTENCY_CONFLICT'):self.vault.prepare(A,'request_fixture_0001','bazi',{**INPUT,'time':'04:00'},True,2002)
        self.assertEqual(self.vault.prepare(B,'request_fixture_0001','bazi',INPUT,True,2003)['fresh'],True)
    def test_reopen_and_wallet_isolation(self):
        r,c,record=self.saved()
        self.vault.close();self.vault=Vault(self.path,KEY)
        self.assertEqual(self.vault.read(A.upper().replace('0X','0x'),record),RESULT)
        self.assertEqual(self.vault.list(B),[])
        for action in [lambda:self.vault.read(B,record),lambda:self.vault.run(B,r['id']),lambda:self.vault.trash(B,record,1300)]:
            with self.assertRaises(Missing):action()
        returned=self.vault.read(A,record);returned['input']['name']='changed'
        self.assertEqual(self.vault.read(A,record),RESULT)
    def test_one_request_and_one_order_create_one_original_result(self):
        r,c,record=self.saved()
        again=self.vault.prepare(A,'request_fixture_0001','bazi',INPUT,True,2000)
        self.assertEqual(again['id'],r['id'])
        self.assertIsNone(self.vault.claim(A,r['id'],ORDER,3000))
        self.assertEqual(self.vault.complete(A,r['id'],c['attempt'],RESULT,3000),record)
        self.assertEqual(len(self.vault.list(A)),1)
        with self.assertRaisesRegex(VaultError,'IDEMPOTENCY_CONFLICT'):
            self.vault.prepare(A,'request_fixture_0001','bazi',{**INPUT,'time':'04:00'},True,3000)
        with self.assertRaisesRegex(VaultError,'ORDER_CONFLICT'):
            self.vault.bind_order(A,r['id'],'0x'+'2'*64)
        with self.assertRaisesRegex(VaultError,'DELIVERY_CONFLICT'):
            self.vault.complete(A,r['id'],c['attempt'],{**RESULT,'report':{'body':'changed'}},3000)
    def test_no_plain_birth_data_wallet_or_name_in_database_and_wal(self):
        self.saved()
        for file in self.path.parent.glob('vault.sqlite*'):
            raw=file.read_bytes()
            for text in ['1990-01-02','合成旅人',A,RESULT['report']['body']]:self.assertNotIn(text.encode(),raw)
        row=self.vault.db.execute('SELECT * FROM records').fetchone()
        self.assertNotEqual(row['owner'],A)
        self.assertGreater(len(row['result_blob']),29)
    def test_ciphertext_tamper_and_wrong_storage_key_fail_closed(self):
        r,c,record=self.saved()
        other=Vault(self.path,bytes(reversed(KEY)))
        try:
            with self.assertRaises(Missing):other.read(A,record)
        finally:other.close()
        blob=self.vault.db.execute('SELECT result_blob FROM records WHERE id=?',(record,)).fetchone()[0]
        self.vault.db.execute('UPDATE records SET result_blob=? WHERE id=?',(blob[:-1]+bytes([blob[-1]^1]),record))
        with self.assertRaisesRegex(VaultError,'DOCUMENT_AUTHENTICATION_FAILED'):self.vault.read(A,record)
    def test_only_active_attempt_can_finish_after_lease_recovery(self):
        r,c=self.prepared()
        self.assertIsNone(self.vault.claim(A,r['id'],ORDER,1200))
        resumed=self.vault.claim(A,r['id'],ORDER,122000)
        self.assertNotEqual(resumed['attempt'],c['attempt'])
        with self.assertRaisesRegex(VaultError,'LEASE_LOST'):self.vault.complete(A,r['id'],c['attempt'],RESULT,122100)
        with self.assertRaisesRegex(VaultError,'LEASE_LOST'):self.vault.fail(A,r['id'],c['attempt'],'ENGINE_FAILED')
        record=self.vault.complete(A,r['id'],resumed['attempt'],RESULT,122100)
        self.assertEqual(self.vault.read(A,record),RESULT)
    def test_explicit_save_consent_result_contract_and_clocks(self):
        for value in [False,None,'true',1]:
            with self.assertRaisesRegex(VaultError,'SAVE_CONSENT_REQUIRED'):self.vault.prepare(A,'request_fixture_0001','bazi',INPUT,value,1000)
        self.assertEqual(self.vault.db.execute('SELECT count(*) FROM runs').fetchone()[0],0)
        for now in [True,-1,float('nan'),1.5,'1000']:
            with self.assertRaisesRegex(VaultError,'INVALID_CLOCK'):self.vault.prepare(A,'request_fixture_0001','bazi',INPUT,True,now)
        r,c=self.prepared()
        for result in [{},[],{**RESULT,'mode':'demo'},{**RESULT,'system':'western'}]:
            with self.assertRaises(VaultError):self.vault.complete(A,r['id'],c['attempt'],result,1200)
        self.assertEqual(self.vault.list(A),[])
    def test_trash_is_recoverable_without_recomputation_or_a_new_run(self):
        r,c,record=self.saved()
        self.vault.trash(A,record,1300)
        self.assertEqual(self.vault.list(A),[])
        self.assertEqual(self.vault.list(A,trash=True)[0]['id'],record)
        with self.assertRaises(Missing):self.vault.read(A,record)
        self.vault.trash(A,record,1400,restore=True)
        self.assertEqual(self.vault.read(A,record),RESULT)
        self.assertEqual(self.vault.db.execute('SELECT count(*) FROM runs').fetchone()[0],1)

if __name__=='__main__':unittest.main()
