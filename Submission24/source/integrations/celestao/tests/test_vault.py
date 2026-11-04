"""Synthetic storage contracts only, not a live chart or payment certification."""
import copy, sqlite3, tempfile, unittest
from pathlib import Path
from celestao_world.vault import Vault,VaultError,Missing,UNPAID_GRACE_MS

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
            r=self.vault.prepare(A,'request_page_'+str(i).zfill(6),'bazi',INPUT,True,1000+i)
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
        admitted=self.vault.prepare(A,'request_admitted_001','bazi',INPUT,True,1000);self.vault.admit(A,admitted['id'])
        self.assertEqual(UNPAID_GRACE_MS,30*86400000)
        unadmitted=self.vault.prepare(A,'request_unadmitted_1','bazi',INPUT,True,1000)
        self.vault.prepare(A,'request_other_000001','bazi',INPUT,True,unadmitted['expires_ms']-1)
        self.assertEqual(self.vault.run(A,unadmitted['id'])['id'],unadmitted['id'])
        self.vault.prepare(A,'request_other_000002','bazi',INPUT,True,unadmitted['expires_ms'])
        with self.assertRaises(Missing):self.vault.run(A,unadmitted['id'])
        end=admitted['expires_ms']+UNPAID_GRACE_MS
        self.vault.prune_unpaid(end-1);self.assertEqual(self.vault.run(A,admitted['id'])['id'],admitted['id'])
        self.vault.prune_unpaid(end)
        with self.assertRaises(Missing):self.vault.run(A,admitted['id'])
        self.assertEqual(self.vault.run(A,bound['id'])['order_id'],ORDER)
    def test_forgetting_removes_only_a_run_no_request_had_admitted(self):
        run=self.vault.prepare(A,'request_admitted_001','bazi',INPUT,True,1000);self.vault.admit(A,run['id'])
        self.vault.forget_unpaid(A,run['id']);self.assertEqual(self.vault.run(A,run['id'])['id'],run['id'])
        new=self.vault.prepare(A,'request_unadmitted_1','bazi',INPUT,True,1000)
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
        bound=self.vault.prepare(A,'request_bound_000001','bazi',INPUT,True,1000);self.vault.bind_order(A,bound['id'],ORDER)
        self.assertEqual(self.vault.prepare(A,'request_bound_000001','bazi',INPUT,True,5000000)['expires_ms'],bound['expires_ms'])
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
