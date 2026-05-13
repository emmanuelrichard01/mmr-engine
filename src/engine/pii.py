# src/engine/pii.py
"""
PII masking functions for NDPR/CBN compliance.

Defence-in-depth strategy:
    1. Raw payloads are stored in Bronze (MinIO) — no access from Silver/Gold
    2. Silver transforms apply masking functions before DB write
    3. CHECK (has_pii_masked = TRUE) constraint enforces masking at database level
    4. Narration fields are scrubbed with regex for residual PII patterns

Masking formats:
    - Account numbers: first 2 + asterisks + last 2  (01******89)
    - Names:           first char per word + asterisks (C****** O*******)
    - BVN:             asterisks + last 4              (*******8901)
    - Phone:           replaced with [REDACTED-PHONE]

References:
    - TDD §9.2: PII Masking Engine
    - Data Architecture §5: PII Handling
    - ERD §6.5: CHECK (has_pii_masked = TRUE)
"""
import re
from typing import Optional


# Patterns for PII detection in narration fields
_NUBAN_PATTERN = re.compile(r"\b\d{10}\b")         # 10-digit NUBAN
_BVN_PATTERN = re.compile(r"\b\d{11}\b")           # 11-digit BVN
_PHONE_PATTERN = re.compile(
    r"(\+?234|0)[789]\d{9}"                         # Nigerian phone number variants
)
_EMAIL_PATTERN = re.compile(
    r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"  # Email addresses
)


def mask_account_number(account: Optional[str]) -> Optional[str]:
    """
    Mask a NUBAN account number (10 digits).
    Format: first 2 digits + asterisks + last 2 digits.
    Example: 0123456789 → 01******89

    Non-10-digit inputs: partially masked preserving first/last 2.
    None inputs: returned as None (field not provided by PSP).
    """
    if account is None:
        return None
    account = account.strip()
    if not account:
        return None
    if len(account) == 10 and account.isdigit():
        return account[:2] + "*" * 6 + account[-2:]
    if len(account) >= 4:
        return account[:2] + "*" * (len(account) - 4) + account[-2:]
    return "****"


def mask_name(name: Optional[str]) -> Optional[str]:
    """
    Mask a person's full name.
    Format: first character of each word + asterisks for remaining characters.
    Example: 'Chioma Okonkwo' → 'C***** O******'

    Single character words: returned as is (initials).
    None inputs: returned as None.
    """
    if name is None:
        return None
    name = name.strip()
    if not name:
        return None
    parts = name.split()
    masked = []
    for part in parts:
        if len(part) <= 1:
            masked.append(part)
        else:
            masked.append(part[0] + "*" * (len(part) - 1))
    return " ".join(masked)


def mask_bvn(bvn: Optional[str]) -> Optional[str]:
    """
    Mask a BVN (11 digits).
    Format: asterisks + last 4 digits.
    Example: 12345678901 → *******8901
    """
    if bvn is None:
        return None
    bvn = bvn.strip()
    if len(bvn) < 4:
        return "***"
    return "*" * (len(bvn) - 4) + bvn[-4:]


def mask_phone(phone: Optional[str]) -> Optional[str]:
    """
    Mask a Nigerian phone number.
    Format: first 4 digits + asterisks + last 2 digits.
    Example: 08012345678 → 0801*****78
    """
    if phone is None:
        return None
    phone = phone.strip()
    if len(phone) < 6:
        return "****"
    return phone[:4] + "*" * (len(phone) - 6) + phone[-2:]


def scrub_narration(narration: Optional[str]) -> Optional[str]:
    """
    Remove PII patterns from free-text narration fields.
    Applies regex substitution for NUBAN, BVN, phone, and email patterns.
    Truncates to 500 characters after scrubbing.

    This is not perfect — it's a defence-in-depth measure.
    The primary PII control is that raw payloads never leave Bronze.
    """
    if narration is None:
        return None
    text = narration.strip()
    if not text:
        return None
    text = _NUBAN_PATTERN.sub("[REDACTED-ACCOUNT]", text)
    text = _BVN_PATTERN.sub("[REDACTED-BVN]", text)
    text = _PHONE_PATTERN.sub("[REDACTED-PHONE]", text)
    text = _EMAIL_PATTERN.sub("[REDACTED-EMAIL]", text)
    return text[:500]
