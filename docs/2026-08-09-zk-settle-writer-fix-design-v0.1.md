# ZK 结算死 20 天 — 写方(`payout_ps_addr` 陈旧)修复设计 v0.1

> **Status**: CURRENT

- **日期**: 2026-08-09
- **作者**: J2(Bettor 派工)
- **状态**: 设计稿(design-only)。**本文档不改任何生产代码 / DB / 链上。** 供 J1 照实现、NWT 红队、Owner 拍。
- **关联**: K-18 §3.3 coherence gate(`docs/2026-07-18-payoutshard-family-coherence-gate-design.md` /
  `docs/2026-07-21-p2-batch1-truth-source-layer-k18-landing-design.md` §3.3(d) /
  `docs/2026-07-21-p2-batch2-coherence-gate-wiring-design.md`)。
- **诚实边界(先说)**: 我没有查过 live DB。"13 个 divergent 盘 / 8 funded 60,474 KAS landed+unspent / 5 个
  attested_v2 exhausted"这些数字全部取自派工描述,本设计的回填脚本**自己重新枚举**divergent 盘、不信这些数字
  当输入(见 §2.1)。链上"landed+unspent"我也没独立复核,§2.4 把"回填前必须链上确认 redeem 权威"设成硬前置正是
  为了不让脚本盲信这个前提。

---

## 0. 根因复述(一句话)与不弱化闸的立场

`payout_ps_addr` 是 **write-once 陈列**:只在 genesis 铸造那一刻由 `ensurePayoutShard/V2` 写入
(`pool-shard-register.mjs:158/300`,值 = `p2sh(payout_redeem_hex)`)。此后 consolidation / close 在
`payout_redeem_hex` 上**原地 splice**(改了 redeem 字节 + `payout_ps_outpoint`),但**三条写路径全都漏刷
`payout_ps_addr`**。于是 K-18 §3.3 coherence gate 的 step(d)——
`p2sh(stored payout_redeem_hex) === payout_ps_addr`——拿**当前(已 splice)的 redeem** 去比**陈旧(genesis)的
addr**,必然不等 → `throw` → 拦住 13 盘结算。

**立场(与派工一致)**:闸抓到了一个真实的 DB 漂移(addr 与 redeem 不再自洽),**闸有价值,必须保留**。
本设计**只修写方**(让 splice 之后 addr 跟着刷)+ **一次性回填历史漂移**,**不动 gate 一个字节**,
不把 step(d) 改成"永远 pass"。§3 的阴性对照专门证明这一点。

### 0.1 关键旁证 — `payout_ps_addr` 不在任何花费路径上

grep 全库 `payout_ps_addr` / `psAddr` 消费点,确认**真正花钱/签名的路径不读这一列**,而是**运行时从
`payout_redeem_hex` 现推地址**:

- `bshard-close-voter.js:359` / `:482`(命门① chain-bound):`ctx.p2sh(req.psRedeemHex)` → 现推,不读列。
- `pool-shard-settle.mjs:280`(enforceCommitteeSign 命门①):`p2sh(psRedeemHex)` → 现推,不读列。

`payout_ps_addr` 这一列的**唯二功能消费者**:
1. **coherence gate step(d)**(`bshard-payout-family-coherence.mjs:171`)—— 自洽性断言。
2. **register 早返回**(`pool-shard-register.mjs:144/287`)—— 把 `existing.payout_ps_addr` 当 `psAddr`
   缓存值返回给 `ensurePayoutShard/V2` 的调用方(genesis PayoutShard 的资金地址,用于给新盘充种子)。

> 🔵 **推论(承重)**:回填 `payout_ps_addr` **不可能改变任何已在途的花费行为**——因为花费侧根本不读它。
> 回填的收益是让 gate step(d) 恢复"能过真盘、又能拦真漂移";风险面≈register 早返回的缓存值(下面 §4.2 论证)。
> 我**没有**穷举 register 返回的 `psAddr` 再往下游流到哪每一处(诚实标注),但已确认它不是链上花费地址来源。

