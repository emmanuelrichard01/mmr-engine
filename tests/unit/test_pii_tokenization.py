# tests/unit/test_pii_tokenization.py
"""Keyed name tokenization used for matching without storing names (ADR 0001)."""

from hypothesis import given
from hypothesis import strategies as st

from src.engine.pii import name_token_similarity, normalise_name_tokens, tokenize_name

K = b"k1"


def test_order_case_accents_and_honorifics_ignored():
    assert tokenize_name("Mr. Adébáyọ̀ JOHN", K) == tokenize_name("john adebayo", K)


def test_business_suffixes_ignored():
    assert tokenize_name("ACME VENTURES LTD", K) == tokenize_name("Acme", K)


def test_tokens_do_not_contain_the_name():
    tokens = tokenize_name("Chioma Okonkwo", K)
    assert all("CHIOMA" not in t and "OKONKWO" not in t for t in tokens)
    assert all(len(t) == 32 for t in tokens)


def test_key_changes_tokens():
    assert tokenize_name("Chioma Okonkwo", K) != tokenize_name("Chioma Okonkwo", b"k2")


def test_dropped_middle_name_still_matches():
    assert name_token_similarity(tokenize_name("Adebayo John", K), tokenize_name("Adebayo John Oluwaseun", K)) == 1.0


def test_single_shared_word_is_not_a_match():
    score = name_token_similarity(tokenize_name("John", K), tokenize_name("John Smith", K))
    assert score is not None and score < 1.0


def test_unknown_name_is_none():
    assert name_token_similarity([], tokenize_name("Ada", K)) is None


def test_normalise_drops_noise():
    assert normalise_name_tokens("TRF FROM MRS. Ngozi-Eze") == ["EZE", "NGOZI"]


@given(st.text(max_size=40), st.text(max_size=40))
def test_similarity_bounded_and_symmetric(a, b):
    ta, tb = tokenize_name(a, K), tokenize_name(b, K)
    s1, s2 = name_token_similarity(ta, tb), name_token_similarity(tb, ta)
    assert s1 == s2
    assert s1 is None or 0.0 <= s1 <= 1.0
