# tests/unit/test_normaliser.py
"""
Silver normaliser tests: amount conventions, event classification, PII
handling, and the regressions fixed in the credibility cleanup.
"""

import copy
from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

import pytest

from src.engine.normaliser import (
    PermanentEventError,
    classify_event,
    normalise_flutterwave_event,
    normalise_paystack_event,
    parse_timestamp,
)
from src.engine.pii import tokenize_name


def _ps(payload, **kw):
    return normalise_paystack_event(
        payload=payload,
        bronze_ingestion_id=uuid4(),
        run_id=uuid4(),
        fx_rate_snapshot_id=kw.get("fx_id"),
        fx_rate_applied=kw.get("fx"),
        expected_settlement_at=None,
    )


def _flw(payload, **kw):
    return normalise_flutterwave_event(
        payload=payload,
        bronze_ingestion_id=uuid4(),
        run_id=uuid4(),
        fx_rate_snapshot_id=kw.get("fx_id"),
        fx_rate_applied=kw.get("fx"),
        expected_settlement_at=None,
    )


class TestClassifyEvent:
    @pytest.mark.parametrize(
        ("event", "tx_type", "status"),
        [
            ("charge.success", "credit", "settled"),
            ("transfer.success", "debit", "settled"),
            ("transfer.failed", "debit", "failed"),
            ("transfer.reversed", "reversal", "reversed"),
        ],
    )
    def test_paystack_vocabulary(self, event, tx_type, status):
        d = classify_event("paystack", event, {"data": {}})
        assert (d.process, d.transaction_type, d.settlement_status) == (True, tx_type, status)

    @pytest.mark.parametrize(
        "event", ["subscription.create", "charge.dispute.create", "paymentrequest.success", "unknown"]
    )
    def test_unhandled_paystack_events_are_not_guessed_into_credits(self, event):
        """Regression: unknown events used to default to transaction_type='credit'."""
        assert classify_event("paystack", event, {"data": {"amount": 100}}).process is False

    def test_flutterwave_failed_charge_is_not_a_credit(self):
        """Regression: charge.completed with status=failed was stored as a settled credit."""
        d = classify_event("flutterwave", "charge.completed", {"data": {"status": "failed"}})
        assert d.process is False

    def test_flutterwave_successful_charge(self):
        d = classify_event("flutterwave", "charge.completed", {"data": {"status": "successful"}})
        assert (d.process, d.transaction_type, d.settlement_status) == (True, "credit", "settled")

    def test_flutterwave_failed_transfer_is_recorded_as_failed_debit(self):
        d = classify_event("flutterwave", "transfer.completed", {"data": {"status": "FAILED"}})
        assert (d.process, d.transaction_type, d.settlement_status) == (True, "debit", "failed")

    def test_payload_without_data(self):
        assert classify_event("paystack", "charge.success", {}).process is False

    def test_unknown_psp(self):
        assert classify_event("mpesa", "anything", {"data": {}}).process is False


