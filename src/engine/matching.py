# src/engine/matching.py
"""
Two-Tier Reconciliation Matching Engine (pure functions, no I/O).

Tier 1 — exact primary: complementary transaction types on different PSPs,
identical amount, within the primary time window. The closest-in-time
candidate wins.

Tier 2 — probabilistic secondary: weighted evidence (amount closeness, time
closeness, counterparty-name token overlap, bank code) above a threshold.

Ambiguity guard: when the best candidate is not clearly better than the
runner-up, the engine refuses to choose and returns UNMATCHED with
`ambiguous=True` evidence. A wrong automatic match is worse than an
unmatched transaction that a person reviews. Picking "the first one in the
list" (the original behaviour) made results depend on query order.

References:
    - TDD §8.2: Matching Algorithm
    - QA §4.4: Matching Engine Tests
    - Correctness Property C-004
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from enum import StrEnum
from typing import Any

from src.engine.pii import name_token_similarity


class MatchStrategy(StrEnum):
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
    # Best probabilistic score must beat the runner-up by at least this much.
    ambiguity_margin: float = 0.05

    @classmethod
    def from_settings(cls) -> "MatchingConfig":
        from src.config import get_settings

        s = get_settings()
        return cls(
            primary_time_window=timedelta(hours=s.matching_primary_window_hours),
            probabilistic_threshold=s.matching_secondary_confidence_threshold,
            probabilistic_time_window=timedelta(hours=s.matching_secondary_window_hours),
            amount_tolerance_pct=Decimal(str(s.matching_amount_tolerance_pct)),
            fx_variance_threshold_pct=Decimal(str(s.fx_variance_threshold_pct)),
        )


DEFAULT_CONFIG = MatchingConfig()


@dataclass
class TransactionCandidate:
    id: Any
    psp_name: str
    transaction_type: str
    amount_ngn: Decimal
    currency_raw: str
    initiated_at: datetime
    settled_at: datetime | None
    counterparty_name_tokens: list[str] | None
    beneficiary_bank_code: str | None
    sender_bank_code: str | None
    already_matched: bool = False


@dataclass
class MatchResult:
    source_transaction_id: Any
    matched_transaction_id: Any | None
    strategy: MatchStrategy
    confidence_score: float
    confidence_evidence: dict[str, Any] = field(default_factory=dict)
    amount_delta_ngn: Decimal | None = None
    is_within_fx_threshold: bool = False


@dataclass
class ConfidenceEvidence:
    amount_score: float = 0.0
    time_score: float = 0.0
    name_score: float = 0.0
    bank_score: float = 0.0
    amount_delta_pct: float = 0.0
    time_delta_seconds: float = 0.0
    name_similarity: float | None = None
    bank_match: bool = False


def _are_complementary_types(type_a: str, type_b: str) -> bool:
    return {type_a, type_b} == {"credit", "debit"}


def _eligible(source: TransactionCandidate, c: TransactionCandidate) -> bool:
    return (
        c.id != source.id
        and c.psp_name != source.psp_name
        and not c.already_matched
        and _are_complementary_types(source.transaction_type, c.transaction_type)
    )


def _time_delta_seconds(a: TransactionCandidate, b: TransactionCandidate) -> float:
    return abs((a.initiated_at - b.initiated_at).total_seconds())


def _compute_confidence_evidence(
    source: TransactionCandidate,
    candidate: TransactionCandidate,
    config: MatchingConfig,
) -> ConfidenceEvidence:
    ev = ConfidenceEvidence()
    # Amount: 1.0 for exact, linearly down to 0 at the tolerance boundary.
    if source.amount_ngn > 0:
        delta_pct = abs(source.amount_ngn - candidate.amount_ngn) / source.amount_ngn
        ev.amount_delta_pct = float(delta_pct)
        tol = config.amount_tolerance_pct
        if delta_pct == 0:
            ev.amount_score = 1.0
        elif tol > 0 and delta_pct <= tol:
            ev.amount_score = float(1 - delta_pct / tol)
    # Time: 1.0 at zero delta, linearly down to 0 at the window boundary.
    td = _time_delta_seconds(source, candidate)
    ev.time_delta_seconds = td
    win = config.probabilistic_time_window.total_seconds()
    ev.time_score = max(0.0, 1.0 - td / win) if td <= win else 0.0
    # Counterparty name (keyed tokens): unknown on both sides is neutral,
    # known on one side only is weak evidence against.
    similarity = name_token_similarity(source.counterparty_name_tokens, candidate.counterparty_name_tokens)
    ev.name_similarity = similarity
    if similarity is not None:
        ev.name_score = similarity
    elif not source.counterparty_name_tokens and not candidate.counterparty_name_tokens:
        ev.name_score = 0.5
    else:
        ev.name_score = 0.2
    # Bank
    sb = source.beneficiary_bank_code or source.sender_bank_code
    cb = candidate.beneficiary_bank_code or candidate.sender_bank_code
    if sb and cb:
        ev.bank_match = sb == cb
        ev.bank_score = 1.0 if ev.bank_match else 0.0
    elif not sb and not cb:
        ev.bank_score = 0.5
    return ev


def _unmatched(source: TransactionCandidate, strategy: MatchStrategy, **evidence: Any) -> MatchResult:
    return MatchResult(
        source_transaction_id=source.id,
        matched_transaction_id=None,
        strategy=strategy,
        confidence_score=0.0,
        confidence_evidence=dict(evidence),
    )


def find_primary_match(
    source: TransactionCandidate,
    candidates: Sequence[TransactionCandidate],
    config: MatchingConfig = DEFAULT_CONFIG,
) -> MatchResult:
    """Tier 1: exact amount, cross-PSP, complementary type, closest in time."""
    window = config.primary_time_window.total_seconds()
    exact = sorted(
        (
            (_time_delta_seconds(source, c), c)
            for c in candidates
            if _eligible(source, c) and c.amount_ngn == source.amount_ngn
        ),
        key=lambda pair: pair[0],
    )
    exact = [(td, c) for td, c in exact if td <= window]
    if not exact:
        return _unmatched(source, MatchStrategy.EXACT_PRIMARY)
    if len(exact) > 1 and exact[0][0] == exact[1][0]:
        return _unmatched(
            source,
            MatchStrategy.EXACT_PRIMARY,
            ambiguous=True,
            reason="multiple exact-amount candidates equally close in time",
            candidate_ids=[str(c.id) for _, c in exact[:5]],
        )
    td, best = exact[0]
    return MatchResult(
        source_transaction_id=source.id,
        matched_transaction_id=best.id,
        strategy=MatchStrategy.EXACT_PRIMARY,
        confidence_score=1.0,
        confidence_evidence={"time_delta_seconds": td, "exact_candidates": len(exact)},
        amount_delta_ngn=Decimal("0"),
        is_within_fx_threshold=True,
    )


def find_probabilistic_match(
    source: TransactionCandidate,
    candidates: Sequence[TransactionCandidate],
    config: MatchingConfig = DEFAULT_CONFIG,
) -> MatchResult:
    """Tier 2: weighted confidence score, with an ambiguity guard."""
    window = config.probabilistic_time_window.total_seconds()
    scored: list[tuple[float, TransactionCandidate, ConfidenceEvidence]] = []
    for c in candidates:
        if not _eligible(source, c) or _time_delta_seconds(source, c) > window:
            continue
        ev = _compute_confidence_evidence(source, c, config)
        if ev.amount_score == 0.0:
            # Outside the amount tolerance: never a match, whatever else agrees.
            continue
        score = (
            ev.amount_score * config.weight_amount
            + ev.time_score * config.weight_time
            + ev.name_score * config.weight_name
            + ev.bank_score * config.weight_bank
        )
        scored.append((score, c, ev))

    scored.sort(key=lambda t: t[0], reverse=True)
    if not scored or scored[0][0] < config.probabilistic_threshold:
        return _unmatched(source, MatchStrategy.PROBABILISTIC_SECONDARY)

    best_score, best, ev = scored[0]
    if len(scored) > 1 and best_score - scored[1][0] < config.ambiguity_margin:
        return _unmatched(
            source,
            MatchStrategy.PROBABILISTIC_SECONDARY,
            ambiguous=True,
            reason="runner-up within ambiguity margin",
            best_score=round(best_score, 4),
            runner_up_score=round(scored[1][0], 4),
            candidate_ids=[str(c.id) for _, c, _ in scored[:5]],
        )

    delta = abs(source.amount_ngn - best.amount_ngn)
    delta_pct = delta / source.amount_ngn if source.amount_ngn > 0 else Decimal("0")
    return MatchResult(
        source_transaction_id=source.id,
        matched_transaction_id=best.id,
        strategy=MatchStrategy.PROBABILISTIC_SECONDARY,
        confidence_score=round(best_score, 4),
        confidence_evidence={
            "amount_score": round(ev.amount_score, 4),
            "time_score": round(ev.time_score, 4),
            "name_score": round(ev.name_score, 4),
            "bank_score": round(ev.bank_score, 4),
            "time_delta_seconds": ev.time_delta_seconds,
        },
        amount_delta_ngn=delta,
        is_within_fx_threshold=delta_pct <= config.fx_variance_threshold_pct,
    )


def run_matching(
    source: TransactionCandidate,
    candidates: Sequence[TransactionCandidate],
    config: MatchingConfig = DEFAULT_CONFIG,
) -> MatchResult:
    """Full two-tier matching: primary exact → probabilistic fallback."""
    primary = find_primary_match(source, candidates, config)
    if primary.matched_transaction_id is not None:
        return primary
    if primary.confidence_evidence.get("ambiguous"):
        # Several exact-amount candidates tie: a fuzzy score would only
        # pick one of them arbitrarily. Leave it for review.
        return MatchResult(
            source_transaction_id=source.id,
            matched_transaction_id=None,
            strategy=MatchStrategy.UNMATCHED,
            confidence_score=0.0,
            confidence_evidence=primary.confidence_evidence,
        )
    prob = find_probabilistic_match(source, candidates, config)
    if prob.matched_transaction_id is not None:
        return prob
    return MatchResult(
        source_transaction_id=source.id,
        matched_transaction_id=None,
        strategy=MatchStrategy.UNMATCHED,
        confidence_score=0.0,
        confidence_evidence=prob.confidence_evidence,
    )
