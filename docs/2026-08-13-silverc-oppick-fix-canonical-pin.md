# silverc OP_PICK Fix — Canonical Compiler Pin & Recovery Record

**Date:** 2026-08-13
**Author:** claude (read-only verification + documentation task)
**Scope:** Documentation + read-only verification ONLY. No code, config, env default, or binary was changed. Nothing was built. Nothing was pushed to any remote.
**Authority for the underlying decision:** CLAUDE.md 铁律 0.5; this file is the canonical *pin/recovery* record, not a decision change.

---

## 1. Risk statement (why this file exists)

The `pick_from_depth` OP_PICK off-by-one codegen bug in `silverc` was fixed in a **single local commit that was never pushed upstream**. KANet's covenants compile correctly because we invoke *our* fixed build; any third party invoking upstream `silverc` still hits the bug.

The load-bearing fix has **two independent survival layers**, and the failure mode is *silent*:

- **Layer A — the compiled binary** (`versioned-builds/silverc-zk-8065184.exe`): a pinned, version-named artifact on disk. Explicitly wired by the ZK-family callers (see §4). Safe *as long as the file is not deleted*.
- **Layer B — the fix source** (commit `8065184` on branch `j2-oppick-fix-2026-07-06`): exists **only in one unpushed local branch** in `D:/silverscript`. It is **not on any remote** and **not an ancestor of `master`**. A re-clone / hard reset / branch deletion of that tree **destroys the only way to rebuild the fixed binary**, and **no check in either repo would detect the loss** until the next covenant compile silently miscompiles or fails.

This file records the verified identity of the fixed build and exact recovery steps so that losing either layer is recoverable and detectable.

---

## 2. Verified facts (actual command evidence, 2026-08-13)

### 2.1 `/d/silverscript` HEAD + branch (step 1)
```
$ git -C /d/silverscript rev-parse HEAD
80651849962f1d83eb941c2c913eaaea06e867b7
$ git -C /d/silverscript branch --show-current
j2-oppick-fix-2026-07-06
```
HEAD is the fix commit itself; the working tree is checked out on the fix branch.

### 2.2 Fix commit is on NO remote (step 2)
```
$ git -C /d/silverscript branch -r --contains 8065184
(empty)
$ git -C /d/silverscript branch --contains 8065184
* j2-oppick-fix-2026-07-06        # local only
$ git -C /d/silverscript merge-base --is-ancestor 8065184 master ; echo $?
NO not on master
$ git -C /d/silverscript log --oneline -1 8065184
8065184 Fix OP_PICK off-by-one in compile_byte_sequence_cast_call
```
Remote branches present: `origin/master`, `origin/HEAD`, `origin/covid-example`, `origin/covpp-reset2`. **None contains `8065184`.** upstream `github.com/kaspanet/silverscript` does NOT have this fix.

Branch topology (fix sits one commit past what master has):
```
8065184  Fix OP_PICK off-by-one ...          <- j2-oppick-fix-2026-07-06 (HEAD), UNPUSHED
d25bd34  Bump rusty-kaspa version to v2.0.1 (#136)   <- master / origin/master tip
c46e0e2  Expose typed CheckSigFromStack builtins (#132)
faaa074  Allow contract state to include different  (#131)
2c46231  Add compiler version to CompiledContract (#124)
```

### 2.3 Canonical binaries (step 3)
`D:/silverscript/versioned-builds/`:
```
2026-07-07 07:07   4694528   silverc-legacy-2c46231.exe
2026-07-07 07:09   4758016   silverc-zk-8065184.exe
2026-07-07 10:17      2542   MANIFEST.txt
```
SHA256 (verified this session):
```
e0e9b62c086df6b6a63344cbbbd21a0d176af76c5a869826131a879ff06a2c06  silverc-legacy-2c46231.exe
9de7f2f682bc9e50a4b922e1c811335f1b1cd67c175f2e01df6fa6efc9015fc4  silverc-zk-8065184.exe   <-- THE FIXED BUILD
e0e9b62c086df6b6a63344cbbbd21a0d176af76c5a869826131a879ff06a2c06  target/release/silverc.exe
```

**🔴 Key finding:** `target/release/silverc.exe` (mtime 2026-07-08 11:48) has SHA256 `e0e9b62c…` = **byte-identical to the LEGACY `silverc-legacy-2c46231.exe`**, i.e. the **pre-fix** build. Despite the working tree being *checked out on the fix branch*, the mutable `target/release/silverc.exe` currently contains **legacy (non-fixed) codegen**, NOT the OP_PICK fix. The fixed codegen lives ONLY in `silverc-zk-8065184.exe`. This is exactly why the ZK callers must never fall back to `target/release`.

