"""Medallion ETL for the Global Skincare & Beauty e-store workbook.

Bronze (raw) -> Silver (cleaned & conformed) -> Gold (star schema), with a
data-quality gate and a profiling pass. The Gold layer is the single source of
truth the React dashboard is built from.
"""
