# ZK 平替 live drive 执行卡 — fresh J2 会话照此秒驱

> **用途**: interim-B ZK 平替「自动结算第一笔 live 真盘」的精确执行 runbook。
> **为何独立成卡**: 2026-06-29 凌晨 J2 在 6hr+ marathon compaction 续场·诚实 xzztw 自检 flag·Bettor 拍板「不强驱·转 fresh 会话」。
>   本卡 = 趁满上下文把每步/每 ctx 字段来源/co-verify checklist 钉死·fresh 会话照此 5 分钟秒驱·零重新推导。
> **设计源(canonical·勿重复内容)**: `docs/2026-06-29-settler-daemon-design.md`。本卡只是它的**执行 runbook**·非另一份设计。
> **代码源(真相·勿凭记忆)**: `kasia-console/src/services/bshard-auto-settler.mjs`(行号下引)·`kasia-console/src/lib/pool-bettor-sides-query.mjs`(getMarketBets)。
> **proven 参照**: qi37q 手驱 e2e(close 30e69fdc + claim e81b6ef8·winner 1d732134 实领 10KAS·5源验)。close-drive playbook 见记忆 `project-interim-b-qi37q-reproducible-e2e-and-close-drive-playbook`。

---

## 0. PRE-FLIGHT(fresh 会话先做·不碰链)

1. **会话自检(xzztw 铁律)**: 确认是 fresh 会话·非疲劳续场。带病碰不可逆结算 = 重演 xzztw。不确定就停。
2. **代码新鲜度**(防 stale 假阴性):
   ```
   node scripts/check-tree-fresh.mjs           # 落后 canonical 警告
   node scripts/grep-canonical.mjs "export async function settleMarketLive" kasia-console/src/services/bshard-auto-settler.mjs
   ```
   确认 auto-settler 在 canonical(`origin/bshard-m3-deploy`)未被改动。若本地领先有未推 commit → 先 push(check-tree-fresh 会提示 preserve-check)。
3. **§0 prerequisite 已载**: 跑着的 relay 须含 `unSafeJson: un.serializeToSafeJSON()`(canonical 4c498e88·p2sh.mjs close_attest+cancel_attest build-preimage)。若 relay 未重启加载 → cross-node 委员 `sign_input_for_settle{safe_json:true}` 签不出 byte-exact。验: build 返回须有 `buildRes.unSafeJson`(auto-settler L155 硬 gate)。
4. **co-verify 槽确认**: Bettor + J1 在线接 co-verify(read-only)。落链一笔报 txid·他们立即独立链读重算。无 co-verify 槽别驱(单源不算 5源验)。

---

## 1. STEP 0 — seeder 协调 + 停(防 commingle)

**为何**: AutoBetter seeder(commit f5bb64c6·relay **ecb15318**)给每个新盘自动按 v06/logical 押注 → commingle 污染 → auto-settler 的 cleanliness 闸(L63-66)会 **跳过挂 alert** 不结算(防 strand logical bet)。∴ 必须建盘前停 seeder·保证纯 shard。

1. **跟 KANet-UI 错时窗**(铁律·别 unilateral yank): 停 seeder 会动 UI 首页「热门单子」展示数据。先频道问 KANet-UI 当前是否在 seeder-data-dependent 的真机验中。当前(2026-06-29)UI 在改 bot /start button 流转(不依赖 seeder 数据)→ 大概率可停·但**先对齐**。
2. **停 seeder**: AutoBetter 由 relay ecb15318 跑。停法 = 通过 Console 停该 relay 的 AutoBetter task / 或停 market-seeder。**驱前查实际停法**(grep `AutoBetter`/`market-seeder` 看 supervisor·别凭记忆)·停后 verify 无新 v06 押注涌入。
3. drive 完可恢复 seeder。

---

## 2. STEP 1 — 建 fresh 干净 bshard 盘(register-v07)

**目标**: 纯 shard·零 commingle·几注真押注(非 seeder)。

