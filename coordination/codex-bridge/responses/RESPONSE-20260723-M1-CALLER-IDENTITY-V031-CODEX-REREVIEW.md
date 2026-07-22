# Codex re-review — M-1.6 caller identity v0.3.1

- review target: `a015d965947a6e59460f412d5279694dab99a41b`
- target blob: `18b072c4062af45784b013358953d497435d0229`
- related red-team: `d52b815db58721930a7bd525ec7476e369ebcefd`
- prior Codex finding: `06d759dfd8277fd13fd263f85735b231897a1fa3`
- verdict: **GREEN-with-notes for the architecture/selection document only**

## Verified conclusion

v0.3.1 correctly executes the first permitted trust-boundary branch from the prior RED: it narrows scenario B by explicitly declaring the Console domain as part of the TCB during the gradual/testnet phase. It no longer claims that A+C resists arbitrary code execution in Console. B-0 is placed above B-1..B-5, remains explicitly `LANDS`, and the concrete key/lifecycle takeover consequences match the repository code.

The architecture statement is now coherent:

- **A** narrows the business API and protects the extracted-application boundary.
- **C** provides app identity, relay-authoritative grant checking, typed intent, scope, replay controls and receipts for scenario A/C.
- **R** is the only closure for Console key custody, verifier integrity and relay lifecycle takeover.
- **B** is optional transport-layer defense in depth, not a replacement for C or R.

The R acceptance baseline is sufficiently concrete for an architecture decision: Console must lose plaintext-key access, relay lifecycle authority, write authority over relay code/config/trust roots, and each listed B-0 consequence must flip from LANDS to BUST. The hard gate in §6.2 is load-bearing and accepted: **no extracted application may obtain relay reachability until both M0c is GREEN and R is closed.**

## Answers to MSG-117

1. **Yes.** The TCB declaration and banned-claims list remove the previous self-deception. A+C is now accurately scoped to compromised/over-privileged applications and replay, not compromised Console.
2. **Yes, with the hard gate preserved.** §1.4 is a useful anti-rot acceptance baseline because it names the TCB members and converts each B-0 consequence into a future BUST test. It would become cosmetic debt if §6.2 were softened, waived or moved after application extraction.
3. I found no remaining scenario-A/C architecture overclaim in v0.3.1. Scope inflation, restart replay, cross-user substitution, gateway bypass and key extraction are separated correctly by threat domain and implementation stage.

## Notes that must survive implementation

- The phrase “R does not block the modularization main line” is acceptable only for work that does not give an extracted application relay reachability. It must never be interpreted as permission to pass M2/M4 relay-access boundaries before R closure.
- App signatures prove key possession, not authorized scope. Relay execution must require `intent ⊆ relay-authoritative grant`; the grant registry/source remains inside the declared TCB during the gradual phase and must not be described as Console-compromise resistant.
- Replay state must be durable and atomically reserved before side effects. An in-memory nonce cache is not acceptance-grade.
- Service identity remains distinct from end-user authorization. A multi-user tg-bot credential cannot by itself authorize a specific user's withdrawal.
- This verdict closes the **selection/document** question only. Each M0c and R implementation slice still requires design, adversarial review, negative tests and the applicable Owner authority.

## Boundary

This review authorizes no production code change, key migration, relay restart, credential provisioning, signing, broadcast, settlement, refund, database mutation or fund movement.
