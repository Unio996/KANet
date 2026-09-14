Title: readInputStateWithTemplate + validateOutputState in the same entry crashes at runtime: "-N cannot be used as an array index"

### Environment

- `silverc` built from commit `3ed973335b59269293564805cc2c58a14595ec03` (tag `v1.0.0`).
- `cli-debugger` built from the same commit/tag.
- Windows x64.
- Compile: `silverc.exe <file>.sil --ctor <ctor>.json -o <out>.json`
- Run: `cli-debugger.exe <file>.sil --test-file <file>.test.json --run-all -r` (batch; add `--test-name <name>` without `-r` for the interactive source-annotated trace shown below).

### Summary

In a contract entry function, calling `readInputStateWithTemplate(...)` (read another input's state via an external/foreign template) and `validateOutputState(...)` (continue this contract's own `State`) **in the same entry function** makes the compiled script crash at runtime with `error: -N cannot be used as an array index` (N differs run to run — looks like a mis-computed offset, not a `require` rejection). The failure is reported at the `validateOutputState(...)` call site itself; every `require` before it in the same call has already passed.

### Minimal repro

`Other.sil` — a trivial contract compiled only to produce a real, independent template (prefix/suffix bytes + `template_hash`) for `Repro` to read via `readInputStateWithTemplate`. It plays no other role; its own logic is irrelevant to the bug.

<details>
<summary>Other.sil</summary>

```
pragma silverscript ^0.1.0;
contract Other(int init_amount, byte[32] init_owner) {
    int amount = init_amount;
    byte[32] owner = init_owner;
    entry noop() { require(amount >= 0); }
}
```

</details>

<details>
<summary>other.ctor.json</summary>

```json
[
 { "kind": "int", "value": 100 },
 { "kind": "bytes", "value": [17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17] }
]
```

</details>

`Repro.sil`:

```
pragma silverscript ^0.1.0;
contract Repro(
    byte[] ext_prefix, int ext_prefix_len, byte[] ext_suffix, int ext_suffix_len, byte[32] ext_tmpl_hash,
    int init_counter, int init_closed, byte[32] init_root
) {
    int counter = init_counter;
    int closed = init_closed;
    byte[32] root = init_root;
    struct Ext {
        int      amount;
        byte[32] owner;
    }
    entry step(int selfOutIdx, int extInIdx, int ext_amount) {
        require(closed == 0);
        Ext e = readInputStateWithTemplate(extInIdx, ext_prefix_len, ext_suffix_len, ext_tmpl_hash);
        require(e.amount == ext_amount);
        validateOutputState(selfOutIdx, State {
            counter: counter + ext_amount,
            closed: 0,
            root: root
        });
        require(tx.outputs[selfOutIdx].value >= 1000);
    }
}
```

<details>
<summary>repro.test.json</summary>

```json
{
 "tests": [
  {
   "name": "repro_crash_read_external_plus_self_continue",
   "function": "step",
   "constructor_args": [
    "0x6b",
    1,
    "0x6c76042f1190ab8763757800a269757551676a68",
    20,
    "0xe601414877c7bc3d1c5af416c3c26b0e6f8805e01b2a6a1c9a4d98e5e347da63",
    100,
    0,
    "0x0000000000000000000000000000000000000000000000000000000000000000"
   ],
   "args": [
    0,
    1,
    100
   ],
   "expect": "pass",
   "tx": {
    "active_input_index": 0,
    "inputs": [
     {
      "utxo_value": 1,
      "covenant_id": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "signature_script_hex": "0x00ffffffffffffffffffff"
     },
     {
      "utxo_value": 10,
      "utxo_script_hex": "0xaa20016fbfffbb2ab31b1d53eabee7758f2adb44147f56780c20811e29268d05fefe87",
      "signature_script_hex": "0x6b0864000000000000002011111111111111111111111111111111111111111111111111111111111111116c76042f1190ab8763757800a269757551676a68"
     }
    ],
    "outputs": [
     {
      "value": 1000,
      "covenant_id": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "state": {
       "counter": 200,
       "closed": 0,
       "root": "0x0000000000000000000000000000000000000000000000000000000000000000"
      }
     }
    ]
   }
  }
 ]
}
```

</details>

Both `.sil` files compile cleanly; the crash is purely at test-run time.

Command:

```
cli-debugger.exe Repro.sil --test-file repro.test.json --run-all -r
```

Actual output:

```
  RUN   repro_crash_read_external_plus_self_continue
  FAIL  repro_crash_read_external_plus_self_continue
        error: -409 cannot be used as an array index
           --> 19:9
           |
        18 |         require(e.amount == ext_amount);
        19 |         validateOutputState(selfOutIdx, State {
           |         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ verification failed here
           |   closed = 0, counter = 100, e = {amount: 100, owner: 0x1111111111111111111111111111111111111111111111111111111111111111}, extInIdx = 1, ext_amount = 100, ...
           |

1 tests: 0 passed, 1 failed
```

