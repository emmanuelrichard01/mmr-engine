# src/engine/pii.py
"""
PII protection: display masking, narration scrubbing, and match tokenization.

Two different jobs, two different tools (see docs/adr/0001-pii-tokenization.md):

1. **Display masking** (`mask_*`): irreversible, human-readable redaction for
   anything an operator sees, e.g. `01******89`, `C***** O******`. Masked values
   must never be used for matching: two different people mask to the same
   string whenever their initials and name lengths coincide.

2. **Match tokenization** (`tokenize_name`): a keyed HMAC-SHA256 of each
   normalised name token. Equal tokens mean equal words, so the engine can
   compare names (order-insensitive, honorific-insensitive) without storing
   them. Without the key, tokens cannot be reversed or brute-forced offline.

Defence in depth:
    1. Raw payloads live only in Bronze (MinIO); Silver/Gold never see them
    2. The normaliser masks/tokenizes before any Silver write
    3. CHECK (has_pii_masked = TRUE) enforces the masking step at DB level
    4. Narrations are regex-scrubbed for residual identifiers

Legal context: Nigeria Data Protection Act 2023 (NDPA). This module is an
engineering control, not a compliance certification.
"""

import hashlib
import hmac
import re
import unicodedata

from src.config import get_settings

# Patterns for PII detection in narration fields. Order matters: an
# 11-digit Nigerian mobile number (0803...) also looks like a BVN, so phone
# numbers are redacted first, then 11-digit BVNs, then 10-digit NUBANs.
_PHONE_PATTERN = re.compile(r"(?<!\d)(?:\+?234|0)[789][01]\d{8}(?!\d)")
_BVN_PATTERN = re.compile(r"(?<!\d)\d{11}(?!\d)")
_NUBAN_PATTERN = re.compile(r"(?<!\d)\d{10}(?!\d)")
_EMAIL_PATTERN = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")

# Tokens that carry no identity: honorifics, titles, transfer boilerplate and
# business suffixes that banks/PSPs add or drop inconsistently.
_NAME_STOPWORDS = frozenset(
    {
        "MR",
        "MRS",
        "MS",
        "MISS",
        "DR",
        "CHIEF",
        "ALH",
        "ALHAJI",
        "ALHAJA",
        "ENGR",
        "PASTOR",
        "PROF",
        "HON",
        "SIR",
        "TRF",
        "TRANSFER",
        "FROM",
        "FRM",
        "NIP",
        "MOB",
        "FT",
        "TO",
        "LTD",
        "LIMITED",
        "ENT",
        "ENTERPRISE",
        "ENTERPRISES",
        "VENTURES",
        "NIG",
        "NIGERIA",
        "PLC",
        "CO",
        "AND",
    }
)
_NON_ALNUM = re.compile(r"[^A-Z0-9 ]+")


def mask_account_number(account: str | None) -> str | None:
    """
    Mask a NUBAN account number (10 digits) for display.
    Format: first 2 digits + asterisks + last 2 digits. 0123456789 → 01******89
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


def mask_name(name: str | None) -> str | None:
    """
    Mask a person's full name for display: first character of each word.
    'Chioma Okonkwo' → 'C***** O******'. Never use the result for matching.
    """
    if name is None:
        return None
    name = name.strip()
    if not name:
        return None
    return " ".join(part if len(part) <= 1 else part[0] + "*" * (len(part) - 1) for part in name.split())


def mask_bvn(bvn: str | None) -> str | None:
    """Mask a BVN (11 digits): asterisks + last 4 digits. 12345678901 → *******8901"""
    if bvn is None:
        return None
    bvn = bvn.strip()
    if len(bvn) < 4:
        return "***"
    return "*" * (len(bvn) - 4) + bvn[-4:]


def mask_phone(phone: str | None) -> str | None:
    """Mask a Nigerian phone number: 08012345678 → 0801*****78"""
    if phone is None:
        return None
    phone = phone.strip()
    if len(phone) < 6:
        return "****"
    return phone[:4] + "*" * (len(phone) - 6) + phone[-2:]


def scrub_narration(narration: str | None) -> str | None:
    """
    Remove PII patterns from free-text narration fields, then truncate to 500
    characters. Defence in depth only: the primary control is that raw
    payloads never leave Bronze.
    """
    if narration is None:
        return None
    text = narration.strip()
    if not text:
        return None
    text = _EMAIL_PATTERN.sub("[REDACTED-EMAIL]", text)
    text = _PHONE_PATTERN.sub("[REDACTED-PHONE]", text)
    text = _BVN_PATTERN.sub("[REDACTED-BVN]", text)
    text = _NUBAN_PATTERN.sub("[REDACTED-ACCOUNT]", text)
    return text[:500]


def normalise_name_tokens(name: str | None) -> list[str]:
    """
    Canonical word list for a person or business name: uppercase, accents
    stripped, punctuation removed, honorifics/boilerplate dropped, de-duplicated
    and sorted (so word order never matters).
    """
    if not name:
        return []
    decomposed = unicodedata.normalize("NFKD", name)
    ascii_only = "".join(c for c in decomposed if not unicodedata.combining(c))
    cleaned = _NON_ALNUM.sub(" ", ascii_only.upper())
    return sorted({t for t in cleaned.split() if t not in _NAME_STOPWORDS and len(t) > 1})


def tokenize_name(name: str | None, key: bytes | None = None) -> list[str]:
    """
    Keyed, order-insensitive name tokens for matching without storing names.
    Each token is HMAC-SHA256(key, word) truncated to 128 bits (hex).
    """
    words = normalise_name_tokens(name)
    if not words:
        return []
    hmac_key = key if key is not None else get_settings().pii_tokenization_key.get_secret_value().encode("utf-8")
    return sorted({hmac.new(hmac_key, word.encode("utf-8"), hashlib.sha256).hexdigest()[:32] for word in words})


def name_token_similarity(a: list[str] | None, b: list[str] | None) -> float | None:
    """
    Similarity of two token sets in [0, 1], or None when either side has no name.

    - Dice coefficient 2|A∩B| / (|A|+|B|) handles order swaps and partial overlap.
    - When the shorter name has ≥ 2 words and is fully contained in the longer
      one ("ADEBAYO JOHN" vs "ADEBAYO JOHN OLUWASEUN"), score 1.0: banks often
      drop middle names. Single-word containment is not trusted ("JOHN" ⊂ every
      John).
    """
    if not a or not b:
        return None
    set_a, set_b = set(a), set(b)
    overlap = len(set_a & set_b)
    shorter = min(len(set_a), len(set_b))
    if shorter >= 2 and overlap == shorter:
        return 1.0
    return 2 * overlap / (len(set_a) + len(set_b))
