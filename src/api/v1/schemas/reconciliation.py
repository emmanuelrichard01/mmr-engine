# src/api/v1/schemas/reconciliation.py
"""
Pydantic response models for reconciliation API endpoints.

Typed contracts ensure consistent API responses and auto-generate
OpenAPI documentation for downstream consumers.

References:
    - API Specification §3: Response Schemas
    - TDD §11.2: API Contracts
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


# ── Reconciliation Summary ────────────────────────────────────────────

class DiscrepancyBreakdown(BaseModel):
    """Breakdown of discrepancies by type."""
    discrepancy_type: str
    count: int
    total_exposure: Decimal = Field(decimal_places=2)


class ReconciliationSummaryResponse(BaseModel):
    """Daily reconciliation summary."""
    report_date: str
    total_transactions: int
    matched: int
    unmatched: int
    match_rate_pct: Decimal = Field(decimal_places=2)
    discrepancies: list[DiscrepancyBreakdown]
    generated_at: datetime


# ── Reconciliation Pairs ──────────────────────────────────────────────

class ReconciliationPairResponse(BaseModel):
    """A single matched reconciliation pair."""
    id: int
    transaction_a_id: int
    transaction_b_id: int
    match_strategy: str
    confidence_score: Decimal = Field(decimal_places=4)
    amount_a_ngn: Decimal = Field(decimal_places=6)
    amount_delta_ngn: Decimal = Field(decimal_places=6)
    is_within_fx_threshold: bool
    status: str
    confidence_evidence: Optional[dict] = None
    created_at: datetime


class ReconciliationPairsListResponse(BaseModel):
    """Paginated list of reconciliation pairs."""
    pairs: list[ReconciliationPairResponse]
    limit: int
    offset: int
    count: int


# ── Discrepancies ─────────────────────────────────────────────────────

class DiscrepancyResponse(BaseModel):
    """A single discrepancy record."""
    id: int
    transaction_id: int
    discrepancy_type: str
    severity: str
    estimated_exposure_ngn: Decimal = Field(decimal_places=2)
    evidence: Optional[dict] = None
    status: str
    detected_by_run_id: Optional[str] = None
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[str] = None
    created_at: datetime


class DiscrepanciesListResponse(BaseModel):
    """Paginated list of discrepancies."""
    discrepancies: list[DiscrepancyResponse]
    limit: int
    offset: int
    count: int


class DiscrepancyResolveResponse(BaseModel):
    """Confirmation of discrepancy resolution."""
    discrepancy_id: int
    status: str = "resolved"
    resolved_by: str
    resolved_at: datetime


# ── Exposure ──────────────────────────────────────────────────────────

class ExposureEntry(BaseModel):
    """Exposure breakdown by PSP and discrepancy type."""
    psp_name: str
    discrepancy_type: str
    open_count: int
    total_exposure_ngn: Decimal = Field(decimal_places=2)


class ExposureResponse(BaseModel):
    """Total exposure summary."""
    total_open_exposure_ngn: Decimal = Field(decimal_places=2)
    by_psp_and_type: list[ExposureEntry]
    generated_at: datetime
