# tests/unit/test_fx.py
"""
Unit tests for FX conversion logic.

Tests verify:
    1. NGN passthrough (no conversion needed)
    2. USD → NGN conversion with correct rate application
    3. Zero/negative rate rejection
    4. Decimal precision preservation (NUMERIC(20,6))

References:
    - TDD §9.3: FX Rate Engine
"""
from decimal import Decimal

import pytest

from src.engine.fx import convert_to_ngn


class TestConvertToNGN:
    """Tests for the convert_to_ngn function."""

    def test_ngn_passthrough(self):
        """NGN amounts should pass through unchanged."""
        result = convert_to_ngn(Decimal("50000"), "NGN", Decimal("1"))
        assert result == Decimal("50000")

    def test_ngn_case_insensitive(self):
        """NGN check should be case-insensitive."""
        result = convert_to_ngn(Decimal("50000"), "ngn", Decimal("1"))
        assert result == Decimal("50000")

    def test_usd_to_ngn(self):
        """USD → NGN: 31.645 USD at rate 0.00063291 = ~50,000 NGN"""
        amount_usd = Decimal("31.645")
        rate = Decimal("0.00063291")  # 1 NGN = 0.00063291 USD
        result = convert_to_ngn(amount_usd, "USD", rate)
        # Should be approximately 50,000 NGN
        assert Decimal("49990") < result < Decimal("50010")

    def test_gbp_to_ngn(self):
        """GBP → NGN conversion."""
        amount_gbp = Decimal("100")
        rate = Decimal("0.0005")  # 1 NGN = 0.0005 GBP
        result = convert_to_ngn(amount_gbp, "GBP", rate)
        assert result == Decimal("200000.000000")

    def test_precision_preserved(self):
        """Result should have 6 decimal places (NUMERIC(20,6))."""
        result = convert_to_ngn(Decimal("10"), "USD", Decimal("0.001"))
        # 10 / 0.001 = 10000
        assert result == Decimal("10000.000000")

    def test_zero_rate_rejected(self):
        """Zero rate should raise ValueError."""
        with pytest.raises(ValueError, match="positive"):
            convert_to_ngn(Decimal("100"), "USD", Decimal("0"))

    def test_negative_rate_rejected(self):
        """Negative rate should raise ValueError."""
        with pytest.raises(ValueError, match="positive"):
            convert_to_ngn(Decimal("100"), "USD", Decimal("-0.5"))

    def test_small_amount(self):
        """Very small amounts should still compute correctly."""
        result = convert_to_ngn(Decimal("0.01"), "USD", Decimal("0.001"))
        assert result == Decimal("10.000000")

    def test_large_amount(self):
        """Large amounts should not overflow."""
        result = convert_to_ngn(Decimal("1000000"), "USD", Decimal("0.001"))
        assert result == Decimal("1000000000.000000")