---

## 1. 读透三条写路径 + 精确改法

三条写路径共 **4 条 UPDATE 语句**(settle-daemon 两处)。每处都是"splice 出新 redeem → UPDATE redeem+outpoint
→ 漏刷 addr"。改法统一:**在同一条 UPDATE 里补上 `payout_ps_addr = <p2sh(新 redeem)>`**,用**该处已经在
作用域里的 p2sh 函数**算(不新造 p2sh 实现,避免网络参数漂移)。

所有四处 p2sh 底层都是同一算法:
`addressFromScriptPublicKey(ScriptBuilder.fromScript(redeemBytes).createPayToScriptHashScript(), network)`。
gate step(d) 用的也是同一算法(close-transport 的 `gateP2sh` / settle-daemon 的 `_p2shCache`),所以只要写方
用它自己作用域里那个同款函数,写出来的 addr 必然 === gate 之后会算出的 `p2sh(redeem)`,step(d) 自洽。

### 1.A `bshard-settle-daemon.mjs:236`(needConsolidate=true,consolidate 后 splice)

现状(读过):
```js
psRedeemHex = res.redeemHex;                                  // consolidateAllShards 内部 splice 出的权威字节
try { sqlite.prepare('UPDATE payout_shards SET payout_ps_outpoint = ?, payout_redeem_hex = ? WHERE logical_market_id = ?')
  .run(res.psOutpoint, psRedeemHex, marketId); } catch {}
```
时机:本 tick consolidate 完成(链上 splice tx landed)后,把新 redeem/outpoint 写回。
值来源:`res.redeemHex`(与 relay 广播同源的权威字节)、`res.psOutpoint`(新 outpoint)。

改法(补第 3 列,`_p2shCache` 是本文件模块级函数 line 364,同 gate 用的那个):
```js
psRedeemHex = res.redeemHex;
const psAddrNew = _p2shCache(psRedeemHex);                    // ← 新增: addr 跟着 redeem 一起刷
try { sqlite.prepare('UPDATE payout_shards SET payout_ps_outpoint = ?, payout_redeem_hex = ?, payout_ps_addr = ? WHERE logical_market_id = ?')
  .run(res.psOutpoint, psRedeemHex, psAddrNew, marketId); } catch {}
```

### 1.B `bshard-settle-daemon.mjs:298`(needConsolidate=false,Tier2 genesis-walk 重建命中)

现状(读过):
```js
psRedeemHex = resumePoint.redeemHex;                          // autoDetectConsolidateResume genesis-walk splice 出的权威字节
try { sqlite.prepare('UPDATE payout_shards SET payout_ps_outpoint = ?, payout_redeem_hex = ? WHERE logical_market_id = ?')
  .run(`${psOutpointTxid}:${psIdx}`, psRedeemHex, marketId); } catch {}
```
时机:Tier1 判 redeem 不新鲜 / outpoint 已花 → Tier2 从 genesis 逐片重建,命中后自愈写回。
值来源:`resumePoint.redeemHex`(genesis-walk 现场 splice 的权威字节)、`${psOutpointTxid}:${psIdx}`。

改法:
```js
psRedeemHex = resumePoint.redeemHex;
const psAddrNew = _p2shCache(psRedeemHex);                    // ← 新增
try { sqlite.prepare('UPDATE payout_shards SET payout_ps_outpoint = ?, payout_redeem_hex = ?, payout_ps_addr = ? WHERE logical_market_id = ?')
  .run(`${psOutpointTxid}:${psIdx}`, psRedeemHex, psAddrNew, marketId); } catch {}
```

> 注:同函数 Tier1 命中分支(line 278)`psRedeemHex = ps.payout_redeem_hex` **不写 DB**(redeem 未变),
> 所以 addr 不漂移,**无需改**。只有真正 UPDATE redeem 的两处(236/298)需要补 addr。

### 1.C `bshard-close-transport.mjs:322`(ZK propose 路径,absorb 后 splice)

