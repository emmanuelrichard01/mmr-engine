# tests/unit/test_matching.py
"""
Matching engine unit tests — covers correctness property C-004.

References:
    - QA §4.4: Matching Engine Tests
    - C-004: Match correctness
"""
import pytest
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from src.engine.matching import (
    MatchingConfig, MatchStrategy, TransactionCandidate,
    find_primary_match, find_probabilistic_match, run_matching,
    _trigram_similarity, _compute_confidence_evidence,
)


def _make_tx(
    id: int = 1, psp: str = "paystack", tx_type: str = "credit",
    amount: Decimal = Decimal("50000"), currency: str = "NGN",
    initiated_at: datetime = None, name: str = None,
    bank_code: str = None, matched: bool = False,
) -> TransactionCandidate:
    return TransactionCandidate(
        id=id, psp_name=psp, transaction_type=tx_type,
        amount_ngn=amount, currency_raw=currency,
        initiated_at=initiated_at or datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc),
        settled_at=None, beneficiary_name_masked=name,
        beneficiary_bank_code=bank_code, sender_bank_code=None,
        already_matched=matched,
    )


class TestPrimaryExactMatching:
    """C-004: Primary match requires identical amount_ngn + cross-PSP."""

    def test_exact_amount_cross_psp_matches(self):
        source = _make_tx(id=1, psp="paystack", tx_type="credit")
        candidates = [_make_tx(id=2, psp="flutterwave", tx_type="debit")]
        result = find_primary_match(source, candidates)
        assert result.matched_transaction_id == 2
        assert result.strategy == MatchStrategy.EXACT_PRIMARY
        assert result.confidence_score == 1.0

    def test_amount_difference_prevents_match(self):
        """Even NGN 1 difference prevents primary match."""
        source = _make_tx(id=1, amount=Decimal("50000"))
        candidates = [_make_tx(id=2, psp="flutterwave", tx_type="debit",
                               amount=Decimal("49999"))]
        result = find_primary_match(source, candidates)
        assert result.matched_transaction_id is None

    def test_same_psp_not_matched(self):
        """Two Paystack transactions should never match."""
        source = _make_tx(id=1, psp="paystack", tx_type="credit")
        candidates = [_make_tx(id=2, psp="paystack", tx_type="debit")]
        result = find_primary_match(source, candidates)
        assert result.matched_transaction_id is None

    def test_already_matched_not_reused(self):
        """Matched transaction cannot be reused."""
        source = _make_tx(id=1)
        candidates = [_make_tx(id=2, psp="flutterwave", tx_type="debit",
                               matched=True)]
        result = find_primary_match(source, candidates)
        assert result.matched_transaction_id is None

    def test_same_type_not_matched(self):
        """Two credits should not match."""
        source = _make_tx(id=1, tx_type="credit")
        candidates = [_make_tx(id=2, psp="flutterwave", tx_type="credit")]
        result = find_primary_match(source, candidates)
        assert result.matched_transaction_id is None

    def test_outside_time_window_not_matched(self):
        """Transaction outside 72h window should not match."""
        source = _make_tx(id=1, initiated_at=datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc))
        candidates = [_make_tx(
            id=2, psp="flutterwave", tx_type="debit",
            initiated_at=datetime(2026, 5, 5, 8, 0, tzinfo=timezone.utc),
        )]
        result = find_primary_match(source, candidates)
        assert result.matched_transaction_id is None

    def test_within_time_window_matches(self):
        """Transaction within 72h window should match."""
        t0 = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)
        source = _make_tx(id=1, initiated_at=t0)
        candidates = [_make_tx(
            id=2, psp="flutterwave", tx_type="debit",
            initiated_at=t0 + timedelta(hours=71),
        )]
        result = find_primary_match(source, candidates)
        assert result.matched_transaction_id == 2

    def test_selects_first_matching_candidate(self):
        """When multiple exact matches exist, selects the first."""
        source = _make_tx(id=1)
        t0 = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)
        candidates = [
            _make_tx(id=2, psp="flutterwave", tx_type="debit", initiated_at=t0 + timedelta(hours=2)),
            _make_tx(id=3, psp="flutterwave", tx_type="debit", initiated_at=t0 + timedelta(hours=1)),
        ]
        result = find_primary_match(source, candidates)
        assert result.matched_transaction_id == 2


