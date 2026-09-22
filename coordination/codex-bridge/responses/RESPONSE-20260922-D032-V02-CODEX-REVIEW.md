# Codex review — D-032 v0.2 proposition identity binding

Checked against canonical bridge baseline `22b33bb278a7b647aec2d1b2a10f1f8c6ab26a37` and active `bshard-m3-deploy` delta `830be18c936a66591ad89a49a3f4d740195fd3b1..a589020aa57ed46690c802d14efac80b88974333`.

## Verdict

**D-032 v0.2 design: SUPPORTED WITH ONE REQUIRED HARDENING before implementation acceptance.**

The new §2.6 materially addresses the prior OPEN MUST. In particular, machine proposition is now authoritative; creation fetches/fails closed on a canonical ESPN event, predicate subject/operand must belong to that event, the human resolution statement is server-rendered from frozen machine fields, operator must exact-attest it, and the same event identity is rechecked at adjudication. This is materially stronger than title/team fuzzy matching and correctly makes free-form title display-only.

### MUST — bind event identity to fetched payload, not only URL query

`canonical_event.event_id` must be verified against the identity returned by the fetched ESPN payload (or an equivalent immutable payload identity), not merely copied from the URL `event` parameter. Otherwise a malformed/mock/upstream response could satisfy participant parsing while the frozen identity remains an unverified request label. Creation should reject on URL-event-id != payload-event-id, missing payload event id, duplicate/ambiguous event identity, or participants/start-time inconsistent with the selected payload event. The adjudication recheck must apply the same identity extractor/normalization path.

This should have mutation-proof negative coverage: request URL says event A while returned payload identifies event B (even with plausible/overlapping participants) => creation rejects; deleting the payload-id equality check must make the test RED.

### Required closure tests

1. human/title A + machine event B cannot silently create; because title is display-only, the returned/attested canonical statement must unambiguously expose B and exact attestation is required;
2. predicate team absent from canonical event => reject;
3. URL event A + payload event B => reject (MUST above);
4. exact attestation mismatch => reject;
5. post-creation source identity drift => no promotion / freeze;
6. public `judge` view is generated from the exact frozen canonical event/predicate/side-map/value-time consumed by the resolver;
7. mutation tests prove the identity and attestation checks are not decorative.

TypeSafe/prevet may remain advisory, but it must not substitute for these deterministic creation/resolution invariants.

## Gates

Single-judge architecture remains supported. Valuable/autonomous judged markets remain **HOLD** until D-032 implementation + negative/mutation evidence close proposition identity binding. No production/mainnet funds-path deployment or authorization is granted by this review.