现状(读过):
```js
const absorbedRedeemBuf = Buffer.from(ps.payout_redeem_hex, 'hex');
absorbedRedeemBuf.writeBigInt64LE(BigInt(consolidateRes.consolidatedPool), 2);   // 原位 splice consolidated_pool
const absorbedRedeemHex = absorbedRedeemBuf.toString('hex');
try { sqlite.prepare('UPDATE payout_shards SET payout_redeem_hex = ?, payout_ps_outpoint = ? WHERE logical_market_id = ?')
  .run(absorbedRedeemHex, consolidateRes.psOutpoint, marketId); } catch {}
ps = { ...ps, payout_redeem_hex: absorbedRedeemHex, payout_ps_outpoint: consolidateRes.psOutpoint };
```
时机:ZK propose 里 consolidate 需要 absorb 时,原位 splice `consolidated_pool` i64LE 后写回。
值来源:`absorbedRedeemHex`(在原始 V2 字节上原位改 offset 2 的 i64LE)、`consolidateRes.psOutpoint`。

改法(用同一 block 内 line 285 已定义的 `p2shFn`——它在 `if (needConsolidate) {` 块内,line 322 也在同块内,
作用域可用;`p2shFn` 网络判定 `relayAddrForConsolidate.startsWith('kaspatest:')` 与 gate 的
`process.env.KASPA_NETWORK` 在 TN12 上一致):
```js
const absorbedRedeemHex = absorbedRedeemBuf.toString('hex');
const absorbedPsAddr = p2shFn(absorbedRedeemHex);            // ← 新增
try { sqlite.prepare('UPDATE payout_shards SET payout_redeem_hex = ?, payout_ps_outpoint = ?, payout_ps_addr = ? WHERE logical_market_id = ?')
  .run(absorbedRedeemHex, consolidateRes.psOutpoint, absorbedPsAddr, marketId); } catch {}
ps = { ...ps, payout_redeem_hex: absorbedRedeemHex, payout_ps_outpoint: consolidateRes.psOutpoint, payout_ps_addr: absorbedPsAddr };
```
> ⚠ 实现提醒(J1 落地时验一遍):确认 `p2shFn` 的作用域确实覆盖到 line 322(两者同在 `needConsolidate`
> 块内,应可用)。若因块结构变化不可用,退而在此处用与 gate 同款
> `addressFromScriptPublicKey(...ScriptBuilder..., gateNetwork)` 现算,**网络参数必须与 gate 的 `gateNetwork`
> 取同一来源**,否则 addr 会与 gate 期望不符(见 §4.3)。

### 1.D `bshard-close-voter.js:667`(`_persistAttestedPsState`,V2 close-attest 后 splice)

现状(读过):
```js
const preRedeemHex = req.closeInputs.payoutshard.redeem_hex;
const spliced = _splicePayoutV2CloseRedeem(preRedeemHex, { newPayoutRootHex, newAttestedWinner, ... });
sqlite.prepare('UPDATE payout_shards SET payout_redeem_hex = ?, payout_ps_outpoint = ? WHERE logical_market_id = ?')
  .run(spliced, `${txId}:0`, marketId);
```
时机:`close_attest_v2` 广播 + landed 后,把 attest 写入的新状态(closed=1 + 4 个 root/winner 字段)splice 进
redeem 持久化。outpoint 恒 `${txId}:0`(self_out_idx 固定 0)。
值来源:`spliced`(`_splicePayoutV2CloseRedeem` byte-exact splice)、`${txId}:0`。

