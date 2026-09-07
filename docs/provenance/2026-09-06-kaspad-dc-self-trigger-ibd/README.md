# D-c · relay-mode self-triggered IBD · kaspad build provenance (J2 · 2026-09-06)
> All timestamps UTC from `date -u` in build.sh. Files here: `README.md`, `patch.diff`, `COMMIT.txt`, `build.sh`, `build.log` (attempt 4, the artifact), `build-attempt2-WORKTREE-no-embedded-hash-a39c60d2.log`, `build-attempt3-WORKTREE-sed-failed-noop.log`, `MANIFEST.sha256`.

| item | value |
|---|---|
| design | `docs/2026-09-06-bettor-dc-relay-mode-self-trigger-ibd-design-v0.1.md` v0.1.1 (§4 + §9) · KANet ledger 959 (GO) · NWT hunk review GREEN-final on a39c60d2 |
| source | branch `j2-dc-self-trigger-ibd` · commit **a39c60d27a36d460fe6504c09997ff02b259f24f** (`a39c60d2`) = 4d0a9e30 (D-b) → 82d47d85 (impl) → a39c60d2 (NWT review fixes: 3 MUST + 2 SHOULD) |
| patch | `patch.diff` = `git diff 4d0a9e30 a39c60d2` · 803 lines · 6 files +654/−15 · sha256 in MANIFEST |
| build tree (artifact) | **`D:\rusty-kaspa-dc2`** — a real clone (`.git` is a directory) of `D:\rusty-kaspa-da` at a39c60d2. NOT the worktree `D:\rusty-kaspa-dc` (its `.git` is a file ⇒ `utils/build.rs:41-42` embeds no commit hash; attempts 1–3 there are SUPERSEDED, see below). `D:\rusty-kaspa-da` working tree untouched. |
| CARGO_TARGET_DIR | `D:\rusty-kaspa-dc\target-dc` (isolated; never `D:\rusty-kaspa-da\target` = live D-a exe) |
| rustc / cargo | `rustc 1.96.1 (31fca3adb 2026-06-26)` / `cargo 1.96.1 (356927216 2026-06-26)` (same as D-a/D-b) · `-j 2` (live host: kaspad WS 28 GB when up; free 8.2 GB at attempt 2; 41 GB at attempt 4 only because kaspad was down) |
| build (attempt 4) | start 2026-09-06T23:05:56Z · rc=0 · wall 352 s · dirty=0 |
| exe | `D:\rusty-kaspa-dc\target-dc\release\kaspad.exe` → copied to **`D:\kaspad-live\dc-a39c60d2\kaspad.exe`** (rule 863: file name unchanged, per-version subdir) · 40,616,960 B |
| sha256 | **bd5808ab685f0f22f561f70e3d642f652ae0286d92472c1ffef44ca3bb36a8a3** |
| embedded hash | short `a39c60d2` ×3 · full ×1 (`grep -a`, same shape as the D-b exe: 3 short) · `--version` = `kaspad 1.1.1-toc.1` (hash is in the first log line, not in --version — same as D-b) |
| new flags | `--help` lists `--ibd-self-trigger-lag-secs` (env `KASPAD_IBD_SELF_TRIGGER_LAG_SECS`, default 480, 0 = legacy off) / `--ibd-self-trigger-check-secs` (60) / `--ibd-self-trigger-backoff-max-secs` (1800) |
| SUPERSEDED artifacts | attempt 1 (82d47d85, worktree, killed before review fixes) — no artifact kept; attempt 2 (a39c60d2, worktree) sha **ae1242664a8089a2130c39bf60f9a8e38a1acd2a27adf91203681ab686f59715**, embedded hash 0 ⇒ overwritten, must not be deployed; attempt 3 = attempt 2 re-run by mistake (sed on build.sh failed), same sha |
| verification | `cargo check` rc=0 · `cargo test -p kaspa-p2p-flows self_trigger` 14/14 · rustfmt clean · `cargo clippy --no-deps -D warnings` clean on the 3 touched crates (`kaspa-consensus` has a pre-existing `while_let_loop` lint, untouched) |
| deployment | NOT deployed. Switch = Owner GO, two steps: ① `--ibd-self-trigger-lag-secs=0` shadow 1 h (negative control: `IBD self-trigger` lines must be 0, behavior == db-4d0a9e30) · ② default 480. Runbook `scratch/_j2_Dc_switch_admin_runbook_PREPARED_2026-09-06.md`. Rollback = `D:\kaspad-live\db-4d0a9e30\kaspad.exe` (sha 2432c36b…) without the D-c flag. |
