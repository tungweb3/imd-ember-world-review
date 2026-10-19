import test_world_trial as fixture
from test_world_trial import NOW, ADDRESS
from unittest.mock import patch
from web import world_auth as w
import urllib.parse
import unittest

class TrialBoundaryAuditTests(unittest.TestCase):
    setUp=fixture.TrialTests.setUp
    tearDown=fixture.TrialTests.tearDown
    identity=fixture.TrialTests.identity
    session=fixture.TrialTests.session
    def test_expired_trial_still_allows_holder_session(self):
        self.session()
        for end in [NOW-20,NOW]:
            with self.subTest(end=end),patch.object(w,'_world_post',return_value=self.identity(end=end)),patch.object(w,'_balance',return_value=True):
                self.assertEqual(w.session_eligible('S'*43,require_profile='world'),(ADDRESS,True))
                self.assertFalse(w._world_trial(w._identity(self.identity(end=end)),profile='world'))
    def test_expired_trial_still_allows_holder_login(self):
        with patch.object(w,'_world_post',return_value=self.identity(end=NOW-20)),patch.object(w,'_balance',return_value=True):
            start=w.begin_login('zh',ADDRESS,profile='world')
            state=urllib.parse.parse_qs(urllib.parse.urlparse(start.url).query)['state'][0]
            self.assertEqual(w.complete_login(state,start.flow_cookie,'C'*43,profile='world').address,ADDRESS)
    def test_expired_trial_never_grants_nonholder_access(self):
        self.session()
        with patch.object(w,'_world_post',return_value=self.identity(end=NOW)),patch.object(w,'_balance',return_value=False):
            self.assertEqual(w.session_eligible('S'*43,require_profile='world'),(ADDRESS,False))

if __name__=='__main__':unittest.main()
