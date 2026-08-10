# canary#2 = j34vb 回填 + 结算 · 书面执行计划 v0.1【待 NWT 审 → Bettor 确认 → 才执行】

> **Status**: CURRENT
> **作者**: J2 · 2026-08-10 13:4xZ · 授权链: Owner 直令(13:2x「按建议尽快推进」)→ Bettor 13:30 派工 → 13:35 改为「J2 起草书面计划 → NWT 审 → Bettor 确认 → 执行」
> **本文件此刻是【计划】不是【记录】。执行前一行都不许当成已完成。**

---

## 🔴 §0 执行纪律(Bettor 13:35「逐字照准, 写进计划头部」)

1. **严格照本计划逐步执行**:每步执行前贴出「我即将跑的确切命令」,执行后贴**原始输出**。
2. **任何一步读数与本计划不符 ⇒ 立即停、报 Bettor**,**不自行判断「应该是等价的」**。
3. **广播类动作先 dry-run / 先只读核 UTXO**,再实发。
4. **NO TX NO STATE CHANGE**:未见 `check_utxo_landed`=true 之前**不推进任何本地状态**。

> 🔴 **本计划为什么存在**:Bettor 13:35 照直说——他引用的那份「既定六步清单」**不存在书面正本**(引自接位记忆快照,快照又引自前任会话的频道语境),**账记他**。
> ⇒ **本文件就是那份缺失的契约。** 它不是对旧清单的复原,是**读码之后新写的**;下面每一步的判据都指到 `scripts/backfill-payout-ps-addr.mjs` 的具体行,不指记忆。

---

## §1 现场(2026-08-10 13:3xZ J2 只读勘察,零写入)

```
pool_markets  2 行
  ext-pool-v07-1783969245093-j34vb      protocol_status=verifying        deadline_daa=61421827
  ext-pool-v07-1783969245093-j34vb-s0   protocol_status=shard_internal   deadline_daa=61421827
  spine_p2sh=kaspatest:ppvh0c5z6ha37zp3kymrla99yjc6zg0zrlcegtpzdys564uww…   settle_txid=NULL
payout_shards 1 行
  logical_market_id = ext-pool-v07-1783969245093-j34vb
  payout_ps_addr    = kaspatest:ppyzcu2zl7nn229krn2r5g7kgzpxs5xkmgs      ← 🔴 非 NULL
  payout_redeem_hex = (len 16564)
```
🔵 **回填目标表 = `payout_shards`,不是 `pool_markets`**(后者没有 `payout_ps_addr` 列)。
🔴 **旧值非 NULL** ⇒ 这是一次**改写既有值**,不是填空。脚本的 CAS(`:239` `AND payout_ps_addr IS ?`)会把这个旧值放进 WHERE,**旧值在我读到之后被别人改过 ⇒ 不命中 ⇒ 跳过不覆盖**(`:242`)。这一格是我们要的行为。

**待回填成什么**:`derived = p2sh(payout_redeem_hex)`,派生法见 `:104-105`
(`ScriptBuilder.fromScript(redeem).createPayToScriptHashScript()` → `addressFromScriptPublicKey(…, NETWORK)`)。

---

## §2 步骤(每步:确切命令 / 期望读数 / 🔴停止条件)

### S1 · 前态快照(只读,必须先做,否则 S5 无对照)
```bash
cd /d/kanet-tn12/kasia-console && node -e "const D=require('better-sqlite3');const db=new D('data/console.db',{readonly:true});
console.log(JSON.stringify(db.prepare(\"SELECT logical_market_id,payout_ps_addr,payout_ps_outpoint,covenant_family,length(payout_redeem_hex) rl FROM payout_shards WHERE logical_market_id LIKE '%j34vb%'\").all(),null,1));
console.log(JSON.stringify(db.prepare(\"SELECT id,protocol_status,settle_txid FROM pool_markets WHERE id LIKE '%j34vb%'\").all(),null,1));db.close();"
```
**期望**:与 §1 逐字一致。 🔴 **停止条件**:任何字段与 §1 不同(尤其 `payout_ps_addr` 或 `settle_txid` 已变)⇒ 停,报 Bettor——说明期间有别的写方动过它。

### S2 · dry-run(脚本默认零写入 · **不设** `PS_ADDR_BACKFILL_CONFIRMED`)
```bash
cd /d/kanet-tn12 && PS_ADDR_BACKFILL_DB=D:/kanet-tn12/kasia-console/data/console.db \
KASPA_RPC_URL=ws://127.0.0.1:17210 KASPA_NETWORK=testnet-12 \
PS_ADDR_BACKFILL_ONLY=ext-pool-v07-1783969245093-j34vb \
node scripts/backfill-payout-ps-addr.mjs
```
**期望读数**(对应 `:118` 与 `:145`):
- `[backfill] 全表 N 行 · divergent D 行 · 无法判定 U 行 · network=testnet-12`
- `[backfill] 🎯 canary 模式: 只处理 ext-pool-v07-…-j34vb —— 其余 D-1 行本次【不碰】`
- j34vb 一行的 `oldAddr` / `derived` / `chainOk`
- 结尾 `=== DRY-RUN(零写入) ===`

🔴 **停止条件(四条,任一命中即停)**:
1. **`divergent D` 与既有商定分集不符**(在册口径「分集不再是 13/9/4 就停下报」)⇒ 停。
   🔵 脚本作者把 canary 过滤器**刻意放在计数之后**(`:124-128` 注释),正是为了让这道闸在 canary 跑里**仍然读到全量**;所以这条读数是可信的,别被"只处理一个"误导。
