# Codex review — unsynced gate-(d) second-vantage / live-binary provenance update

Verdict: **MATERIAL STATUS CHANGE / gate (d) remains OPEN.**

Bridge itself had no new canonical message. I therefore inspected the directly-related `bshard-m3-deploy` delta after the last processed checkpoint.

## 1. Exact live-kaspad provenance on `younio`: PASS as new evidence

J1's r2 report now gives two independent checks that `younio` is running the exact Toccata build previously used as the source coordinate for the gate-(d) difficulty/window analysis:

- startup log identifies `kaspad v1.1.1-toc.1-7b1e18cc`;
- the `kaspad.exe` SHA-256 matches the `da9` binary byte-for-byte.

This materially strengthens the claim that the same consensus/runtime coordinate is present on both machines. It does **not** by itself prove that the two machines observe the same live network state, but it closes the narrower "different binary / same version label" ambiguity.

## 2. `younio` is **not yet a valid second chain-read vantage**

The current evidence is explicit that `younio` has not completed IBD and must not be counted as an independent second RPC/network observation source yet. The wcap fetch-design now records that all current four-gate / exact-window / `bitsCalc==received bits` evidence is from the `da9` node only.

I accept this as the correct fail-closed treatment.

Do **not** describe the current gate-(d) data-provenance evidence as "two-vantage verified" until `younio` satisfies the same explicit readiness criteria and the relevant reconstruction checks are rerun from that node.

The distinction matters:

- **single-node exact reconstruction / consensus-mirror checks** can be valid evidence about deterministic algorithm correctness;
- **multi-vantage disagreement / reorg-observation evidence** requires an actually synced and independently-operating second node.

Those are different claims and must remain separate.

## 3. Physical / custody fault-domain result: useful, but not network-observation closure

The r2 report also gives evidence that the J1 host is a separate physical laptop and that its `CONSOLE_ENCRYPTION_KEY` differs from `da9`. This is useful for future watchtower/key-custody fault-domain design.

However, physical-host separation does not imply independent power/network path, and—more importantly for gate (d)—an unsynced node still cannot serve as a second consensus observation vantage. Keep these layers separately named.

## 4. Current gate-(d) status

No previously-closed D-STAT design item is reopened.

Current status remains:

- D-STAT-1/2/3: **CLOSED AT DESIGN LAYER**;
- `w_cap` consensus ordering / equal-work hash tie-break: **CLOSED**;
- real-RPC fetch/exactness: **single-node evidence only**;
- second-vantage chain-read evidence: **OPEN** until `younio` is synced and the relevant checks are rerun there;
- `M_reorg` / `W_dis` evidence that depends on a second vantage: **OPEN**;
- gate (d) overall: **OPEN / PROVISIONAL**.

No production money-path authorization is implied by this update.
