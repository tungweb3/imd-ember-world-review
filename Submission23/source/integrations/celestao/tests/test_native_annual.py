"""NativeEngine and the paid 流年運勢 report; synthetic birth data, no GOLD, needs the site tree and node."""
import asyncio,os,unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
BODY={'system':'ziwei','name':'合成旅人','date':'1990-06-15','time':'10:30','gender':'女','timezone':'Asia/Taipei','lat':25.033,'lon':121.5654,
      'city':'Taipei, Taiwan','target':'2027-07-01','ziwei_day_divide':'forward','dst_fold':None,'consent':True,'year':2027,'lang':'zh'}

@unittest.skipUnless((ROOT/'backend'/'annual_ziwei').is_dir() and os.getenv('LIFE_ENGINE_DIR'),'needs the native tree and a configured engine')
class NativeAnnualTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from backend.report_plain_release.app import app
        from celestao_world.native import NativeEngine,NativeInputError
        cls.published=app;cls.engine=NativeEngine(app);cls.input_error=NativeInputError
    def test_public_release_has_no_annual_route(self):
        # Paid only: the published app the site mounts does not serve the annual report.
        self.assertFalse([r for r in self.published.router.routes if getattr(r,'path',None)=='/api/reports/annual-ziwei'])
    def test_a_name_the_reader_would_refuse_is_refused_before_payment(self):
        with self.assertRaisesRegex(self.input_error,'INVALID_CHART_INPUT'):
            asyncio.run(self.engine.validate('annual_ziwei',{**BODY,'name':'Ann onset=1'}))
    def test_a_birth_before_the_lunar_table_is_refused_as_input_not_an_error(self):
        with self.assertRaisesRegex(self.input_error,'INVALID_CHART_INPUT'):
            asyncio.run(self.engine.validate('annual_ziwei',{**BODY,'date':'1900-01-15','target':'1901-07-01','year':1901}))
    def test_validate_accepts_year_and_language_and_refuses_before_birth(self):
        saved=asyncio.run(self.engine.validate('annual_ziwei',BODY))
        self.assertEqual((saved['system'],saved['year'],saved['lang']),('ziwei',2027,'zh'))
        late={**BODY,'date':'2026-08-01','target':'2026-08-01','year':2026}
        with self.assertRaisesRegex(self.input_error,'YEAR_BEFORE_BIRTH'):asyncio.run(self.engine.validate('annual_ziwei',late))
        for patch in [{'target':'2028-07-01'},{'lang':'fr'},{'year':'2027'},{'requested_sources':['ziwei']}]:
            with self.assertRaisesRegex(self.input_error,'INVALID_CHART_INPUT'):asyncio.run(self.engine.validate('annual_ziwei',{**BODY,**patch}))
        # The plain Zi Wei product still refuses the annual fields.
        with self.assertRaisesRegex(self.input_error,'INVALID_CHART_INPUT'):asyncio.run(self.engine.validate('ziwei',BODY))
    def test_compute_returns_the_annual_report(self):
        payload=asyncio.run(self.engine.validate('annual_ziwei',BODY))
        result=asyncio.run(self.engine.compute('annual_ziwei',payload,'fixture'))
        self.assertEqual((result['system'],result['mode'],result['schema_version']),('annual_ziwei','live','annual-ziwei-1.0'))
        self.assertEqual(result['document']['cover']['year'],2027)
        self.assertIn('流年',result['html']);self.assertNotIn('<script',result['html'].lower())

if __name__=='__main__':unittest.main()
