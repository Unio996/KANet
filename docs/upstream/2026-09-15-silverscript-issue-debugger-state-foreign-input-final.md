`cli-debugger`'s `state:` test-file sugar silently encodes a non-active input's state using the active contract's own layout, with no diagnostic, whenever the field names/count happen to coincide

## Summary

`debugger/cli/src/main.rs` loads exactly one `.sil` source per invocation (the `SCRIPT_PATH`/active contract) and reuses that single `ContractAst`/source string for every `tx.inputs[]`/`tx.outputs[]` entry in a `.test.json` file, including entries that are meant to represent a UTXO belonging to a *different* contract. When such a non-active entry uses the `state:` convenience field instead of `utxo_script_hex`/`signature_script_hex`, the debugger:

- parses the JSON object against the **active** contract's own declared state fields (`parse_state_value`, `debugger/session/src/args.rs:474`), and
- compiles the **active** contract's own source to produce that input's/output's redeem script (`materialize_bytecode_for_explicit_state`, `debugger/cli/src/main.rs:270-303`, specifically the `compile_debug_artifact(source, ...)` call at line 280, where `source` is the one file loaded at line 697),

with no check anywhere that the entry's real, intended contract is the same template as the active one. If the intended foreign contract happens to declare the same state field names and count as the active contract, the call succeeds silently and the debugger embeds the **active contract's entire compiled bytecode** (only the state-value span patched) as that input's redeem script / signature script content and as the basis for its P2SH `scriptPubKey` (`pay_to_script_hash_script(&redeem)`, line ~808). This is a different program than the real foreign contract, with no error, warning, or documentation of the substitution.

If the field names/count do *not* coincidentally match, the same code path raises a hard, loud error (`"unknown struct field '<name>'"` / `"struct field '<name>' must be initialized"`, `debugger/session/src/args.rs:151-172`) — so the tool is inconsistent, not simply permissive: it silently does the wrong thing in exactly the cases where the shapes happen to line up, which is the more dangerous outcome because a test author has no signal that anything went wrong.

`README.md` does not document this behavior anywhere. It documents `state:` as a generic per-input/output convenience ("each input or output state can be described with either `constructor_args` or an explicit `state` object") with no caveat that it is scoped to inputs/outputs sharing the active contract's own template, and it does not mention the raw `utxo_script_hex`/`signature_script_hex` fields at all, so a reader has no documented indication that those are the only correct way to describe a genuinely foreign-template input/output.

## Reproduction

Built and run against `origin/master` at `3ed9733` (`cli-debugger`, release build, no local patches).

`A.sil` (the contract under test — the "active" contract in the debugger session):

```
pragma silverscript ^0.1.0;

contract A(int initA) {
    int a = initA;

    entry check_foreign() {
        State got = readInputState(1);
        require(got.a == 999);
    }
}
```

`B.sil` (a different, unrelated contract that happens to declare the same single state field name/type as `A`; this is the contract `tx.inputs[1]` is meant to represent):

```
pragma silverscript ^0.1.0;

contract B(int initA) {
    int a = initA;

    entry noop() {
        require(a == a);
    }
}
```

Compiling `B.sil` directly (pinned `3ed9733` compiler, `ctor_args=[999]`) gives its real, authoritative compiled bytecode:

```
len=29
hex=6b08e7030000000000006c76042f1190ab87637576789c697551676a68
```

`A.test.json`, describing `tx.inputs[1]` (the `B`-shaped UTXO) with the `state:` sugar instead of `B`'s real compiled bytes:

```json
{
  "tests": [
    {
      "name": "foreign_state_sugar",
      "function": "check_foreign",
      "constructor_args": [111],
      "expect": "pass",
      "tx": {
        "active_input_index": 0,
        "inputs": [
          { "utxo_value": 5000, "constructor_args": [111] },
          { "utxo_value": 5000, "state": { "a": 999 } }
        ],
        "outputs": [
          { "value": 5000, "constructor_args": [111] }
        ]
      }
    }
  ]
}
```

