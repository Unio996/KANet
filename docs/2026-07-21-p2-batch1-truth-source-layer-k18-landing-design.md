# P2 第一批 — 真相源层模块化 + K-18 §3.1-§3.3 落地 + verifyClaimLanded 金额校验(J1 主稿,J2 协)

> **Status**: CURRENT(v0.5 · 2026-07-21 · J1 draft,§3.5 折入 J2 发现+草案(#ue9cp6.1)→ Bettor 方向审 GREEN-with-3-notes(#uegipr)→ NWT 正式红队 GREEN-with-2-MUST-FIX → 三态设计(kaspa_tx_log 主 + getUtxos 兜底)经 Bettor/NWT/J2 交叉论证收敛定案(#uesq36,不再变动)· 待 NWT 对实际落码 diff 复核)
> **依据**: `docs/2026-07-21-28-state-sync-architecture-full-design.md` §5 P2 派工("全状态推广 re-derive+校验纪律 + 真相源层模块化,§3 完整实现,J1 主+J2 协,分批走每批独立 NWT 审") + Bettor 今日派工(#udvo4q,并入 K-18 残项)+ Owner 直令(今日一鼓作气+充分测试,D-011 内部审核链走完即可装载)。
> **前置**: K-18 §3.1-§3.4 全案(`docs/2026-07-18-payoutshard-family-coherence-gate-design.md` v1.1,**已 NWT GREEN-with-3-MUST-FIX 且 3 条全折入**)——§3.4(recompile 降级校验)已在昨晚 P0 v0.3(`25b3d0a0`)+ line423(`67490897`)落地。**本卡 = 落地 K-18 剩余 §3.1(covenant_family 列)+ §3.2(zk_native 铸后不可变)+ §3.3(assertPayoutShardCoherence 四步门)**,K-18 的架构设计本身不重新评审(已经 NWT 审过),本卡是**实现落地计划 + 用它解决两条昨晚遗留的开放线索**。

---

## 0. 本批要解决的两条遗留线索(不是新问题,是本批的验收数据)

1. **`pruned_expired_waived`(15 行)组的 +202 字节签名**:昨晚 backfill dry-run 测出这组 `payout_redeem_hex` 比正常 V1 `closed:0` 模板系统性多 202 字节(J2 四值探针,15/15 精确一致),跟 8pson/verifying 组的 -2614 字节签名(V2/ZK 家族误判)不是同一类。J2 判断"疑似另一种 closed 状态或额外字段",但没有 `.sil` 字节布局知识精确定位,交给本批用 §3.3(b) 结构探针查清楚。
2. **A0(stored redeem 的 p2sh)vs `payout_ps_addr` 6/8 不符**(verifying 组旁证发现):NWT 已判定"归入 K-18 §3.3(d) 本来就该管的范围,不用另开线"——`assertPayoutShardCoherence` 的 (d) 步骤(`p2sh(stored) == payout_ps_addr`)正是设计来抓这类问题的,本批实现这一步会自然给出这 6 条的正式判定。

这两条不是本批"顺便查"的外快,是**本批 backfill 迁移步骤本身就必须产出的数据**(K-18 §3.1 backfill 探针本来就要对每行判 family + 结构合法性)——用真实迁移跑一遍生产数据,自动就把这两条悬案解决了,不需要额外发明诊断动作。

---

## 1. 字节布局参考(2026-07-21 从活代码抠出,非猜测,供本批设计使用)

V1 PayoutShard state 区(`bshard-close-enforce.mjs:69-75` 注释 + `_splicePayoutCloseRedeem`/`_readPsConsolidatedPool` 实现逐字核对):

| 字段 | offset(从 `_PS_STATE_START=1` 起算) | 编码 | 字节数 |
|---|---|---|---|
| `consolidated_pool` | +1 | PUSH8 + i64LE | 9 |
| `closed` | +10 | PUSH8 + i64LE | 9 |
| `payoutRoot` | +19 | PUSH32 + 32B | 33 |
| `w0..w16`(17 个 nullifier word) | +52 起 | 各 PUSH8 + i64LE | 17×9=153 |

State 区总计 = 9+9+33+153 = **204 字节**(从 `_PS_STATE_START=1` 起,即整个 redeem 里 offset 1~205 是 state 区,offset 0 是 state_start 的某个前导字节)。State 区**之前**是 ctor 常量区(`poolMerkleRoot`/`predicateCommit` 各 32B+PUSH 前缀 ≈ 33B),这部分在 V1 里位于 state 区之前还是之后需要读 `PayoutShard.sil` 源码 ctor 顺序核实(`compilePayoutShardRedeem` 的 ctor 数组顺序是 `[poolMerkleRoot, predicateCommit, consolidatedPool, closed, payoutRoot, ...W17]`,推断常量区在 state 区前,但 push 后的实际字节序要以 silverc 编译产物为准,不能只信 ctor 参数顺序=字节顺序——本批结构探针会实测坐实,不预先断言)。

**这个表是本批 §3.3(b) 结构探针 + 202 字节归因的直接工具**——不再是"猜可能是哪个字段",是"逐字段核对 offset 处的字节跟这个表对不对得上"。

---

## 2. 范围(本批 IN / 后续批 OUT)

**IN(本批)**:
- K-18 §3.1: `payout_shards.covenant_family` 不可变列(schema + 写入点 + backfill)。
- K-18 §3.2: `zk_native` 铸后不可变(fail-closed 拒绝已铸市场改标记)。
- K-18 §3.3: `assertPayoutShardCoherence(psRow)` 四步一致性门(family 声明 + 结构探针 + recompile byte-equality + 地址匹配),调用点分级接入(高频省三步/低频全四步,K-18 原设计已定)。
- 用 §3.1 backfill + §3.3(b) 结构探针,**产出 pruned_expired_waived(15 行)+ verifying 组 A0 不符(6 行)的正式归因**(数据+判定,不是猜测)。
- lint 规则 `R-PS-FAMILY-DISPATCH`(K-18 §5 DoD-2 原定)。

**OUT(明确排除,留后续批,不在本批隐式夹带)**:
- P2 更广义的"全状态字段推广 re-derive"(K-18 只管 covenant family/redeem 一致性;`win_direction`/`payoutRoot` 已经有各自的 re-derive+验证模式在跑,`payout_shards` 之外的其它表字段的类似推广是后续批,本批先把 K-18 这个已经设计完、只差落地的模块做完,不铺更大摊子稀释审查质量)。
- `covenant_family` 列建好后,把它接进**日常高频调用路径**(`registerBettorOnShard` 每笔下注)的完整性能测试/压测——本批只做正确性验收,性能验收(K-18 §3.3 调用点①每笔下注要求"零子进程 spawn"的实测确认)排验收清单但如果时间不够可以在装载后单独一批补,不阻塞本批正确性主线。
- line423 的 `curRedeem` splice-not-recompile 彻底根治(P0 §4 已标注的独立待办,不在本批范围)。

---

## 3. 实现计划

### 3.1 `payout_shards.covenant_family` 列(migrate v189)

```sql
ALTER TABLE payout_shards ADD COLUMN covenant_family TEXT NOT NULL DEFAULT 'unknown';
```

写入点(K-18 §3.1 原设计,谁编译谁 declare):
- `ensurePayoutShard`(`pool-shard-register.mjs:121` INSERT)→ `'v1_committee'`。
- `ensurePayoutShardV2`(`:257` 附近 INSERT)→ `'v2_zk'`。

Backfill(migrate v189 内一次性,复用昨晚已交付的探针基础设施):
- 对每个既有 `payout_shards` 行跑结构探针(§3.3(b) 同一函数)——**结构探针的判据不是"猜家族",是实测字节:先按 V1 state 布局(本卡 §1 表)解出 `consolidated_pool`/`closed`,recompile 出 V1 candidate,byte-compare;不过则按 V2 布局(`bshard-close-enforce.mjs` 现有 `_PSV2_*` offset 常量)解一遍,recompile 出 V2 candidate,再 byte-compare。两次都不过 → `'unknown'`,不猜。**
- **backfill dry-run 报告硬前置(K-18 §5 DoD-0,Owner"充分测试"直令下不可省)**:migration 落码前先跑只读版本,产出总行数/family 分布/unknown 行是否对应在途盘的报告,人工过一遍确认无在途盘被误伤才能真正执行 migration——避免"backfill 本身制造一批盘静默卡住"(K-18 原文教训)。

**§0 两条遗留线索在这一步自然产出答案**:backfill 探针跑到 `pruned_expired_waived`(15 行)和 verifying 组 A0 不符(6 行)时,会记录它们具体在哪个 offset 解码失败/字节不符,而不是像昨晚那样只知道"总长度差 202/不知道差在哪"——这是本批设计比昨晚临时诊断脚本更进一步的地方:昨晚是事后调查,这次是把同一套逻辑做成生产级、可重跑、结论可追溯的迁移工具。

### 3.2 `zk_native` 铸后不可变

判定点:该 logical market 的 `payout_shards` 行已存在(genesis 已 mint)后,任何写 `resolution_rule_spec` 的路径若改变 `zk_native` 值 → 拒绝(API 400 / 内部 throw),不静默纠正。覆盖点:`bettor.js:1459` + `pool.js` spec 写点(落码时全量 grep 收口,K-18 §3.2 已列出大致位置,实现时重新 grep 一遍不假设旧文档行号仍准——今晚已经吃过一次"文档行号漂移导致排查扑空"的亏,MUST-FIX②那次)。

### 3.3 `assertPayoutShardCoherence(psRow)`

新函数,单源供 console+daemon,K-18 §3.3 原设计四步:
- (a) `covenant_family` ∈ {v1_committee, v2_zk},`'unknown'` 直接 FAIL。
- (b) 结构探针(本卡 §1 表 + 对应 V2 offset 常量),探针结果必须 == declared 家族。
- (c) recompile byte-equality(按声明家族分派 `compilePayoutShardRedeem`/`compilePayoutShardV2Redeem`)——**这一步现在有了明确的 K-18 §3.4 定位:仅作校验,不作为任何调用点的花费权威来源**(呼应昨晚 Codex MUST-FIX4 教训,本批从设计阶段就把这条焊死,不是落码后才发现)。
- (d) `p2sh(stored) == payout_ps_addr`——**直接解决 verifying 组 6/8 不符的问题**,不用另外写诊断代码。

调用点分级(K-18 原设计,NWT MUST-FIX③ 已折入):
- 高频(`ensurePayoutShard`/`V2` 早返回分支,每笔下注):只跑 (a)(b)(d) 三步,零子进程。
- 低频(`consolidateAndBuildPsState` 使用前、close-transport V2 入口):完整四步含 (c) recompile。

### 3.4 lint `R-PS-FAMILY-DISPATCH`

`compilePayoutShardRedeem|compilePayoutShardV2Redeem` 调用点必须在 coherence-gate 保护内(白名单机制同既有 `R-MANIFEST-*` 系,`scripts/lint-kanet.mjs` 已有可复用的实现模式)。

### 3.5 `verifyClaimLanded` 金额校验(J2 发现,Bettor #ue9cp6.1 裁定折入本批;#28 全案 §6.5 DoD 明文项,P0 批漏了、本批还账)

**问题(J2 坐实,`bshard-auto-settler.mjs:639-651`)**:`verifyClaimLanded` 只判 `r?.landed`,不比对金额——claim tx 落地但金额不对(比如 witness/redeem 某处编码错误导致实际打款额跟 `claimData` 里的期望值不一致)会被误判"实正到账",跟 `verifyClaimLanded` 的姊妹函数 `verifyClosedLanded`(同文件 :609-635)形成明显不对称——**后者早就在做金额校验**(:614-623:`landed` 通过后额外调 `ctx.getUtxos(expectedAddr)`,`.some()` 精确比对 `String(amt) === String(consolidatedPool)` 才算数,注释原话"depth 只保证这笔 TX 够深不会被 reorg 退,不代表金额对;两个校验都过才真正判定 landed")。

**实现方案(比 J2 原草案更小的改动面——直接照抄 `verifyClosedLanded` 自己已经在用的模式,不改 relay 层)**:J2 草案提议扩展 relay `checkUtxoLanded` 加第 5 参 `expectedAmount`、把 amount 从 relay 侧带出来。读码发现**不需要动 relay**——`verifyClosedLanded` 从没让 relay 带出金额,是 console 侧 `landed` 通过后自己再单独调一次 `ctx.getUtxos(expectedAddr)` 查金额,`verifyClaimLanded` 完全可以照搬同一模式,零 relay 改动、零跨服务接口变更:

**v0.4(Bettor 冲突收敛 #uemwsc + J2 历史先例补充,三态设计,不是 kaspa_tx_log/getUtxos 二选一)**:J2 指出 7/8 committee attest 那晚的先例——`kaspa_tx_log` 是 relay 自己 block-added 监听写入的本地索引,不是链的完整镜像,曾出现"已落链 tx 但监听漏事件、本地表查无"的真实案例,当时定的规矩是"本地表 miss = inconclusive,不是 confirmed-absent,优先走直连 RPC 兜底"。§3.5 照抄同款三态,不把"查无记录"并入"金额不符"这一支(两者原因不同、该有的后续动作也不同):

```js
async function verifyClaimLanded(ctx, winnerAddr, claimTx, expectedAmount = null) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const r = await ctx.relayPost(ctx.feeRelay.id, { type: 'check_utxo_landed', address: winnerAddr, txid: claimTx, minDepth: REORG_SAFE_MIN_DEPTH });
      if (r?.landed) {
        if (expectedAmount == null) return true;   // 向后兼容: 不传 = 老行为,零改变(NWT 复核点③)
        // 三态金额校验(v0.4): ①kaspa_tx_log 命中且金额符 → true(主路径, 历史永久记录, 不受"UTXO 后来
        // 被花掉"影响, 解决 Bettor note① 的 85fit 教训)。②kaspa_tx_log 命中但金额不符 → 真· mismatch,
        // 不重试当前 attempt 内的 fallback(不该让"查不到"和"查到了但错"混同处理)。③kaspa_tx_log 查无
        // 该 txid(indexer miss)→ inconclusive(不是"金额不符"), 按 J2 7/8 先例直连 ctx.getUtxos(当前
        // UTXO 集)兜底一次——这一步才是 v0.2 原稿的 ctx.getUtxos 逻辑, 不是被 v0.3 替换掉, 是降级为
        // indexer-miss 时的兜底路径, 两条数据源分工明确、互相不遮蔽对方能解决的场景。
        // 【关键边界(NWT 复核重点点名, 落码前钉死语义)】"命中但不符"(真 mismatch, 不 fallback)必须严格
        // 限定为"找到了 winnerAddr 这个地址的输出条目, 但它的金额跟 expectedAmount 不一样"——以下三种情形
        // 都【不算】"命中不符", 全部并入 inconclusive → fallback getUtxos, 不能被误判成 mismatch 直接拒:
        //   (a) txRow 本身缺失(indexer 没这个 txid 的记录, J2 7/8 先例的原始场景)
        //   (b) outputs_json JSON.parse 失败(数据本身损坏/格式异常, 不代表这笔钱没到账)
        //   (c) outs 数组里根本没有 winnerAddr 这个地址的条目(可能是这份记录当初就没捕全该 tx 的所有
        //       output, 不是"确认没给这个地址转钱"——真给没给, 后面 getUtxos 直接查这个地址现状更准)
        let outs = null;
        const txRow = ctx.db.prepare('SELECT outputs_json FROM kaspa_tx_log WHERE tx_id = ?').get(claimTx);
        if (txRow?.outputs_json) {
          try { const parsed = JSON.parse(txRow.outputs_json); if (Array.isArray(parsed)) outs = parsed; } catch {}
        }
        const matchingOutput = outs?.find(o => o?.address === winnerAddr);
        if (matchingOutput) {
          if (String(matchingOutput.amount_sompi ?? matchingOutput.amount) === String(expectedAmount)) return true;
          // 真找到了这个地址的输出、金额确实不是期望值 = 唯一的"确认 mismatch"情形, 不 fallback(不允许
          // "两个源挑一个顺眼的"), 落到下面继续下一 attempt(容许 expectedAmount 传参时序性 bug 被上游
          // 修正的窗口, 20 次预算耗尽仍不符才真正 fail-closed)。
        } else {
          // 上面 (a)(b)(c) 三种情形统一走到这里: inconclusive, 直连 RPC 现读当前 UTXO 集兜底一次
          // (J2 7/8 先例的规矩首次落码——本地表 miss ≠ confirmed-absent)。
          const entries = await ctx.getUtxos(winnerAddr);
          const ok = entries.some(e => {
            const j = JSON.parse(JSON.stringify(e, (k, v) => typeof v === 'bigint' ? v.toString() : v));
            const op = j.entry?.outpoint || j.outpoint;
            const amt = j.entry?.amount ?? j.amount;
            return op?.transactionId === claimTx && String(amt) === String(expectedAmount);
          });
          if (ok) return true;
          // getUtxos 兜底也查不到(可能是 NWT MUST-FIX② 那个"UTXO 已被 winner 自己花掉"的场景, 或者
          // indexer 还没追上+这个查询窗口 UTXO 真的还没上链)→ 两条路径这次 attempt 都不能确认, 继续重试。
        }
      }
    } catch (e) {
      console.warn(`[verifyClaimLanded] attempt ${attempt + 1}/20 threw (非落地判定失败, 诊断用): ${e?.message || e}`);
    }
    await _sleep(3000);
  }
  return false;
}
```

调用点(两处,`amount` 参数直接来自局部已有的 `cd.amount`,零新增数据流):
- `bshard-auto-settler.mjs:572`:`verifyClaimLanded(ctx, winnerAddr, claimTx, cd.amount)`(winner claim)。
- `bshard-auto-settler.mjs:845`:`verifyClaimLanded(ctx, bettorAddr, claimTx, cd.amount)`(refund claim)。

**定案(v0.4,NWT 最终裁定,#uesq36 收敛,不再变动)**:原 v0.2 稿只用 `ctx.getUtxos`(当前 UTXO 集)校验金额。Bettor 方向审 note① 抓出 85fit 同款教训(claim UTXO 若在验证前被赢家自己花掉,当前 UTXO 集查无此笔,误判"金额不符"),一度论证"landed 先行短路下这个窗口收益趋近空集"(建议退回纯 v0.2),但随即自己发现漏算 TOCTOU 窗口(landed=true 那一瞬到金额读取之间,UTXO 仍可能被花,`getUtxos` 会漏读而 `kaspa_tx_log.outputs_json` 因为是历史永久记录仍可读)并撤回。**结论:金额源是 `kaspa_tx_log` 主 + `ctx.getUtxos` 兜底的三态设计(v0.4),两个数据源都保留、分工不同,不是二选一替换**——`kaspa_tx_log` 解 spent-race(§2 Tier1 同一原语,本文件已有三处先例 :246/:497/:531),`ctx.getUtxos` 解 indexer 永久漏块(J2 引的 7/8 committee attest 先例,首次落码这条规矩)。`ctx.getUtxos` 参数依然需要,调用侧签名不变(`ctx` 本来就带 `ctx.db`+`getUtxos`)。

**NWT 四点复核意见逐条对应**(v0.3 用 kaspa_tx_log 源重新过一遍,结论不变):
1. fail-closed 默认对不对——`expectedAmount` 传了就必须真拦,不能只 log:金额不符(或 indexer 缺口)时**不 return true**,穿透到 20 次重试耗尽后返回 `false`,调用方现有的 `if (!received) { ...STOP threading... }` 分支原样生效,是真拦不是日志。
2. 精确相等非容差:`String(o.amount_sompi ?? o.amount) === String(expectedAmount)`,不做任何 `>=`/容差。
3. 向后兼容——`expectedAmount == null` 分支直接 `return true`,新代码(含 kaspa_tx_log 查询)完全不会被执行,两处既有调用点行为逐字节不变。
4. `outputs_json` 里对应输出缺失/字段异常——`.some()` 精确比较自然返回 `false`(视为该记录不支持这次比对,跟"记录整体缺失"走向同一条重试路径,但**不等于**"确认金额不符"——见下方 v0.4 三态订正)。

**v0.4 订正(NWT 实读坐实,收回"跟 verifyRedeemMatchesChainObservedOutput 同一原语"这个类比)**:上面 4 点是针对 v0.3(纯 `kaspa_tx_log`,无 RPC 兜底)写的,NWT 红队 + J2 独立核实发现 `verifyRedeemMatchesChainObservedOutput`(P0 Tier1 用,已装载在线上)**本身也只是布尔 collapse,indexer 缺口跟真 mismatch 都归到同一个 `false`,没有直连 RPC 兜底**——J1 之前把它当"已有先例"类比是过度延伸,团队核实后确认"indexer 查无 = inconclusive,应该直连 RPC 兜底"这条规矩(J2 引 7/8 committee attest 那晚的教训)**此前从没有一个现成实现可抄,§3.5 v0.4 是这条规矩第一次真正落码**,不是复用。v0.4 三态明确区分,且"确认 mismatch"的边界收窄到最严格的定义(NWT 复核重点,见上方代码注释):**只有"找到 winnerAddr 的输出条目、金额确实不同"才算真 mismatch**,以下都算 inconclusive → fallback:txRow 缺失 / JSON.parse 失败或非数组 / outs 里没有 winnerAddr 这条。**回归测试扩到 7 case**:①`kaspa_tx_log` 命中+金额符→true;②命中(找到地址)+金额不符→false 且不 fallback(用 spy 断言 `ctx.getUtxos` 没被调用,验证真是"不 fallback"而不是"fallback 了但也没用");③`kaspa_tx_log` 整行缺失(txRow=null)+`getUtxos` 命中→true;④`outputs_json` JSON.parse 失败(存一个非法 JSON 字符串)+`getUtxos` 命中→true(不当 mismatch);⑤`outs` 数组是合法 JSON 但没有 winnerAddr 这条+`getUtxos` 命中→true(不当 mismatch);⑥两个源都查不到/都不符→false(重试预算耗尽后);⑦**spent-during-retry 自愈场景**(NWT MUST-FIX②,见下)。风格复用 `bshard-consolidated-pool-rederive.test.mjs` 的 offline stub 模式(`ctx.relayPost`/`ctx.getUtxos`/`ctx.db` 均用 stub,不需要真链)。

---

**NWT 正式红队 MUST-FIX②(2026-07-21,#uegipr 后续,实读 `kasia-relay/src/lib/p2sh.mjs:1484-1509` 坐实,比 Bettor 方向审 note① 更进一层)**:

`checkUtxoLanded`(relay 侧,`verifyClaimLanded`/`verifyClosedLanded` 共同依赖的底层 landed 判定)本身就是**当前 UTXO 集**语义,不是历史记录——`getUtxosByAddresses` 查当下活 UTXO,`entry = entries.find(e => outpoint.transactionId === txid)`(:1494),若该笔 claim tx 的输出**在这次检查前已被 winner 自己花掉**,`entries` 里根本没有这个 outpoint 了,`entry` 为 `undefined`,直接 `{landed: false}`(:1495)——**不是"landed 但金额查不到",是"landed 本身就判 false"**。这意味着 §3.5 把金额源换成 `kaspa_tx_log`(本卡上方 note①改法)解决的只是"금액比对"这一层,**没有解决更上游的 `r?.landed` 判定本身同样对"UTXO 已花"敏感**——winner 若在 60s 重试窗内自己花掉 payout(完全合法的正常操作,钱已经到账,爱怎么用怎么用),后续每次 `attempt` 都会在 `checkUtxoLanded` 这一步就返回 `landed:false`,20 次重试预算耗尽后触发 `STOP threading`,卡住这批结算里排在这个 winner 之后的其余 winner。

**范围裁定(NWT,Bettor 方向审 note① 给的两个选项里选①)**:这不是 §3.5 新引入的风险——`checkUtxoLanded` 这个 landed 语义是 relay 共享基础设施,`verifyClosedLanded` 用同一个函数、同样暴露(只是 shard 地址不像 winner 外部钱包那样会被"用户主动花掉",发生概率低很多但机制上一样脆弱)。**本批不改 `checkUtxoLanded` 的 landed 判定本身**(那是更大改动面——relay 侧共享函数,改了要过全部现有调用点的回归,不是"顺手一起改"能装下的范围,会稀释本批审查质量),接受这个已知暴露面作为 pre-existing 特征,不在本批解决,但必须做到"卡住不是死状态、能自愈":

- **DoD 第 4 回归 case**:构造"claim tx 已 landed 但在下一次 attempt 前该 UTXO 被花掉"的场景(stub `ctx.relayPost` 让第一次返回 `landed:true`、第二次开始返回 `landed:false` 模拟这个时序),断言:①`verifyClaimLanded` 最终对这一笔返回 `false`(诚实反映"验证不了",不是假装成功)②`STOP threading` 触发后这个市场进入既有的 `settled_partial_claims` 重试队列(不是死状态,下一 tick daemon 会重新走 resume 路径续接,不需要人工介入才能恢复)③不产生任何"钱没到账"的误报——alert 文案需要能让 on-call 分清"这是良性花费竞态"还是"真的没收到钱"。
- **Alert 文案改动**(`bshard-auto-settler.mjs` 现有 `ctx.alert?.(marketId, 'claim not landed ... — STOP threading (NO-TX-NO-STATE)')`):追加一句区分提示,例如 `+ '(可能是 winner 在验证窗口内自行花费 payout 的良性竞态, 非必然实失败——先查该地址近期是否有自主转出记录再判断是否需要介入)'`,防止 on-call 把良性竞态当成真事故连夜追查。

---

## 4. DoD(Owner"充分测试"直令,逐条钉死,缺一不收卡)

1. **回归测试 fixture 复刻生产真实输入结构**(Owner 直令原话,不许简化字段)——参考今晚 `bshard-consolidated-pool-rederive.test.mjs` 的自举模式(真实 migration 跑出的 schema,不是手搓精简版),覆盖:
   - V1 正常行 / V2 正常行 → coherence 通过。
   - incoherent 行(手工造 V2 redeem + v1 declared)→ assert FAIL + event 落表 + 零花费。
   - `unknown` 行 → gate 拒绝,不猜。
   - `zk_native` 铸后尝试翻转 → API 400。
2. **孤儿盘 / 重启穿越两类场景覆盖**(85fit 盲区,NWT 专项要求)——backfill migration 中途重启的幂等性(v189 是一次性 migration,需确认重跑不重复处理已 backfill 过的行)。
3. **装载后活代码复跑**(不信任装载前结果,今晚 KANet-UI/J2 的习惯延续)。
4. **backfill dry-run 报告人工过一遍**(K-18 DoD-0 铁律,confirm 无在途盘被误伤)才能真正执行 v189 migration。**责任人钉死(Bettor note②,不留无主语)**:沿 K-18 DoD-0 昨晚先例——KANet-UI 在生产库机器执行只读 dry-run(有权限跑),J1(本卡作者)对报告出域内判定(family 分布是否合理/unknown 行是否对应在途盘),两人角色不互换、不能只由一方单独拍板过这一关。
5. **pruned_expired_waived(15)+ A0 不符(6)两条遗留线索的正式归因结论**写入本卡或独立记录,不是"順手查了"没有下文。
6. NWT 红队每步都出"测试覆盖是否够"专项判断(Owner 直令口径)。
7. 测试网真金 E2E(Owner"测试 KAS 充足,不吝啬"直令):如果 coherence gate 接入高频路径(下注时),建议至少造一笔真实测试网下注验证零子进程 spawn 的性能路径+真实通过 gate,不能只看离线单测绿。
8. **§3.5 `verifyClaimLanded` 金额校验**:3 case 回归测试(匹配/不符/字段缺失)全绿 + 两处既有调用点(:572/:845)改动后 `bshard-auto-settler.test.mjs`(即使今晚发现其 `deriveResumePlanFromEvidence` 分支因既有 schema drift 跑不通,不影响这次改动路径不同的部分——但如果落码时顺手能低成本把那个 fixture 的 `id` 列 schema drift 修一下,算是路过带修,不算范围蔓延)不因本改动引入新失败。

---

## 5. 风险 / 待 NWT 复核重点(自提,架构师不自审)

1. **【MUST,Bettor note③ 升级确认】常量区(`poolMerkleRoot`/`predicateCommit`)在 state 区之前还是之后,§1 表格没有 100% 实测坐实(只是从 ctor 参数顺序推断)**——**落码硬前置(不是"待复核的风险",是阻塞落码的 MUST 项)**:必须先用一个已知 V1 行(`protocol_status='completed'` 任取一行即可,今晚测试里已经在用这个筛选惯例)实测 hex dump,逐字段核对 §1 表格 offset 跟实际字节位置完全吻合,才能把 §1 这张表写进探针/backfill 代码——**先 dump 后写 offset,不是先写 offset 后验证**,顺序不能反(今晚 MUST-FIX②"文件名笔误导致排查扑空"的同类教训:文档/代码里任何"可能是猜的"结构性断言,落码前必须有一次真实数据的正向验证,不能等出了岔子才回头查)。
2. Backfill 探针的"两次 recompile 都不过→unknown"逻辑本身是否会误伤 pruned_expired_waived/verifying 这类历史行(如果它们的真实家族既不是标准 V1 也不是标准 V2 模板,是介于两者之间的过渡期产物)——需要在 dry-run 报告里显式统计"两次都不过"的行数并人工过一遍,不能假设只有两种可能。
3. 高频调用点(每笔下注)的"零子进程 spawn"承诺——(a)(b)(d) 三步是否真的零 silverc 调用需要落码后实测确认,不是文档说了就算。

---

**关联**: `docs/2026-07-18-payoutshard-family-coherence-gate-design.md`(K-18 v1.1)、`docs/2026-07-21-28-state-sync-architecture-full-design.md`(#28 全案)、`docs/2026-07-21-p0-consolidated-pool-rederive-implementation-plan.md`(P0/line423,§3b K-18§3.4 已落地部分)、`docs/2026-07-21-k18-splice-vs-recompile-backfill-dryrun-report.md`(昨晚 98 条 MISMATCH 归因,pruned_expired_waived/A0 两条遗留线索来源)、`kasia-console/scripts/_j1tn_k18_splice_vs_recompile_backfill_dryrun.mjs`+`_j1tn_k18_v1_structural_probe.mjs`(本批复用的既有工具)。
