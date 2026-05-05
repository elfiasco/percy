"""Tests for connect output → element data binding (the 'monday refresh' demo)."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

os.environ["PERCY_PUBLIC_DEV"] = "1"

from percy.agent import connect_apply
from percy.agent.script_api import Studio
from percy.bridge import BridgeSlide, PercyDocument, PresentationMetadata
from percy.bridge import builders


THEME = {"ACCENT_1": "#3B82F6", "ACCENT_2": "#10B981", "TX1": "#1E293B"}


@pytest.fixture
def client_and_doc():
    from app.backend import main as backend_main
    doc_id = "test-connect-apply"
    doc = PercyDocument(
        slides=[BridgeSlide(slide_number=1, elements=[], width=13.333, height=7.5)],
        metadata=PresentationMetadata(slide_count=1),
        theme_colors=THEME,
    )
    # Create a chart with stale data
    chart = builders.build_chart({
        "chart_type": "column_clustered",
        "categories": ["Q1", "Q2"],
        "series": [{"name": "Revenue", "values": [10, 20]}],
        "position": {"left_in": 1, "top_in": 1, "width_in": 6, "height_in": 4},
        "name": "Revenue Chart",
    }, THEME, slide=doc.slides[0])
    doc.slides[0].elements.append(chart)

    backend_main._docs[doc_id] = {
        "doc": doc, "bridge_dir": backend_main._CACHE_DIR / doc_id / "bridge",
        "name": doc_id, "kind": "pptx",
        "_undo_stack": [], "_redo_stack": [],
    }
    (backend_main._CACHE_DIR / doc_id / "bridge").mkdir(parents=True, exist_ok=True)
    yield TestClient(backend_main.app), doc_id, doc, chart
    backend_main._docs.pop(doc_id, None)


class TestApplyChartOutput:
    def test_full_chart_replacement(self, client_and_doc):
        client, doc_id, doc, chart = client_and_doc
        studio = Studio(base_url="http://test", doc_id=doc_id,
                        asgi_app=client.app)
        eid = str(chart.identification.shape_id)

        result = connect_apply.apply_connect_output(
            studio=studio, slide_n=1, element_id=eid,
            element_type="BridgeChart",
            output={
                "categories": ["Q1", "Q2", "Q3", "Q4"],
                "series": [
                    {"name": "Revenue", "values": [100, 120, 130, 140]},
                    {"name": "Cost",    "values": [80, 90, 95, 100]},
                ],
            },
        )
        assert result.ok and result.applied, f"didn't apply: {result.reason}"

        # Verify the live chart has new data
        assert chart.categories.categories == ["Q1", "Q2", "Q3", "Q4"]
        assert len(chart.series) == 2
        assert chart.series[0].values == [100.0, 120.0, 130.0, 140.0]
        assert chart.series[1].name == "Cost"

    def test_dataframe_shape_coercion(self, client_and_doc):
        client, doc_id, doc, chart = client_and_doc
        studio = Studio(base_url="http://test", doc_id=doc_id,
                        asgi_app=client.app)
        eid = str(chart.identification.shape_id)

        result = connect_apply.apply_connect_output(
            studio=studio, slide_n=1, element_id=eid,
            element_type="BridgeChart",
            output={
                "columns": ["Quarter", "Revenue"],
                "rows": [["Q1", 100], ["Q2", 120], ["Q3", 130]],
            },
        )
        assert result.ok and result.applied, result.reason
        assert chart.categories.categories == ["Q1", "Q2", "Q3"]
        assert chart.series[0].values == [100.0, 120.0, 130.0]


class TestApplyTextOutput:
    def test_string_output(self, client_and_doc):
        client, doc_id, doc, _ = client_and_doc
        # Add a text element
        text_el = builders.build_text({
            "text": "Old text",
            "position": {"left_in": 1, "top_in": 5, "width_in": 8, "height_in": 0.5},
        }, THEME, slide=doc.slides[0])
        doc.slides[0].elements.append(text_el)

        studio = Studio(base_url="http://test", doc_id=doc_id, asgi_app=client.app)
        eid = str(text_el.identification.shape_id)
        result = connect_apply.apply_connect_output(
            studio=studio, slide_n=1, element_id=eid,
            element_type="BridgeShape", output="$4.2M revenue this quarter",
        )
        assert result.ok and result.applied
        # Live element text should be updated
        first_run = text_el.text_content.paragraphs[0].runs[0]
        assert first_run.text == "$4.2M revenue this quarter"


class TestRefreshActuallyRefreshes:
    def test_refresh_applies_connect_output(self, client_and_doc):
        """End-to-end: connect script → refresh → chart updates."""
        client, doc_id, doc, chart = client_and_doc
        # Attach a connect script that returns refreshed data
        chart.custom_properties = {"connect": {
            "script": (
                "def run(slide, inputs, studio):\n"
                "    return {\n"
                "        'categories': ['Q1', 'Q2', 'Q3', 'Q4'],\n"
                "        'series': [\n"
                "            {'name': 'Revenue', 'values': [200, 220, 240, 260]}\n"
                "        ],\n"
                "    }\n"
            ),
            "inputs": {},
        }}

        # Sanity check current state
        assert chart.categories.categories == ["Q1", "Q2"]
        assert chart.series[0].values == [10.0, 20.0]

        # Run refresh
        r = client.post(f"/api/docs/{doc_id}/refresh", json={})
        assert r.status_code == 200, r.text
        body = r.json()
        # The connect should have run + applied
        connect_outcomes = [o for o in body["outcomes"] if o["kind"] == "connect"]
        assert len(connect_outcomes) == 1
        assert connect_outcomes[0]["ok"]

        # And the chart should have new data
        assert chart.categories.categories == ["Q1", "Q2", "Q3", "Q4"]
        assert chart.series[0].values == [200.0, 220.0, 240.0, 260.0]