改法(用本文件已有的 `p2shFromRedeemSync(redeemHex, network)` line 49):
```js
const spliced = _splicePayoutV2CloseRedeem(preRedeemHex, { ... });
const network = ...;                                         // 见下方"网络来源"提醒
const splicedAddr = p2shFromRedeemSync(spliced, network);   // ← 新增
sqlite.prepare('UPDATE payout_shards SET payout_redeem_hex = ?, payout_ps_outpoint = ?, payout_ps_addr = ? WHERE logical_market_id = ?')
  .run(spliced, `${txId}:0`, splicedAddr, marketId);
```
> ⚠ 两点实现约束(J1 必须处理,否则改了会崩):
> 1. **`p2shFromRedeemSync` 要求 `_kaspaWasm` 已 load**(否则 throw)。`_persistAttestedPsState` 是 sync 函数,
>    被 `bshardCloseSubmitV2Tick`(line 737/765)调用。该 tick 路径里 `ensureKaspaWasm()` 是否一定先跑过需
>    J1 确认;**最稳妥**是把 `_persistAttestedPsState` 改成 `async` 并在算 addr 前 `await ensureKaspaWasm()`,
>    或在调用点保证已 load。**注意本函数现有纪律**:整个 body 包在 try/catch 里,"记账失败不倒灌钱路"——
>    addr 计算失败也必须落在同一 catch 内(attest 已落链是既成事实,不能因为算 addr 失败而 throw 出去)。
> 2. **网络来源**:本函数签名没有 network 参数。取法与 `buildEnforceCtx`(line 138)一致:
>    `String(voter.address||'').startsWith('kaspatest:') ? 'testnet-12' : 'mainnet'`——但 `_persistAttestedPsState`
>    当前拿不到 `voter`。J1 需把 network(或 voter.address)透传进来,**取值来源必须与 gate step(d) 算 addr 的
>    网络同源**(TN12 恒 testnet-12)。

### 1.E 写方改动小结

| # | 文件:行 | 触发时机 | 新 redeem 来源 | 该处 p2sh 函数 | 需处理的坑 |
|---|---------|---------|---------------|---------------|-----------|
| A | settle-daemon:236 | consolidate landed | `res.redeemHex` | `_p2shCache`(模块级) | 无 |
| B | settle-daemon:298 | Tier2 重建命中 | `resumePoint.redeemHex` | `_p2shCache` | 无 |
| C | close-transport:322 | ZK propose absorb | `absorbedRedeemHex`(原位 splice) | `p2shFn`(同块 line 285) | 确认作用域 |
| D | close-voter:667 | close_attest_v2 landed | `spliced` | `p2shFromRedeemSync`(line 49) | 需 kaspa-wasm 已 load + network 透传 + 落 catch 内 |

**共性纪律**:addr 计算是纯函数(kaspa-wasm sync,无 I/O),插在 UPDATE 之前不引入任何新的 await 间隙(除 D 需
先 ensure wasm),不改变各处既有事务/try-catch 结构——只是往已有 UPDATE 的 SET 子句多加一列。

---

## 2. 一次性回填设计(migration,**本次不执行**)

目标:把所有 `p2sh(payout_redeem_hex) !== payout_ps_addr` 的历史盘,一次性把 addr 刷成 `p2sh(payout_redeem_hex)`。
遵循 v189 backfill 已确立的**同款范式**:ADD/UPDATE 分离、`table_info` 幂等守卫、**显式 opt-in 环境变量闸**、
默认只 dry-run 不写。

### 2.1 如何枚举 divergent 盘(不信派工给的"13")

脚本自己算,不接受外部数字:
```
SELECT * FROM payout_shards;
对每行 row:
  derived = p2sh(row.payout_redeem_hex)          // 与 gate step(d) 同款算法 + 同网络
  if derived !== row.payout_ps_addr:  收进 divergent 集合
```
`p2sh` 用与生产 gate 完全同款的实现(`addressFromScriptPublicKey(ScriptBuilder.fromScript(bytes)
.createPayToScriptHashScript(), network)`,network 由 `KASPA_NETWORK` 决定,TN12=testnet-12)。
**不复制第二份 p2sh 逻辑**,直接 import 现有(或复用与 gate 相同的 helper),防止"回填算的 addr 跟 gate 算的
addr 用了不同实现而对不上"。

### 2.2 正确 addr 怎么算 + 为什么 `payout_redeem_hex` 是权威