Running `cli-debugger ./A.sil --test-file ./A.test.json --test-name foreign_state_sugar -r` reports `PASS`, with no error or warning. Instrumenting `materialize_bytecode_for_explicit_state`'s return value (one `eprintln!` of the hex-encoded bytecode immediately before its `Ok(bytecode)`, no other change, reverted afterward) shows exactly what was substituted for `tx.inputs[1]`:

```
NWT-DIAG materialize_bytecode_for_explicit_state: source_contract=A raw_state={"a":999} len=54 hex=6b08e7030000000000006c7604dd92fed18763755151c90136945151939351c9013694515193935893bc7602e7039c69757551676a68
```

`source_contract=A` — the debugger used contract `A`'s own source for an input that is supposed to represent `B`. The two hex strings share only their first 13 bytes (`6b08e7030000000000006c76` + one length byte), which is the encoded `int a = 999` state value common to both contracts' single-field layout; everything after that — 41 of the fabricated input's 54 bytes — is `A`'s own `check_foreign`/`readInputState` program, not `B`'s real 29-byte `noop` program. The resulting `scriptPubKey` computed for `tx.inputs[1]` (`pay_to_script_hash_script` over this fabricated bytecode) is therefore the P2SH commitment of a script that does not exist as `B`, and would not match any real on-chain `B` UTXO's `scriptPubKey`.

Control case (using `B`'s real compiled bytes directly): giving `tx.inputs[1]` the real 29-byte `B` bytecode via `signature_script_hex` and letting `A.check_foreign()` call `readInputState(1)` on it fails at the VM level (`-22 cannot be used as an array index`) rather than reading `B`'s real state — but this is `readInputState`'s own documented restriction ("appropriate when the surrounding covenant domain guarantees a single allowed contract/layout for the foreign input", `docs/TUTORIAL.md:1284-1287`), not a debugger defect: it confirms that `A` and `B`'s compiled layouts are genuinely different once you use `B`'s real bytecode, which is exactly what the `state:`-sugar path above hid by substituting `A`'s own bytecode instead.

Boundary check — same `A.sil`, `tx.inputs[1]` described as `"state": {"a": 999, "marker_flag": true}` (mismatched field count, as if trying to describe a two-field foreign contract) instead: `cli-debugger` immediately raises `Error: "unknown struct field 'marker_flag'"` and refuses to run. This confirms the silent case above is not "the tool has no validation at all" — it has field-count/name validation, and that validation happens to not fire when the foreign contract's shape coincides with the active one's.

## Where this sits relative to documented behavior

`README.md`'s "Testing" section says only: "For covenant tests, add a `tx` section ... each input or output state can be described with either `constructor_args` or an explicit `state` object." There is no mention of:

- `state:` being restricted to inputs/outputs that share the active contract's own template, or
- `utxo_script_hex`/`signature_script_hex` existing at all, let alone being required for a genuinely foreign-template input/output.

`docs/TUTORIAL.md:1284-1287` documents the *runtime* distinction between `readInputState` (same-template only) and `readInputStateWithTemplate` (foreign-template, with its own template-hash and P2SH-commitment checks) — but that is a statement about the compiled contract's own opcodes, not about the debugger's test-authoring convenience layer. Nothing in either document says the `state:` JSON sugar in a `.test.json` file is scoped the same way, and the code does not enforce that scoping either (it has no way to: it never loads a second contract source).

**This is not a limitation the documentation already discloses** — README.md and TUTORIAL.md are silent on it, and the debugger gives no runtime signal (for the case where it matters most: same field shape, different contract) that anything other than the intended foreign contract's real bytecode was used. Filed as a bug: `cli-debugger` should either (a) refuse `state:` sugar for any `tx.inputs[]`/`tx.outputs[]` entry other than ones sharing the active input's own contract/template (erroring the same way it already does on field-shape mismatch, just unconditionally), or (b) if `state:` is meant to remain usable for such entries as a deliberate simplification, `README.md` should say so explicitly and point authors at `utxo_script_hex`/`signature_script_hex` as the only way to give a foreign-template input/output its real bytes.

## Scope note

Found while investigating a `.test.json` construction question in an internal test suite (bisected independently). Checked only against `origin/master` at `3ed9733`.
