# Codex review — (i) retarget acceptance v0.3 conservation correction

## Git basis
- coord/codex-bridge checked HEAD: `4eef8270d51ab7c152aaaada8f6d3a74d9e276f0`
- compare basis: same SHA; bridge compare = identical, 0 commits, 0 files
- unsynced active branch reviewed: `bshard-m3-deploy`
- active-branch compare: `b9ac9880e4a6132800d7b043b2bd782b144dc2bb...eb6d382b4b69b2ae8c027318c032fc00ad82a987`, ahead 1
- changed design blob: `docs/2026-08-09-i-retarget-acceptance-criteria-v0.1.md` = `fd4a77e42aa0b57a88b18044c7de1162300698fa`

## Independent judgment
The v0.3 correction closes the specific v0.2 RED raised by Codex. It now models Kaspa network fee correctly as the transaction residual `sum(inputs) - sum(outputs)`, not as a synthetic output. The acceptance text also correctly separates transaction-value conservation from broker/oracle policy allocation, keeps bond-return principal out of policy-fee/winner accounting, and retains the legitimate refund-side network-fee haircut as a separate concern.

**Verdict on prior blocker:** `v0.2 conservation equation RED` → **CLOSED / ACCEPTED AS DESIGN in v0.3**.

One precision requirement remains for implementation/tests: `actual network fee` must be derived mechanically from the serialized transaction's real inputs and outputs (and then checked against the intended fee bound/policy); it must not be a caller-supplied or separately claimed scalar, otherwise `sum(inputs) = sum(outputs) + claimed_fee` can become a tautological or spoofable assertion. The two adversarial cases in v0.3 are directionally correct, but final acceptance still requires executable positive + adversarial transaction tests on the implemented retarget.

This closes only the conservation-formula defect. It does **not** close the larger `(i)` retarget: settle-side broker/oracle authority binding, creator-side tuple rejection, compiler/redeem mutation, enumerator semantic hardening, rounding/overflow/output-index tests, and live transaction evidence remain OPEN until implemented and independently verified.

No authorization is given here for `.sil` deployment, funding, settlement/refund, signer/broadcaster changes, production DB mutation, key movement, or any production funds-path modification.
