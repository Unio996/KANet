# ZK 结算 实施方案 — 换掉脆性 covenant 地基（Owner 2026-06-28 钦定·细化自 6-23 spike）

**目标**：把发钱算术（pari-mutuel payout）从脆性 SilverScript covenant（链上逐字节抠 21 条 require）搬进 **RISC0 ZK 电路**，链上只验**一个证明**。今天这一整类脆性（sighash / dup-address / NUM2BIN / 槽位）一次性消失。
**基底（查资产·不重造）**：设计 = KB `architecture/zk-track-c-verified-trustless-settle.md`；spike+港计划 = `docs/2026-06-23-track-c-zk-spike-plan.md`（S1-S4 + #953 port STEP A-D）。本文 = 把它细化成可执行阶段 + owner + 闸。
**铁律**：每阶段 probe-not-model（实测不估计）；不 rebuild live 节点（zk-sdk 同 vendored kaspa-wasm 单独编）；NO TX NO TRUTH（真 tx LAND 才算过）。

---

## P0 — port 上游 zk-sdk builder（de-risk·头号不确定性·先答）
现状：我们 fork **有 verifier**（OpZkPrecompile 0xa6 active on TN12 实证）**没 builder**（#953 zk-sdk 没 cherry-pick）。silverc 无 zk builtin → 发不出 0xa6。
- **A**：取上游 `crypto/txscript/zk-sdk/`（kaspanet:master PR #953）源。
- **B（🟠 GATING·必先答·别假装 trivial）**：上游 zk-sdk 产的脚本格式 == 我们 fork verifier 期望？逐项核 Groth16 stack（VK/proof/count/inputs 顺序+压缩）+ R0 stack（hashfn/control_id/image_id/journal/seal/digests 顺序）+ 版本（risc0 3.0.4/4.0.4 两边对上）。**diverge → port 不成立**（对齐版本或自建）。
- **C**：`wasm-pack` 单独编 zk-sdk WASM 包，不碰节点二进制。
- **闸**：B 不过 → 停报 Owner（port 路死，评估自建/等上游）。owner=**J1**（最熟 verifier 版本+格式）。

## P1 — 最小链上闭环（trivial proof 在 TN12 LAND）
- 写最 trivial RISC0 guest（输出常量 journal）→ ported zk-sdk 构造脚本 → **TN12 广播 tx → 链上 LAND**（OpZkPrecompile accept）+ 实测真实 script-units（对照声明 140k/250k）。
- **闸**：tx 不 LAND → 停报（工具链端到端没通，后面免谈）。owner=**J1 建脚本 + J2/Bettor 验 LAND**。

## P2 — 结算 guest 电路（逻辑正确性在这·正常 Rust 可穷举测）
- guest = 现有 `pool-shard-settle.mjs` 纯函数（`computePariMutuelPayout` + `deriveFeeLeaves` + `settlePayoutRoot`）移植成 RISC0 guest（Rust）。
- **journal 公开输出**（命门·必绑链上真相）：`inputs_commit`（押注集 merkle 根==covenant 已 commit）/ `verdict`（预言机判决）/ `fee_rules_commit`（==genesis 烤的 feeRules）/ `payout_root`（算出的根·被证明锚死）。
- RISC0 **压成 Groth16** 上链便宜验（140k<250k，zk-sdk `commit_to_groth16`）。
- **回归闸**：Rust guest 算的 payoutRoot **== 现 JS settle byte-equal**（x4kpq 重算对死）·否则白证。owner=**J1（guest 移植）+ Bettor（byte-equal 对死）**。

## P3 — ZK-settle covenant（脆性消失的那一步）
- 新 settle covenant：OpZkPrecompile 验 seal → 校 `journal.image_id`==钉死的结算程序 → 校 `journal.inputs_commit/verdict/fee_rules_commit`==链上对应 commit → 取 `journal.payout_root` 作分发根。
- **21 条脆性 require → 1 个证明 + 几个 journal-绑定**。零委员签名、零 settler 自由度。
- **命门（NWT 红队死盯）**：`journal.inputs_commit` 必绑链上真相·covenant 校验时**必读得到那个 commit**·否则 vacuous（verify-value-source 的 ZK 版·正是今天那个递归洞的 ZK 形态）。owner=**J1（covenant）+ NWT（红队 vacuous/input-commit 漏）**。

## P4 — settler 集成 + live e2e
- settler 生成证明（RISC0 prove → Groth16 compress）→ 建 settle TX（proof+covenant）。
- TN12 live e2e：建盘 → settle 走 ZK → **链上 LAND**。J1 跨节点同证 + NWT 红队端到端 + Bettor 验落链。
- owner=**J2（settler 集成+prove 接入）**·验=J1/NWT/Bettor。

---

## 闸序（probe-not-model·每个是 yes/no·失败即停报）
1. **P0-B 格式对得上？**（最大不确定性·先答·0 链上动作）
2. **P1 trivial proof LAND on TN12？**（工具链端到端铁证）
3. **P2 guest payoutRoot == JS byte-equal？**（移植无漂移）
4. **P4 ZK-settle live LAND + 红队过 + 双节点同证？**（地基换成）

## owner 分工
| 阶段 | owner | 验 |
|---|---|---|
| P0 port + 格式闸 | J1 | NWT（格式核） |
| P1 链上 trivial | J1 | J2/Bettor（LAND） |
| P2 结算电路 | J1 | Bettor（byte-equal） |
| P3 ZK covenant | J1 | NWT（vacuous 红队） |
| P4 settler+e2e | J2 | J1/NWT/Bettor |
协调/验落链/byte-equal 对死 = Bettor。架构方向终裁 = Owner。

## 工期诚实
周级（port + guest + covenant + 集成），非天级。但**换掉脆性地基**——值。P0-B 一周内能给 yes/no（最大风险先消）。
