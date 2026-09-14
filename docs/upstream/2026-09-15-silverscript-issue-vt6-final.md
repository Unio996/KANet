> **Status**: RETRACTED (2026-09-15) — do not file. Decisive follow-up (`docs/DECISIONS.md` D-018 status
> note, same date) found the original failure was caused by a cardinality mismatch in the test vector
> itself (only 1 output, belonging to a covenant outside the active group, while `next_states.length`
> declared 1) — the `binding=cov` wrapper's own "continuation-output count == `next_states.length`"
> check (documented behavior, not a bug) rejects that shape before the user's `require` ever runs. A
> corrected vector (2 outputs: one real in-group continuation matching `next_states.length`, one
> external) shows `OpOutputCovenantId` reads the external output correctly from inside `binding=cov` —
> pass when the value matches, fail exactly at the `require` line when it doesn't. Kept below for the
> record; not to be posted upstream.

Title: `OpOutputCovenantId` inside a `#[covenant(binding=cov)]` function fails on outputs outside the covenant group, with no compile-time diagnostic

### Environment

- `silverc` built from commit `3ed973335b59269293564805cc2c58a14595ec03` (tag `v1.0.0`).
- `cli-debugger` built from the same commit/tag.
- Windows x64.

### Summary

`OpOutputCovenantId(idx)` works correctly when called from a plain hand-written `entry`, for any output index, including an output that declares a completely different `covenant_id` than the active input's own covenant. The identical call, made from inside a `#[covenant(binding=cov, ...)]`-declared function, fails at runtime when `idx` refers to such an output — even though nothing in `docs/DECL.md` says this combination is disallowed, and `silverc` compiles it without any warning or error.

We read `docs/DECL.md`'s "Homogeneous-template assumption" section first: it describes a different situation (inputs/outputs *sharing the same covenant ID* using a different program template/State layout), not this one (an output belonging to a *different* covenant ID entirely). It also notes that `validateOutputStateWithTemplate` is "available for manual cross-template routing, not declaration lowering" — which reads as a hint that mixing declaration-lowering with cross-covenant output introspection isn't an intended combination, but nothing states this explicitly for `OpOutputCovenantId`, and the compiler raises no diagnostic when it's used this way. We're filing this primarily as a **documentation/diagnostic request**: either make this combination explicitly unsupported with a compile-time error, or confirm it's expected to work and treat the runtime failure below as a bug.

### Minimal repro

Two contracts, same transaction shape, same target output — one hand-written `entry`, one `#[covenant(binding=cov)]` function.

**Control (passes)** — `ReproEntry.sil`:

```
pragma silverscript ^0.1.0;
contract ReproEntry(int dummy) {
    int x = dummy;
    entry check(int out_k, byte[32] want) {
        require(OpOutputCovenantId(out_k) == want);
    }
}
```

Vector (`entry_control_pass`, `expect: "pass"`): a two-input transaction where input 0 is the active/spending input and input 1 is a "continuation-case" filler input declaring the same `covenant_id` as the target output (a documented convention for this debugger: an output declaring a `covenant_id` with no matching input anywhere in the tx is treated as a fresh genesis output whose `covenant_id` gets recomputed from the real previous-outpoint hash rather than read back verbatim — declaring a matching filler input with `authorizing_input` pointing at it short-circuits that recompute path so the test can assert the literal declared value). Output 0 declares `covenant_id = 0x3e4b0775...80677`, `authorizing_input: 1`. Calling `check(0, 0x3e4b0775...80677)` **passes**.

<details>
<summary>entry.test.json (control, PASS)</summary>

```json
{
 "tests": [
  {
   "name": "entry_control_pass",
   "function": "check",
   "constructor_args": [0],
   "args": [0, "0x3e4b0775073c8af63b5ab26209e575d67c5bc11d91410bd858e6ebbb4eb80677"],
   "expect": "pass",
   "tx": {
    "active_input_index": 0,
    "inputs": [
     { "utxo_value": 1, "utxo_script_hex": "0xaa20016fbfffbb2ab31b1d53eabee7758f2adb44147f56780c20811e29268d05fefe87", "signature_script_hex": "0x00" },
     { "utxo_value": 1, "covenant_id": "0x3e4b0775073c8af63b5ab26209e575d67c5bc11d91410bd858e6ebbb4eb80677", "signature_script_hex": "0x00ff" }
    ],
    "outputs": [
     { "value": 1, "covenant_id": "0x3e4b0775073c8af63b5ab26209e575d67c5bc11d91410bd858e6ebbb4eb80677", "authorizing_input": 1 }
    ]
   }
  }
 ]
}
```

</details>

**Failing case** — `ProbeBoutCov3.sil` (an isolation probe from an earlier investigation; kept as-is, it already isolates the minimal combination: `OpOutputCovenantId` alone, no other foreign-template primitive):

