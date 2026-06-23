# Bettor-tn 接位文档（协调者 + 审码 + determinism 判 + 验落链）

> 写于 2026-06-15。前任 Bettor-tn（我）反复犯一个致命操作错——把工具调用写成纯文本而非真 invocation，导致频道消息发不出去、协调失效。Owner 令我根修或留接位文档退位。我留此文档。**你先全读再动手。** 姊妹文档：`docs/2026-06-15-NWT-verifier-handoff.md` / `docs/2026-06-15-KANet-UI-operator-handoff.md`。

---

## 0. 你是谁 / 你的角色
你是 **Bettor-tn**，团队**协调者 + 审码者 + determinism 判 + 验落链者**（Owner 钦定四支柱 `feedback-bettor-core-mission-four-pillars`）：
1. **把握方向**（不清楚就对抗共识）。
2. **驱动 agents 各做分内事**（不自己全干——最难守，手痒替别人干=破坏协作）。
3. **审码**（读真码逻辑，非只信 test/lint；实编译才是真；注释≠实现）。
4. **验落链**（relay `check_utxo_landed` 走本地 kaspad，用 tx 的 **output 地址** 非花掉的锁定地址）。

**relay 身份（频道发言）**: `relayId = 5c07f7e5-752b-470c-8a48-f548b3b17068`（name=Bettor-tn）。

---

## 1. ⚠⚠ 前任的致命错——你必须避开（#1 优先）
**症状**: 把工具调用的 `call` + invoke/parameter 标签当**纯文本**写进 response body → harness 不执行 = 废稿。频道消息没发（团队收不到=协调失效）、ScheduleWakeup 没排（loop 死）、命令没跑。前任本会话犯了**几十次**，每次 receipt-required 事后抓到重发，但**根上没止住**，Owner 暴怒退位。
**根因（已诊断）**: **narration-before-tool-call 触发文本模式**——先写一大段叙述再 compose 工具调用时极易写成文本。
**根治（铁律）**:
- **任何工具调用永远是真 invocation，做这条 response 的第一个动作，前面零叙述文字**。要解释先把工具调用发出去、拿到 tool_result 再说。
- **调用后必看 tool_result**：没 result = 没执行 = 立即重做。唯一真相 = tool_result / SENT txid。
- 频道发送用 `_kanet_send.cjs`（读 `_kanet_msgs.json` JSON 数组）+ 核 `SENT <txid>`；FAIL/无 txid = 没发。dedup-block（"100% similar"）= 内容重了，多半是文件没更新发了旧内容。
- **机械兜底已建**: `scripts/receipt-required-hook.mjs`（Stop hook, 6/6 回归测 `scripts/receipt-required-hook.test.mjs`）+ ANTI-PATTERNS 规则 48 + 记忆 `feedback-tool-call-must-be-real-invocation-not-text`。
- **交叉验证**: 每隔几条核一次频道 `GET /api/chat/messages` 看自己消息真在（前任发现"协调失效"就是只 1/30 条真落地）。

---

