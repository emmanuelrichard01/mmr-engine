# src/engine/matching.py
"""
Two-Tier Reconciliation Matching Engine.

References:
    - TDD §8.2: Matching Algorithm
    - QA §4.4: Matching Engine Tests
    - Correctness Property C-004
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from enum import Enum
from typing import Any, Optional
import structlog

log = structlog.get_logger(__name__)


class MatchStrategy(str, Enum):
    EXACT_PRIMARY = "exact_primary"
    PROBABILISTIC_SECONDARY = "probabilistic_secondary"
    UNMATCHED = "unmatched"


@dataclass(frozen=True)
class MatchingConfig:
    primary_time_window: timedelta = timedelta(hours=72)
    probabilistic_threshold: float = 0.75
    probabilistic_time_window: timedelta = timedelta(hours=168)
    amount_tolerance_pct: Decimal = Decimal("0.05")
    weight_amount: float = 0.40
    weight_time: float = 0.25
    weight_name: float = 0.25
    weight_bank: float = 0.10
    fx_variance_threshold_pct: Decimal = Decimal("0.005")


DEFAULT_CONFIG = MatchingConfig()


@dataclass
class TransactionCandidate:
    id: int
    psp_name: str
    transaction_type: str
    amount_ngn: Decimal
    currency_raw: str
    initiated_at: datetime
    settled_at: Optional[datetime]
    beneficiary_name_masked: Optional[str]
    beneficiary_bank_code: Optional[str]
    sender_bank_code: Optional[str]
    already_matched: bool = False


@dataclass
class MatchResult:
    source_transaction_id: int
    matched_transaction_id: Optional[int]
    strategy: MatchStrategy
    confidence_score: float
    confidence_evidence: dict[str, Any] = field(default_factory=dict)
    amount_delta_ngn: Optional[Decimal] = None
    is_within_fx_threshold: bool = False


@dataclass
class ConfidenceEvidence:
    amount_score: float = 0.0
    time_score: float = 0.0
    name_score: float = 0.0
    bank_score: float = 0.0
    amount_delta_pct: float = 0.0
    time_delta_seconds: float = 0.0
    name_similarity: float = 0.0
    bank_match: bool = False


def _are_complementary_types(type_a: str, type_b: str) -> bool:
    return (type_a, type_b) in {("credit", "debit"), ("debit", "credit")}


def _trigram_similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    a_lower, b_lower = a.lower().strip(), b.lower().strip()
    if a_lower == b_lower:
        return 1.0
    a_padded, b_padded = f"  {a_lower} ", f"  {b_lower} "
    a_tri = {a_padded[i:i+3] for i in range(len(a_padded) - 2)}
    b_tri = {b_padded[i:i+3] for i in range(len(b_padded) - 2)}
    if not a_tri or not b_tri:
        return 0.0
    return len(a_tri & b_tri) / len(a_tri | b_tri)


def _compute_confidence_evidence(
    source: TransactionCandidate,
    candidate: TransactionCandidate,
    config: MatchingConfig,
) -> ConfidenceEvidence:
    ev = ConfidenceEvidence()
    # Amount
    if source.amount_ngn > 0:
        delta = abs(source.amount_ngn - candidate.amount_ngn)
        delta_pct = delta / source.amount_ngn
        ev.amount_delta_pct = float(delta_pct)
        tol = float(config.amount_tolerance_pct)
        if delta_pct == 0:
            ev.amount_score = 1.0
        elif float(delta_pct) <= tol:
            ev.amount_score = 1.0 - (float(delta_pct) / tol)
        else:
            ev.amount_score = 0.0
    # Time
    td = abs((source.initiated_at - candidate.initiated_at).total_seconds())
    ev.time_delta_seconds = td
    win = config.probabilistic_time_window.total_seconds()
    ev.time_score = max(0.0, 1.0 - (td / win)) if td <= win else 0.0
    # Name
    sn = source.beneficiary_name_masked or ""
    cn = candidate.beneficiary_name_masked or ""
    if sn and cn:
        ev.name_similarity = _trigram_similarity(sn, cn)
        ev.name_score = ev.name_similarity
    elif not sn and not cn:
        ev.name_score, ev.name_similarity = 0.5, 0.5
    else:
        ev.name_score, ev.name_similarity = 0.2, 0.0
    # Bank
    sb = source.beneficiary_bank_code or source.sender_bank_code
    cb = candidate.beneficiary_bank_code or candidate.sender_bank_code
    if sb and cb:
        ev.bank_match = sb == cb
        ev.bank_score = 1.0 if ev.bank_match else 0.0
    elif not sb and not cb:
        ev.bank_score = 0.5
    else:
        ev.bank_score = 0.0
    return ev


def find_primary_match(
    source: TransactionCandidate,
    candidates: list[TransactionCandidate],
    config: MatchingConfig = DEFAULT_CONFIG,
) -> MatchResult:
    """Tier 1: Exact amount match, cross-PSP, within time window."""
    for c in candidates:
        if c.psp_name == source.psp_name:
            continue
        if c.already_matched:
            continue
        if not _are_complementary_types(source.transaction_type, c.transaction_type):
            continue
        if c.amount_ngn != source.amount_ngn:
            continue
        td = abs((source.initiated_at - c.initiated_at).total_seconds())
        if td > config.primary_time_window.total_seconds():
            continue
        return MatchResult(
            source_transaction_id=source.id,
            matched_transaction_id=c.id,
            strategy=MatchStrategy.EXACT_PRIMARY,
            confidence_score=1.0,
            confidence_evidence={"time_delta_seconds": td},
            amount_delta_ngn=Decimal("0"),
            is_within_fx_threshold=True,
        )
    return MatchResult(
        source_transaction_id=source.id, matched_transaction_id=None,
        strategy=MatchStrategy.EXACT_PRIMARY, confidence_score=0.0,
    )


def find_probabilistic_match(
    source: TransactionCandidate,
    candidates: list[TransactionCandidate],
    config: MatchingConfig = DEFAULT_CONFIG,
) -> MatchResult:
    """Tier 2: Weighted confidence score matching."""
    best, best_score = None, 0.0
    for c in candidates:
        if c.psp_name == source.psp_name or c.already_matched:
            continue
        if not _are_complementary_types(source.transaction_type, c.transaction_type):
            continue
        td = abs((source.initiated_at - c.initiated_at).total_seconds())
        if td > config.probabilistic_time_window.total_seconds():
            continue
        ev = _compute_confidence_evidence(source, c, config)
        score = (ev.amount_score * config.weight_amount
                 + ev.time_score * config.weight_time
                 + ev.name_score * config.weight_name
                 + ev.bank_score * config.weight_bank)
        if score > best_score and score >= config.probabilistic_threshold:
            delta = abs(source.amount_ngn - c.amount_ngn)
            delta_pct = delta / source.amount_ngn if source.amount_ngn > 0 else Decimal("0")
            best_score = score
            best = MatchResult(
                source_transaction_id=source.id,
                matched_transaction_id=c.id,
                strategy=MatchStrategy.PROBABILISTIC_SECONDARY,
                confidence_score=round(score, 4),
                confidence_evidence={
                    "amount_score": round(ev.amount_score, 4),
                    "time_score": round(ev.time_score, 4),
                    "name_score": round(ev.name_score, 4),
                    "bank_score": round(ev.bank_score, 4),
                },
                amount_delta_ngn=delta,
                is_within_fx_threshold=delta_pct <= config.fx_variance_threshold_pct,
            )
    if best:
        return best
    return MatchResult(
        source_transaction_id=source.id, matched_transaction_id=None,
        strategy=MatchStrategy.PROBABILISTIC_SECONDARY, confidence_score=0.0,
    )


def run_matching(
    source: TransactionCandidate,
    candidates: list[TransactionCandidate],
    config: MatchingConfig = DEFAULT_CONFIG,
) -> MatchResult:
    """Full two-tier matching: primary exact → probabilistic fallback."""
    primary = find_primary_match(source, candidates, config)
    if primary.matched_transaction_id is not None:
        return primary
    prob = find_probabilistic_match(source, candidates, config)
    if prob.matched_transaction_id is not None:
        return prob
    return MatchResult(
        source_transaction_id=source.id, matched_transaction_id=None,
        strategy=MatchStrategy.UNMATCHED, confidence_score=0.0,
    )
