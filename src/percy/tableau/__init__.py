"""Percy Tableau import/export helpers.

Converts BridgeChart and BridgeTable elements to self-contained .twbx files
that can be opened directly in Tableau Desktop or published to Tableau Server.
Also onboards .twb/.twbx workbooks into existing Percy bridge elements.

Usage::

    from percy.tableau import chart_to_twbx, table_to_twbx

    twbx = chart_to_twbx(my_chart, my_datasource, sheet_name="Revenue")
    Path("revenue.twbx").write_bytes(twbx)
"""

from percy.tableau.export import chart_to_twbx, table_to_twbx
from percy.tableau.onboard import inspect_tableau, onboard_tableau

__all__ = ["chart_to_twbx", "inspect_tableau", "onboard_tableau", "table_to_twbx"]
