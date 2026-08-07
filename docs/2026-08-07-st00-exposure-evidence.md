# ST-00 exposure 数字 · 证据包

> **Status**: CURRENT · 证据文档(非叙事稿)· **零链上写 · 零生产 DB 写**
> **作者**: J2 · 2026-08-07 · **缘起**: Codex `3486cb17` 判 ST-00 v0.2 里全部资金数字为 **OBSERVED · 尚不可独立复现**(只活在叙事里,没有像 G-4 那样的 committed 证据包)· Bettor 11:11 派工
> **生成器**: `scratch/st00-exposure-evidence-gen.mjs`(只读,可重跑;⚠ 该脚本本身在 gitignored 目录,**故本文件把 SQL 与 RPC 原文全部内联**,不依赖它)

🔴 **本文件回答的是"这些数字怎么来的、怎么重查",不是"这些钱该不该退"。** 后者是 ST-03/G-4 本体的事。

---

## 0. 身份锚(读数之前先对这一节)

| 项 | 值 |
|---|---|
| 分支 / HEAD | `bshard-m3-deploy` / `e34d14f1` |
| `pool-market-settler.js` blob | `74231c3c` |
| DB | `D:/kanet-tn12/kasia-console/data/console.db`(**本机**) |
| kaspad `getInfo().serverVersion` | `1.1.1-toc.1` |
| kaspad 启动横幅 | `v1.1.1-toc.1-7b1e18cc`(`logs/kaspad-tn12.out.log`,**2026-07-15 落盘**)<br>⚠ **该横幅未证是当前进程所打**(KANet-UI 2026-08-07 已如实标此缺口) |
| network / isSynced | `testnet-12` / `true` |
| 采集时 `virtualDaaScore` | `76029367` ⚠ **每秒在动,仅作时刻锚** |
| 🔴 schema 锚 | **库无可查询版本**(`PRAGMA user_version = 0`,无 migrations 表);唯一锚 = `src/db/migrate.js` 最高标记 **v194** |

**摘要 digest**(对下方全部记录的规范化 JSON 取 sha256):
```
e70c202f7e593ed6cfcb8d70ef8305aa1bbdade6e61dc143097556948f7cf5a2
```
**L1 重查锚**:本次共取到 **4,010 条 UTXO outpoint**,其 `{addr,txid,index,amount}` 排序后 sha256:
```
c9b42e9320175ca6f154f5c3a42096e416f250eb0aa9bf2e91577931c3991cf9
```
⚠ **两个 digest 都会随链与库变动而变** —— 它们锚的是"这一次采集",不是不变量。

---

## 1. 分类与去重口径(Codex 点名要的那一格 —— 先看这节,否则下面的数会被读错)

### 1.1 side 行 vs side 地址

```sql
SELECT COUNT(*) AS sides, COUNT(DISTINCT side_p2sh) AS side_addrs
  FROM pool_bettor_sides WHERE side_p2sh IS NOT NULL;
```
| sides | side_addrs |
|---|---|
| 36,012 | 2,710 |

⇒ **一个地址平均对应约 13 行**:同一 bettor 在同一市场/方向多次下注 ⇒ 多个 UTXO、同一个 P2SH(`PoolSide_v07` 设计如此:金额不入 ctor,per-UTXO 独立 claim)。**"36,012" 是行数不是人数也不是地址数。**

### 1.2 redeem script 的三态(🔴 `IS NOT NULL` 会把空串算作有值)

```sql
SELECT COUNT(*) AS total,
       SUM(CASE WHEN side_redeem_script_hex IS NULL THEN 1 ELSE 0 END)  AS is_null,
       SUM(CASE WHEN side_redeem_script_hex = ''    THEN 1 ELSE 0 END)  AS is_empty,
       SUM(CASE WHEN side_redeem_script_hex IS NOT NULL
                 AND side_redeem_script_hex <> ''   THEN 1 ELSE 0 END)  AS has_value
  FROM pool_bettor_sides;
```
| total | is_null | is_empty | has_value |
|---|---|---|---|
| 36,012 | 0 | **29,652** | **6,360** |

### 1.3 那 29,652 空串行【全部】属于分片架构 —— 不是"数据缺失"

```sql
SELECT m.protocol_status, COUNT(*) AS n
  FROM pool_bettor_sides s JOIN pool_markets m ON m.id = s.market_id
 WHERE s.side_redeem_script_hex = '' GROUP BY m.protocol_status ORDER BY n DESC;
```
| protocol_status | n |
|---|---|
| `shard_internal` | **29,652**(零例外) |