回填把 addr 对齐到 `p2sh(payout_redeem_hex)`,前提是 **redeem 是权威、addr 是陈的**。这一方向性由三条独立线
坐实(派工):consolidation/close 一路 splice 的是 redeem、写回的是 redeem+outpoint,addr 从 genesis 起就没动过;
且 8 个 funded 盘的钱 **landed+unspent 在 `p2sh(redeem)` 派生地址上**——即链上真金就在 redeem 派生的地址,
**redeem 就是链上真相,addr 是落后的那个**。所以修 addr(不是修 redeem)是唯一正确方向。

> 🔴 **方向性硬约束(不能反)**:回填**只准**把 addr 改成 `p2sh(redeem)`,**绝不准**反过来改 redeem 去迁就 addr。
> 后者会把一个已落链的权威 redeem 改坏,等于伪造。

### 2.3 幂等性

- ADD COLUMN 无关(addr 列早已存在)。
- 回填 UPDATE 的 WHERE 隐含条件 = "derived !== stored"(§2.1 枚举的结果集)。重跑时,已修好的行 derived===stored
  不再进集合 → 天然幂等,不会重复写、不会覆盖新写入点(§1 修好后)已正确刷新的行。
- 建议实现成:先枚举 divergent → 打印清单 → 仅对清单里的 `logical_market_id` 执行
  `UPDATE payout_shards SET payout_ps_addr = ? WHERE logical_market_id = ? AND payout_ps_addr = ?`
  (把旧 addr 也放进 WHERE 做**乐观并发保护**:若这一刻别的写路径刚好刷了它,WHERE 不命中、不误写)。

### 2.4 🔴 回填前硬前置:链上确认 redeem 权威(不盲信)

回填盲信 `payout_redeem_hex` 有一个真实风险:万一某盘的 redeem 本身是坏的(不对应链上任何资金),回填会把 addr
改成"和坏 redeem 自洽",等于**用改数据把 gate 的真报警消音**。所以对**有资金的盘**,回填**必须先链上确认**再改:

对每个 divergent 且**预期有资金**的盘:
1. `derived = p2sh(payout_redeem_hex)`。
2. 经 relay(Console 不碰链)`get_address_utxos` / `check_utxo_landed` 查 `derived` 地址上是否**真有** UTXO
   且其 outpoint 与 `payout_ps_outpoint` 一致(复用既有 `verifyRedeemMatchesChainObservedOutput` 原语,
   `pool-shard-settle.mjs:363`,**不新写探链逻辑**)。
3. **命中**(链上确认 redeem 派生地址即真金所在)→ 该盘 redeem 权威成立,回填 addr = derived,并在事件里记
   `provenance: chain_confirmed`。
4. **未命中** → **不回填、不猜**,写一条 `payout_ps_addr_backfill_skipped` 事件(reason=chain_unconfirmed)
   交人工核。fail-closed。

> 这条把"回填"从"盲改 DB"降级成"只在链上已经替我们背书了 redeem 权威时才对齐 addr",与全库
> "DB 读数不算数、走链上真相"的纪律一致(memory `reference-chain-verify-via-relay-check-utxo-landed`)。

### 2.5 回填前后如何验证

- **回填前**:dry-run 模式(默认,`PS_ADDR_BACKFILL_CONFIRMED !== '1'`)只**枚举 + 打印** divergent 清单
  (marketId、旧 addr、derived addr、covenant_family、链上确认结果),**零写入**。人工过一遍这份报告
  (对齐 v189 的 DoD-0 纪律)。
- **回填后(逐盘)**:对每个刚回填的盘,内存里跑一次 `assertPayoutShardCoherence(row, { p2sh, tier:'full' })`
  (直接调既有 gate 函数,不复制判据),断言返回 `ok:true`(step(d) 恢复通过)。任何一盘回填后 gate 仍不过 →
  说明该盘除 addr 外还有别的不自洽(如 step(b) 结构签名 / step(c) recompile),**记录、不吞、交人工**,
  不算回填成功。
- **回填后(全局)**:重跑 §2.1 枚举,divergent 集合应为空(幂等 + 完备的双重确认)。

### 2.6 迁移脚本骨架(设计,非成品)

