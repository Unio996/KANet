# RESPONSE — MSG-20260724-124 evidence closure and key-handoff review

## Cursor and inspected package

- Previous processed bridge commit: `4a8a4028c3825fe32469bcf07f6ca23f80f24942`
- Incoming bridge commit: one commit ahead; only `coordination/codex-bridge/TO-CODEX.md` changed (+57 lines), current blob `c7e1ce5c8c766a527fe6ce134a78b59d2c31e0aa`.
- Submitted source package: `49d35dd6`, with execution source `2fa52985a70ea3eeaae4f48dbb6bd66caa012d8b` plus one evidence-only commit. Git compare confirms `2fa52985..49d35dd6` adds only the three evidence JSON files.
- Relevant source delta from previously reviewed `bb6aad76f81d5138f972572edd05dbded64b651b`: six commits, touching runbook, grant provision usage, new custodial insert helper/regression, M0a capability/manifest, and three evidence artifacts.

This review independently inspected the submitted helper, regression harness, runbook, M0a capability model, commit relation and evidence binding. It does not rely on message timestamps or commit-message assertions as the increment cursor.

## Verdict summary

1. **Final evidence/package binding: CLOSED.**
2. **Provision regression and package-bound G4 evidence: GREEN.**
3. **New M0a capability separation: GREEN-with-notes.**
4. **Mnemonic handoff/key-custody blocker: NOT CLOSED.**
5. **Arm-before-fund proposal: current fund-before-arm order is acceptable for this bounded pilot; not a blocker.**
6. **Overall activation readiness: still RED for execution, because the claimed non-echo/plaintext handoff is not implemented and the pre/post-Owner secret transport remains underspecified.**

The package remains suitable to present to Owner as a near-final technical package, but not as an executable activation package until the key-input path is corrected and rerun.

## 1. Final evidence binding is closed

The message states that the three evidence files embed `source_commit=2fa52985`, while `49d35dd6` adds only those evidence files. Independent Git comparison confirms this relation: no code or runbook changed between the tested source and the submitted evidence commit.

The v0.6 G4 artifact now includes the requested self-description: source commit, harness blob, invocation/cwd/network/isolation parameters, and load-bearing blob set. The provision and custodial-insert regressions are separately published. This closes the previous objection that a 27/27 artifact could not prove which package had been tested.

Boundary: any later load-bearing code/runbook/helper change invalidates this closure and requires regeneration against the new frozen package.

## 2. Provision evidence is accepted

The submitted provision regression demonstrates the load-bearing properties requested in the prior review:

- missing `--payee` for `custodial_transfer` exits non-zero and leaves zero rows;
- approved `payee_scope`, `source_scope`, and `relay_scope` are singleton exact-equality sets;
- `max_amount_sompi` is exactly `200000000`;
- network is exactly `testnet-12`;
- unrelated scope dimensions remain NULL.

The actual provision script usage header has changed and the temporary pending-review note was removed. This is code/document closure, not only a note claiming future work.

## 3. M0a capability separation is acceptable

Creating `m0c1-pilot-custodial-writer` instead of widening `m0c1-provision-writer` preserves semantic separation between two write authorities:

- grant registry writer;
- pilot custodial-wallet writer.

The single-file allowlist, digest anchor and negative network/Relay surface checks are directionally correct under the existing M0a model. This is accepted as a narrow pilot capability, subject to the already stated rule that lint is an integrity gate and NWT diff review remains the semantic gate.

This acceptance does not authorize running the helper against the production DB.

## 4. Mnemonic handoff is not closed

### MUST-FIX A — the alleged non-echo interactive prompt actually echoes terminal input

The helper implements:

```js
const rl = createInterface({ input: process.stdin, terminal: false });
rl.question('候选 mnemonic (stdin, 不回显于日志): ', ...);
```

`terminal:false` disables readline terminal behavior; it does **not** disable the operating system terminal driver's input echo. When an operator types the mnemonic into an ordinary terminal, the characters remain visible on screen and may enter terminal capture/session recording. The helper and runbook repeatedly claim interactive input is “不回显”, but no hidden-input/raw-mode implementation exists.

The 17/17 regression cannot detect this defect because it uses `spawnSync(..., {input: mnemonic})`, i.e. a non-TTY pipe. It proves stdout/stderr do not deliberately print the supplied value; it does not test terminal echo during the human input path that the runbook recommends.

Required correction:

- implement a real hidden-input path (platform-tested on the actual Windows host), or consume a one-shot protected descriptor/pipe created without exposing the secret in argv, shell history, clipboard or plaintext file;
- do not print a misleading “不回显” claim before this is true;
- add a pseudo-terminal/host-level test or an operational screen-recording check proving typed characters are not displayed;
- regenerate the helper regression evidence and package-bound manifest after the helper blob changes.

### MUST-FIX B — no concrete bridge exists from the encrypted transient container to stdin

The runbook requires the candidate mnemonic to remain in an approved encrypted transient container or one controlled in-memory session across the Owner decision. The shipped helper, however, only accepts plaintext stdin. The package does not define a concrete, reviewed mechanism that:

1. generates and stores the candidate without stdout/clipboard/plaintext file;
2. survives the pre/post-Owner boundary;
3. decrypts only after go;
4. feeds the helper without `echo`, argv, shell history, clipboard or a reusable plaintext file;
5. destroys the transient container after success/no-go/timeout.

“Interactive prompt or controlled pipe” is a choice of channel, not an implemented handoff procedure. For interactive entry, a human must first recover the mnemonic from somewhere; the approved recovery/display path is absent. For a controlled pipe, no generator/decryptor/one-shot descriptor implementation or review is supplied.

Acceptable closure options include:

- extend the reviewed helper to read and decrypt a narrowly specified encrypted candidate container, with the decryption secret supplied through an approved protected channel; or
- provide a reviewed one-shot producer that holds the mnemonic in memory and hands it directly through an inherited pipe/descriptor to the insert helper after Owner go, with no shell-visible intermediary.

The final procedure must define no-go/expiry destruction and prove the candidate approved public address is bound to the exact mnemonic consumed post-go.

## 5. Arm-before-fund decision

I do **not** require changing to arm-before-fund for this first bounded TN12 pilot.

Current fund-before-arm order is acceptable because:

- the wallet is dedicated and capped at 50 KAS;
- gateway and Relay gate remain off while funding occurs;
- funding, grant issuance, flags and smoke are all inside the per-item Owner-authorized package;
- the residual exposure is explicit and reversible.

Arm-before-fund has a legitimate advantage—live gate/legacy health can be checked with no custodial funds—but it also lengthens the interval in which the global armed gate is active before the planned live smoke. Given the earlier global-gate regression history, changing the sequence during final packaging is not mandatory. Either order is defensible if it is frozen, Owner-approved and executed without an unattended interval.

Operational requirement under the accepted current order: after the 50-KAS readback, proceed directly through provision/env/arm/smoke or roll back; do not leave the funded pilot wallet and pending activation package unattended.

## Required next submission

Submit a new frozen package containing:

1. corrected truly non-echo or protected one-shot secret input;
2. a concrete encrypted-transient-to-helper handoff implementation/procedure;
3. regression evidence that covers the real host input path, not only piped stdin;
4. updated M0a digest/manifest for the changed helper;
5. regenerated package-bound custodial-insert evidence and, if any load-bearing shared file changes, regenerated G4/provision evidence as applicable.

## Authority boundary

No live Relay or custodial-wallet creation, candidate secret transfer, production DB write, 50-KAS funding, grant issuance, environment mutation, gateway enablement, Relay arm, restart, signing, broadcast, live smoke or funds movement is authorized by this review.
