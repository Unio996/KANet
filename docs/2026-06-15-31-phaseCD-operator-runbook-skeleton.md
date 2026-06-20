# #31 chunked-settle — Phase C/D 跨节点 e2e operator 运行手册（骨架）

> 2026-06-15 KANet-UI-tn（:3200 operator + 单 git-writer）。gate B finish-line 我的棒 = 100-winner v08
> 造市数据脚本 + :3200 部署 + Phase C/D 执行。本文 = **骨架**（复用 [A-run recipe](../) 接力记忆
> `project-longpole-A-signature-run-complete`），待 ② v08 create wire + ④ relay v08 scriptSig 落地后按**真端点**填实
> （禁对 moving target 写死，fixture-must-mirror-production 铁律）。

## 0. 分工锚（团队 2026-06-15 划定）
- **(a) fixture DATA-gen** = J1 域 ✓ DONE（`test-framework/standalone/gen_31_e2e_fixture.mjs` @ 10c92a8a → `fixtures/31_e2e_100winner.json`）。我**消费**不重造。
- **(b) 造市 + :3200 部署 + Phase C/D 执行** = 我（operator）。本文。
- **(c) 验证锚点规格** = NWT + J1（`docs/2026-06-15-31-e2e-verification-anchors-NWT.md` + harness Phase C/D 断言）。我执行时按此验。

## 1. Gating（诚实分层，禁跳）
| 步 | gated on | 现状 |
|----|----------|------|
| 造市脚本对真端点写实 | ② market-create v08 路由（settler L1953）落地 | ⏳ J2 wire 中 |
| chunked settle 触发 + 逐 chunk scriptSig | ④ relay v08 settle_chunk/settle_aggregate scriptSig wire | ⏳ J2 wire 中 |
| Phase C/D 实跨节点 | 双节点同步部署到 j1-31 **同 commit**（whole-repo-sync，非 cherry-pick）| ⏳ 候 ②③④ deploy-ready |

## 2. Fixture 参数（来自 10c92a8a，我消费的 expected 参考）
- N_WINNERS = 100；STAKE = 1e8 sompi（1 KAS/bettor = API min-bet floor）
- POOL_VALUE = 100×1e8 + 1e9 = 110 KAS（100 池 + 10 fee/headroom）
- FIXED outputs = broker 5e7 + 5 committee @ ORACLE_BOND 1.2e8
- 预期 partition = **[40, 47, 13]**（chunk_0=40 含 broker+5committee 6 显式检 / chunk_1=47=MAX_K / chunk_2=13）
- payoutRoot + winner 集（pk+amount，merkle_index ASC）= fixture 自带，两节点 byte-equal 锚
- **fixture-scope = (A) 确定性 seed（团队 unanimous, fixture-gen @98901eee）**：seed=`KANET-31-E2E-FIXTURE-SEED-v1`（公开）。
  派生法（我复现铁律）：`sk_i = blake2b(utf8(SEED) ‖ uint32LE(i))[32]`；`pk_i = kaspa.PrivateKey(sk_i).toPublicKey().toXOnlyPublicKey()`，i=0..99=merkle_index。
  privkey 派自 seed → **我造市脚本可派生同 100 keypair 且可签注册**。
- ✅ **consumer 复现已验**（2026-06-15 KANet-UI）：我用上式独立复现 `pk_0 = 9338fdfdcb0532fc...` == J1 fixture pk_0，匹配 → (A) 耦合端到端打通，链上 payoutRoot 必 byte-equal fixture（同 keypair 同 amount 同 builder 逻辑）。NWT 独立 impl 重算 payoutRoot 交叉验（2-impl 抓共享 builder bug）。

## 3. 执行序（骨架，端点占位待 ②/④ 填实）
1. **:3200 + :3300 同步部署** j1-31 同 commit（我整树 whole-repo-sync + tree-kill 重启 Console；J1 :3300 FF 同 sha；双方 `git rev-parse HEAD` 对齐 = 跨节点 determinism 前置）。
2. **造 v08 市场**：create-v08（真端点待 ② = `POST /api/pool/market/...v08`？占位）→ 派生 PoolSpine_v08 P2SH（含 f739ab2e broker/committee 显式检 SS）→ 链上 market_publish + check_utxo_landed 验。
3. **100 bettor 注册**：seed→100 真 keypair → 各 fund（treasury 4094a133 转）→ 各 register 押 **winning side**（v08 register 端点待 ②/③ state-serial）→ 100 押注 + pool-lock 资金。
4. **验 pool-lock**：池 P2SH 余额 == POOL_VALUE + 守恒；pool_bettor_sides 100 行 bettor_pk POPULATED（pk-derive 单源）。
5. **触发 chunked settle**：oracle 委员判 winning side → settler dispatchPhase2 v08 路由（②）→ 逐 chunk settle_chunk + 末 settle_aggregate（④ scriptSig）→ chunk-chain sequential-with-confirmation（N×block-time，§8.2）。
6. **Phase C 逐 chunk 验**（NWT 锚点）：每 chunk 落链双节点独立 `check_utxo_landed`（[[reference-chain-verify-via-relay-check-utxo-landed]]）；实际 output {pk-derive addr, amount} == fixture 期望；payoutRoot byte-equal :3200 vs :3300。
7. **Phase D resume（8.3b 双节点中断恢复）**：:3300 settle chunk_0,1 → 杀 → :3200 scan **unspent spine-P2SH change UTXO** assert count∈{0,1} → read hwm → 续 settle chunk_2。断言：无双付 [0,hwm) + 无漏付 [hwm,end) + 末 change==0 + 全 winner==预期 + resume 读链上 **confirmed** 非 local。

## 4. ⚠ Operator 前瞻风险（我 own 的域，现在标，执行前必备）
- **880-wall / broadcaster UTXO starvation**：步 3 = **100 bettor fund + 100 register = ~200 tx**，叠加步 5 的逐 chunk settle（≥3 chunk，每 chunk 重组 sign_req）。这是我 own 的 880 墙域二阶效应（[[project-broadcast-880-wall-deepdive]]）：大量 1-in-1-out self-send 会耗尽 broadcaster UTXO → 发不出。**缓解**：(a) 造市前用 #24 `consolidate_utxo`（N→1，已部署 759aefdd）+ `splitUtxos`（N 个 disjoint fund UTXO）预备充足 broadcaster UTXO；(b) fund 100 bettor 用**单 tx 多 output**（1-in-100-out）非 100 笔 self-send，省 mass + 避墙；(c) 逐 chunk settle 间留 confirmation 间隔（本就 sequential）。
- **资金量**：110 KAS 池 + 100 bettor 各需 gas + oracle bond ×5 ×1.2e8 = ~6 KAS bond。treasury 4094a133（8.98M source）够，但需预算 + check_utxo_landed 每步验落链（NO TX NO STATE）。
- **zombie 市场干扰**：造市前确认无 stuck verifying 僵尸抢 settle cron（gate E §7 zombie-vs-real by deadline age）。

## 5. 待填（②/④ 落地后）
- 真 v08 create/register 端点路径 + payload schema（按真码填，禁猜）
- settle 触发的真 oracle 判定路径（v08 委员会）
- NWT 锚点 doc 的精确断言清单对齐
- 100-keypair seed 派生脚本（确定性 + 能签）+ 单-tx-多-output fund 脚本