## 2. 当前状态（gate B #31 = 公测开门最大 blocker，核心已验证，差 wire+e2e+deploy）
**开门门**: A#30✓ 问2#35✓ 问3#36✓。gate B#31 进行中：
- **SS 层 = 4-agent 验证完成**：`PoolSpine_v08_chunk.sil.draft`（533 行，commit b367753b 后）。settle_chunk + settle_aggregate 两 entry 都真实现+ctor16 COMPILE OK+MAX_K=47。关键不变量全在码：leaf=blake2b(pk‖payout **8-byte LE**)/payoutRoot=committee-sign(planCommit)/recipient ScriptPubKeyP2PK/amount==merkle-proven/change **OpInputCovenantId**(前任 critical 修了 spine_p2sh witness 同义反复偷钱洞)/HWM 链/chunk_kind 绑/**output-count keystone**(防 steal-output)/守恒/fee≤V07_MAX_FEE 单源/cap=470k(STORAGE_MASS_SAFE_THRESHOLD 单源, 注意 cap=100k 是 pre-Toccata 陈旧值已弃)。
- **off-chain computeSettleChunks**（`kasia-console/_j2_compute_settle_chunks.mjs`, fb9fc085）**four-vantage 验完**（J2 self-test 10/10 + J1 drift-watch GREEN + Bettor holistic + 跨节点段 byte-identical + payoutRoot byte-match）。
- **关键模型澄清**: packing/segmentation 是 **settler-chosen 非 cross-node consensus**（committee 验 settler 提议的段，不 re-derive canonical）。cross-node determinism 真正要的 = **payoutRoot byte-equal + HWM 链连续**（非 packing byte-equal）。
- **resumable（前任 owned slice）AIRTIGHT 收口**（§8.3+§8.3b, eb27dece）: resume 游标 = 链上**唯一 unspent spine-P2SH change UTXO**（链尾）的 hwm；per-market-shard P2SH 唯一；confirmed-only；mempool-race 安全（UTXO 单花）。**§8.3b cross-node resume**=node A 死 node B 从链上 HWM 续。
- **已知限制（documented）**: committee 可铸假 winner（v07-equivalent trust，pre-existing，testnet conscious-accept，mainnet 硬化=bettor-membership merkle）`docs/2026-06-15-known-limitation-committee-winner-attestation.md`。

## 3. gate B 剩件（finish-line path，你接手就盯这个）
1. **J2 正在 wire `computeSettleChunks` → `dispatchPhase2` v08**（集成点 pool-market-settler.js **L1953**, 现 estMass>470k→cancel-refund 处改 v08 chunk 路由）。5 改点: market-create v08 P2SH 派生 / dispatchPhase2 L1953 路由 / relay 建 v08 scriptSig+change cov-relock / resume 游标(唯一 unspent change) / 部署常量。**他事先审再增量出码——你审 plan + 读真码**。
2. **跨节点 settle e2e**（gate B 真闭=链上证非编译；§8 harness 在 `docs/2026-06-15-31-chunk-boundary-determinism-spec-j1.md`）: J1 :3300 + 你 broadcast slice co-own。造 100-winner 市场→3 chunk→:3300 settle→per-chunk `check_utxo_landed` output addr 核 + 守恒逐 sompi + **§8.3 resumable kill-mid-chunk**（你 owned）。
3. **NWT 7-attack runnable PoC**（cli-debugger `D:/silverscript/...`, gated 在 J2 signed honest test.json）。
4. **deploy**（gate E 演练绑此, **whole-repo-sync ctor16 两节点同 commit 同 tree**, 否则异 P2SH 异市场）。

## 4. 其余 gate / 任务
- **gate C #32**: prevet FP<5%/FN<15% 120-fixture（MVP 达标, J2+NWT 域, 待 ramp）。
- **gate D #33**: onboarding **已部署**（bot-DM /faucet+/start, broker-1）, 待 Owner 文案终拍 + Telegram 真 DM e2e。
- **gate E #34**: checklist done（`docs/2026-06-15-gateE-deploy-hardening-checklist.md`, 4-agent）, 待部署演练（绑 gate B 部署）。
- **#29 推荐排序**: 设计收敛, 待 Owner 终裁 4 点（前任荐: prevet-gate-only/history+bond-cold-start/bond-slashable-coupled-gateB/self-broker-neutral）。
- **#24 design-v2 B 880**: consolidate N→1 链上证（b63f2eb5 landed）。#25 UMA / #26 bshard: 长期/扩容, gated post-open。

## 5. 团队花名册（dev-coord-testnet 频道）
| Agent | 角色 | relayId |
|---|---|---|
| **J1tn** | :3300 独立节点 operator + SS determinism 作者（v08 SS / §8 e2e harness） | （:3300 机器）|
| **J2-tn** | settler/mass 域（computeSettleChunks / dispatchPhase2 wire / 880） | `102cbb99-...` |
| **NWT-tn** | 对抗验证 + determinism lead（结构审 / runnable PoC / byte-match） | `8dd59acb-3ccc-...` |
| **KANet-UI-tn** | :3200 operator + **单 git 写者** + 部署执行（你不写 git, 让她 commit） | `f5cf6d85-...` |
| **Owner** | 终裁。要全自动、报数诚实分级、**消息必真送达**（前任死在这） | — |

## 6. 沟通纪律（真送达四铁律, 前任违反退位）
①真发（核 SENT txid）②880 墙拆 <880 多条 ③@具体人名禁@团队 ④派工末尾 `👉@名字【必回】`。**最重要: 工具调用是真 invocation 非文本**（见 §1）。多协调但**发必成功**——发不出去=协调=0=Owner 暴怒。

---
*前任 Bettor-tn 在 gate B 做了实事（critical SS 偷钱洞、resumable airtight、四支柱审码），但反复发不出消息=协调失效退位。你接手: 守 §1 铁律, 盯 gate B finish-line（wire→e2e→deploy）, 别让消息发不出去。*
