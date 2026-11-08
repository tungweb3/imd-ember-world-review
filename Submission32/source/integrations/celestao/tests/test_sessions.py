"""Synthetic identity-storage contracts; real issuer verification is separate."""
from test_vault import VaultFixture,A,B
from celestao_world.sessions import Sessions
from celestao_world.vault import VaultError,Missing

def grant(wallet=A):return {'issuer':'https://imdember.com','audience':'celestao','scope':'fortune:account','address':wallet,'bridge_session':'g'*43,'expires_at':90000}

class SessionTests(VaultFixture):
    def setUp(self):super().setUp();self.sessions=Sessions(self.vault)
    def test_a_delayed_callback_cannot_reestablish_a_superseded_wallet(self):
        first=self.sessions.begin('zh',1000)
        consumed=self.sessions.consume(first['state'],first['cookie'],1100)
        self.sessions.begin('zh',1200,previous_cookie=first['cookie'])
        with self.assertRaisesRegex(VaultError,'SUPERSEDED_LOGIN'):
            self.sessions.issue(grant(A),1300,source_state=consumed['source_state'])
        second=self.sessions.begin('zh',2000)
        consumed=self.sessions.consume(second['state'],second['cookie'],2100)
        token=self.sessions.issue(grant(A),2200,source_state=consumed['source_state'])
        third=self.sessions.begin('zh',2300,previous_cookie=second['cookie'])
        with self.assertRaises(Missing):self.sessions.read(token,2400)
        consumed=self.sessions.consume(third['state'],third['cookie'],2400)
        current=self.sessions.issue(grant(B),2500,source_state=consumed['source_state'])
        self.assertEqual(self.sessions.read(current,2600)['address'],B)
    def test_expired_sessions_leave_at_the_next_sign_in(self):
        old=self.sessions.issue(grant(A),1000)
        count=lambda:self.vault.db.execute('SELECT count(*) FROM wallet_sessions').fetchone()[0]
        self.assertEqual(count(),1)
        expires=self.vault.db.execute('SELECT expires_ms FROM wallet_sessions').fetchone()[0]
        current=grant(B);current['expires_at']=expires+3600000
        self.sessions.issue(current,expires)
        self.assertEqual(count(),1)
        with self.assertRaises(Missing):self.sessions.read(old,expires)
    def test_state_is_cookie_bound_short_lived_and_single_use(self):
        value=self.sessions.begin('zh',1000)
        with self.assertRaisesRegex(VaultError,'INVALID_STATE'):self.sessions.consume(value['state'],'x'*43,2000)
        self.assertEqual(self.sessions.consume(value['state'],value['cookie'],2000)['verifier'],value['verifier'])
        with self.assertRaisesRegex(VaultError,'INVALID_STATE'):self.sessions.consume(value['state'],value['cookie'],2000)
        expired=self.sessions.begin('en',1000)
        with self.assertRaisesRegex(VaultError,'INVALID_STATE'):self.sessions.consume(expired['state'],expired['cookie'],601000)
    def test_wallet_switch_revokes_the_prior_cookie_context_and_tokens_stay_encrypted(self):
        first=self.sessions.issue(grant(),1000)
        self.assertEqual(self.sessions.read(first,1100)['address'],A)
        second=self.sessions.issue(grant(B),1200,previous=first)
        with self.assertRaises(Missing):self.sessions.read(first,1300)
        self.assertEqual(self.sessions.read(second,1300)['address'],B)
        self.assertFalse(self.sessions.check_csrf(second,self.sessions.csrf(first)))
        self.assertTrue(self.sessions.check_csrf(second,self.sessions.csrf(second)))
        self.assertNotEqual(self.sessions.context(first),self.sessions.context(second))
        self.sessions.revoke(second,1400)
        with self.assertRaises(Missing):self.sessions.read(second,1400)
        for file in self.path.parent.glob('vault.sqlite*'):
            raw=file.read_bytes()
            for text in [first,second,A,B,'g'*43]:self.assertNotIn(text.encode(),raw)
    def test_unrelated_scopes_bad_expiry_and_client_tampering_never_create_a_session(self):
        for patch in [{'audience':'aimarket'},{'scope':'gold:spend'},{'issuer':'https://evil.test'},{'expires_at':1000},{'expires_at':True},{'address':'not-a-wallet'},{'bridge_session':'short'}]:
            with self.assertRaises(VaultError):self.sessions.issue({**grant(),**patch},1000)
        self.assertEqual(self.vault.db.execute('SELECT count(*) FROM wallet_sessions').fetchone()[0],0)