Expected: `pass` (all values are consistent — `e.amount == ext_amount`, the output's declared continuation state matches, the output value is `1000 >= 1000`). The vector is a straightforward same-template continuation plus one legitimate external state read; nothing about it should fail.

The offset (`-409` here) is not stable across otherwise-identical runs with different constructor byte lengths (see isolation matrix below, which shows `-575`, `-71`, `-31218`, `-40783`, `-869` for structurally similar programs) — consistent with a mis-derived compile-time offset rather than a data-dependent runtime condition.

### Isolation matrix

Built while narrowing down a larger contract of ours that hit this at first. Each row changes exactly one variable from the previous baseline; all compiled and ran against the same pinned toolchain.

| Variant | Change | Result |
|---|---|---|
| external-template-only | `readInputStateWithTemplate` + `validateOutputStateWithInputTemplate` (both "foreign template" family), no self-`State` continuation | **PASS** |
| + read loop | above + a loop that internally also calls `readInputStateWithTemplate` several times | **PASS** |
| + self continuation | above + `validateOutputState` (own `State` continuation) added back | **FAIL (crash)** |
| swapped order | same as above, `validateOutputState` and `validateOutputStateWithInputTemplate` calls swapped | **FAIL (crash, order-independent)** |
| `validateOutputStateWithTemplate` instead | swap the foreign-template call for the ctor-baked-prefix/suffix variant instead of the input-borrowed one | **FAIL (crash either foreign-template primitive)** |
| no loop | drop the read loop, keep one bare `readInputStateWithTemplate` + both validate calls | **FAIL (crash, loop not required)** |
| **minimal** | only `readInputStateWithTemplate` once + `validateOutputState` once (`Repro.sil` above) | **FAIL (crash)** |
| swapped order (minimal) | swap the two calls | **FAIL (crash, order-independent)** |
| `validateOutputStateWithInputTemplate` control | isolate this primitive alone, no `readInputStateWithTemplate`/`validateOutputState` accompanying it | **PASS** |

Conclusion: `validateOutputStateWithTemplate`/`validateOutputStateWithInputTemplate` alone are fine; `readInputStateWithTemplate` alone is fine. **Any one "read a foreign input's state" call plus a `validateOutputState` self-continuation, in the same entry function, crashes** — independent of call order, whether the read is looped, and which foreign-template primitive is used.

### Working control: `validateOutputStateWithInputTemplate` pointed at a different input

A variant using only `validateOutputStateWithInputTemplate(outIdx, newState, otherInputIdx, ...)` — where `otherInputIdx` is a genuinely different input than the active one — passes fine on its own. Separately, we also found that pointing `validateOutputStateWithInputTemplate`'s `templateInputIndex` argument at `this.activeInputIndex` (i.e., using it to re-derive the *current* contract's own template/state, as a possible workaround for avoiding `validateOutputState`) hits the same `-N cannot be used as an array index` crash. So the crash is not specific to `validateOutputState`'s own codegen path — it also appears when any "foreign template" primitive is asked to treat the *current* input as the template source, alongside another external-state read in the same function.

### Hypothesis (unverified)

`silverscript-lang/src/compiler/compile.rs::compile_contract_impl` (around line 102–140 on `origin/master`) runs a fixed-point loop (`for _ in 0..32`, line ~106) to resolve the final compiled bytecode size for contracts where `contract_uses_bytecode_size(...)` is true (line ~102): it starts with a placeholder `bytecode_size = Some(100i64)` and re-compiles until `actual_size == bytecode_size` converges. `silverscript-lang/src/compiler/compile/state.rs` (around line 151–220) computes offsets for reading a foreign input's redeem script as `bytecode_base = input_sigscript_len(input_idx) - bytecode_size`, i.e. it depends on that same `bytecode_size` value. We have not verified this in the debugger/compiler internals ourselves, but it looks like a plausible candidate: if `readInputStateWithTemplate`'s offset expression is built using the *placeholder* `bytecode_size` during an early iteration of that 32-round loop, before it has converged to `Repro`'s own real compiled length, the derived offset could go negative or out of range — this would explain why the crash is specific to "self-continuation forces this loop to run" + "a separate primitive computes an input-relative offset using the same in-flight `bytecode_size`" being combined in the same entry.

We are flagging this as an unverified hypothesis for whoever investigates, not a confirmed root cause.

### Impact

This blocks a fairly natural pattern: an entry that both reads a token/asset held in another input and continues its own state in the same call (e.g. "absorb an external balance into a running total, then re-commit my own updated state"). We found one workaround (hand-encode the self-continuation's state bytes manually and rebuild+compare the P2SH script by hand, bypassing `validateOutputState` entirely) but it requires hardcoding the contract's own compiled prefix/suffix lengths per contract revision, which is significantly more fragile than the declarative `validateOutputState(...)` form.