### 2.4 Fix commit contents (step 5)
```
$ git -C /d/silverscript show --stat 8065184
commit 80651849962f1d83eb941c2c913eaaea06e867b7
Author: J2 (KANet) <j2-agent@kanet.local>
Date:   Mon Jul 6 21:14:56 2026 +0700

    Fix OP_PICK off-by-one in compile_byte_sequence_cast_call

    Remove spurious stack_depth increment in the 2-argument byte[](val,size)
    dynamic cast branch. The sister function compile_bytes_call's equivalent
    branch does not have this extra increment; OpNum2Bin's own -1 correction
    already accounts for the net pop2-push1 effect.
    ...

 silverscript-lang/src/compiler/compile.rs | 1 -
 1 file changed, 1 deletion(-)
```
Single-line deletion in `silverscript-lang/src/compiler/compile.rs`. The fix specifically targets the **2-argument `byte[](val,size)` dynamic cast** branch. Branch `j2-oppick-fix-2026-07-06` still exists locally and `8065184` is reachable → **the binary can be rebuilt from source** (recovery §5).

---

## 3. Canonical build identity

| | |
|---|---|
| **Canonical FIXED compiler** | `D:/silverscript/versioned-builds/silverc-zk-8065184.exe` |
| **SHA256** | `9de7f2f682bc9e50a4b922e1c811335f1b1cd67c175f2e01df6fa6efc9015fc4` |
| **Size** | 4758016 bytes |
| **Provenance** | commit `8065184` ("Fix OP_PICK off-by-one in compile_byte_sequence_cast_call"), branch `j2-oppick-fix-2026-07-06`, unpushed |
| **Used for** | ZK covenant family — `computeCloseZkTmplAnchor`, `compilePayoutShardV2Redeem` (PayoutShardV2.sil), CloseZk mint |

Companion pinned build (NOT the fix — deliberately pre-fix, kept for byte-exact reproduction of already-deployed V1 covenants):

| | |
|---|---|
| **Legacy compiler** | `D:/silverscript/versioned-builds/silverc-legacy-2c46231.exe` |
| **SHA256** | `e0e9b62c086df6b6a63344cbbbd21a0d176af76c5a869826131a879ff06a2c06` |
| **Provenance** | commit `2c46231` (parent of `faaa074`), pushed / on `origin/master` |
| **Used for** | V1 family — PayoutShard.sil, ShardLeaf.sil, PoolSide_v08_shard.sil — must stay byte-stable to preserve already-live P2SH hashes |

> Two builds by design: V1-family P2SH addresses are already live on TN12 and must reproduce byte-exact under the legacy compiler; the OP_PICK fix is only needed by (and only wired into) the ZK/V2 family. See `versioned-builds/MANIFEST.txt` for the 2026-07-07 incident background (an in-place `cargo build` from the fix branch overwrote the legacy binary at `target/release/silverc.exe` and broke bshard betting 23:41–00:47; the fix was to version-name both builds and stop depending on the mutable `target/release` default).

---

## 4. Every KANet silverc call site (step 4)

**kasia-console (all PINNED to versioned-builds — hardened after the 2026-07-07/08 incident):**

| File | Constant / default | Env override | Resolves to |
|---|---|---|---|
| `kasia-console/src/lib/pool-p2sh.mjs:19` | `SILVERC` = legacy | `SILVERC_LEGACY_PATH` | legacy-2c46231 |
| `kasia-console/src/lib/pool-bshard-artifacts.mjs:31` | `SILVERC` = legacy | `SILVERC_LEGACY_PATH` | legacy-2c46231 |
| `kasia-console/src/lib/pool-bshard-market-setup.mjs:20` | `SILVERC` = legacy | `SILVERC_LEGACY_PATH` | legacy-2c46231 |
| `kasia-console/src/lib/prediction-escrow-ss.mjs:32` | `SILVERC` = legacy | `SILVERC_LEGACY_PATH` | legacy-2c46231 |
| `kasia-console/src/services/bshard-close-voter.js:43` | `SILVERC` = legacy | `SILVERC_LEGACY_PATH` | legacy-2c46231 |
| `kasia-console/src/lib/pool-shard-register.mjs:69` | `SILVERC_LEGACY` | `SILVERC_LEGACY_PATH` | legacy-2c46231 (V1 redeems) |
| `kasia-console/src/lib/pool-shard-register.mjs:74` | `SILVERC_ZK` | `SILVERC_ZK_PATH` | **zk-8065184 (fixed)** — closeZk / PayoutShardV2 |
| `kasia-console/src/lib/closezk-v2-mint.mjs:16` | `SILVERC_ZK` | `SILVERC_ZK_PATH` | **zk-8065184 (fixed)** |
| `kasia-console/src/lib/bshard-payout-family-coherence.test.mjs:98` | test presence probe | `SILVERC_LEGACY_PATH` | legacy-2c46231 (test only) |

**kasia-relay (NOT pinned — mutable default):**

| File | Constant / default | Env override | Resolves to |
|---|---|---|---|
| `kasia-relay/src/lib/p2sh.mjs:26` | `SILVERC` = `'D:/silverscript/target/release/silverc.exe'` | `SILVERSCRIPT_COMPILER` | **mutable path → currently LEGACY (e0e9b62), i.e. NON-fixed** |

