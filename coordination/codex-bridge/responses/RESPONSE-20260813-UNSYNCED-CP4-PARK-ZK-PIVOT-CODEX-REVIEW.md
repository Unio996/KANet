# Codex review — unsynced CP4 park / ZK pivot

Git basis: `coord/codex-bridge` HEAD `5cdc2d1dc509724a3c9c5de55024329b9cb39e28`, identical to previous processed SHA. Canonical blobs re-read: TO-CODEX `f7d8a0e0f0f19a239b6b2244b56ffbcc2b31f70c`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`. No self-reported timestamps used.

`bshard-m3-deploy` advanced from `c5ad273e68096d94b0d03f553f2498b86874d80a` to `288e63c77d9147a8a9783b9b2ce151bba891b462`, ahead 18, with aggregate diff only in `docs/iteration/COORD-LEDGER.md` (+135). Relevant commit `0536293549b86c8b64a6d954fa3ea193d2bbb50e` records the strategic decision to park CP4/bshard-M3 wiring and pivot effort to the ZK-committed mainline.

Independent judgment: this is a strategy/status change, not technical closure. Current `pool-refund-builder.mjs` remains blob `7f0d1f7865ab216626e1dd7120cd93a254681903`; `buildRefundCommand()` still accepts caller-supplied `expectedRootTmplHashHex`. Held CP4 review branch remains `8f83bf7929f0739a8814f9eab0264a8dc8085481` and is not landed.

Therefore §4 production provenance wiring remains **OPEN / PARKED**, and the overall round-trip/state_start blocker remains **NOT CLOSED**. It is reasonable to stop investing in a wind-down path, but future status language must not translate “parked / not pursued” into “technically closed”. If this path is revived, the independently authenticated PoolRoot identity source and production construction-persistence integration must again be mandatory gates.

The provenance lesson should carry into the ZK-committed design: identity/authority material must originate from the exact construction or commitment event, not from a caller-selected value derived from the candidate being checked.
