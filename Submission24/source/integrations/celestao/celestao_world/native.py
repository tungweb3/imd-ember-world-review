"""Adapter around the existing pinned calculation endpoints, not a new engine.

Called in process only after the authenticated World payment boundary. It does
not forge an HTTP Origin or weaken the public application's same-origin guard.
"""
import asyncio,json
from fastapi import Request
from starlette.responses import Response
from pydantic import ValidationError

class NativeUnavailable(ValueError):pass
class NativeInputError(ValueError):pass
class NativeNondelivery(ValueError):pass

ANNUAL_ROUTE='/api/reports/annual-ziwei'

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
            if system=='profile':
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
        response=await endpoint(model,request)
        if isinstance(response,Response):
            if response.status_code in (429,502,503):raise NativeUnavailable('ENGINE_TEMPORARILY_UNAVAILABLE')
            if response.status_code!=200:raise NativeNondelivery('CHART_NOT_GENERATED')
            value=json.loads(response.body)
        else:value=response
        result=value.get('result') if isinstance(value,dict) else None
        if not isinstance(result,dict) or result.get('mode')!='live' or result.get('system')!=system:raise NativeUnavailable('INVALID_NATIVE_RESULT')
        if system=='profile':
            document=result.get('document',{})
            if set(document.get('used_sources',[]))!={'ziwei','bazi','western','human'} or document.get('unavailable_sources'):
                raise NativeNondelivery('CHART_NOT_GENERATED')
        if system=='annual_ziwei':
            document=result.get('document')
            if not isinstance(result.get('html'),str) or not isinstance(document,dict) or not document.get('cover'):raise NativeNondelivery('CHART_NOT_GENERATED')
        return result
