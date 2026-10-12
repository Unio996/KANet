# 2xm7t 补写 zk_self_cov_id —— 取值证明 + dry-run（账本1893 票）

盘：`ext-pool-v07-1791202570105-2xm7t`（主网第一个有注的 ZK 盘，已结算，claim 续约已耗尽）。
全程只读：对线上库只做了**文件拷贝**（拷到 scratch 后在拷贝上查询/dry-run），没有写线上库，没有广播任何交易。

## 1. 要补的值与来源（链上，api.kaspa.org 只读）

`zk_self_cov_id` = `9f5a986b265844b144608d38028752b65331565ce37e212f8094fe507b33c0d0`

续约链（CloseZkV2 continuation）上同一个 covenant id 贯穿：

| 交易 | 角色 | 该 covenant id 出现位置 |
|---|---|---|
| `65c169f6…83fe` (zk_handoff) | 创建 | out 0（20,000,000） |
| `1af8244c…f59a` (zk_close) | 续约 | in 0 = 65c169f6:0；out 0（20,000,000） |
| `cdbf79e3…b266` (claim #1) | 花掉续约、铸 claim/token | in 0 = 1af8244c:0；out 0 = 续约 |
| `d45690d9…4b88` (claim #2, last) | 花掉续约，耗尽 | in 0 = cdbf79e3:0 |

claim #1 / #2 的 **input 0** 的 `covenant_id` 都是上面这个值（claim #1 的另一个输入 65c169f6:1 的 covenant 是另一条（gate 侧），不是它）。

## 2. 与 zk-recovery-enumerate 重算的 claim redeem 对账

枚举器对每个已领叶，用候选 id 重算 `KanetTokenClaim` redeem → P2SH 地址 → 查链上 UTXO。若 id 错，地址对不上，会得到 `gone`（找不到）。

用候选 id（`--cov-id <完整盘id>=<64hex>`）跑 `zk-recover` dry-run（`--max 0`，库=线上库的拷贝，`KASPA_RPC_URL` 读本机主网节点 wRPC，只调只读的 get utxos）：

| 叶 | 金额(筹码单位) | claim 记录 UTXO | 链上该 UTXO 的 covenant | token UTXO |
|---|---|---|---|---|
| 0 | 98,100,000 | `cdbf79e3:1`，40,000,000 sompi | `f281651c…`（= cdbf79e3 out 1 的 covenant_id） | `cdbf79e3:2`，40,000,000 |
| 1 | 1,900,000 | `d45690d9:0`，40,000,000 sompi | `5c5a94e5…` | `d45690d9:1`，40,000,000 |

两个叶的 claim 记录都在**重算出的地址**上找到了存活 UTXO，并且 claim UTXO 的 covenant id、token UTXO 都吻合 ⇒ 候选 id 正确。副证：2xm7t 盘上没有 `zk_recovery_params`，枚举器回落到当前 env（`params_source=env-fallback`）重算，同样对上了链上地址，说明当前 env 的 sink_pk / retire_daa 与铸造时一致。

## 3. zk-recover dry-run 能不能列出 2xm7t 的 claim 记录 UTXO，何时到期

- **不带 `--cov-id`、补写之前**：列不出来，claim 被 skipped：`need_cov_id(2 个已领叶…)`。
- **带 `--cov-id` 或补写之后**：列得出，2 个 claim + 1 张票，全部 `notYet`（未到龄）：

  | 记录 | 当时 age / 门槛 | 预计可回收（门槛 + 软余量 1000 DAA） |
  |---|---|---|
  | claim 叶0 `cdbf79e3:1` | 3,755 / 25,920,000 DAA | 2026-11-11 11:09Z 前后（claim #1 落链 2026-10-12 11:08:50Z + 30 天） |
  | claim 叶1 `d45690d9:0` | 3,440 / 25,920,000 DAA | 2026-11-11 11:10Z 前后（claim #2 落链 11:09:20Z + 30 天） |
  | ticket（1 张，Σin 7,000,000 sompi） | 5,274,457 / 315,360,000 DAA | 约 365 天后（2027-10 中旬） |

  （25,920,000 DAA ÷ 10 DAA/s = 30 天；relay builder 另有 50 DAA 硬余量，门槛以链上实际 DAA 为准，上表是日历估算。）
- 补写后**不带 `--cov-id`**也能列出同样的 2 个 claim（`cov_id_via=stamped`），在二次副本库上验证过。

## 4. 补写脚本（dry-run 输出；未写任何库）

脚本 `kasia-console/scripts/zk-backfill-self-cov-id.mjs`（逻辑在 `src/lib/zk-self-cov-backfill.mjs`，测试 `zk-self-cov-backfill.test.mjs` 10 项全过）。默认 dry-run；`--apply` 才写。写入是**单条 SQL**：

```
UPDATE pool_markets SET metadata = json_set(metadata,'$.zk_self_cov_id',?)
 WHERE id=? AND json_valid(metadata) AND json_extract(metadata,'$.zk_self_cov_id') IS NULL
```
只碰这一个键；判空与写入同一条语句（原子，运行中的 console 同时改 metadata 也不会丢更新）；已有值一律不覆盖；只补 `zk_continuation.exhausted===true` 的盘。

线上库拷贝上的 dry-run：
```
[backfill] DRY-RUN(不写库) market=ext-pool-v07-1791202570105-2xm7t
[backfill] 目标: metadata.zk_self_cov_id = 9f5a986b265844b144608d38028752b65331565ce37e212f8094fe507b33c0d0
[backfill] 结果: {"ok":true,"action":"would_write","current":null}
```
另在**二次拷贝**上演练过 `--apply`：written；再跑同值 ⇒ `noop already_set_same`；换不同值 ⇒ 拒绝 `already_set_DIFFERENT(不覆盖)`。

真写命令（重启之后由 Bettor 跑）：
```
DB_PATH=<线上库> node scripts/zk-backfill-self-cov-id.mjs --market ext-pool-v07-1791202570105-2xm7t \
  --cov-id 9f5a986b265844b144608d38028752b65331565ce37e212f8094fe507b33c0d0 --apply
```

## 5. 顺带发现

1. `zk-recover.mjs` 头注/报错写 `--cov-id <盘id末段>=<64hex>`，但枚举器 `resolveSelfCovId` 用 `covIdOverrides[marketId]` **精确匹配完整盘 id**，用末段会静默不生效（我第一次就踩了）。实际要传完整盘 id。未改（不在本票范围），待你定。
2. 现有 `stampSelfCovId`（zk-recovery-params.mjs）是读-改-写整串 metadata，对运行中的 console 有丢更新窗口；与早先记的 SHOULD（元数据写入改 json_set）同族。本票的补写脚本没用它。
3. 另一条（顺带）：6 张 ticket 之外，2xm7t 目前只有 1 张票待回收；`liveSlotHolders` 3/3 被另外 3 个 pending_bettors 盘占满（与本票无关，仅报告）。