class TestProbabilisticMatching:
    """C-004: Probabilistic match with weighted confidence scoring."""

    def test_perfect_probabilistic_score(self):
        """All components perfect → score near 1.0."""
        source = _make_tx(id=1, name="C***** O******", bank_code="057")
        candidates = [_make_tx(
            id=2, psp="flutterwave", tx_type="debit",
            name="C***** O******", bank_code="057",
        )]
        result = find_probabilistic_match(source, candidates)
        assert result.matched_transaction_id == 2
        assert result.confidence_score >= 0.95

    def test_below_threshold_no_match(self):
        """Score below 0.75 produces no match."""
        t0 = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)
        source = _make_tx(id=1, amount=Decimal("50000"),
                          initiated_at=t0, name="C***** O******")
        candidates = [_make_tx(
            id=2, psp="flutterwave", tx_type="debit",
            amount=Decimal("40000"),  # 20% off → low amount score
            initiated_at=t0 + timedelta(hours=100),
            name="T**** A****",
        )]
        result = find_probabilistic_match(source, candidates)
        assert result.matched_transaction_id is None

    def test_custom_threshold(self):
        """Custom threshold should be respected."""
        config = MatchingConfig(probabilistic_threshold=0.95)
        source = _make_tx(id=1, name="C***** O******", bank_code="057")
        candidates = [_make_tx(
            id=2, psp="flutterwave", tx_type="debit",
            amount=Decimal("49500"),  # slight diff → not perfect
            name="C***** O******", bank_code="057",
        )]
        result = find_probabilistic_match(source, candidates, config)
        assert result.confidence_score < 0.95
        assert result.matched_transaction_id is None

    def test_fx_threshold_flag(self):
        """Amount delta within FX threshold should flag is_within_fx_threshold."""
        source = _make_tx(id=1, amount=Decimal("50000"), name="C***** O******", bank_code="057")
        candidates = [_make_tx(
            id=2, psp="flutterwave", tx_type="debit",
            amount=Decimal("49900"),  # 0.2% delta → within 0.5% FX threshold
            name="C***** O******", bank_code="057",
        )]
        result = find_probabilistic_match(source, candidates)
        if result.matched_transaction_id:
            assert result.is_within_fx_threshold is True


class TestConfidenceScoreWeights:
    """Verify confidence score weights sum correctly."""

    def test_weights_sum_to_one(self):
        config = MatchingConfig()
        total = config.weight_amount + config.weight_time + config.weight_name + config.weight_bank
        assert abs(total - 1.0) < 0.001

    def test_perfect_components_produce_max_score(self):
        source = _make_tx(id=1, name="Test", bank_code="057")
        candidate = _make_tx(id=2, psp="flutterwave", tx_type="debit",
                             name="Test", bank_code="057")
        ev = _compute_confidence_evidence(source, candidate, DEFAULT_CONFIG)
        score = (ev.amount_score * 0.40 + ev.time_score * 0.25
                 + ev.name_score * 0.25 + ev.bank_score * 0.10)
        assert abs(score - 1.0) < 0.01


class TestTrigramSimilarity:
    """Test the trigram similarity function."""

    def test_identical_strings(self):
        assert _trigram_similarity("hello", "hello") == 1.0

    def test_empty_strings(self):
        assert _trigram_similarity("", "") == 0.0
        assert _trigram_similarity("hello", "") == 0.0

    def test_similar_strings(self):
        sim = _trigram_similarity("C***** O******", "C***** O******")
        assert sim == 1.0

    def test_different_strings(self):
        sim = _trigram_similarity("abcdef", "zyxwvu")
        assert sim < 0.3

    def test_case_insensitive(self):
        assert _trigram_similarity("Hello", "hello") == 1.0


class TestFullMatchingPipeline:
    """Test the full run_matching two-tier pipeline."""

    def test_exact_match_preferred_over_probabilistic(self):
        source = _make_tx(id=1, name="C***** O******", bank_code="057")
        candidates = [
            _make_tx(id=2, psp="flutterwave", tx_type="debit",
                     name="C***** O******", bank_code="057"),
        ]
        result = run_matching(source, candidates)
        assert result.strategy == MatchStrategy.EXACT_PRIMARY
        assert result.confidence_score == 1.0

    def test_falls_back_to_probabilistic(self):
        """Different amounts → no exact → probabilistic."""
        source = _make_tx(id=1, amount=Decimal("50000"),
                          name="C***** O******", bank_code="057")
        candidates = [_make_tx(
            id=2, psp="flutterwave", tx_type="debit",
            amount=Decimal("49900"), name="C***** O******", bank_code="057",
        )]
        result = run_matching(source, candidates)
        assert result.strategy == MatchStrategy.PROBABILISTIC_SECONDARY

    def test_no_candidates_returns_unmatched(self):
        source = _make_tx(id=1)
        result = run_matching(source, [])
        assert result.strategy == MatchStrategy.UNMATCHED
        assert result.matched_transaction_id is None

    def test_only_same_psp_candidates_returns_unmatched(self):
        source = _make_tx(id=1, psp="paystack")
        candidates = [_make_tx(id=2, psp="paystack", tx_type="debit")]
        result = run_matching(source, candidates)
        assert result.strategy == MatchStrategy.UNMATCHED


from src.engine.matching import DEFAULT_CONFIG
