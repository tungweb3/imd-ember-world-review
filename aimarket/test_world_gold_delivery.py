import hashlib,json,os,tempfile,unittest,sqlite3
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
from web import world_gold_delivery as d

NOW=2_000_000_000_000
SECRET='local-cross-service-fixture-secret-32'
ORDER=dict(orderId='0x'+'1'*64,wallet='0x'+'a'*40,product='research')
def report(day='2026-10-19',**extra):
    value=dict(report_date=day,chain_id=1,tokens=[dict(name='研究資料',value=0)],**extra)
    value['report_id']=hashlib.sha256(d._raw(value)+b'\n').hexdigest()
    return value

class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.env=patch.dict(os.environ,{'AIMARKET_WORLD_STATE_DB':str(Path(self.temp.name)/'holder_world.sqlite3'),'AIMARKET_BRIDGE_SECRET':SECRET});self.env.start()
    def tearDown(self):self.env.stop();self.temp.cleanup()
    def call(self,order=None,action='deliver',loader=None,header=None):
        raw=d._raw(order or ORDER);path=d.PREFIX+action
        h=header if header is not None else d.signature(SECRET,'request',path,str(NOW//1000),raw)
        status,body,proof=d.handle(path,raw,h,now=lambda:NOW,load_report=loader or report)
        if status==200:self.assertEqual(proof,d.signature(SECRET,'response',path,str(NOW//1000),body))
        return status,json.loads(body)
    def test_no_auth_cannot_create_storage_or_read_a_report(self):
        self.assertEqual(self.call(header='')[0],403);self.assertFalse((Path(self.temp.name)/'world_gold_delivery.sqlite3').exists())
    def test_snapshot_is_immutable_and_once_per_order_even_after_latest_report_changes(self):
        one=self.call();two=self.call(loader=lambda:report('2026-10-20'));self.assertEqual(one,two)
        status,full=self.call(dict(ORDER,reference=one[1]['result']['reportId']),action='read',loader=lambda:None)
        self.assertEqual(status,200);self.assertEqual(full['document']['report_date'],'2026-10-19');self.assertEqual(full['document']['tokens'][0]['name'],'研究資料')
        with closing(sqlite3.connect(Path(self.temp.name)/'world_gold_delivery.sqlite3'))as db:self.assertEqual(db.execute('SELECT count(*) FROM delivery_receipts').fetchone()[0],1)
    def test_same_order_different_wallet_and_wrong_reference_are_denied(self):
        self.call();self.assertEqual(self.call(dict(ORDER,wallet='0x'+'b'*40))[0],409);self.assertEqual(self.call(dict(ORDER,reference='f'*64),action='read')[0],409)
    def test_pending_is_not_failure_and_can_deliver_later(self):
        self.assertEqual(self.call(loader=lambda:None)[1]['kind'],'pending');self.assertEqual(self.call()[1]['kind'],'delivered')
    def test_corrupted_report_cannot_be_declared_delivered_or_refunded(self):
        self.assertEqual(self.call(loader=lambda:dict(report(),tokens=[]))[0],503)
        with closing(sqlite3.connect(Path(self.temp.name)/'world_gold_delivery.sqlite3'))as db:self.assertEqual(db.execute('SELECT count(*) FROM delivery_receipts').fetchone()[0],0)
    def test_deterministic_oversize_is_original_order_nondelivery_with_no_later_delivery(self):
        result=self.call(loader=lambda:report(content='x'*(d.MAX_DOCUMENT+1)));self.assertEqual(result[1]['kind'],'terminal-failure');self.assertEqual(result[1]['proof']['reference'],ORDER['orderId']);self.assertEqual(result,self.call())
    def test_stale_signature_wrong_protocol_body_and_unsupported_service_are_rejected(self):
        raw=d._raw(ORDER);path=d.PREFIX+'deliver'
        self.assertEqual(self.call(header=d.signature(SECRET,'request',path,str(NOW//1000-31),raw))[0],403)
        self.assertEqual(self.call(header=d.signature(SECRET,'response',path,str(NOW//1000),raw))[0],403)
        self.assertEqual(self.call(dict(ORDER,product='fortune'))[0],400)
        bad=b'{"orderId":"x","orderId":"y"}'
        status,_,_=d.handle(path,bad,d.signature(SECRET,'request',path,str(NOW//1000),bad),now=lambda:NOW)
        self.assertEqual(status,400)
    def test_committed_receipt_survives_lost_response_and_clock_failure(self):
        times=iter([NOW,NOW-1]);raw=d._raw(ORDER);path=d.PREFIX+'deliver'
        status,_,_=d.handle(path,raw,d.signature(SECRET,'request',path,str(NOW//1000),raw),now=lambda:next(times),load_report=report)
        self.assertEqual(status,503);self.assertEqual(self.call(loader=lambda:None)[1]['kind'],'delivered')

if __name__=='__main__':unittest.main()
