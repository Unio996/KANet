Title: cli-debugger silently ignores `tx.inputs[active_input_index].signature_script_hex` in test-file mode

### Environment

- `cli-debugger` built from commit `3ed973335b59269293564805cc2c58a14595ec03` (tag `v1.0.0`).
- Windows x64.
- Run: `cli-debugger.exe <file>.sil --test-file <file>.test.json --test-name <name> --run`

### Summary

The `.test.json` schema (`TestTxInputScenario`) accepts a per-input `signature_script_hex` field, and it is documented nowhere as being special-cased for the **active input** (`tx.active_input_index`) — the README's test-file section describes constructing a spend via `function`/`args`/`constructor_args`/`state`, and never mentions `signature_script_hex` at all. Reading the JSON schema, a caller would reasonably expect that supplying `signature_script_hex` explicitly for an input overrides whatever the harness would otherwise construct for it — the field exists on every input including the active one, with no documented exception.

In practice, for the **active input**, `signature_script_hex` is read into `explicit_input_sigs` and used only when assembling the final `tx_inputs`/`kas_tx` (`main.rs:914`, used for consensus-level checks such as mass calculation and `_assertTxInvariants`). The actual interactive/`--run` interpretation that produces `PASS`/`FAIL` is driven by a **separate** variable, `active_sigscript`, which is always reconstructed from `function`/`args` (or the covenant-declaration path) — see `main.rs:976`:

```rust
let mut session = DebugSession::full(&active_sigscript, &active_lockscript, &source, active_debug_info, engine)?
```

`active_sigscript` is computed earlier (`main.rs:893-910`) purely from `function`/`args`/`constructor_args`, with no reference to `explicit_input_sigs`. So for the active input, whatever is written in `signature_script_hex` has **no effect on the interpreted result** — it is silently unused for the one purpose a caller would most expect it to serve (testing a hand-built or externally-produced sigScript against the contract).

We ran into this while trying to verify — independently of `function`/`args` re-encoding — that a sigScript we built ourselves (via `kaspa-wasm`'s `ScriptBuilder`, mirroring `silverscript-abi::encode_contract_entry_sig_script`) actually executes correctly against a real contract. Supplying it as `signature_script_hex` for the active input silently had zero effect on the test outcome; `function`/`args` were still driving the result. (We resolved our verification a different way — by capturing `active_sigscript` from `function`/`args` and comparing it byte-for-byte against our own construction — but that requires a debug build; a fresh reader has no way to notice this from the docs or the JSON schema alone.)

We are not asking for a specific fix (error vs. warning vs. an actual override implementation) — we think the debugger authors are best placed to judge that trade-off — but as it stands, this is a silent behavior gap with no documentation, and it caused us real confusion diagnosing why our verification vector wasn't discriminating between "PASS" and "FAIL" as the raw bytes changed. Two options that came to mind: reject `signature_script_hex` for the active input with an explicit error, or document that it's inert there and only affects the mass/invariant-check tx shape used elsewhere in the run.

### Minimal repro

`MinimalRepro.sil`:

```
pragma silverscript ^0.1.0;

contract MinimalRepro() {
    entry f(int x) {
        require(x == 1);
    }
}
```

`repro.test.json` — two cases against the same contract:

```json
{
 "tests": [
  {
   "name": "a_fnargs_x1_pass",
   "function": "f",
   "args": [1],
   "expect": "pass"
  },
  {
   "name": "b_fnargs_x2_but_sigscript_hex_is_x1",
   "function": "f",
   "args": [2],
   "expect": "pass",
   "tx": {
    "active_input_index": 0,
    "inputs": [
     {
      "utxo_value": 1000,
      "signature_script_hex": "0x5104b37a66a4187604b37a66a48763757682599f697576519c697551676a68"
     }
    ],
    "outputs": [
     { "value": 1000 }
    ]
   }
  }
 ]
}
```

The `signature_script_hex` in case `b` is a real, independently-constructed sigScript for `f(1)` — 4 bytes of `int(1)` push + 4-byte `dispatch_tag` push (`b37a66a4`, read from the real compiled ABI artifact for this exact contract, not guessed) + a push of the contract's own compiled bytecode as the redeem reveal. It is the byte-for-byte correct encoding for `x=1` per `silverscript-abi::encode_contract_entry_sig_script` — built with `kaspa-wasm`'s `ScriptBuilder` (`addI64`/`addData`, `covenantsEnabled: true`), not hand-rolled.

Case `a` (`function`/`args` = `x=1`, no `tx` section at all): **PASS**, as expected.

Case `b` (`function`/`args` = `x=2`, but the active input's `signature_script_hex` is the correct-for-`x=1` bytes above): fails with `x = 2` in the trace — i.e. the result is driven entirely by `args`, and `signature_script_hex` had no observable effect:

```
error: script ran, but verification failed
   --> 5:9
   |
 4 |     entry f(int x) {
 5 |         require(x == 1);
   |         ^^^^^^^^^^^^^^^^ verification failed here
   |   x = 2
   |
```

If `signature_script_hex` were being honored for the active input, we would expect case `b` to pass (the supplied bytes correctly encode `x=1`). Full run output in `run.log`; `MANIFEST.sha256` covers all attached files.

We believe the relevant code path is `debugger/cli/src/main.rs:976` (`DebugSession::full(&active_sigscript, ...)`, constructed from `function`/`args` at `main.rs:893-910`, independent of `explicit_input_sigs` populated at `main.rs:810` from `signature_script_hex`) — flagging this as "we believe" since we're reading the pinned `v1.0.0` source, not maintainers with full context on intended design.
