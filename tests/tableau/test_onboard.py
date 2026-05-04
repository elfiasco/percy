from __future__ import annotations

import zipfile
from pathlib import Path

from percy.bridge import BridgeChart, BridgeImage, BridgeTable
from percy.tableau import onboard_tableau


def test_onboard_tableau_extracts_existing_bridge_elements():
    output_dir = Path("out/test-tableau-onboard")
    output_dir.mkdir(parents=True, exist_ok=True)
    twbx_path = output_dir / "sample.twbx"
    workbook_xml = """<?xml version='1.0' encoding='utf-8' ?>
<workbook source-build='2024.1.0' source-platform='win' version='18.1'>
  <datasources>
    <datasource caption='Orders' inline='true' name='orders' version='18.1'>
      <connection class='federated'>
        <relation name='Orders' table='[Orders]' type='table'>
          <columns>
            <column datatype='string' name='Category' ordinal='0' />
            <column datatype='real' name='Sales' ordinal='1' />
          </columns>
        </relation>
      </connection>
      <column datatype='string' name='[Category]' role='dimension' type='nominal' />
      <column datatype='real' name='[Sales]' role='measure' type='quantitative' />
    </datasource>
  </datasources>
  <worksheets>
    <worksheet name='Sales Chart'>
      <table>
        <view>
          <datasources><datasource caption='Orders' name='orders' /></datasources>
          <datasource-dependencies datasource='orders'>
            <column datatype='string' name='[Category]' role='dimension' type='nominal' />
            <column datatype='real' name='[Sales]' role='measure' type='quantitative' />
            <column datatype='real' name='[SalesPlusOne]' role='measure' type='quantitative'>
              <calculation class='tableau' formula='[Sales] + 1' />
            </column>
            <column-instance column='[Category]' derivation='None' name='[none:Category:nk]' pivot='key' type='nominal' />
            <column-instance column='[Sales]' derivation='Sum' name='[sum:Sales:qk]' pivot='key' type='quantitative' />
          </datasource-dependencies>
          <filter class='quantitative' column='[orders].[sum:Sales:qk]' included-values='non-null' />
          <shelf-sorts>
            <shelf-sort-v2 dimension-to-sort='[orders].[none:Category:nk]' direction='DESC' measure-to-sort-by='[orders].[sum:Sales:qk]' shelf='rows' />
          </shelf-sorts>
        </view>
        <style>
          <style-rule element='worksheet'><format attr='font-family' value='Trebuchet MS' /></style-rule>
          <style-rule element='header'><format attr='width' field='[orders].[none:Category:nk]' value='88' /></style-rule>
        </style>
        <cols>[orders].[sum:Sales:qk]</cols>
        <rows>[orders].[none:Category:nk]</rows>
        <panes><pane><mark class='Bar'><color column='[orders].[none:Category:nk]' /></mark></pane></panes>
      </table>
    </worksheet>
    <worksheet name='Field Table'>
      <table>
        <view>
          <datasources><datasource caption='Orders' name='orders' /></datasources>
          <datasource-dependencies datasource='orders'>
            <column datatype='string' name='[Category]' role='dimension' type='nominal' />
          </datasource-dependencies>
        </view>
        <panes><pane><mark class='Text'><text column='[orders].[none:Category:nk]' /></mark></pane></panes>
      </table>
    </worksheet>
  </worksheets>
  <dashboards>
    <dashboard name='Overview'>
      <size maxheight='900' maxwidth='1600' minheight='900' minwidth='1600' />
      <zones>
        <zone h='100000' id='1' param='Image/bg.png' type-v2='bitmap' w='100000' x='0' y='0' />
        <zone h='10000' id='2' name='Sales Chart' w='50000' x='25000' y='25000' />
      </zones>
    </dashboard>
  </dashboards>
</workbook>"""
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc```\x00\x00"
        b"\x00\x04\x00\x01\xf6\x178U\x00\x00\x00\x00IEND\xaeB`\x82"
    )

    with zipfile.ZipFile(twbx_path, "w") as package:
        package.writestr("sample.twb", workbook_xml)
        package.writestr("Image/bg.png", png_bytes)

    document = onboard_tableau(twbx_path)

    assert len(document.slides) == 3
    assert isinstance(document.slides[0].elements[1], BridgeChart)
    assert isinstance(document.slides[1].elements[1], BridgeTable)
    assert any(isinstance(element, BridgeImage) for element in document.slides[2].elements)
    assert document.custom_properties["source_format"] == "tableau"
    worksheet_info = document.slides[0].custom_properties["tableau"]
    assert worksheet_info["visual_items"][0]["bridge_target"] == "BridgeChart"
    assert worksheet_info["visual_items"][0]["role_mappings"]["rows"][0]["fields"][0]["name"] == "Category"
    assert worksheet_info["visual_items"][0]["role_mappings"]["marks"]["color"][0]["field_info"]["name"] == "Category"
    assert worksheet_info["visual_items"][0]["query_plan"]["status"] in {
        "no_queryable_extract",
        "needs_field_mapping",
        "queryable_direct_extract",
    }
    assert worksheet_info["layout"]["dashboard_placements"][0]["dashboard"] == "Overview"
    assert worksheet_info["layout"]["dashboard_placements"][0]["normalized"]["x"] == 0.25
    assert worksheet_info["pythonic_model"]["formulas"][0]["pandas_sketch"] == "df['Sales'] + 1"
    assert worksheet_info["pythonic_model"]["filters"][0]["pandas_predicate_sketch"] == "df['Sales'].notna()"
    assert worksheet_info["pythonic_model"]["sorts"][0]["pandas_sketch"] == "df.sort_values('Sales', ascending=False)"
    assert worksheet_info["pythonic_model"]["style"]["bridge_properties"]["font_family"] == "Trebuchet MS"
    assert worksheet_info["pythonic_model"]["layout"]["element_count"] >= 3
    assert worksheet_info["reconstruction"]["items"][0]["can_recreate_structure"] is True
