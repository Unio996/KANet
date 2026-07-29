# Codex review — unsynced addpeer same-host sync evidence

## Git / blob basis

- Last processed bridge commit: `ea99e00131d630ac7aec33ab015ea696d15d899e`
- Incoming bridge HEAD before this response: `ea99e00131d630ac7aec33ab015ea696d15d899e`
- Bridge compare: `identical` (`ahead=0`, `behind=0`)
- Canonical blobs:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Active branch baseline: `84f9b12551ee2e4131d805879bdf7e330d6c4d95`
- Active branch HEAD: `a5045e252babaf6c5ece13de01804c00090ea7ed`
- Active compare: `ahead=3`, `behind=0`; only `docs/examples/kanet-external/README.md`, `+4/-0`
- README blob: `850272b2bc0466a6a5eee445da7b636c1b99e152`

No file-internal timestamp was used for increment detection.

## Verdict

`SAME_HOST_ADDPEER_SYNC_EVIDENCE_ACCEPTED_WITH_NARROW_SCOPE__FRESH_CROSS_NETWORK_BOOTSTRAP_AND_SEND_RECEIVE_E2E_STILL_OPEN__NO_MONEY_PATH_AUTHORIZATION`

### 1. The new claim is materially narrower and technically coherent

The added text now distinguishes two separate questions:

1. whether a node can discover a peer without operator-supplied addresses; and
2. once a peer address is available, whether an empty appdir node can catch up to tip.

The reported observation supports only the second proposition: with seeders deliberately unavailable and an explicitly supplied peer on the same machine, the node reached `isSynced=true` with matching block/header counts. This is useful evidence that the manual `--addpeer` recovery path can complete under that controlled topology.

### 2. The evidence does not establish stranger-host or cross-network onboarding

The peer was on the same host. Therefore this run does not test:

- NAT/firewall traversal;
- remote P2P reachability;
- Internet latency, packet loss or unstable peers;
- DNS-seeder behavior on a fresh network;
- a truly new machine with no existing TN12 process or local peer;
- time-to-tip on an external operator's environment.

The README explicitly preserves this scope boundary, so the four-line addition is accepted as a correction rather than an overclaim.

### 3. The top-level “from zero to message on-chain” claim remains stronger than current end-to-end evidence

This addition changes node-sync evidence only. It does not supply the still-missing proof for the current `send-comm.mjs --to` path:

- real TN12 transaction construction and submission;
- txid and inclusion/depth evidence;
- fee/change reconciliation;
- actual recipient-side parsing and decryption;
- plaintext equality;
- malformed-address rejection before signing/submission.

Accordingly the external example remains an architecture-and-recipe candidate, not independently verified send-ready onboarding.

### 4. Evidence packaging should be made immutable

For future closure, retain an immutable receipt containing the exact kaspad version/blob, launch commands for both arms, appdir state, process epoch, peer topology, RPC outputs, start/end chain metrics and the control-arm result. Commit-message prose is useful indexing metadata but is not a substitute for the receipt.

## Authorization boundary

This review authorizes no production/test-asset deployment, node restart, faucet action, signing, broadcast, automatic acknowledgement, settlement, refund, schema migration or funds movement.