放在 `migrate.js` 新版本号(接当前最新之后,**J1 落地时查 `docs/DATABASE.md` 确认当前 max 版本再定号**——
本设计不钉版本号,避免与其它在途 migration 撞号),范式照抄 v189:

```
{
  // 幂等:addr 列已存在,无 ADD。
  const confirmed = process.env.PS_ADDR_BACKFILL_CONFIRMED === '1';
  const rows = sqlite.prepare('SELECT * FROM payout_shards').all();
  const divergent = rows.filter(r => p2sh(r.payout_redeem_hex) !== r.payout_ps_addr);
  if (!confirmed) {
    // dry-run:打印 divergent 清单(含链上确认结果),不写。
    console.log(`[migrate] vNNN: ${divergent.length} 行 payout_ps_addr divergent — PS_ADDR_BACKFILL_CONFIRMED!=1,跳过真实回填(先人工过 dry-run 报告)`);
  } else {
    const tx = sqlite.transaction((list) => {
      for (const r of list) {
        const derived = p2sh(r.payout_redeem_hex);
        // §2.4 链上确认(有资金盘必过;exhausted 盘走 §4.1 决定的策略)
        // 命中 → UPDATE ... SET payout_ps_addr = derived WHERE logical_market_id = r.id AND payout_ps_addr = r.old
        // 未命中 → 记 skipped 事件,不写
      }
    });
    tx(divergent);
    // 回填后:逐盘 assertPayoutShardCoherence 断言 ok;全局重枚举应空。
  }
}
```
> 注:§2.4 的链上确认要经 relay 异步查询,而 migrate.js 传统是同步。若在 migrate 内做异步探链不便,**可拆成
> 独立的一次性运维脚本**(`scripts/` 下,绝对路径读 `console.db`,同 KANet-UI 跑生产 dry-run 的操作惯例),
> migrate 只保留"纯结构对齐"的保守版、探链版走运维脚本。J1 二选一,**本设计倾向独立运维脚本**——因为链上确认
> 是回填的安全核心,不该被 migrate 的同步约束逼掉。

---

## 3. 验收判据

### 3.1 正向(闸能过真盘)

回填(+§1 写方修复)后:
1. 8 个 funded 盘,内存跑 `assertPayoutShardCoherence(row,{p2sh,tier:'full'})` 全部 `ok:true`
   (step(d) 通过,step(a)(b)(c) 本就该过)。
2. 对这 8 盘触发结算路径(close-transport `buildProposeCloseRequestV2` / settle-daemon
   `consolidateAndBuildPsState`),入口 gate **不再 throw**,结算能向下推进(不再卡在 step(d))。
3. §2.5 全局重枚举:divergent 集合为空。

### 3.2 阴性对照(证明没把闸弱化成永远 pass)

**这是本设计防"消音式修复"的核心验收。** 回填**只改数据、不改 gate 代码**,所以 gate 对未来漂移的拦截能力
必须原样保留。构造一个**真 divergent**(addr 与 redeem 真不一致、非陈旧陈列)喂给 gate:

- **造法 A(改 addr)**:取一个已回填好的盘,把它的 `payout_ps_addr` 手工改成一个**别的合法地址**(不是
  `p2sh(redeem)`),跑 `assertPayoutShardCoherence(..., tier:'full')` → **必须** `ok:false, failedStep:'d'`。
- **造法 B(改 redeem 一个字节)**:取一盘,把 `payout_redeem_hex` 改一个字节(addr 保持原值)→ `p2sh(改后 redeem)`
  必然 != addr → gate **必须**在 step(b 结构签名)或 step(d) 拦下(throw / ok:false)。
- **造法 C(回填脚本本身的阴性)**:给回填脚本喂一个 divergent 且**链上查不到 UTXO**(§2.4 未命中)的盘 →
  脚本**必须 skip 不写**、记 `chain_unconfirmed` 事件,**不得**把 addr 改成和坏 redeem 自洽。

