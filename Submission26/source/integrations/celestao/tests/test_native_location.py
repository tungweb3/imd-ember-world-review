"""What is refused before any payment, because the report could not be made after it. No native tree needed."""
import asyncio,unittest
from types import SimpleNamespace
from celestao_world.native import NativeEngine,NativeInputError,HOUSE_LATITUDE_LIMIT

class Model(SimpleNamespace):
    def model_dump(self,mode=None):return dict(self.__dict__)
class Schema:
    @staticmethod
    def model_validate(value):return Model(**value)

def engine():
    e=NativeEngine.__new__(NativeEngine)
    e.chart_model=e.profile_model=e.annual_model=Schema;e.time_error=LookupError;e.offset=lambda model:8;e.configured=lambda family:True
    e.inspect=lambda request:{'can_compute_primary':True,'requires_partial_acknowledgement':False};e.capability=lambda **fields:fields;e.first_year=lambda value:1900
    return e
BODY={'date':'1990-01-01','time':'12:00','timezone':'Asia/Taipei','dst_fold':None,'consent':True,'lon':10.0}
PROFILE={**BODY,'system':'ziwei','requested_sources':['ziwei','bazi','western','human'],'analysis_timezone':'Asia/Taipei'}

class Location(unittest.TestCase):
    def check(self,system,body):return asyncio.run(engine().validate(system,body))
    def refused(self,system,body,code):
        with self.assertRaisesRegex(NativeInputError,'^'+code+'$'):self.check(system,body)
    def test_the_line_is_the_one_measured_against_the_engine(self):
        self.assertEqual(HOUSE_LATITUDE_LIMIT,66.5)
    def test_western_and_the_full_profile_stop_past_the_line_on_both_sides(self):
        for system,body in (('western',{**BODY,'system':'western'}),('profile',PROFILE)):
            for lat in (66.51,-66.51,69.65,-77.85,89):
                with self.subTest(system=system,lat=lat):self.refused(system,{**body,'lat':lat},'LOCATION_UNSUPPORTED')
            for lat in (66.5,-66.5,25.03,0):
                with self.subTest(system=system,lat=lat):self.assertEqual(self.check(system,{**body,'lat':lat})['lat'],lat)
    def test_systems_without_houses_are_still_sold_there(self):
        for system,body in (('human',{**BODY,'system':'human'}),('ziwei',{**BODY,'system':'ziwei'}),('annual_ziwei',{**BODY,'system':'ziwei','year':2026})):
            with self.subTest(system):self.assertEqual(self.check(system,{**body,'lat':78.22})['lat'],78.22)
    def test_a_profile_outside_the_one_analysis_timezone_is_refused(self):
        self.refused('profile',{**PROFILE,'lat':25.03,'analysis_timezone':'Asia/Hong_Kong'},'INVALID_CHART_INPUT')

if __name__=='__main__':unittest.main()
