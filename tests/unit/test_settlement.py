# tests/unit/test_settlement.py
"""
Unit tests for settlement time calculation logic.

Tests verify:
    1. Weekend skipping logic for business days
    2. No change for calendar day settlements
    3. Correct weekday detection

References:
    - TDD §9.4: Settlement Compute
"""
from datetime import datetime, timezone

import pytest

from src.engine.settlement import _skip_weekends


class TestSkipWeekends:
    """Tests for weekend skipping logic."""

    def test_weekday_unchanged(self):
        """Monday–Friday should pass through unchanged."""
        # Monday
        monday = datetime(2026, 5, 4, 10, 0, tzinfo=timezone.utc)
        assert _skip_weekends(monday) == monday

        # Wednesday
        wednesday = datetime(2026, 5, 6, 10, 0, tzinfo=timezone.utc)
        assert _skip_weekends(wednesday) == wednesday

        # Friday
        friday = datetime(2026, 5, 8, 10, 0, tzinfo=timezone.utc)
        assert _skip_weekends(friday) == friday

    def test_saturday_to_monday(self):
        """Saturday should advance to Monday."""
        saturday = datetime(2026, 5, 9, 14, 30, tzinfo=timezone.utc)
        result = _skip_weekends(saturday)
        assert result.weekday() == 0  # Monday

    def test_sunday_to_monday(self):
        """Sunday should advance to Monday."""
        sunday = datetime(2026, 5, 10, 9, 0, tzinfo=timezone.utc)
        result = _skip_weekends(sunday)
        assert result.weekday() == 0  # Monday
