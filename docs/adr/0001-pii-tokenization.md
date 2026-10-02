# ADR 0001: Keyed tokenization, not masking, for matching personal data

- Status: accepted (implemented in migration `015` and `src/engine/pii.py`)
- Date: 2026-10-02
- Deciders: Emmanuel Richard

## Context

Silver stores no raw personal data. Account numbers and counterparty names were *masked* before the
Silver write (`0123456789` → `01******89`, `Chioma Okonkwo` → `C***** O******`). The matching engine then
computed trigram similarity on the masked names.

Masking destroys exactly the information matching needs:

- Different people collide. `Chioma Okonkwo` and `Chisom Onyekwe` both mask to `C***** O******`, so
  they scored as a perfect name match.
- Similar spellings of the same person stop resembling each other. Trigram similarity on
  `A***** J***` mostly measures word lengths.
- Order swaps (`JOHN ADEBAYO` vs `ADEBAYO JOHN`), honorifics (`MR`, `ALHAJI`) and transfer boilerplate
  (`TRF FROM`) cannot be normalised after masking.

So the name signal in the probabilistic tier was noise, and in the worst case it actively supported
wrong matches.

## Options considered

1. **Keep masking, drop names from matching.** Safe, but it loses the strongest corroborating signal
   between two equal-amount transfers.
2. **Store names encrypted, decrypt to match.** Matching works, but every matching run handles
   plaintext PII, and key custody spreads to every worker.
3. **Deterministic keyed tokenization.** Normalise the name (uppercase, strip accents and punctuation,
   drop honorifics and boilerplate, de-duplicate), then store `HMAC-SHA256(key, word)` for each word,
   truncated to 128 bits. Equal words give equal tokens; without the key, tokens cannot be reversed or
   brute-forced offline.
4. **Phonetic or fuzzy hashing** (e.g. Soundex of each token). Tolerates typos but leaks more structure,
   and Nigerian names are poorly served by English-centric phonetic codes.

## Decision

Option 3. Silver gets `counterparty_name_tokens TEXT[]`. Masked names stay for display only.
Similarity is the Dice coefficient over token sets, with one exception: if the shorter name has at least
two words and all of them appear in the longer one, the score is 1.0. Banks often drop middle names, but
one shared word (every "John") is never treated as a match.

The key is `PII_TOKENIZATION_KEY` (at least 32 characters, required at boot).

## Consequences

- **Good:** order, accents, honorifics and dropped middle names no longer break matching; distinct people
  no longer collide; no plaintext name is needed at match time.
- **Bad:** exact-token matching does not tolerate typos (`ADEBAYO` vs `ADEBAYOO`). Accepted: the amount and
  time evidence dominate the score, and an unmatched transaction goes to review rather than being guessed.
- **Bad:** rotating the key makes old and new tokens incomparable. A rotation needs a re-tokenization pass
  from Bronze, which still holds the raw events.
- **Follow-up:** the same approach should cover account numbers if account-level matching is added.
  A per-tenant key is required once the system is multi-tenant, so tokens can't be correlated across
  tenants.
