# AI v5 → Contract canonical score mapping

The AI v5 response keeps the raw verifier scores in `evidence`:

- WARN is decided by `queryVerifierScore >= 0.351229127861893`.
- HOLD is decided by `similarityScore >= 0.9471999941293027`.
- BLOCK is a Chromaprint exact duplicate.

For the current Contract EIP-712 payload, Backend preserves those raw values in the evidence JSON and maps only the decision band to the existing normalized score scale:

- PASS: `< 0.80`
- WARN: `0.80 <= score < 0.85`
- HOLD: `>= 0.85`

This mapping is not a second AI decision. It is a canonical transaction band so Contract, marketplace, and purchase restrictions agree while the original v5 scores remain auditable.