```
pragma silverscript ^0.1.0;
contract ProbeBoutCov3(int init_amount, byte[32] init_owner, byte init_owner_scheme, byte init_borrow_scheme, byte[32] init_borrow_guard, byte[32] init_extension_commitment, int max_ins, int max_outs) {
    int amount = init_amount;
    byte[32] owner = init_owner;
    byte owner_scheme = init_owner_scheme;
    byte borrow_scheme = init_borrow_scheme;
    byte[32] borrow_guard = init_borrow_guard;
    byte[32] extension_commitment = init_extension_commitment;
    struct ClaimState { byte[32] winner_pk; int amount; }
    #[covenant(binding = cov, from = max_ins, to = max_outs, name = transfer, delegate_name = transfer_delegator)]
    function transferPolicy(State[] prev_states, State[] next_states, byte[] witness, int[] owner_input_idx, int[] recv_idx, ClaimState[] new_claims) {
        require(witness.length == 0);
        int out_k = 0 - recv_idx[0] - 1;
        require(OpOutputCovenantId(out_k) == next_states[0].owner);
    }
    #[covenant.delegate]
    function transfer_delegator() {
        require(true);
    }
}
```

Same shape as the control: the active input's own covenant is `0xaaaa...aaaa`; a second input declares covenant `0x3e4b0775...80677` (the same continuation-case filler convention as the control) and is the `authorizing_input` for the transaction's one output, which also declares `covenant_id = 0x3e4b0775...80677`. `next_states[0].owner` is set to that same value, and `recv_idx = [-1]` maps to `out_k = 0` — the transaction's only output, same index, same covenant value, same construction as the control's `check(0, ...)` call. Calling `transfer` with this shape **fails**:

<details>
<summary>ProbeBoutCov3.test.json (FAIL)</summary>

```json
{
 "tests": [
  {
   "name": "cov_id_only_pass",
   "function": "transfer",
   "constructor_args": [100, "0x1111111111111111111111111111111111111111111111111111111111111111", 4, 0, "0x0000000000000000000000000000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000000000000000000000000000", 3, 3],
   "args": [
    [{ "amount": 100, "owner": "0x3e4b0775073c8af63b5ab26209e575d67c5bc11d91410bd858e6ebbb4eb80677", "owner_scheme": 4, "borrow_scheme": 0, "borrow_guard": "0x0000000000000000000000000000000000000000000000000000000000000000", "extension_commitment": "0x0000000000000000000000000000000000000000000000000000000000000000" }],
    "0x",
    [1],
    [-1],
    [{ "winner_pk": "0x7777777777777777777777777777777777777777777777777777777777777777", "amount": 500 }]
   ],
   "expect": "pass",
   "tx": {
    "active_input_index": 0,
    "inputs": [
     { "utxo_value": 1, "covenant_id": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "state": { "amount": 100, "owner": "0x1111111111111111111111111111111111111111111111111111111111111111", "owner_scheme": 4, "borrow_scheme": 0, "borrow_guard": "0x0000000000000000000000000000000000000000000000000000000000000000", "extension_commitment": "0x0000000000000000000000000000000000000000000000000000000000000000" } },
     { "utxo_value": 1, "covenant_id": "0x3e4b0775073c8af63b5ab26209e575d67c5bc11d91410bd858e6ebbb4eb80677" }
    ],
    "outputs": [
     { "value": 1, "covenant_id": "0x3e4b0775073c8af63b5ab26209e575d67c5bc11d91410bd858e6ebbb4eb80677", "authorizing_input": 1 }
    ]
   }
  }
 ]
}
```

</details>

```
error: script ran, but verification failed
   --> 1:1
   |
 1 | pragma silverscript ^0.1.0;
   | ^^^^^^^^^^^^^^^^^^^^^^^^^^^ verification failed here
   |   __cov_id = 0xaaaa...aaaa, __cov_in_count = 1, __cov_out_count = 0, out_k = 0,
       next_states = [{... owner: 0x3e4b0775...80677 ...}], recv_idx = [-1], ...
```

Full variable dump omitted for brevity (available on request) — the field worth calling out is `__cov_out_count = 0`, an internal variable the declaration lowering introduces itself. The transaction genuinely has one output; `__cov_out_count = 0` suggests the framework is counting outputs *belonging to the active covenant group* rather than the transaction's raw output list, and then resolving `OpOutputCovenantId(0)` relative to that (empty) count instead of the transaction's real output 0 — which would explain why an otherwise-correct index into `tx.outputs` fails specifically when it points outside the group.

### Isolation

This is the narrowest of four probes from an earlier investigation (kept file name for continuity with our internal records) that isolated the same failure independently of loop constructs, array indexing style, and whether `validateOutputStateWithTemplate` is combined with `OpOutputCovenantId` or either primitive is used alone — all four combinations failed the same way once moved into a `binding=cov` function body; all passed when written as a plain `entry`.

### Ask

Either:
1. Confirm this is expected/unsupported and add a compile-time diagnostic when a `binding=cov`-declared function calls output-introspection primitives (`OpOutputCovenantId`, `OpOutputCovenantId`-consuming builtins) on an index that cannot be statically shown to belong to the active covenant group's own continuation outputs, so this fails at compile time with a clear message instead of at runtime with an internal-looking trace; or
2. If this is meant to work, treat the runtime behavior above as the bug to fix.

We went with option 1 as a working assumption for our own contracts (we moved this kind of cross-covenant output check into a plain hand-written `entry` instead), but wanted to flag the compile-time silence either way.