```sql
SELECT COUNT(*) AS shard_rows,
       SUM(CASE WHEN shard_redeem_hex IS NOT NULL AND shard_redeem_hex <> '' THEN 1 ELSE 0 END) AS with_redeem
  FROM market_shards;
```
| shard_rows | with_redeem |
|---|---|
| 1,341 | **1,341(100%)** |

⇒ **分片 side 本来就没有 per-side redeem —— 它由分片层的 `shard_redeem_hex` 承载,而那一层是满的。⇒「82.3% 数据缺了」是错的说法。**

### 1.4 存量脚本的版本分档(长度即版本判别器,启发式)

```sql
SELECT LENGTH(side_redeem_script_hex) AS hex_len, COUNT(*) AS n,
       COUNT(DISTINCT market_id) AS markets, MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
  FROM pool_bettor_sides WHERE side_redeem_script_hex <> ''
 GROUP BY hex_len ORDER BY n DESC;
```
| hex_len | n | markets | 跨度 |
|---|---|---|---|
| **4006** | **6,329** | 445 | 06-02 … 06-30 |
| 3916 | 11 | 2 | 05-31 |
| 1204 | 6 | 2 | 05-30 … 06-24 |
| 1198 | 5 | 5 | 05-29 … 06-03 |
| 3998 | 4 | 4 | 06-01 |
| 3912 | 4 | 4 | 05-31 |
| 3924 | 1 | 1 | 06-02 |

⇒ **6,329 / 6,360 = 99.5% 属同一版**(= 实测可用当前 `.sil` 逐字节重生成的那一版);**旧版共 31 条 / 18 市场 / 6 种长度,可枚举。**
⚠ **同长度 ≠ 同版本**(启发式);严格判定需逐字节。

### 1.5 V1 / V2 分类

```sql
SELECT covenant_family, COUNT(*) AS n, COUNT(DISTINCT logical_market_id) AS logical_markets
  FROM payout_shards GROUP BY covenant_family;
```
| covenant_family | n | logical_markets |
|---|---|---|
| **`v1_committee`** | **701** | 701 |
| `v2_zk` | 21 | 21 |

⇒ **主力是 V1**(`PayoutShard.sil`):`refund_claim` 要求 `closed==2`,而 `closed=2` **只能由 `cancel_attest` 设**,后者要 **4-of-5 委员签名**(`require(validSigs >= 4)`,`PayoutShard.sil` entry3 逐字;🔴 我原写"5 个"= 把【签名参数个数】当成了【门槛】),且该文件 **`tx.time` 出现 0 次 = 零 timelock** ⇒ **无许可逃生路不存在**。(此格 Codex `3486cb17` 逐行读 `PayoutShard.sil` **代码级确认**。)

🔨 **这处更正连带改变了严重性,必须一起说(不是纯措辞)**:
- **4-of-5 容忍 1 个委员失效** ⇒ 「**缺任一即永锁**」是错的,准确说法是「**须坏 ≥2 个才永锁**」;
- **但结论方向不变**: 仍需 4 个委员主动配合、`PayoutShard.sil` 仍**零 timelock**、仍**无无许可逃生路** ⇒ **liveness 失败面成立,只是门槛比我原写的低一格。**
🔨 **判据(Bettor 入册,我这处是触发实例)**: **报 M-of-N 门控的严重性,必须同时带 M 和 N 两个数** —— 只说"要委员签"或只说一个数,会让"签不出"被读成"全体签不出",而实际是"够不到阈值"。
⚠ **我这次的具体错法**: **读了签名【参数个数】(5 个 `sig` 形参),把它当成了【门槛】** —— 而门槛在下面的 `require(validSigs >= 4)` 里,源码注释甚至逐字写着 `threshold t=4-of-5`。**参数个数 ≠ 门槛。**

### 1.6 tg 托管钱包

```sql
SELECT COUNT(*) AS wallets,
       SUM(CASE WHEN mnemonic_encrypted IS NOT NULL AND mnemonic_encrypted <> '' THEN 1 ELSE 0 END) AS with_mnemonic,
       access_mode FROM tg_custodial_wallets GROUP BY access_mode;
```
| access_mode | wallets | with_mnemonic |
|---|---|---|
| `normal` | 25 | 25 |
| `capability_only` | 1 | 1 |

