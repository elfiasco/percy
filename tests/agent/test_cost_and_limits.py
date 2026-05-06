"""Tests for cost tracker, budget enforcer, rate limiter, MCP adapter."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ["PERCY_PUBLIC_DEV"] = "1"

from percy.agent import cost_tracker as ct


@pytest.fixture
def fresh_db():
    tmp = tempfile.mkdtemp(prefix="percy-cost-")
    db_path = Path(tmp) / "agent.db"
    ct._INITIALIZED = False
    ct.init_db(db_path)
    yield db_path
    ct._INITIALIZED = False


# ── Pricing ────────────────────────────────────────────────────────────────


class TestPricing:
    def test_anthropic_sonnet(self):
        c = ct.estimate_cost("anthropic", "claude-sonnet-4-6", 10_000, 2_000)
        # 10k input @ $0.003/k + 2k output @ $0.015/k = $0.03 + $0.03 = $0.06
        assert abs(c - 0.06) < 0.001

    def test_anthropic_opus(self):
        c = ct.estimate_cost("anthropic", "claude-opus-4-7", 1000, 500)
        # 1k @ $0.015 + 0.5k @ $0.075 = 0.015 + 0.0375 = $0.0525
        assert abs(c - 0.0525) < 0.001

    def test_anthropic_haiku(self):
        c = ct.estimate_cost("anthropic", "claude-haiku-4", 1000, 500)
        # 1k @ $0.0008 + 0.5k @ $0.004 = 0.0008 + 0.002 = $0.0028
        assert abs(c - 0.0028) < 0.0001

    def test_bedrock_claude_sonnet(self):
        c = ct.estimate_cost("bedrock", "anthropic.claude-sonnet-4-v1:0", 10_000, 2_000)
        assert abs(c - 0.06) < 0.001

    def test_bedrock_nova_lite(self):
        c = ct.estimate_cost("bedrock", "amazon.nova-lite-v1:0", 10_000, 2_000)
        # 10k @ $0.00006 + 2k @ $0.00024 = 0.0006 + 0.00048
        assert 0.001 < c < 0.0015

    def test_lmstudio_free(self):
        assert ct.estimate_cost("lmstudio", "gpt-oss-20b", 100_000, 20_000) == 0.0

    def test_unknown_provider_returns_zero(self):
        assert ct.estimate_cost("unknown", "model-x", 1000, 1000) == 0.0


# ── Recording + aggregation ────────────────────────────────────────────────


class TestRecording:
    def test_record_and_aggregate_today(self, fresh_db):
        ct.record_call(ct.CallRecord(
            user_id="u1", org_id="org1", doc_id="d1",
            provider="anthropic", model="claude-sonnet-4-6", source="chat",
            input_tokens=5000, output_tokens=1000,
        ), db_path=fresh_db)
        ct.record_call(ct.CallRecord(
            user_id="u1", org_id="org1", doc_id="d1",
            provider="anthropic", model="claude-haiku-4", source="mode_router",
            input_tokens=500, output_tokens=50,
        ), db_path=fresh_db)
        today = ct.org_spend_today("org1", db_path=fresh_db)
        assert today["calls"] == 2
        assert today["input_tokens"] == 5500
        assert today["output_tokens"] == 1050
        assert today["cost_usd"] > 0

    def test_summary_by_source(self, fresh_db):
        ct.record_call(ct.CallRecord(
            user_id="u1", org_id="org1", doc_id="d",
            provider="anthropic", model="claude-sonnet-4-6", source="chat",
            input_tokens=1000, output_tokens=200,
        ), db_path=fresh_db)
        ct.record_call(ct.CallRecord(
            user_id="u1", org_id="org1", doc_id="d",
            provider="anthropic", model="claude-sonnet-4-6", source="generate_deck",
            input_tokens=2000, output_tokens=500,
        ), db_path=fresh_db)
        summary = ct.org_spend_summary("org1", db_path=fresh_db)
        assert "chat" in summary["by_source"]
        assert "generate_deck" in summary["by_source"]
        assert summary["by_source"]["generate_deck"]["calls"] == 1


# ── Budget enforcement ─────────────────────────────────────────────────────


class TestBudget:
    def test_default_budget_allows(self, fresh_db):
        check = ct.check_budget("org1", estimated_input_tokens=1000,
                                  estimated_output_tokens=500, db_path=fresh_db)
        assert check.allowed
        assert check.headroom_today_usd > 0

    def test_daily_token_cap_blocks(self, fresh_db):
        # Insert calls totaling 99k tokens (default cap = 100k)
        ct.record_call(ct.CallRecord(
            user_id="u1", org_id="org1", doc_id="d",
            provider="lmstudio", model="x", source="chat",
            input_tokens=98000, output_tokens=1000,
        ), db_path=fresh_db)
        # A new call asking for 5k tokens would exceed the 100k daily cap
        check = ct.check_budget("org1", estimated_input_tokens=5000,
                                  estimated_output_tokens=500, db_path=fresh_db)
        assert not check.allowed
        assert "daily token budget" in (check.reason or "")

    def test_daily_usd_cap_blocks(self, fresh_db):
        # Force-set a tiny budget then exceed it
        ct.set_org_limits("org1", daily_usd=0.01, db_path=fresh_db)
        ct.record_call(ct.CallRecord(
            user_id="u1", org_id="org1", doc_id="d",
            provider="anthropic", model="claude-opus-4", source="chat",
            input_tokens=1000, output_tokens=200,  # = ~$0.03
        ), db_path=fresh_db)
        check = ct.check_budget(
            "org1", estimated_input_tokens=100, estimated_output_tokens=50,
            model="claude-opus-4", provider="anthropic", db_path=fresh_db,
        )
        assert not check.allowed
        assert "$ budget" in (check.reason or "")

    def test_no_org_id_passes(self, fresh_db):
        check = ct.check_budget(None, db_path=fresh_db)
        assert check.allowed

    def test_set_org_limits_round_trip(self, fresh_db):
        ct.set_org_limits("org-a", daily_tokens=12345, monthly_usd=42.0,
                           db_path=fresh_db)
        limits = ct.get_org_limits("org-a", db_path=fresh_db)
        assert limits.daily_tokens == 12345
        assert limits.monthly_usd == 42.0
        # Defaults preserved for unset fields
        assert limits.daily_usd > 0


# ── Rate limiter ───────────────────────────────────────────────────────────


class TestRateLimiter:
    def test_buckets_refill(self):
        from app.backend.rate_limit import _Bucket
        b = _Bucket(capacity=2.0, rate=1.0, tokens=2.0, updated_at=0.0)
        # Two takes succeed, third fails
        assert b.take(now=0.0)
        assert b.take(now=0.0)
        assert not b.take(now=0.0)
        # After 1 second, one more
        assert b.take(now=1.0)
        assert not b.take(now=1.0)


# ── MCP adapter ────────────────────────────────────────────────────────────


@pytest.fixture
def mcp_client():
    from app.backend import main as backend_main
    return TestClient(backend_main.app)


class TestMCPAdapter:
    def test_initialize(self, mcp_client):
        r = mcp_client.post("/api/mcp", json={
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-03-26"},
        })
        assert r.status_code == 200
        body = r.json()
        assert body["jsonrpc"] == "2.0"
        assert body["id"] == 1
        assert body["result"]["serverInfo"]["name"] == "percy-studio"
        assert "tools" in body["result"]["capabilities"]

    def test_tools_list(self, mcp_client):
        r = mcp_client.post("/api/mcp", json={
            "jsonrpc": "2.0", "id": 2, "method": "tools/list",
        })
        assert r.status_code == 200
        body = r.json()
        tools = body["result"]["tools"]
        assert len(tools) >= 30  # we have 43+ in the manifest
        names = {t["name"] for t in tools}
        assert "chart.create" in names
        assert "agent.find_element" in names
        assert "template.apply" in names
        # Tool descriptors have proper schema
        chart = next(t for t in tools if t["name"] == "chart.create")
        assert chart["inputSchema"]["type"] == "object"
        assert "categories" in chart["inputSchema"]["properties"]

    def test_unknown_method_returns_jsonrpc_error(self, mcp_client):
        r = mcp_client.post("/api/mcp", json={
            "jsonrpc": "2.0", "id": 3, "method": "no/such/method",
        })
        body = r.json()
        assert "error" in body
        assert body["error"]["code"] == -32601

    def test_batch_request(self, mcp_client):
        r = mcp_client.post("/api/mcp", json=[
            {"jsonrpc": "2.0", "id": 1, "method": "ping"},
            {"jsonrpc": "2.0", "id": 2, "method": "ping"},
        ])
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, list)
        assert len(body) == 2
        assert all(b["result"] == {} for b in body)


# ── Cost dashboard endpoint ─────────────────────────────────────────────────


class TestCostDashboard:
    def test_summary_route(self, mcp_client):
        r = mcp_client.get("/api/agent/cost-summary")
        assert r.status_code == 200
        body = r.json()
        assert "limits" in body
        assert "today" in body
        assert "month" in body
        assert "headroom" in body
        assert "utilization_pct" in body

    def test_set_limits_route(self, mcp_client):
        r = mcp_client.put("/api/agent/cost-limits", json={
            "org_id": "test-org-zzz", "daily_tokens": 50000, "monthly_usd": 25,
        })
        assert r.status_code == 200
        body = r.json()
        assert body["ok"]
        assert body["limits"]["daily_tokens"] == 50000