1. **register-v07** 建盘(bshard 协议·`protocol_version` 以 `v0.7` 开头)。参数: maker_pk / broker_pk / predicate(winner==ARG 类·judgeLine 可判) / deadline_daa(给够窗·committee endBlockHash 锚此) / maker seed(open_new 空 genesis ShardLeaf·count=0)。
   - 建盘 = 链上写 = **driver/J2 域**(Bettor 永不碰链·见铁律记忆)。
2. **几注真押注**(非 seeder): 用 register-v07 路(按 shard_market_id 键存·非 v06 logical)。2-3 注·分 YES/NO 制造有赢有输(测 payout 分配)。
3. **验干净**(getMarketBets·shard-aware):
   ```js
   const { bets, betCount, poolSompi, isBshard, multiShard } = getMarketBets(logicalMarketId, db);
   // 必: isBshard===true · multiShard===0(单片) · betCount===你押的注数 · logical 键 0 bet
   const logicalBets = db.prepare('SELECT COUNT(*) c FROM pool_bettor_sides WHERE market_id = ?').get(logicalMarketId).c;
   // 必: logicalBets === 0(否则 commingled → cleanliness 闸会跳过)
   ```
   `betCount`/`logicalBets` 不对 → seeder 没停干净或押错路·别往下。

---

## 3. STEP 2 — 装配 ctx(每字段来源·绑实际代码)

`bshard-auto-settler.mjs` ctx 契约(L31-42 + L131-132 注 + 代码实读)。**每字段来源钉死**:

| ctx 字段 | 类型/返回 | 来源 / 装配法 | 代码引用 |
|---|---|---|---|
| `db` | better-sqlite3 | Console DB `data/console.db`(只读够·无 lease) | L51 |
| `relayPost(relayId, cmd)` | →result | POST `:3200/api/relay/:id/send-command`(relay IPC) | L151,170,182,205 |
| `getUtxos(address)` | →entries | chain `getUtxosByAddresses`(NO TX NO STATE 验) | L219 |
| `judgeWinDir(market, bets)` | →0\|1 | **judgeLine(predicate, ESPN)·非 DB outcome_side**(命门·L12 注实证 outcome_side=1 但 winDir=0) | L69 |
| `endBlockHash(deadlineDaa)` | →hash | fetchEndBlockHashCanonical(committee seed·跨节点确定性) | L79 |
| `poolMembers(poolMerkleRoot, deadlineDaa)` | →[{pk_hex,stake_sompi}] | oracle pool members·**必 pin deadline_daa snapshot**(stakes 随时间变·同 root 多 snapshot 不同 stake→selectCommittee flaky·L80-81 注) | L82 |
| `feeRelay` | {id,address} | 专用 fee relay(防 churn·SIGHASH_ALL 含 fee input body) | L151,182,205 |
| `feeUtxo()` | →{address,outpointTxid,index} | fee relay 的 UTXO·**amount 取 `e.entry.amount` 非 `e.utxoEntry.amount`**(今晚撞) | L146,208 |
| `psState(marketId)` | →{outpointTxid,index,redeem_hex,consolidatedPool,poolMerkleRoot,predicateCommit} | consolidated PayoutShard 链上态(须先 consolidate·见下) | L141,195 |
| `pkToRelay(pk_hex)` | →relayId | committee pk → 控制它的 relay id(签名用·uncontrollable→skip 需 ≥4) | L167 |
| `p2shAddr(redeem)` | →address | kaspa-wasm p2sh 派生(predict-then-verify 应锚地址) | L103 |
| `p2pkAddr(pk)` | →address | winner P2PK 地址 | L201 |
| `p2pkSpk(addr)` | →hex | round-trip 验·**比 `'20'+pk+'ac'` 串·别 Buffer.from 双编码**(今晚撞·L202-203) | L202 |
| `psSeedSompi` | int | PS_SEED(默认 20000000·consolidatedPool = poolSompi + PS_SEED·L101) | L101 |
| `dryRun` | bool | true = 计算+enforce·零 submit | L138 |
| `alert(marketId, reason)` | void | 挂起 alert(失败不乱结) | 多处 |