class TestPaystack:
    def test_kobo_to_naira(self, paystack_charge_payload):
        assert _ps(paystack_charge_payload)["amount_ngn"] == Decimal("50000")

    def test_kobo_precision_kept(self, paystack_charge_payload):
        p = copy.deepcopy(paystack_charge_payload)
        p["data"]["amount"] = 1234567  # ₦12,345.67
        assert _ps(p)["amount_ngn"] == Decimal("12345.67")

    def test_counterparty_masked_and_tokenized(self, paystack_charge_payload):
        rec = _ps(paystack_charge_payload)
        assert rec["beneficiary_name_masked"] == "C***** O******"
        assert rec["beneficiary_account_masked"] == "01******89"
        assert rec["counterparty_name_tokens"] == tokenize_name("Chioma Okonkwo")
        assert "Chioma" not in str(rec)

    def test_email_never_in_output(self, paystack_charge_payload):
        assert "chioma@example.com" not in str(_ps(paystack_charge_payload))

    def test_idempotency_key(self, paystack_charge_payload):
        assert _ps(paystack_charge_payload)["idempotency_key"] == "paystack:T_abc123xyz:charge.success"

    def test_fees_kept_in_kobo_not_float(self, paystack_charge_payload):
        assert _ps(paystack_charge_payload)["psp_metadata"]["fees_kobo"] == 145000

    def test_transfer_counterparty_is_recipient(self):
        payload = {
            "event": "transfer.success",
            "data": {
                "reference": "TRF_1",
                "amount": 1000000,
                "currency": "NGN",
                "created_at": "2026-05-01T10:00:00.000Z",
                "recipient": {
                    "details": {"account_number": "0011223344", "account_name": "ADA EZE", "bank_code": "044"}
                },
            },
        }
        rec = _ps(payload)
        assert rec["transaction_type"] == "debit"
        assert rec["beneficiary_account_masked"] == "00******44"
        assert rec["counterparty_name_tokens"] == tokenize_name("ADA EZE")

    def test_non_ngn_requires_fx_rate(self, paystack_charge_payload):
        p = copy.deepcopy(paystack_charge_payload)
        p["data"]["currency"] = "USD"
        with pytest.raises(PermanentEventError, match="FX rate required"):
            _ps(p)

    def test_non_ngn_converted(self, paystack_charge_payload):
        p = copy.deepcopy(paystack_charge_payload)
        p["data"].update(currency="USD", amount=3165)  # $31.65
        rec = _ps(p, fx=Decimal("0.00063291"), fx_id=uuid4())
        assert rec["amount_ngn"] == (Decimal("31.65") / Decimal("0.00063291")).quantize(Decimal("0.000001"))

    @pytest.mark.parametrize(
        "mutate",
        [
            lambda d: d.pop("reference"),
            lambda d: d.pop("amount"),
            lambda d: d.update(amount=0),
            lambda d: d.update(amount=-5),
            lambda d: d.update(amount="abc"),
            lambda d: d.pop("paid_at"),
            lambda d: d.update(paid_at="2026-05-01T08:00:00"),  # no timezone
        ],
    )
    def test_malformed_payloads_raise_permanent_error(self, paystack_charge_payload, mutate):
        p = copy.deepcopy(paystack_charge_payload)
        mutate(p["data"])
        with pytest.raises(PermanentEventError):
            _ps(p)

    def test_unhandled_event_raises(self, paystack_charge_payload):
        p = copy.deepcopy(paystack_charge_payload)
        p["event"] = "subscription.create"
        with pytest.raises(PermanentEventError):
            _ps(p)


class TestFlutterwave:
    def test_major_units_passthrough(self, flutterwave_charge_payload):
        assert _flw(flutterwave_charge_payload)["amount_ngn"] == Decimal("50000")

    def test_json_float_amount_is_exact(self, flutterwave_charge_payload):
        p = copy.deepcopy(flutterwave_charge_payload)
        p["data"]["amount"] = 1999.99
        assert _flw(p)["amount_ngn"] == Decimal("1999.99")

    def test_pii_masked(self, flutterwave_charge_payload):
        rec = _flw(flutterwave_charge_payload)
        assert rec["beneficiary_name_masked"] == "A** J******"
        assert rec["beneficiary_account_masked"] == "98******10"
        assert "ade@example.com" not in str(rec)

    def test_metadata_fees_are_strings(self, flutterwave_charge_payload):
        meta = _flw(flutterwave_charge_payload)["psp_metadata"]
        assert meta["app_fee"] == "200" and meta["merchant_fee"] == "1250"
        assert meta["flw_ref"] == "FLW-MOCK-abc123"

    def test_failed_charge_rejected(self, flutterwave_charge_payload):
        p = copy.deepcopy(flutterwave_charge_payload)
        p["data"]["status"] = "failed"
        with pytest.raises(PermanentEventError):
            _flw(p)

    def test_idempotency_key(self, flutterwave_charge_payload):
        assert _flw(flutterwave_charge_payload)["idempotency_key"] == "flutterwave:FLW-TXN-99887:charge.completed"


class TestParseTimestamp:
    def test_iso_with_z(self):
        assert parse_timestamp("2026-05-01T08:12:00.000Z") == datetime(2026, 5, 1, 8, 12, tzinfo=UTC)

    def test_offset_converted_to_utc(self):
        assert parse_timestamp("2026-05-01T09:12:00+01:00") == datetime(2026, 5, 1, 8, 12, tzinfo=UTC)

    @pytest.mark.parametrize("value", [None, "", "not-a-date", "2026-05-01T08:00:00"])
    def test_invalid(self, value):
        with pytest.raises(PermanentEventError):
            parse_timestamp(value)
