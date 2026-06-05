# 跨节点 4-of-5 委员预言机首次链上裁决闭环 — CLOSURE

> **状态**: ✅ 机制级闭环达成，testnet-12 链上铁证（2026-06-06）
> **范围红线 (G5)**: 这是**机制范式验证**（去中心化预言机能裁决市场 + 付赢家），**不是经济闭环**。金额为 testnet demo 值，非真金。项目终点 = 测试网公开 demo，mainnet 生产不在 scope。
> **独立见证**: Bettor-tn (④验链) + NWT-tn r303 (独立 ASSERT) + J2-tn (收口落链) + J1-tn (:3300 节点)

---

## 一、闭环命题

**KANet 用 Kaspa 信任链，让一组去中心化预言机（跨独立节点）对一个预测市场做出共识裁决，并把池子按裁决结果在链上自动分给赢家 + 委员 + broker，全程无单点、可审计、链上派生。**

首个跑通的市场：

| 字段 | 值 |
|------|----|
| market id | `ext-pool-v07-1780675304257-opkiy` |
| protocol_version | v0.7 |
| 裁定结果 (outcome) | **YES** (winner=0) |
| 数据源 | `kanet_v07_test` → 公网 GitHub raw URL（跨节点可达，非 localhost）|
| deadline_daa | 30631749 |

---

## 二、链上铁证

| 锚点 | 值 |
|------|----|
| **spine P2SH（池托管地址）** | `kaspatest:ppv5jr0rnv5t0xwz9w5hg774paaq5jewe9v06jdprmhyrfj694gt7jcjc0ljx` |
| **spine lock TX（建池）** | `bf65a9407e1f4b196260537d2c43e6603eb098448ed14f2a04c1469e59e663ee` |
| **pool_merkle_root（委员成员树根，blake2b）** | `560ae06b81c170cb6f53c17f1da140e6909ce9936a2a8628be8430ed0d3c54a4` |
| **committee_pk_hash（双节点 byte-exact 一致）** | `fb3a46b659e415468f88f88d861a77b6b4d69051b8afff3571154a5c74920d0f` |
| **settle TX（裁决出账）** | `95c84f8aaad7ecd3c42ff77a82e65889fd58348bf1863165c31618c5ec6f6f09` |
| **accepting block_hash** | `a85dacb038e7f711e4f375bdacadf67d3bcea4b234e07141be3240f9668e7c8a` |
| block_time | 1780677341 |
| network | testnet-12 |

> ④ 验证方法：本节点嵌入式 indexer (`kaspa_tx_log`) 观测到 settle TX **进块**（block_hash 非空）= is_accepted，非仅 submit。settle TX 提交无 `script ran, but verification failed` = **SS 链上验签通过**。

### settle TX 链上三方分账（10 输出实付）

| 收款方地址 | 金额 (sompi) | ≈ KAS | 角色 |
|------------|--------------|-------|------|
| `qz0zmw…kyjkky` | 179,990,162 | 1.7999 | 委员预言机 c0 |
| `qpep9m…g7gq5f` | 179,990,162 | 1.7999 | 委员预言机 c1（:3200 本地）|
| `qrnxvg…vu8gdg` | 179,990,162 | 1.7999 | 委员预言机 c2 |
| `qpcp8u…wzk4ws` | 179,990,162 | 1.7999 | 委员预言机 c3 |
| `qzss97…7a0pge` | 179,990,162 | 1.7999 | 委员预言机 c4 |
| `qpjhaad7…tpnx9r` | 39,256,221,940 | ~392.56 | YES 赢家 |
| `qrl33afe…76jlh2` | 39,256,221,940 | ~392.56 | YES 赢家 |
| `qrl33afe…76jlh2` | 981,405,549 | ~9.81 | YES 赢家（第二笔/找零）|
| `qzcpypy…kpstg` (spine) | 196,281,110 | 1.9628 | broker/协议费 |
| `qzcpypy…kpstg` (spine) | 5,000,000 | 0.05 | spine 维持 |

5 个委员收款地址**精确匹配** `pool_committee.committee_relay_ids` 的 c0–c4，也匹配投票阶段链上 c0–c4。winner=YES 与数据源裁定一致。

---

## 三、完整管道（链派生 → 裁决 → 出账）

