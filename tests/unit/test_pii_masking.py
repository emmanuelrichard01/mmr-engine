# tests/unit/test_pii_masking.py
"""
Unit tests for PII masking engine.

Tests verify that:
    1. Account numbers are correctly masked (first 2 + last 2 visible)
    2. Names are correctly masked (first char per word visible)
    3. BVN masking preserves only last 4 digits
    4. Narration scrubbing catches NUBAN, BVN, phone, email patterns
    5. None inputs are passed through as None
    6. Edge cases (empty strings, short inputs) are handled

References:
    - TDD §9.2: PII Masking Engine
    - Data Architecture §5: PII Handling
"""
import pytest

from src.engine.pii import (
    mask_account_number,
    mask_bvn,
    mask_name,
    mask_phone,
    scrub_narration,
)


class TestMaskAccountNumber:
    """Tests for NUBAN (10-digit) account masking."""

    def test_standard_nuban(self):
        """Standard 10-digit NUBAN: 0123456789 → 01******89"""
        assert mask_account_number("0123456789") == "01******89"

    def test_another_nuban(self):
        """Different account: 3045678901 → 30******01"""
        assert mask_account_number("3045678901") == "30******01"

    def test_short_account(self):
        """Short account (< 4 chars): fully masked."""
        assert mask_account_number("123") == "****"

    def test_medium_account(self):
        """6-digit account: first 2 + last 2 visible."""
        assert mask_account_number("123456") == "12**56"

    def test_long_account(self):
        """12-digit (non-standard): first 2 + last 2 visible."""
        assert mask_account_number("123456789012") == "12********12"

    def test_none_input(self):
        """None should pass through as None."""
        assert mask_account_number(None) is None

    def test_empty_string(self):
        """Empty string should return None."""
        assert mask_account_number("") is None

    def test_whitespace_trimmed(self):
        """Leading/trailing whitespace should be trimmed."""
        assert mask_account_number("  0123456789  ") == "01******89"


class TestMaskName:
    """Tests for name masking."""

    def test_full_name(self):
        """Full name: Chioma Okonkwo → C***** O******"""
        result = mask_name("Chioma Okonkwo")
        assert result.startswith("C")
        assert "O" in result
        # Each word should start with original first char
        parts = result.split()
        assert parts[0][0] == "C"
        assert parts[1][0] == "O"
        # Remaining chars should be asterisks
        assert all(c == "*" for c in parts[0][1:])
        assert all(c == "*" for c in parts[1][1:])

    def test_single_name(self):
        """Single name: Emmanuel → E*******"""
        result = mask_name("Emmanuel")
        assert result[0] == "E"
        assert result[1:] == "*" * 7

    def test_three_word_name(self):
        """Three-word name preserves first char of each."""
        result = mask_name("Ade John Smith")
        parts = result.split()
        assert len(parts) == 3
        assert parts[0][0] == "A"
        assert parts[1][0] == "J"
        assert parts[2][0] == "S"

    def test_single_char(self):
        """Single character word: returned as is."""
        assert mask_name("A") == "A"

    def test_none_input(self):
        assert mask_name(None) is None

    def test_empty_string(self):
        assert mask_name("") is None

    def test_whitespace_only(self):
        assert mask_name("   ") is None


class TestMaskBVN:
    """Tests for BVN (11-digit) masking."""

    def test_standard_bvn(self):
        """Standard BVN: 12345678901 → *******8901"""
        assert mask_bvn("12345678901") == "*******8901"

    def test_short_bvn(self):
        """Short input (< 4 chars): fully masked."""
        assert mask_bvn("12") == "***"

    def test_none_input(self):
        assert mask_bvn(None) is None


class TestMaskPhone:
    """Tests for Nigerian phone number masking."""

    def test_standard_phone(self):
        """08012345678 → 0801*****78"""
        result = mask_phone("08012345678")
        assert result[:4] == "0801"
        assert result[-2:] == "78"
        assert "*" in result

    def test_international_format(self):
        """+2348012345678 → +234*******78"""
        result = mask_phone("+2348012345678")
        assert result[:4] == "+234"
        assert result[-2:] == "78"

    def test_none_input(self):
        assert mask_phone(None) is None


class TestScrubNarration:
    """Tests for narration PII scrubbing."""

    def test_nuban_redacted(self):
        """10-digit account number in narration should be redacted."""
        result = scrub_narration("Transfer to 0123456789 for rent")
        assert "0123456789" not in result
        assert "[REDACTED-ACCOUNT]" in result

    def test_bvn_redacted(self):
        """11-digit BVN in narration should be redacted."""
        result = scrub_narration("BVN verification 12345678901")
        assert "12345678901" not in result
        assert "[REDACTED-BVN]" in result

    def test_phone_redacted(self):
        """Phone number in narration should be redacted."""
        result = scrub_narration("Call 08012345678 for details")
        assert "08012345678" not in result
        assert "[REDACTED-PHONE]" in result

    def test_email_redacted(self):
        """Email in narration should be redacted."""
        result = scrub_narration("Contact user@example.com for refund")
        assert "user@example.com" not in result
        assert "[REDACTED-EMAIL]" in result

    def test_multiple_pii_patterns(self):
        """Multiple PII patterns should all be redacted."""
        result = scrub_narration(
            "Send to 0123456789 phone 08012345678 email test@email.com"
        )
        assert "0123456789" not in result
        assert "08012345678" not in result
        assert "test@email.com" not in result

    def test_clean_narration_unchanged(self):
        """Narration without PII should pass through unchanged."""
        text = "Monthly subscription payment"
        assert scrub_narration(text) == text

    def test_truncation(self):
        """Narrations over 500 chars should be truncated."""
        long_text = "A" * 600
        result = scrub_narration(long_text)
        assert len(result) == 500

    def test_none_input(self):
        assert scrub_narration(None) is None

    def test_empty_string(self):
        assert scrub_narration("") is None