**consolidate 前置**(L140-142): minimal settler 假定 PS 已 consolidate(ShardLeaf→PayoutShard)。fresh 盘须先 consolidate(J1 helper `j1-consolidate-autosplice` 41b90ac9·传 `{base_redeem_hex, current_leaf_state}` relay 派生当前 SL 地址)。`psState` 取 consolidate 后的链上 outpoint+redeem。

---

## 4. STEP 3 — computeSettlePlan(纯计算·无链·先 co-verify)

```js
import { computeSettlePlan } from 'kasia-console/src/services/bshard-auto-settler.mjs';
const plan = await computeSettlePlan(logicalMarketId, ctx);
```
**验 plan(L106-111 返回)**:
- `plan.ok===true`·`isBshard`·`betCount` 对·`multiShard===0`。
- `winDir` ∈ {0,1}(judgeLine·非 outcome_side)。
- `payoutRoot`(driver re-derive·命门)·`winners`[{pk,amount}]。
- `committee`(asc 5 pk)·`committeePkHash`(blake2b(c0..c4 ascending)·L88-89)·`committeeMeta`(每 pk 的 idx+8 siblings·L91-95)。
- `expectedClosedAddr`(= pzmm5hg7 类 predict·driver enforce 应锚地址·L97-104)。
- `degenerate`/`commingled` 必为 falsy(否则闸拦)。

**🔴 co-verify 槽 #1(plan 阶段·链下)**: 把 `payoutRoot` + `expectedClosedAddr` + `committee` 发频道·Bettor **独立重算 payoutRoot byte-equal**(不信脚本·自己从 bets 算)·确认对死再往下。**determinism 自检**: 同 ctx 跑 computeSettlePlan 3× → committeePkHash/payoutRoot 逐次相同(deadline-pin 后确定性·qi37q 验过)。

---

## 5. STEP 4 — settleMarketLive DRY-RUN(无 submit)

```js
const r = await settleMarketLive(logicalMarketId, { ...ctx, dryRun: true });
// L138: dryRun → 返 {ok:true, dryRun:true, plan}·零链动
```
确认 plan 全绿。dryRun 不 build/不签/不 submit(L138 early return)。

---

## 6. STEP 5 — LIVE close_attest(动钱·命门硬闸保护)

`settleMarketLive(marketId, {...ctx, dryRun:false})` 自动跑(L135-191)。流程+闸:
1. **BUILD**(L151-155): `bshard_close_attest` witness `committee:[]` → 返 preimage + `unSafeJson`。无 unSafeJson → §0 未载·停。
2. **🔴 driver enforce 硬闸**(L157-161·命门·NO submit if mismatch): `buildRes.psContAddress === plan.expectedClosedAddr`? 不等 → alert + **return 不 submit**。这是烤死锚·不依赖你清醒度·疲劳也拦得住乱结。
3. **SIGN**(L164-174): 每 committeeMeta·`pkToRelay` 找 relay·`sign_input_for_settle{tx_hex:unSafeJson, input_index:0, safe_json:true}`·收 132-hex sig。< QUORUM(4) → alert 停。
4. **ASSEMBLE**(L176-179): committee[5](asc·sig 或 dummy 66B `COMMITTEE_DUMMY_SIG`)·**自核 committee_pk_hash == plan**(L178-179)·不等停。
5. **SUBMIT**(L182-187): `bshard_close_attest` witness 含 committee[5] → txId。
6. **🔴 NO TX NO STATE**(L189-191): `verifyClosedLanded` 查 closed PS @ expectedClosedAddr·outpoint==closeTxid·value==consolidatedPool。未 LANDED → 不推进。

