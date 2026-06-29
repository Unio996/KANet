# Track C (ZK-验证 trustless 结算) — Spike 方案

**作者**: Bettor (架构) · **日期**: 2026-06-23 · **状态**: 草案, 待对抗讨论结论 + Owner 拍
**配**: KB `architecture/zk-track-c-verified-trustless-settle.md`(能力坐实) · 仓库 Track B 系列 · memory `project-bshard-enforce-driver-side-not-production-trustless-two-track`

> **定位**: 这是一个**探针 spike**（验真+破不确定性），不是落码工程。目标=用最小代价回答"Track C 能不能做、卡在哪"，把不确定性逐个变成事实。**不抢 Track B 收口的人**（可并行/接力后）。每步**probe-not-model**: 凭实测不凭估计。

---

## 0. 为什么做（2026-06-23 对抗讨论已收敛, 修正 v1 草稿定位）
**⚠ 定位修正**: 本 spike v1 草稿写 "真 trustless 唯有 ZK"——**over-claim, 已被 5-vantage 对抗讨论推翻**。ZK **只闭层2(payout 算术)**, 闭不了层1(outcome 谁赢=oracle 问题, capability 限)。∴ Track C **不是 trustless 银弹, 是层2 增强**: ①把 payout 算术从"委员背书"换成"证明"②突破 SIZE 墙→无限 N③隐私。
**它仍值得做**, 因为: 层2 当前靠"委员小 N 验 + 经济层 fraud-proof"(optimistic), ZK 给层2 **无 trust 假设的数学闭合 + 无限规模 + 隐私**——是层2 的最强形态。但**层1(outcome)永远需 oracle**, Track C 替代不了。**并行的真 production 缺口 = 经济层**(fraud-proof+slashing+挑战窗, 见 KB anchor §3), 那个不需要等 6.30、基于现有 C1/C2/D2 链锚即可建——优先级可能高于 ZK。6.30 主网 ZK 上线 = Track C 的时间窗。

## 1. Spike 分层(每层一个 yes/no, 失败即停报)
**S1 — 激活坐实(0 代码, 最便宜先做)**
- 直接验运行节点: 启动日志找 toccata/zk activation; 或构造一个最小含 OpZkPrecompile(0xa6) 的脚本试发, 看节点 accept/reject + 错误码。
- 同步验 TN10(Toccata 已激活 @DAA 467M)作备选试验台: 我们基础设施能否连 TN10。
- **产出**: "ZK 在哪个网现在可测" 的事实。**失败(都没激活)→ spike 停, 等 6.30 主网 / 等 TN12 接 toccata**。

**S2 — silverc 发 0xa6(工具链缺口)**
- 现状: silverscript 无 zk builtin(实查零命中)。两条路: (a) 给 silverc 加一个 `OpZkPrecompile` builtin/intrinsic; (b) 若 silverscript 支持 raw-opcode/inline 逃逸, 手工嵌 0xa6。
- 先查 silverscript 有无 raw-opcode 机制(compile.rs); 无则评估给 silverc 加 builtin 的代价(J1 域: 他最熟 silverc codegen)。
- **产出**: "能否从 .sil 发 ZK 验证" + 代价。

**S3 — 链上验一个 trivial RISC0 receipt(最小闭环)**
- 写一个最 trivial 的 RISC0 guest(e.g. 输出常量 journal), 链下 prove 出 receipt, 构造 tx 调 OpZkPrecompile(tag=R0Succinct + image_id + journal + seal + control proof), **链上验它 LAND**。
- 这是"NO TX NO TRUTH": 不是单测过, 是真 tx 在真节点 LAND。同时实测真实 script-units 成本(probe-not-model, 对照 tags.rs 声明的 250k)。
- **产出**: ZK 验证在 KANet 工具链端到端跑通的链上铁证 + 真实成本。

**S4 — 设计"结算 = RISC0 guest"(架构, 我主笔)**
- guest 程序 = 现有 `pool-shard-settle.mjs` 的纯函数逻辑(computePariMutuelPayout + deriveFeeLeaves + settlePayoutRoot)移植成 RISC0 guest(Rust)。
- **journal(公开输出)设计 = 命门, 必绑链上真相**:
  - `inputs_commit`: 押注集 merkle 根(== covenant state 里已 commit 的 bets root) ← 防 prover 喂假押注
  - `verdict`: 预言机判决(== 预言机 attested 值) ← ZK 不证外部事实, 这里仍需预言机
  - `fee_rules_commit`: == genesis 烤的 feeRules(命门④) ← 防改分成
  - `payout_root`: 算出的 payoutRoot(被证明锚死)
- covenant 逻辑: OpZkPrecompile 验 seal → 校 journal.image_id == 钉死的结算程序 → 校 journal.inputs_commit/verdict/fee_rules_commit == 链上对应 commit → 取 journal.payout_root 作分发根。**零委员签名, 零 settler 自由度**。
- **产出**: Track C 结算合约 + guest 的设计 spec(待全 vantage 对抗硬化, 像 6-21 那场)。

## 2. 与现有架构的关系(替代什么/保留什么)
- **替代**: Track B 委员"重算 payoutRoot + 签名背书"整条 → ZK 证明。命门③(winningSide 仍来自预言机, 进 journal.verdict) / ④(fee 仍 journal 绑) / C1-C3(押注完整性进 journal.inputs_commit) 全部从"委员 check"变"证明锚死"。
- **保留**: 预言机判决(外部事实, 不可替代); covenant 链锚 commit(predicate/feeRules/bets root, ZK journal 要对它们校验)。
- **可能坍缩**: 分片/fold/聚合/逐张 ticket C1——若一个 RISC0 证明能覆盖任意规模押注集, 大量为绕 SIZE 墙搭的脚手架可拆。**待 S3 实测成本 + S4 设计确认 guest 能吃大输入集**(prover 侧无 SIZE 墙, 但 journal/输入编码 + 链上校验成本要 probe)。