三条都成立 ⇒ 闸没被弱化、回填没被用作"消音"。这些应作为 regression case 落进
`kasia-console/test-framework/cases/` 或与 `bshard-payout-family-coherence.test.mjs` 同级
(现有测试 line 194/196 已有 step(d) 拒的用例,阴性对照可在其上扩展)。
> 🔴 提醒(遵 `docs/TEST-FRAMEWORK.md` 更正):本仓**无自动回归**,加了 case 不等于有人守着——这些 case 是
> **交付那一刻由改动者手工跑并留证据**,不是常驻哨兵。

---

## 4. 风险 / 边界

### 4.1 5 个 attested_v2(exhausted)盘要不要一起回填?

**结论:建议一起回填,但用不同 provenance,且不阻塞主目标。**

- **一起回填的理由**:invariant `payout_ps_addr === p2sh(payout_redeem_hex)` 应当**全局成立**才干净;留着 5 个
  已知不自洽的盘 = 留 5 颗"下次谁读 addr 就绊一下"的雷,也让 §2.5 的"全局重枚举应为空"判据无法成立(得永远
  记特例)。而它们**无资金、无花费路径**(§0.1:花费侧不读 addr;且已 exhausted),回填零钱险。
- **但有一个诚实缺口**:exhausted 盘**链上已无 UTXO**,§2.4 的"链上确认 redeem 权威"**对它们做不了**(查不到
  UTXO ≠ redeem 坏,只是钱已花)。所以它们只能走**结构自洽**回填(addr 直接对齐 `p2sh(redeem)`),provenance
  标 `structural_only_no_chain_confirm`,与 funded 盘的 `chain_confirmed` 区分记录。
- **折中(推荐)**:主回填先只处理 **8 个 funded 盘**(有链上背书,是解 13 盘死结的承重项);5 个 exhausted 盘
  作**同一脚本的第二段 / 或后续独立小卡**,provenance 明确标注。**不让 exhausted 盘的处理策略阻塞 funded 盘
  上线**。J1/NWT 可按此拆两步。

### 4.2 回填 addr 会不会影响别的读者?

已知读者只有两个(§0.1 grep 坐实):
- **gate step(d)**:回填正是为了让它对真盘 pass —— 正向影响,符合设计。
- **register 早返回**(`pool-shard-register.mjs:144/287`):返回 `existing.payout_ps_addr` 当 `psAddr`。
  这条**早返回只在 payout_shards 行已存在时触发**——即**盘已 genesis 铸过**,`ensurePayoutShard/V2` 直接返回缓存值
  不再铸/不再充种子。对**已进入 consolidation/close 的盘**(我们回填的正是这些),不会再有新的 genesis 充种子
  动作去消费这个返回的 `psAddr`。所以回填对这条路径**实际无副作用**。
  > 🟡 **我没验证的部分(诚实标注)**:我没穷举 `ensurePayoutShard/V2` 的返回 `psAddr` 在所有调用方下游还流去
  > 哪里、有没有某个调用方拿它当"给这个地址转账"的目标。已确认的是:命门①/enforce/settle 的花费地址都**现推
  > 自 redeem、不读这一列**(§0.1)。J1/NWT 落地前应快速扫一遍 `ensurePayoutShard(` / `ensurePayoutShardV2(`
  > 的调用方,确认没有"拿返回的 psAddr 去打钱"的路径依赖它是 genesis 值。**若真有,回填让它=当前 redeem 派生地址
  > 反而更对**(那才是钱真正所在),但仍应显式确认而非假设。

### 4.3 写方改动的并发 / 事务问题

- **原子性**:四处都是**往一条已存在的 UPDATE 的 SET 子句多加一列**,仍是单条 SQL 语句、单次执行——原子,
  不引入多语句竞态。addr 与 redeem/outpoint **同一条 UPDATE 一起落**,消除了"redeem 刷了 addr 没刷"的中间态。
- **无新 await 间隙**:addr 计算是纯 sync kaspa-wasm(A/B/C),不在 read 与 write 之间插入 I/O。唯一例外是 D
  可能需 `await ensureKaspaWasm()`——那是模块级一次性 load,建议在函数入口/调用点提前 ensure,不放在 read-write
  之间。