**🟡 Finding on the relay default (reported, NOT fixed — per task):**
- `kasia-relay/src/lib/p2sh.mjs` is the ONLY silverc caller still defaulting to the mutable `target/release/silverc.exe`. `kanet.env` sets no `SILVERSCRIPT_COMPILER` override, so it resolves to whatever `target/release` currently is — **right now that is the pre-fix legacy build**.
- **Actual OP_PICK exposure of this call site is LOW but nonzero:** its only exported compile fn `compileEscrow` (line 117) emits a 2-of-3 escrow using the **single-arg** `byte[](buyerLock)` cast (line 142), not the 2-arg `byte[](val,size)` dynamic cast that the OP_PICK fix targets — so today's legacy default likely does not miscompile *this* contract. Additionally, `compileEscrow` has **no live internal callers** (only the file's own usage-comment references it); it is the original demo escrow, superseded by the bshard pool machinery.
- Still worth flagging: this is a mutable, drift-prone default pointing at a binary whose contents are not guaranteed. If anyone ever routes a `byte[](val,size)`-using contract through relay `p2sh.mjs` without setting `SILVERSCRIPT_COMPILER`, they would silently get pre-fix codegen. Recommend (do NOT apply here) pinning it the same way kasia-console did — left as an open hardening item for owner/Bettor to schedule.

**`.sil` source files** each carry a `// 编译: silverc.exe …` comment (OracleStake_v1, PoolSide_v0_7_1, PredictionEscrowUnanimous5, PredictionPoolUnanimous3, PoolSpine_v0_7_1, WinningsPool_v1). These are documentation strings, not executable path resolutions.

---

## 5. Recovery instructions

If `D:/silverscript/versioned-builds/silverc-zk-8065184.exe` is ever lost or fails its hash, restore it by **either** path:

### Path A — restore the pinned binary (fastest, no build)
1. Recover `silverc-zk-8065184.exe` from backup / another KANet machine.
2. Verify: `sha256sum` MUST equal `9de7f2f682bc9e50a4b922e1c811335f1b1cd67c175f2e01df6fa6efc9015fc4`.
3. Place it at `D:/silverscript/versioned-builds/silverc-zk-8065184.exe`. Done — the ZK callers reference this exact path.

### Path B — rebuild from source (if no binary backup exists)
Requires the fix branch to still exist in `D:/silverscript` (Layer B). Verify first:
```
git -C /d/silverscript branch --contains 8065184     # must list j2-oppick-fix-2026-07-06
git -C /d/silverscript log --oneline -1 8065184       # must show "Fix OP_PICK off-by-one..."
```
Then (read-only listing here; the actual build is an intentional, authorized action — NOT run in this task):
```
git -C /d/silverscript checkout j2-oppick-fix-2026-07-06     # or: checkout 8065184
cargo build --release --manifest-path /d/silverscript/Cargo.toml
# resulting target/release/silverc.exe is the fixed compiler; copy + version-name it:
cp /d/silverscript/target/release/silverc.exe /d/silverscript/versioned-builds/silverc-zk-8065184.exe
sha256sum ...   # confirm == 9de7f2f682...  (a matching hash proves the fix is present)
```
The single fix hunk is one deleted line in `silverscript-lang/src/compiler/compile.rs` (`compile_byte_sequence_cast_call`, the 2-arg `byte[](val,size)` branch — remove the spurious `stack_depth` increment).

**🔴 If BOTH the binary AND the branch are gone:** the fix must be reconstructed by hand from the commit message in §2.4 (remove the extra `stack_depth += 1` in the 2-arg dynamic-cast branch of `compile_byte_sequence_cast_call`, mirroring sibling `compile_bytes_call`). This is the exact silent-loss scenario this document exists to prevent — do not let it reach this state; keep the branch and back up the binary.

---

## 6. ⚠ DO NOT rely on upstream silverc (two-scope note)

- **Our covenants:** OK — every ZK-family compile is explicitly pinned to `silverc-zk-8065184.exe` (§4). Correct codegen.
- **Third-party / upstream silverc:** **NOT OK** — `github.com/kaspanet/silverscript` (`origin/master`, tip `d25bd34`) does not contain `8065184`. Anyone compiling a `byte[](val,size)`-using covenant with upstream silverc gets the OP_PICK off-by-one and eventually an "invalid pick location" / miscalculated PICK indices. Any claim that "the OP_PICK bug is fixed" is **only true with the scope attached**: fixed *in our pinned build*, still live *everywhere upstream*.

---

## 7. OPEN item — upstream push is OUT OF SCOPE here

The fix is **still not pushed** to `github.com/kaspanet/silverscript`. Publishing commit `8065184` upstream (PR / push) is an **external publish action** that:
- would let third parties integrating KANet compile OP_PICK-correct covenants with stock upstream silverc (directly serves the "别人能接上结算" roadmap line in 铁律 0.5);
- is **OUT OF SCOPE for this documentation task** and was **not performed**;
- **requires separate explicit authorization** (external-publish gate — an origin push is a public commit per the security baseline). Route via Bettor / Owner before any push.

This item is flagged, not actioned. Until it is done, §6's two-scope warning stands.
