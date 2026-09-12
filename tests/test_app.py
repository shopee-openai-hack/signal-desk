from dataclasses import replace
from datetime import datetime,timedelta,timezone
from concurrent.futures import ThreadPoolExecutor
import sqlite3
import pytest
from fastapi.testclient import TestClient
from app.config import Settings
from app.main import create_app
from app.planner import build_demo_plan,PlanGenerationError,Planner
from app.session import verify_session
from app.store import SQLiteRunStore,DailyLimitReached

@pytest.fixture
def settings(tmp_path,monkeypatch):
    for name in ['APP_ENV','OPENAI_API_KEY','RAILWAY_ENVIRONMENT_ID','PUBLIC_ORIGIN']:
        monkeypatch.delenv(name,raising=False)
    return replace(Settings.from_env(),db_path=str(tmp_path/'app.sqlite3'),session_secret='test-'*10,
                   session_cookie_secure=False,global_rate_limit_per_minute=100,public_origin='http://testserver')

def test_persistence_isolation_and_forged_cookie(settings):
    with TestClient(create_app(settings)) as a:
        created=a.post('/api/plans',json={'goal':'寫一份明天的展示計畫'})
        assert created.status_code==201
        run=created.json();cookie=dict(a.cookies)
        assert run['mode']=='demo' and len(run['plan']['steps'])==3
        assert 'HttpOnly' in created.headers['set-cookie']
        with TestClient(create_app(settings)) as b:
            assert b.get('/api/runs').json()==[]
            assert b.get('/api/runs/'+run['id']).status_code==404
        a.cookies.set(settings.session_cookie_name,'invalid.signature')
        assert a.get('/api/runs/'+run['id']).status_code==404
    # A different application instance reads the same actual SQLite file.
    with TestClient(create_app(settings),cookies=cookie) as again:
        assert again.get('/api/runs/'+run['id']).json()['status']=='completed'

def test_daily_quota_atomic_across_connections(settings):
    store=SQLiteRunStore(settings.db_path);store.init_schema()
    def reserve(i):
        try: store.create_running(str(i),'test goal',2);return True
        except DailyLimitReached:return False
    with ThreadPoolExecutor(max_workers=6) as pool:
        assert sum(pool.map(reserve,range(8)))==2

def test_global_limit_without_cookie(settings):
    app=create_app(replace(settings,global_rate_limit_per_minute=2))
    outcomes=[]
    for _ in range(3):
        with TestClient(app) as c: outcomes.append(c.post('/api/plans',json={'goal':'test goal'}).status_code)
    assert outcomes==[201,201,429]

def test_origin_body_and_input(settings):
    with TestClient(create_app(settings)) as c:
        assert c.post('/api/plans',json={'goal':'valid goal'},headers={'Origin':'https://other.example'}).status_code==403
        assert c.post('/api/plans',content='hello').status_code==415
        assert c.post('/api/plans',json={'goal':'a'}).status_code==422
        assert c.post('/api/plans',json={'goal':'valid goal','extra':1}).status_code==422
        r=c.post('/api/plans',content=iter([b'{"goal":"valid goal","extra":"',b'x'*20000,b'"}']),headers={'Content-Type':'application/json'})
        assert r.status_code==413

def test_failure_and_stale_state(settings):
    class Broken:
        async def generate(self,goal):raise PlanGenerationError('AI 暫時無法產生規劃，請稍後再試。')
    with TestClient(create_app(settings,planner=Broken())) as c:
        assert c.post('/api/plans',json={'goal':'valid goal'}).status_code==502
        assert c.get('/api/runs').json()[0]['status']=='failed'
    store=SQLiteRunStore(settings.db_path)
    run=store.create_running('stale','old goal',100)
    with sqlite3.connect(settings.db_path) as con:
        con.execute('UPDATE runs SET created_at=? WHERE id=?',((datetime.now(timezone.utc)-timedelta(hours=2)).isoformat(),str(run.id)))
    with TestClient(create_app(settings)) as c:assert c.get('/healthz').status_code==200
    assert store.get_for_visitor('stale',run.id).status=='failed'

def test_production_and_volume_guards(monkeypatch):
    monkeypatch.setenv('APP_ENV','production');monkeypatch.delenv('SESSION_SECRET',raising=False)
    with pytest.raises(RuntimeError):Settings.from_env()
    monkeypatch.setenv('SESSION_SECRET','x'*40);monkeypatch.setenv('PUBLIC_ORIGIN','https://example.com');monkeypatch.setenv('SESSION_COOKIE_SECURE','true')
    monkeypatch.setenv('RAILWAY_ENVIRONMENT_ID','test');monkeypatch.delenv('RAILWAY_VOLUME_MOUNT_PATH',raising=False)
    with pytest.raises(RuntimeError):Settings.from_env()
    monkeypatch.setenv('RAILWAY_VOLUME_MOUNT_PATH','/data');monkeypatch.setenv('DATABASE_PATH','/data/app.sqlite3')
    assert Settings.from_env().db_path=='/data/app.sqlite3'

def test_malformed_session():
    for value in [None,'invalid','a'*43+'.'+'é'*43,'a'*43+'.'+'b'*43]:
        assert verify_session(value,'x'*40) is None

def test_bounded_model_loop(settings,monkeypatch):
    import asyncio,json
    from types import SimpleNamespace
    from app import planner as module
    calls=[]
    class FakeClient:
        def __init__(self,**kwargs): self.chat=SimpleNamespace(completions=self); self.transport=kwargs['http_client']
        async def create(self,**kwargs):
            calls.append(kwargs)
            content='invalid json' if len(calls)==1 else build_demo_plan('test goal').model_dump_json(exclude={'mode'})
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])
        async def close(self):await self.transport.aclose()
    monkeypatch.setattr(module,'AsyncOpenAI',FakeClient)
    async def run():
        p=Planner(replace(settings,openai_api_key='test-only'))
        try: result=await p.generate('test goal');assert result.mode=='live'
        finally: await p.close()
    asyncio.run(run())
    assert len(calls)==2 and calls[0]['max_tokens']==1000
