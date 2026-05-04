from __future__ import annotations

from percy.bridge import (
    BridgeAxis,
    BridgeChart,
    BridgeSlide,
    ChartDataSource,
    ChartSeries,
    ChartWorkbookCell,
    ChartWorkbookSheet,
    PercyDocument,
    Position,
)


def test_chart_has_axis_subcomponents() -> None:
    chart = BridgeChart(
        chart_type="COLUMN_CLUSTERED",
        position=Position(left=1.0, top=2.0, width=6.0, height=3.5),
        series=[ChartSeries(name="Revenue", values=[1.0, 2.0, 3.0])],
    )

    assert isinstance(chart.category_axis, BridgeAxis)
    assert isinstance(chart.value_axis, BridgeAxis)
    assert chart.element_type == "BridgeChart"
    assert chart.position.left == 1.0
    assert chart.series[0].values == [1.0, 2.0, 3.0]


def test_document_groups_bridge_slides() -> None:
    document = PercyDocument(slides=[BridgeSlide(slide_number=1, elements=[BridgeChart()])])

    assert document.slides[0].slide_number == 1
    assert document.slides[0].elements[0].element_type == "BridgeChart"


def test_chart_data_source_can_hold_structured_workbook_cells() -> None:
    source = ChartDataSource(
        source_kind="embedded_workbook",
        workbook_sheets=[
            ChartWorkbookSheet(
                name="Sheet1",
                dimension="A1:B2",
                cells=[ChartWorkbookCell(address="B2", row=2, column=2, value=12.5, data_type="n")],
            )
        ],
    )

    assert source.workbook_sheets[0].cells[0].address == "B2"
    assert source.workbook_sheets[0].cells[0].value == 12.5
