"""Adapter around the existing pinned calculation endpoints, not a new engine.

Called in process only after the authenticated World payment boundary. It does
not forge an HTTP Origin or weaken the public application's same-origin guard.
"""
import asyncio,json
from fastapi import Request
from starlette.exceptions import HTTPException
from starlette.responses import Response
from pydantic import ValidationError

class NativeUnavailable(ValueError):pass
class NativeUnusable(NativeUnavailable):pass
class NativeInputError(ValueError):pass
class NativeNondelivery(ValueError):pass

ANNUAL_ROUTE='/api/reports/annual-ziwei'
# The engine is away or busy: the order waits.
ENGINE_AWAY=frozenset((408,429,502,503,504))
# The engine refuses this input and always will: the order is refunded at once.
ENGINE_REFUSED=frozenset((400,409,422))
# Past the polar circle (about 66.56) Placidus houses have no answer for many birth times. Measured: none refused at or under this line.
HOUSE_LATITUDE_LIMIT=66.5
# The profile endpoint refuses every other analysis timezone.
PROFILE_ANALYSIS_TIMEZONE='Asia/Taipei'

class NativeEngine:
    def __init__(self,baseline):
        from backend.models import ChartRequest,resolve_offset,TimeResolutionError
        from backend.app import configured_engine
        from backend.chart_editorial.endpoint import charts
        from backend.report_profile.request import ProfileReportRequest
        from backend.report_review12.preflight import inspect,CapabilityRequest
        from backend.annual_ziwei.request import AnnualZiweiRequest
        from backend.annual_ziwei.lunar_new_year import first_report_year
        from backend.report_annual_release.app import make_app as annual_release
        self.chart_model=ChartRequest;self.profile_model=ProfileReportRequest;self.annual_model=AnnualZiweiRequest
        self.offset=resolve_offset;self.time_error=TimeResolutionError;self.configured=configured_engine
        self.inspect=inspect;self.capability=CapabilityRequest;self.charts=charts;self.first_year=first_report_year
        matches=[r.endpoint for r in baseline.router.routes if getattr(r,'path',None)=='/api/reports/profile' and 'POST' in getattr(r,'methods',())]
        if len(matches)!=1:raise RuntimeError('CANONICAL_PROFILE_ENDPOINT_REQUIRED')
        self.profile=matches[0]
        # Paid only: the annual route is taken from a release app that is never mounted,
        # so the public site has no free path to it. Rate limit and capacity are shared.
        annual=[r.endpoint for r in annual_release(baseline).router.routes if getattr(r,'path',None)==ANNUAL_ROUTE and 'POST' in getattr(r,'methods',())]
        if len(annual)!=1:raise RuntimeError('ANNUAL_ZIWEI_ENDPOINT_REQUIRED')
        self.annual=annual[0]
    def model(self,system):
        return self.profile_model if system=='profile' else self.annual_model if system=='annual_ziwei' else self.chart_model
    async def validate(self,system,payload):
        try:
            model=self.model(system).model_validate(payload)
            # Western houses are in the western report and in the full profile: both would only fail after payment.
            if system in ('western','profile') and abs(model.lat)>HOUSE_LATITUDE_LIMIT:raise NativeInputError('LOCATION_UNSUPPORTED')
            if system=='profile':
                if model.analysis_timezone!=PROFILE_ANALYSIS_TIMEZONE:raise NativeInputError('INVALID_CHART_INPUT')
                if set(model.requested_sources)!={'ziwei','bazi','western','human'} or len(model.requested_sources)!=4:raise NativeInputError('ALL_FOUR_SOURCES_REQUIRED')
                scope=self.inspect(self.capability(**{k:getattr(model,k) for k in ('date','time','timezone','dst_fold','requested_sources','consent')}))
                if not scope['can_compute_primary'] or scope['requires_partial_acknowledgement']:raise NativeInputError('ALL_FOUR_SOURCES_UNAVAILABLE')
            elif system=='annual_ziwei':
                # The request model says system 'ziwei'; refuse a year that starts before the birth before any payment.
                try:first_year=self.first_year(model.date)
                except ValueError:raise NativeInputError('INVALID_CHART_INPUT') from None
                if model.year<first_year:raise NativeInputError('YEAR_BEFORE_BIRTH')
            elif model.system!=system:raise NativeInputError('SYSTEM_MISMATCH')
            self.offset(model)
        except (ValidationError,self.time_error):raise NativeInputError('INVALID_CHART_INPUT') from None
        families=('bazi','life') if system=='profile' else ('bazi' if system=='bazi' else 'life',)
        for family in families:
            if await asyncio.to_thread(self.configured,family) is None:raise NativeUnavailable('ENGINE_UNAVAILABLE')
        return model.model_dump(mode='json')
    async def compute(self,system,payload,owner):
        model=self.model(system).model_validate(payload)
        endpoint=self.profile if system=='profile' else self.annual if system=='annual_ziwei' else self.charts
        # The existing capacity lock and rate limit remain in force. Use the
        # authenticated opaque owner, not a forged XFF or one shared server IP.
        request=Request({'type':'http','method':'POST','path':'/internal-paid-calculation','headers':[],
            'client':('paid-'+owner,0),'server':('celestao-internal',0),'scheme':'https','query_string':b''})
        try:response=await endpoint(model,request)
        # These endpoints return their status today. One that raises it means the same.
        except HTTPException as exc:response=Response(status_code=exc.status_code)
        if isinstance(response,Response):
            if response.status_code in ENGINE_AWAY:raise NativeUnavailable('ENGINE_TEMPORARILY_UNAVAILABLE')
            if response.status_code in ENGINE_REFUSED:raise NativeNondelivery('CHART_NOT_GENERATED')
            # Any other status, such as 404 or 500, could be a bad deployment. It counts as an attempt, which leaves time to catch one.
            if response.status_code!=200:raise NativeUnusable('UNEXPECTED_ENGINE_STATUS')
            value=json.loads(response.body)
        else:value=response
        result=value.get('result') if isinstance(value,dict) else None
        if not isinstance(result,dict) or result.get('mode')!='live' or result.get('system')!=system:raise NativeUnusable('INVALID_NATIVE_RESULT')
        if system=='profile':
            document=result.get('document',{})
            if set(document.get('used_sources',[]))!={'ziwei','bazi','western','human'} or document.get('unavailable_sources'):
                raise NativeNondelivery('CHART_NOT_GENERATED')
        if system=='annual_ziwei':
            document=result.get('document')
            if not isinstance(result.get('html'),str) or not isinstance(document,dict) or not document.get('cover'):raise NativeNondelivery('CHART_NOT_GENERATED')
        return result