⇒ 共 **26**,**26/26 都有加密助记词副本在运营方 DB**。`capability_only` 那 1 个由脚本创建、不走 `tg-bot/bot.mjs:176` 的展示流程 ⇒ **从未有用户见过它的助记词**。

---

## 2. 链上余额(**去重地址口径 —— 这是唯一可引用的口径**)

**市场集合**(非终态 v0.7):
```sql
SELECT protocol_status, COUNT(*) AS n FROM pool_markets
 WHERE protocol_status IN ('verifying','settle_zombie_quarantine','settle_failed',
       'pending_bettors','refunding','collecting_sigs','unresolved_needs_authorization')
   AND protocol_version = 'v0.7' GROUP BY protocol_status ORDER BY n DESC;
```
`settle_zombie_quarantine` 189 · `verifying` 93 · `settle_failed` 49 · `pending_bettors` 29 · `refunding` 14 · `unresolved_needs_authorization` 5 · `collecting_sigs` 2 ⇒ **合计 381**

🔴 **必须先看这一条,否则金额会被放大**:
```sql
SELECT COUNT(*) AS markets, COUNT(DISTINCT spine_p2sh) AS distinct_spine FROM pool_markets
 WHERE protocol_status IN (…同上…) AND protocol_version='v0.7' AND spine_p2sh IS NOT NULL;
```
| markets | distinct_spine |
|---|---|
| 381 | **303** |

⇒ **381 个市场只有 303 个不同 spine 地址** ⇒ **按「市场 × 层」摊会把同一笔钱数多次。**
**实测放大倍数(我第一版就是这么错的)**:side **1,557,646 → 89,496 KAS(17.4×)** · spine **121,755 → 81,665(1.5×)**。

**RPC**:`getUtxosByAddresses`(`ws://127.0.0.1:17210`,`network` 字段核过),**批 150/次,约 4 req/s**,查询地址 **1,357** 个,其中 **772 个有余额**。

| 层 | sompi | KAS | 谁能动它 |
|---|---|---|---|
| **spine** | 8,166,500,000,000 | **81,665.00** | 只有 `settle_aggregate`(**4-of-5**,`validSigs >= 4`)/ `refund_maker_unjoined`(maker 自己,封顶自己那份) |
| **side** | 8,949,618,000,000 | **89,496.18** | bettor 自己签 + timelock(`refund_market_cancelled`) |
| payout | 6,600,000,000 | 66.00 | V1 = **4-of-5** 委员 `cancel_attest` 之后才可 `refund_claim` |
| shard | 20,000,000 | 0.20 | — |
| ⚠ 跨层地址(**单列,未归类**) | 60,000,000 | 0.60 | 3 个地址同时出现在多层 ⇒ **不硬归类,亦不计入上面四行** |

**合计(四层)= 171,227.38 KAS**;**spine 占 47.7% ≈ 48%**,**side 占 52.3% ≈ 52%**。

---

## 3. 这些数字**不**支持的说法(Codex 要求进标题不进 caveat)

1. 🔴 **「side 那 89,496 KAS = 用户可自主退出」—— 不成立。** 脚本层有那条路(`PoolSide_v07:274` 只要 bettor 自己签 + `deadline+7200` timelock),但**能不能行使**还要:**私钥在不在用户手上**(tg 托管那 26 个不在)· **redeem script + outpoint 拿不拿得到**(见 §1.2–1.4)。⇒ **脚本能力 = 必要条件,不是充分条件。**
2. 🔴 **「链上有钱」≠「卡住」** —— `verifying` 里有正常在途的。**判"卡"要另有判据,本文件没做。**
3. **本文件不覆盖**:v0.6 · 终态市场 · 其它协议版本 · 其它节点。
4. ⚠ **"377/381 个市场仍有钱"这个数出自我更早一次【按市场摊】的采集,本次未重新推导** ⇒ **不要引用它**;本次可引用的是「1,357 个地址中 772 个有余额」。

---

## 4. 怎么重查(不依赖本机、不依赖我)

- **DB 侧**:§1、§2 的 SQL 全部内联,可对任意一份 `console.db` 重跑。
- **L1 侧**:本次 4,010 条 outpoint 的 digest 在 §0;要逐笔核可对同一批地址重跑 `getUtxosByAddresses`,或按 `{txid,index}` 单笔查。
- ⚠ **重跑后 digest 必然不同**(链在动、库在长)——**digest 锚的是"这一次",不是"应当恒等于"**。
