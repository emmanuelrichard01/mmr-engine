# tests/unit/test_matching.py
"""
Matching engine unit tests — correctness property C-004.

Covers the two tiers, the ambiguity guard, keyed-token name matching, and
the greedy one-to-one assignment used by the matching flow.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from hypothesis import given
from hypothesis import strategies as st

from src.engine.matching import (
    DEFAULT_CONFIG,
    MatchingConfig,
    MatchStrategy,
    TransactionCandidate,
    find_primary_match,
    find_probabilistic_match,
    run_matching,
)
from src.engine.pii import mask_name, tokenize_name
from src.flows.matching_flow import match_all

KEY = b"unit-test-key"
T0 = datetime(2026, 5, 1, 8, 0, tzinfo=UTC)


def _tx(
    id: int = 1,
    psp: str = "paystack",
    tx_type: str = "credit",
    amount: str = "50000",
    at: datetime | None = None,
    name: str | None = None,
    bank: str | None = None,
    matched: bool = False,
) -> TransactionCandidate:
    return TransactionCandidate(
        id=id,
        psp_name=psp,
        transaction_type=tx_type,
        amount_ngn=Decimal(amount),
        currency_raw="NGN",
        initiated_at=at or T0,
        settled_at=None,
        counterparty_name_tokens=tokenize_name(name, KEY) if name else [],
        beneficiary_bank_code=bank,
        sender_bank_code=None,
        already_matched=matched,
    )


class TestPrimaryExactMatching:
    def test_exact_amount_cross_psp_matches(self):
        result = find_primary_match(_tx(1), [_tx(2, psp="flutterwave", tx_type="debit")])
        assert result.matched_transaction_id == 2
        assert result.strategy == MatchStrategy.EXACT_PRIMARY
        assert result.confidence_score == 1.0

    def test_one_kobo_difference_prevents_match(self):
        result = find_primary_match(
            _tx(1, amount="50000.00"), [_tx(2, psp="flutterwave", tx_type="debit", amount="49999.99")]
        )
        assert result.matched_transaction_id is None

    def test_same_psp_not_matched(self):
        assert find_primary_match(_tx(1), [_tx(2, tx_type="debit")]).matched_transaction_id is None

    def test_already_matched_not_reused(self):
        cand = _tx(2, psp="flutterwave", tx_type="debit", matched=True)
        assert find_primary_match(_tx(1), [cand]).matched_transaction_id is None

    def test_same_type_not_matched(self):
        assert find_primary_match(_tx(1), [_tx(2, psp="flutterwave", tx_type="credit")]).matched_transaction_id is None

    def test_reversal_never_matches(self):
        assert (
            find_primary_match(_tx(1), [_tx(2, psp="flutterwave", tx_type="reversal")]).matched_transaction_id is None
        )

    def test_outside_primary_window_not_matched(self):
        far = _tx(2, psp="flutterwave", tx_type="debit", at=T0 + timedelta(hours=73))
        assert find_primary_match(_tx(1), [far]).matched_transaction_id is None

    def test_closest_in_time_wins_regardless_of_list_order(self):
        """Regression: the original engine returned the first candidate in list order."""
        far = _tx(2, psp="flutterwave", tx_type="debit", at=T0 + timedelta(hours=10))
        near = _tx(3, psp="flutterwave", tx_type="debit", at=T0 + timedelta(minutes=2))
        assert find_primary_match(_tx(1), [far, near]).matched_transaction_id == 3
        assert find_primary_match(_tx(1), [near, far]).matched_transaction_id == 3

    def test_equally_close_candidates_are_ambiguous(self):
        a = _tx(2, psp="flutterwave", tx_type="debit", at=T0 + timedelta(minutes=5))
        b = _tx(3, psp="flutterwave", tx_type="debit", at=T0 - timedelta(minutes=5))
        result = find_primary_match(_tx(1), [a, b])
        assert result.matched_transaction_id is None
        assert result.confidence_evidence["ambiguous"] is True

    def test_ambiguous_exact_does_not_fall_through_to_fuzzy(self):
        a = _tx(2, psp="flutterwave", tx_type="debit", at=T0 + timedelta(minutes=5))
        b = _tx(3, psp="flutterwave", tx_type="debit", at=T0 - timedelta(minutes=5))
        result = run_matching(_tx(1), [a, b])
        assert result.strategy == MatchStrategy.UNMATCHED
        assert result.confidence_evidence.get("ambiguous") is True


class TestProbabilisticMatching:
    def test_small_delta_with_name_and_bank_corroboration_matches(self):
        source = _tx(1, amount="50000", name="Chioma Okonkwo", bank="057")
        cand = _tx(
            2,
            psp="flutterwave",
            tx_type="debit",
            amount="49900",
            name="OKONKWO CHIOMA",
            bank="057",
            at=T0 + timedelta(minutes=30),
        )
        result = find_probabilistic_match(source, [cand])
        assert result.matched_transaction_id == 2
        assert result.strategy == MatchStrategy.PROBABILISTIC_SECONDARY
        assert result.amount_delta_ngn == Decimal("100")

    def test_outside_amount_tolerance_never_matches(self):
        source = _tx(1, amount="50000", name="Chioma Okonkwo", bank="057")
        cand = _tx(2, psp="flutterwave", tx_type="debit", amount="40000", name="Chioma Okonkwo", bank="057")
        assert find_probabilistic_match(source, [cand]).matched_transaction_id is None

    def test_masked_name_collision_does_not_corroborate(self):
        """Regression: masked names collide for different people with the same
        initials and word lengths. Keyed tokens must not."""
        assert mask_name("Chioma Okonkwo") == mask_name("Chisom Onyekwe") == "C***** O******"
        same = _tx(
            2,
            psp="flutterwave",
            tx_type="debit",
            amount="49800",
            name="Chioma Okonkwo",
            bank="057",
            at=T0 + timedelta(hours=20),
        )
        other = _tx(
            3,
            psp="flutterwave",
            tx_type="debit",
            amount="49800",
            name="Chisom Onyekwe",
            bank="057",
            at=T0 + timedelta(hours=20),
        )
        source = _tx(1, amount="50000", name="Chioma Okonkwo", bank="057")
        assert find_probabilistic_match(source, [same]).matched_transaction_id == 2
        assert find_probabilistic_match(source, [other]).matched_transaction_id is None

    def test_near_tie_is_ambiguous(self):
        source = _tx(1, amount="50000")
        a = _tx(2, psp="flutterwave", tx_type="debit", amount="49950", at=T0 + timedelta(minutes=10))
        b = _tx(3, psp="flutterwave", tx_type="debit", amount="49950", at=T0 + timedelta(minutes=11))
        result = find_probabilistic_match(source, [a, b])
        assert result.matched_transaction_id is None
        assert result.confidence_evidence["ambiguous"] is True

    def test_custom_threshold_respected(self):
        source = _tx(1, amount="50000")
        cand = _tx(2, psp="flutterwave", tx_type="debit", amount="49000", at=T0 + timedelta(hours=40))
        strict = MatchingConfig(probabilistic_threshold=0.95)
        assert find_probabilistic_match(source, [cand], strict).matched_transaction_id is None

    def test_fx_threshold_flag(self):
        source = _tx(1, amount="100000", name="Ade Johnson", bank="058")
        tiny = _tx(2, psp="flutterwave", tx_type="debit", amount="99990", name="Ade Johnson", bank="058")
        result = find_probabilistic_match(source, [tiny])
        assert result.matched_transaction_id == 2
        assert result.is_within_fx_threshold is True


class TestConfigAndPipeline:
    def test_weights_sum_to_one(self):
        c = DEFAULT_CONFIG
        assert abs(c.weight_amount + c.weight_time + c.weight_name + c.weight_bank - 1.0) < 1e-9

    def test_exact_match_preferred_over_probabilistic(self):
        exact = _tx(2, psp="flutterwave", tx_type="debit", at=T0 + timedelta(hours=1))
        fuzzy = _tx(3, psp="flutterwave", tx_type="debit", amount="49990", at=T0)
        assert run_matching(_tx(1), [fuzzy, exact]).matched_transaction_id == 2

    def test_no_candidates_returns_unmatched(self):
        result = run_matching(_tx(1), [])
        assert result.strategy == MatchStrategy.UNMATCHED
        assert result.matched_transaction_id is None


class TestMatchAll:
    """The greedy assignment used by the flow (regression for the index bug)."""

    def test_each_transaction_matched_at_most_once(self):
        txs = [
            _tx(1, at=T0),
            _tx(2, psp="flutterwave", tx_type="debit", at=T0 + timedelta(minutes=1)),
            _tx(3, at=T0 + timedelta(minutes=2)),
            _tx(4, psp="flutterwave", tx_type="debit", at=T0 + timedelta(minutes=3)),
        ]
        pairs = match_all(txs, DEFAULT_CONFIG)
        ids = [p.source_transaction_id for p in pairs] + [p.matched_transaction_id for p in pairs]
        assert len(ids) == len(set(ids)) == 4

    def test_results_are_keyed_by_id_not_position(self):
        """A matched target appearing later in the list must not shift results."""
        txs = [
            _tx(10, at=T0),
            _tx(20, psp="flutterwave", tx_type="debit", at=T0 + timedelta(minutes=1)),
            _tx(30, amount="777", at=T0 + timedelta(minutes=2)),  # unmatched
        ]
        pairs = match_all(txs, DEFAULT_CONFIG)
        assert [(p.source_transaction_id, p.matched_transaction_id) for p in pairs] == [(10, 20)]

    @given(
        st.lists(
            st.tuples(
                st.sampled_from(["paystack", "flutterwave"]),
                st.sampled_from(["credit", "debit"]),
                st.sampled_from(["1000", "2500", "5000"]),
                st.integers(min_value=0, max_value=600),
            ),
            max_size=25,
        )
    )
    def test_property_one_to_one(self, specs):
        txs = [_tx(i, psp=p, tx_type=t, amount=a, at=T0 + timedelta(minutes=m)) for i, (p, t, a, m) in enumerate(specs)]
        pairs = match_all(txs, DEFAULT_CONFIG)
        used = [p.source_transaction_id for p in pairs] + [p.matched_transaction_id for p in pairs]
        assert len(used) == len(set(used))
        by_id = {t.id: t for t in txs}
        for p in pairs:
            a, b = by_id[p.source_transaction_id], by_id[p.matched_transaction_id]
            assert a.psp_name != b.psp_name
            assert {a.transaction_type, b.transaction_type} == {"credit", "debit"}
