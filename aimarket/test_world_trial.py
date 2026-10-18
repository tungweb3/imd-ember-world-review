import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from web import world_auth as w

NOW=2_000_000_000_000
ADDRESS='0x'+'a'*40
class TrialTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'AIMARKET_WORLD_STATE_DB':str(Path(self.temp.name)/'world.sqlite'),'AIMARKET_BRIDGE_SECRET':'local-fixture-not-production-secret-32'})
        self.env.start();self.clock=patch.object(w,'_now_ms',return_value=NOW);self.clock.start()
    def tearDown(self):
        self.clock.stop();self.env.stop();self.temp.cleanup()
    def identity(self,active=True,end=NOW+1000):
        return dict(issuer=w.ISSUER,audience=w.CLIENT_ID,scope='research:read',address=ADDRESS,expires_at=NOW+10000,bridge_session='B'*43,world_trial=dict(active=active,endsMs=end,version=1))
    def session(self,profile='world'):
        db=w._db()
        with db:db.execute('INSERT INTO world_sessions(token_hash,address,bridge_session,expires_at,profile) VALUES(?,?,?,?,?)',(w._digest('S'*43),ADDRESS,'B'*43,NOW+5000,profile))
        db.close()
    def test_old_identity_stays_compatible(self):
        i=self.identity();del i['world_trial'];self.assertEqual(w._identity(i)['address'],ADDRESS)
    def test_authenticated_trial_is_world_only(self):
        i=w._identity(self.identity());self.assertTrue(w._world_trial(i,profile='world'));self.assertFalse(w._world_trial(i,profile='external'));self.assertFalse(w._world_trial(i,profile=None))
    def test_invalid_or_client_style_claims_rejected(self):
        for trial in [True,{'active':True},{'active':1,'endsMs':NOW+100,'version':1},{'active':True,'endsMs':NOW,'version':1},{'active':True,'endsMs':NOW+100,'version':0}]:
            i=self.identity();i['world_trial']=trial
            with self.assertRaises(w.BridgeUnavailable):w._identity(i)
    def test_trial_end_and_manual_stop_apply_on_next_read_without_relogin(self):
        self.session();current=self.identity()
        with patch.object(w,'_world_post',side_effect=lambda *a:current),patch.object(w,'_balance',return_value=False):
            self.assertEqual(w.session_eligible('S'*43,require_profile='world'),(ADDRESS,True))
            current['world_trial']['active']=False
            self.assertEqual(w.session_eligible('S'*43,require_profile='world'),(ADDRESS,False))
    def test_external_session_cannot_use_trial_claim(self):
        self.session('external')
        with patch.object(w,'_world_post',return_value=self.identity()),patch.object(w,'_balance',return_value=False):
            self.assertEqual(w.session_eligible('S'*43),(ADDRESS,False));self.assertEqual(w.session_eligible('S'*43,require_profile='world'),(None,False))
    def test_untrusted_or_revoked_source_cannot_keep_trial(self):
        self.session()
        with patch.object(w,'_world_post',side_effect=w.BridgeDenied('revoked')):
            self.assertEqual(w.session_eligible('S'*43,require_profile='world'),(None,False))
    def test_world_login_can_use_trial_without_holder_balance(self):
        with patch.object(w,'_world_post',return_value=self.identity()),patch.object(w,'_balance',return_value=False):
            start=w.begin_login('zh',ADDRESS,profile='world')
            import urllib.parse
            state=urllib.parse.parse_qs(urllib.parse.urlparse(start.url).query)['state'][0]
            result=w.complete_login(state,start.flow_cookie,'C'*43,profile='world')
            self.assertEqual(result.address,ADDRESS)

if __name__=='__main__':unittest.main()