- **多写者竞态**:settle-daemon 与 close-transport 都可能刷同一盘。但它们**本就已经在竞写 redeem/outpoint 两列**
  (现状),本改动只是让 addr 跟着同一条语句走——**没有新增**竞态面,反而因为三列绑定在一条 UPDATE 里,消除了
  "A 写者刷了 redeem、B 写者读到新 redeem 旧 addr"这种跨语句撕裂。回填脚本的 §2.3 乐观 WHERE(带旧 addr)进一步
  防"回填与写方同刷"撞车。
- **try/catch 纪律**:A/B/C 现状 UPDATE 就包在 `try{}catch{}` 里(记账失败不倒灌钱路),addr 计算若抛(理论上
  纯函数不抛,除非 redeem hex 非法)也被同一 catch 兜住,不影响已落链事实。D 见 §1.D 提醒必须落在其 try 内。

### 4.4 其它边界

- **网络参数一致性**:唯一能让"写方刷的 addr"与"gate 算的 addr"对不上的,是**两边 network 取值不同**
  (testnet-12 vs mainnet)。TN12 现网恒 testnet-12,四处写方 + gate 都解析到同值,实际无风险;但 J1 落地时
  **务必让写方的 network 与 gate step(d) 的 network 取同一来源**(§1.C/§1.D 已标)。这是本改动**唯一**能悄悄
  再造漂移的地方,红队重点看这里。
- **回填与写方修复的上线顺序**:先上**写方修复**(§1),再跑**回填**(§2)。反过来(先回填后修写方)会让回填
  刚修好的盘在下一次 consolidate/close 又被漏刷 addr 的写方重新拖脏。**顺序:写方 → 回填**。

---

## 5. 诚实标注:我没验证的部分(汇总)

1. **未查 live DB**:13 / 8 / 5 的盘数、60,474 KAS、landed+unspent —— 全取自派工,回填脚本自己重新枚举、不信这些
   数字当输入(§2.1);链上"unspent"我没独立复核,§2.4 把链上确认设成硬前置正因如此。
2. **register 返回 `psAddr` 的完整下游**未穷举(§4.2 🟡)——已确认花费地址不来自这一列,但未逐调用方追到底。
3. **close-transport `p2shFn` 覆盖到 line 322 的作用域**:强信(同 `needConsolidate` 块内)但请 J1 编译期实证(§1.C)。
4. **close-voter tick 里 `ensureKaspaWasm()` 是否一定先于 `_persistAttestedPsState` 跑过**:未逐路径确认,
   §1.D 给了"改 async + 入口 ensure"的稳妥兜底,J1 需坐实。
5. **回填是否放 migrate 还是独立运维脚本**:§2.6 给了两条路并倾向独立脚本(因链上确认是异步),未钉死;
   migrate 版本号未定(J1 查 DATABASE.md 当前 max 再定)。
6. 本文档**只读代码 + 写这一份设计**,未运行任何脚本、未改任何生产代码/DB/链上。

---

## 6. 给三方的一页纸

- **J1(实现)**:§1 四处写方补 `payout_ps_addr` 列(表 §1.E),顺序**先写方后回填**;§2 回填走独立运维脚本 +
  显式 opt-in env(`PS_ADDR_BACKFILL_CONFIRMED`),默认 dry-run;链上确认复用
  `verifyRedeemMatchesChainObservedOutput`,不新写探链;落地前扫 §5.2/§5.3/§5.4 三个待坐实点。
- **NWT(红队)**:重点打 §4.3 网络参数一致性(唯一能再造漂移处)、§3.2 三条阴性对照(证明闸没被消音)、§2.4
  "盲信坏 redeem 会消音真报警"这条是否堵死。
- **Owner(拍)**:方向 = 只修写方 + 一次性回填,**闸原样保留、不弱化**;funded 8 盘(承重)先行,exhausted 5 盘
  provenance 区分、不阻塞主线。
