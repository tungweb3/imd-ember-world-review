import unittest
import urllib.parse
from unittest.mock import patch
import test_world_trial as fixture
from test_world_trial import NOW, ADDRESS
from web import world_auth as w


class IdentityExpiryAuditTests(unittest.TestCase):
    setUp = fixture.TrialTests.setUp
    tearDown = fixture.TrialTests.tearDown
    identity = fixture.TrialTests.identity
    session = fixture.TrialTests.session

    def test_expired_introspection_denies_and_revokes_instead_of_outage(self):
        self.session()
        identity = dict(self.identity(), expires_at=NOW)
        with patch.object(w, '_world_post', return_value=identity), patch.object(w, '_balance', return_value=True):
            self.assertEqual(w.session_eligible('S'*43, require_profile='world'), (None, False))
        db = w._db()
        try:
            self.assertEqual(db.execute('SELECT count(*) FROM world_sessions').fetchone()[0], 0)
        finally:
            db.close()

    def test_expired_login_is_source_expired_denial(self):
        identity = dict(self.identity(), expires_at=NOW-1)
        with patch.object(w, '_world_post', return_value=identity), patch.object(w, '_balance', return_value=True):
            start = w.begin_login('zh', ADDRESS, profile='world')
            state = urllib.parse.parse_qs(urllib.parse.urlparse(start.url).query)['state'][0]
            with self.assertRaisesRegex(w.BridgeDenied, 'source_session_expired'):
                w.complete_login(state, start.flow_cookie, 'C'*43, profile='world')

    def test_identity_now_minus_equal_plus_boundary(self):
        for delta in [-1, 0, 1]:
            with self.subTest(delta=delta):
                self.session()
                identity = dict(self.identity(), expires_at=NOW+delta)
                with patch.object(w, '_world_post', return_value=identity), patch.object(w, '_balance', return_value=True):
                    self.assertEqual(w.session_eligible('S'*43, require_profile='world'),
                                     (ADDRESS, True) if delta > 0 else (None, False))
                w.revoke('S'*43)

    def test_trial_boundary_removes_only_trial_grant(self):
        for delta in [-1, 0, 1]:
            for holder in [False, True]:
                with self.subTest(delta=delta, holder=holder):
                    self.session()
                    with patch.object(w, '_world_post', return_value=self.identity(end=NOW+delta)), patch.object(w, '_balance', return_value=holder):
                        self.assertEqual(w.session_eligible('S'*43, require_profile='world'), (ADDRESS, holder or delta > 0))
                    w.revoke('S'*43)

    def test_network_latency_crossing_identity_expiry_revokes(self):
        self.session()
        identity = dict(self.identity(), expires_at=NOW+1)
        def response(*args):
            w._now_ms.return_value = NOW+2
            return identity
        with patch.object(w, '_world_post', side_effect=response), patch.object(w, '_balance', return_value=True):
            self.assertEqual(w.session_eligible('S'*43, require_profile='world'), (None, False))
        db = w._db()
        try:
            self.assertEqual(db.execute('SELECT count(*) FROM world_sessions').fetchone()[0], 0)
        finally:
            db.close()

    def test_balance_wait_cannot_keep_identity_that_has_expired(self):
        self.session()
        identity = dict(self.identity(active=False), expires_at=NOW+1)
        def balance(*args, **kwargs):
            w._now_ms.return_value = NOW+2
            return True
        with patch.object(w, '_world_post', return_value=identity), patch.object(w, '_balance', side_effect=balance):
            self.assertEqual(w.session_eligible('S'*43, require_profile='world'), (None, False))
        db = w._db()
        try:
            self.assertEqual(db.execute('SELECT count(*) FROM world_sessions').fetchone()[0], 0)
        finally:
            db.close()

    def test_malformed_expiry_is_not_promoted_to_valid_or_expired_identity(self):
        for value in [None, True, str(NOW), float(NOW), NOW+7*86400_000+60_001]:
            with self.subTest(value=value):
                with self.assertRaises(w.BridgeUnavailable):
                    w._identity(dict(self.identity(), expires_at=value))

    def test_external_profile_never_gets_trial_boundary_access(self):
        self.session('external')
        for delta in [-1, 0, 1]:
            with self.subTest(delta=delta), patch.object(w, '_world_post', return_value=self.identity(end=NOW+delta)), patch.object(w, '_balance', return_value=False):
                self.assertEqual(w.session_eligible('S'*43), (ADDRESS, False))


if __name__ == '__main__':
    unittest.main()