```
链派生池                bet → spine P2SH 托管
  ↓
VRF 抽委员              deriveCommitteeSeed = blake2b(marketId‖endBlockHash‖poolMerkleRoot)
  ↓                    stake-weighted selectCommittee → 5 委员，threshold=4-of-5
  ↓                    双节点独立抽样 → committee_pk_hash fb3a46b 一致（链派生确定性成立）
状态 advance           deadline 过 → 每节点 deadline-watcher 独立 advance verifying（非跨节点传播，本就 per-node）
  ↓
跨节点投票             :3300 voter 投 4 票 → 广播 kanet-prediction（Kaspa TX）→ :3200 scout ingest
  ↓                    + :3200 本地 1 票 = 5/5 全 YES
4-of-5 共识            decideConsensusV06 按 voter_pubkey 计票 → 满足 4-of-5
  ↓
跨节点 sign_req        广播 kanet-prediction，内嵌 phase2_tx_obj（要签的 unsigned TX，chunked）
  ↓                    ※ 跨节点只有广播(链)通，DM 不通
委员签名               每委员对 phase2_tx_obj sighash 签 → 广播 sign_resp → ingest
  ↓                    收齐 5 真签（1@:3200 + 4@:3300）
组装 + 提交            handleCollectingSigs 按 committee_indices 排序拼 scriptSig
  ↓                    5 sig slots + 5 pubkeys + 各自 merkle proof（leaf=blake2b(pk)）
SS 链上验签            PoolSpine_v07: validSigs≥4 + 每 pk ∈ pool_merkle_root + sides 输出约束
  ↓                    ✅ PASS → settle TX 进块
三方分账落链           5 委员报酬 + YES 赢家拿池 + broker 费
```

---

## 四、收口路上修掉的 bug（全是 half-migration「生产侧改了消费/传播侧没改」同一个病）

详见记忆 `project-cross-node-settle-pipeline-debug`。关键 commit：

| commit | 修的坑 |
|--------|--------|
| `9cf2543` | **最终根因**：chain-scanner merkle leaf 用 `sha256(pkX‖stake)`，SS 用 `blake2b(pk)` → 永不等 → merkle verify fail。对齐 blake2b(pk)。NWT L18 lint 守跨实现一致 |
| `f67356a` | voter 委员匹配用 UUID，但 oracle_relay_ids 存的是地址 → voted=0。4 处消费方全修 |
| `e6b4878` | 共识 decideConsensusV06 按 UUID 读票，票 keyed by pubkey → 0 计。改按 voter_pubkey |
| `5a06b31` | sign_req 走 DM 跨节点不达 → 改广播 kanet-prediction |
| `48960f6` / `3953f40` | phase2_tx_obj 只在 maker 本地 → 内嵌 sign_req 广播 + chunked + handler 从 msg 取 |
| `79fd2af` / `1098eeb` | sign_resp 无 ingest handler + orphan vote/sig 无 re-scan → 加 handler + per-tick replay |
| `924b6a2` | vote/sign ingest 用 v0.5 `oracle1/2/3_pk`（v0.7 NULL）验成员 → 全 reject。改 `pool_committee.committee_pks` |
| `559c5e9` | v0.7 跨节点 ingest 漏 bake pool_snapshots → :3300 抽样前置缺 → committee `[]` |
| `fbaca6e` | deriveVote 不认 `kanet_v07_test` 源名 → 改 `kanet_*` 前缀匹配 |
| `600e899` | cron tick env 可配（`POOL_SETTLER_TICK_SEC`/`PREDICTION_VOTER_TICK_SEC`）→ demo 期 1min 提速流水 5×（mainnet 不设=默认 5min）|

> SS verify 是链上硬约束（改 = P2SH 地址迁移），所有链下实现必对齐它。`#9` 因旧 sha256 root 烤死 spine → 无法 settle → 超时退款牺牲品（资金安全）。`#10` 用对齐后的 blake2b root 重建 → 真 settle 落链。

---

## 五、诚实边界（守 G5 + 报实不报虚）

1. **机制级闭环，非经济闭环**：金额是 testnet demo 值。我们证明的是「机制能跑」，不是「真金在流」。
2. **本例 5/5 真签**；4-of-5 活性路（仅 4 签、1 委员静默仍能 settle）在本市场未单独触发验证 —— 协议支持，但需独立用例证。
3. **seeder 真实用户 go-live 未开**：本闭环的赢家/委员是测试参与方，非公开匿名用户。
4. settle TX 的 is_accepted 取自本节点 indexer 观测进块；如需更强可查 selected-parent-chain virtual acceptance。

---

## 六、决议

- task #20「真 settle 跨节点 4-of-5 签名委员真出账」= **完成**。
- 此文档为 testnet 公开 demo 的链上证据存底。任何「闭环/PASS」声明以本文档锚点为准，不接受无链上 txid 的口头闭环。
- 后续（非本闭环 scope）：4-of-5 活性路用例（#20 衍生）、introspection 强制 settle 输出（#16）、oracle pool 单一源 reader 全迁 hard-FAIL（#21 / NWT L16）、结构化 spec 创建门禁（#22）。