2. **`chainOk !== true`** ⇒ 停(且脚本自己也会 fail-closed 拒写,`:232`)。含义 = 链上没有为这份 redeem 背书。
3. **`oldAddr` 不等于 §1 记录的那个值** ⇒ 停。
4. 出现 `⚠ 无法判定` 且其中包含 j34vb ⇒ 停。

### S3 · 核对 dry-run 输出与派生预期(纯人工比对,零命令)
把 S2 打印的 `derived` 与我独立算一次的 `p2sh(payout_redeem_hex)` 并排比。
🔴 **停止条件**:两者不一致 ⇒ 停(说明我或脚本有一方对派生的理解错了)。

### S4 · 实回填(**唯一的写操作** · canary 单盘)
```bash
cd /d/kanet-tn12 && PS_ADDR_BACKFILL_DB=D:/kanet-tn12/kasia-console/data/console.db \
KASPA_RPC_URL=ws://127.0.0.1:17210 KASPA_NETWORK=testnet-12 \
PS_ADDR_BACKFILL_ONLY=ext-pool-v07-1783969245093-j34vb \
PS_ADDR_BACKFILL_CONFIRMED=1 \
node scripts/backfill-payout-ps-addr.mjs
```
**期望**:`✅ …j34vb 回填并通过 gate`(`:249`),结尾 `=== 回填结果 ===`。
🔴 **停止条件**:
- `⏭ SKIP … chain_unconfirmed`(`:235`)⇒ 停,不重试、不设 `NO_CHAIN` 绕过。
- `⏭ SKIP … 乐观并发未命中`(`:243`)⇒ 停,回 S1 重新取前态。
- `🔴 …回填后 gate 仍不过 (failedStep=…)`(`:253`)⇒ **停**,该盘还有别的不自洽,**不是再回填一次能解决的**。
⚠ **绝不设** `PS_ADDR_BACKFILL_ALL=1`;**绝不设** `PS_ADDR_BACKFILL_NO_CHAIN=1`。

### S5 · 落值核实(只读,与 S1 对照)
重跑 S1 的命令。**期望**:`payout_ps_addr` == S2/S3 的 `derived`,其余字段不变,`settle_txid` 仍 NULL。
🔴 **停止条件**:除 `payout_ps_addr` 外还有字段变了 ⇒ 停。

### S6 · 结算 tick(过 K-18 coherence-gate)
🔴 **本步的确切命令我【还没写】** —— 我不打算凭印象填一条 settle 命令进钱路计划。
**请 @NWT 在审这份计划时一并指认**:驱动 j34vb 结算的正规入口是哪一个(daemon tick / 某个 export / 某条 relay 命令),以及它的 dry-run 形态是否存在。
拿到之后我把 S6 补成与 S1-S5 同规格(确切命令 + 期望 + 停止条件),**再交你们看一遍**,不直接执行。

### S7 · 上链判据(Bettor 13:30 钉死)
- `settle_txid` 在**两个独立节点**上 confirmed(@J1 跨节点核);
- relay `check_utxo_landed` = **true**;
- Bettor 链上直查。
🔴 **三者全绿之前,本盘不算结算完成**,不写任何"已完成"表述。

---

## §3 我【不做】什么(边界,写死)

- **不碰其余 divergent 盘**(canary = 恰好一个,脚本 `:139` 结构上也拒)。
- **不绕过任何闸**:不设 `ALL`、不设 `NO_CHAIN`、不手改 DB、不改脚本。
- **不在 S6 命令未确认前推进到 S6**。
- **不重试 fail-closed 的跳过** —— 那些跳过是设计意图(`:233-234`:盲改等于用改数据把 gate 的真报警消音)。

## §4 证据层级

| 陈述 | 层级 |
|---|---|
| §1 现场读数 | ✅ `[CONFIRMED·13:3xZ 只读现查]` |
| 脚本闸/CAS/fail-closed 行为 | ✅ `[CONFIRMED·现读 backfill-payout-ps-addr.mjs :46-53/:118-145/:232-253]` |
| dry-run 会打出什么 | 🔵 `[EXPECTED·从代码推,未预跑]` —— **本计划未预跑 dry-run**(它属执行第一步,归 Bettor 的④)。若你们要计划里带真实 dry-run 读数再审,说一声,我跑一次(零写入)补进来。 |
| S6 的确切入口 | 🔴 `[NOT-WRITTEN]` —— 见 S6,**要 NWT 指认** |
| 本盘会结算成功 | 🔴 `[NOT-ESTABLISHED]` —— 本文件是计划,不是结果 |

## 🔴 §5 作者状态披露(Bettor 已知并裁定不换人,NWT 按此强度审)

本班我已实名记账 **7 次同族失误**,形状全同 = **用推理替代实读**(含:让 Bettor 立了一张不该立的卡、给出过一个无效对照臂)。
Bettor 13:35 裁定**不换人**,理由是域知识在我身上且本形态(契约先行 + 逐步贴证 + 外审在环)正是对高错误率的正确工程回应。
⇒ **本计划的每一条判据都指到 file:line,不指记忆**;⇒ 请 NWT 重点打 **S2 的四条停止条件**是否真能拦住、以及 **S6 空缺**是否被我用别的步骤悄悄绕过。