## 3. 诚实风险(spike 可能证伪的)
- ZK 在 TN12 没激活 → S1 即停(等主网/TN10)。
- silverc 加 builtin 代价过大 → S2 卡, 评估手汇编或等上游。
- RISC0 prover 重(分钟级 + 资源) → 结算延迟/成本要进 UX 设计。
- guest 移植引入 determinism 漂移(Rust guest vs JS settle 必 byte-equal payoutRoot, 否则白证) → S4 必带回归(同 x4kpq 重算对死)。
- **input-commit 绑定漏 = 递归洞**(journal 说锚了但 covenant 校验取不到那个 commit = vacuous, 正是 verify-value-source 那个坑的 ZK 版) → S4 对抗硬化必盯。

## 4. 路径
对抗讨论结论 → Owner 拍做不做 → S1(激活坐实, 0 代码) → S2/S3(工具链+最小闭环) → S4(结算设计 spec)→ 全 vantage 对抗硬化 → 落码。**主线仍是 Track B 收口(A(b)); Track C spike 并行/接力后, 不抢人。**

---

## 5. PR #953 "Zk sdk" 评估 + port 计划(2026-06-24·Owner 派深查·源码实证)

### 5.1 深查结论(D:/rusty-kaspa 源码 + WebFetch PR #953)
- ✅ **verifier 在我们 fork**: `crypto/txscript/src/zk_precompiles/`(OpZkPrecompile 0xa6 @ opcodes/mod.rs:891, gated `covenants_enabled`; tags.rs: Groth16=0x20 cost 140k SU / R0Succinct=0x21 cost 250k SU; risc0-zkp =3.0.4 / circuit-recursion =4.0.4; Poseidon2-only)。本会话已证 TN12 链上 active。
- 🔴 **PR #953 的 zk-sdk(builder)NOT 在我们 fork**: `crypto/txscript/zk-sdk/` 目录不存在, git --all 无 zk-sdk/#953/R0Script commit。我们 covenant fork(1.1.1-toc.1)cherry-pick 了 Toccata verifier+激活(#1044-1046)但没拿 builder crate。
- **#953 给的**: `R0ScriptBuilder`(RISC0 proof → Kaspa 锁定脚本, lock-then-spend/P2SH, **绕过 silverc**)+ WASM 绑定(JS/TS, 可从 Node 栈调)+ Groth16+Succinct fragments。API: `R0ScriptBuilder.commitToGroth16(imageId).finalizeWith...Proof(...)` → {sigScript, redeemScript}。**这正是本 spike 的 S2 缺口(silverc 无 zk builtin)的上游解药。**

### 5.2 成本/架构 refinement(改 S4)
- Groth16 **140k** SU(~3/block)< R0Succinct **250k**(~2/block)。**且 RISC0 可压缩成 Groth16**(zk-sdk commit_to_groth16)→ **guest 用 Rust 写(RISC0 易写任意结算逻辑), 压成 Groth16 上链便宜验** = 两全。S4 结算 guest 目标改 Groth16-compressed。
- post-Toccata 限放宽: max script element 520→**10000** bytes / max ops 201→300 / sig script →12000(proof 装得下)。

### 5.3 S2 改: 从"自建"→"port 上游 zk-sdk WASM"(de-risk)
**先例**: 我们 vendored 过 kaspa-wasm(`shared/vendor/kaspa-wasm`)= 单独编 WASM crate + vendor, **不碰 live 节点二进制**(守 CLAUDE.md 铁律)。zk-sdk 同模式。

**port 步骤(每步 probe-not-model)**:
- **STEP A**: 从 kaspanet:master 取 zk-sdk crate 源(`crypto/txscript/zk-sdk/`, PR #953)。
- **STEP B(🟠 GATING probe·必先答·别假装 trivial)**: **上游 zk-sdk 产的脚本格式 == 我们 fork verifier 期望的格式?** 首信号正面(tag 0x20/0x21 + cost 140k/250k 两边一致)。但**全编码必逐项核**(Groth16 stack: VK/proof/count/inputs 顺序+压缩格式; R0 stack: hashfn/control_id/image_id/journal/seal/digests/index/claim 顺序)。**diverge → port 不成立**(需对齐版本或自建)。我们 fork verifier 版本(risc0 3.0.4/4.0.4)vs 上游 zk-sdk 编译期望版本必对上。
- **STEP C**: `wasm-pack` 单独编 zk-sdk WASM 包(如 kaspa-wasm 那样), **不 rebuild 节点**。
- **STEP D(S3 合并)**: trivial RISC0 guest(常量 journal)→ ported zk-sdk 构造脚本 → **TN12 链上广播 tx LAND**(NO TX NO TRUTH)+ 实测真实 script-units(对照声明 140k/250k)。

### 5.4 诚实定位(不变)
Track C 只闭层2(payout 算术); 层1(outcome)永远需预言机。真 production 缺口 = 经济层 fraud-proof(不等 6.30, 现有链锚可建)**优先级可能仍高于 ZK**。时间窗: mainnet Toccata DAA 474,165,565 ≈ 2026-06-30 16:15 UTC(params.rs:724 源码确认); TN12 已 active → 现在可在 TN12 开发测试。