**🔴 co-verify 槽 #2(close 落链后)**: 报 `closeTxid` + `payoutRoot` 频道:
- **Bettor**: close_attest 解码 → p2sh 逐字节对死(closed=1,payoutRoot) + 独立重算 payoutRoot。
- **J1**: `:3300 getUtxosByAddresses`(.106 节点)逐项链验 + 自 builder 三方对死 + `closed addr == compilePayoutShardRedeem 派生`(predict-then-verify)。

---

## 7. STEP 6 — CLAIM winners(merkle 授权·NO-SIG)

auto-settler 自动跑(L193-212)。每 winner:
- **depth-10 merkle proof**(`winnerClaimData` L117-126·`merkle_index < 1024`·s0..s9·**非 depth-8**·handler 注释 s0..s7 是 STALE)。`climbOk` 必 true。
- **winner P2PK round-trip 验**(L202-203·防 hex 双编码): `p2pkSpk(addr) === '20'+pk+'ac'`(串比·别 Buffer.from)。
- `bshard_payout_claim` witness(self_out_idx:1, payout_out_idx:0, bettor_pk, payout, merkle_index, siblings_hex)·inputs.payoutshard 用 closedRedeem(closed=1)·outputs.payout→winnerAddr。
- 返 `claims`[{pk,amount,txId,error}]。

**🔴 co-verify 槽 #3(claim 落链后)**: 报 claim txid 频道。Bettor: **claim merkle-binding**(claim 的 blake2b(pk‖payout) proof against root 必成立才 LAND → claim landed = 链共识自证 attested root·最强确认)。J1: winner 实收链验。

---

## 8. 诚实口径(守死·勿越级宣称)

- **driver-side prevention**: 委员 blind-sign·4 driver 交叉 re-derive payoutRoot 对死防恶意。**非 distributed-committee enforce·非 production-trustless**。
- Outcome = trust-minimized / Payout = trustless covenant-checked。**永不宣 production-trustless**。
- 报 Owner 用陈述句·不给菜单(铁律 `feedback-never-menu-owner-not-at-terminal`)。

## 9. 已知陷阱(全绑代码·别重撞)

| 陷阱 | 正解 | 代码/记忆 |
|---|---|---|
| claim depth | **depth-10**(s0..s9·merkle_index<1024)·handler 注释 s0..s7 STALE | L117-126 / PayoutShard.sil L174 |
| fee UTXO amount | `e.entry.amount` 非 `e.utxoEntry.amount` | L146,208 |
| committee_pk_hash | build witness 必含(否则 handler `Buffer.from(undefined)` 崩) | L148 baseWitness |
| committee 序 | **ascending**(asc sort·blake2b 序 = witness slot 序) | L88,177 |
| 缺席委员槽 | **zero-length dummy 66B**(`41`+64×`00`+`01`)·非 64B 全零(OP_CHECKSIG invalid) | L27 |
| committee determinism | poolMembers **pin deadline_daa snapshot**(非 at-close·非 LIKE prefix) | L80-82 |
| winDir | judgeLine·**非 DB outcome_side** | L69 |
| §0 unSafeJson | relay 须载 4c498e88·否则 cross-node 签不出 safe_json | L155 gate |
| shard-blind | getMarketBets shard-aware·**非裸读 logical pool_bettor_sides** | L56 |
| commingled | cleanliness 闸 logical>0 → 跳过挂 alert(别 shard-only strand) | L63-66 |
| fee-churn | committee sig SIGHASH_ALL 含 fee input body·长 poll churn 清旧 sig → 短窗重签·pin fee UTXO | playbook 记忆 |

## 10. 失败处理(NO TX NO STATE)

- enforce mismatch(L158) → **NO submit**·alert·停。最强保护·疲劳也拦。
- < 4-of-5 sig(L174) → 停。
- committee_pk_hash 自核失败(L179) → 停。
- close 未 LANDED(L191) → 不 claim·alert。
- claim climb/round-trip fail(L200,203) → skip 该 winner·alert·不乱发。
- 任何"链上没确认"→ 本地状态不推进。乐观写入 = 致命。
