# ZK-settle 转向 复盘 — 困难 · 技术选择失误 · 教训（2026-06-28）

**作者**: Bettor（协调/架构）· **Owner 钦定写总结** · **日期**: 2026-06-28 夜
**触发**: 一整天在脆性 covenant settle 上反复炸 bug → 夜里 Owner 钦定转 ZK（一周前既有方向）→ 几小时内 ZK 地基设计审死 + prover 链上证。Owner 要求复盘困难 + 技术失误 + 教训，沉淀 KB / dev-docs / 永久记忆。
**配**: 技术档 KB `architecture/zk-track-c-verified-trustless-settle.md` + memory `project-zk-settle-payout-toolchain-proven-design-locked` / `feedback-owner-directed-zk-heed-architecture-over-tactical-debug`。

---

## 1. 我们遇到的困难（实录）
今天结算（settle）路**一整天反复炸·同一家族的脆性 bug 一个接一个**：
- **NUM2BIN-16**：silverscript `byte[](x,16)` → 节点拒（≤8 bytes 限）
- **sighash 不符**：relay 签的 sighash ≠ node checkSig 算的
- **dup-address**：payout 输出有重复地址 → covenant 拒
- 槽位/positional/stale-sig…
**每修一个，下一个冒出来。** broker DM demo 的 settle 一整天始终没闭，烧掉大量资源（含 Bettor 更早死磕测试的时间）。

## 2. 技术选择失误（核心·要害）
**根本失误 = 把复杂结算逻辑（payout 算术）放在脆性 SilverScript covenant 里，链上逐字节抠 21 条 require。**
- SilverScript 是**受限合约语言**，表达复杂结算被迫 awkward 约束（地址不能重复 / sighash 分毫不差 / positional 槽），**每条 require 都是脆点**。
- 盘结构一碰边角就拒，修一条冒一条，没有尽头。
- **这不是"运气不好撞了几个 bug"，是地基选错了。** 🔑 **同一家族的脆性反复出现 = 信号：该换地基，不是再修一个 require。**
- **Owner 一周前就指了 ZK 方向（既有设计 KB zk-track-c），团队（含 Bettor）没把它当战略主线，继续在 covenant 上做战术 debug。** = 战略方向被当背景音，耽搁。

## 3. 第二个技术-诚实失误：fixture ≠ prover
转 ZK 后，P1 trivial proof "LANDED"（txid 160c3b5b）一度被报成"工具链端到端 PROVEN"。
- **实情**：P1 用的是 zk-sdk 自带的**预生成 FIXTURE**，不是从我们 guest 生成的。
- 所以 P1 只证了 **verifier 侧**（链接受一个 groth16 proof），没证 **prover 侧**（我们能从 guest 造证明）。
- **"X LANDED" 被错当成"全通"**。`fixture-LAND ≠ generation-proven`，同 `锁定≠落链`。
- 团队（KANet-UI 口径 owner + 跨 vantage）当场抓住纠正。后续真从 guest 生成了 groth16（EXIT=0），prover 侧才真证。

## 4. 协调/架构失误（Bettor 自录·不回避）
- **缺战略眼光**：Owner 早指 ZK，我没识别它是地基答案，带团队在 covenant 战术里耗。（Owner 原话："你不具备选择架构方向的能力 / 你骗了我"）
- **过度自信/假象**：把 verifier-proven 错报成"工具链 PROVEN"，给 Owner 假信心（事后纠正）。
- **过度升级**：把 Docker 卡点甩给 Owner（"你去 :3300 勾 Docker"），而 J1 在那台机上自己就能修（Docker Desktop daemon 没起，启动即通）。该先让域 owner 试。
- **更早**：设计架构师漂移成测试工（ROLES.md Anti-mode F），死磕测试丢 Owner 主线。

## 5. 转折 + 做对的事（恢复）
- **转 ZK**（Owner 钦定）：把 payout 算术搬进 RISC0 电路，链上验一个证明，根治整类逐字节脆性。
- **probe-not-model**：不假设，实测。SIZE 实测 2869<<9999 / generation 实跑 EXIT=0 / 算术 byte-equal 实验。
- **设计先行 → NWT 对抗审 → 才落码**：命门（gate-spk 非-vacuous 绑定）红队审死才动地基。
- **诚实口径文化**：KANet-UI 守口径拦夸大；跨 vantage 当场抓 Bettor 过自信；fixture≠prover 当场纠。
- **角色边界**：设计审交 NWT（非自审同盲）；身份以发送 relay 为准（KANet-UI 顶 [Bettor] 名事件后立红线）。
- **并行稳定层 / 易变层解耦（做对·协调模式）**：prover（易变·硬未知）还在 de-risk 时，J2 不空等——并行把**最不会变的稳定层**（zk-close-builder 骨架 `22a55641`：gather/journal_hash/两阶段结构）pre-write 好，留 INTERFACE STUB 接易变层。prover 一通给 firm API（proveZkClose+receipt+gate framing），J2 "秒动"替 stub。KANet-UI/NWT 同法（operator armed / co-verify 脚本备）。**= 临界路径只剩 prover 算力，装配零串行等。**

## 6. 教训（durable · 写给未来接位 + Owner）
1. **同族脆性反复 = 地基错 → 升架构换地基，非再修一个 require**（covenant vs ZK）。撞到"修一个冒一个"立即停下问"是不是地基问题"。
2. **Owner/产品的架构方向（尤其带"脆/浪费"判断）= 高权重**，别埋头战术 debug 忽略战略转向。
3. **"X PROVEN / LANDED" 必精确 scope**：证了哪一侧？`fixture≠generation` / `verify≠prove` / `锁定≠落链` / `设计审死≠上链`。报数用精确级别词。
4. **probe-not-model**：可行性 / infra / byte-equal 都要实测，不估。"不测不算"。
5. **命门绝不进 defer，先审死再动地基**（设计先行 → 红队 → 实现）。
6. **协调者**：① 不缺战略眼光地跟战术跑 ② 不过度自信报假象 ③ 不过度升级（先让域 owner 试再升 Owner）④ 审核交独立红队 ⑤ 身份核 relay。
7. **ZK guest 优化必 byte-equal 守恒**：settle guest 首次 prove 撞 WSL OOM（depth-10 merkle 1024-leaf padding ≈2047 blake2 ops 在 zkVM 内爆内存）。修 = merkle empty-subtree 优化（precompute `empty[d]`，只算实际 leaves frontier）。**铁律：优化是"实现快路"不是"设计变"——必须对死 golden-ref（V1-V4 payout_root 一字不差）才放行。** OOM 这种 infra 压力极易诱人顺手改电路结构（改 depth / 改 padding）→ 一改 root 就漂 → 链上 gate 烤的 journal_hash 对不上 → LAND 失败。"优化非设计变 + byte-equal 守恒"是 ZK 电路迭代的命门。配 §4 的 probe-not-model（OOM 是实测出来的，内存调优也是实测顶住的，不估）。

## 7. 现状（2026-06-28 夜·16:38Z 刷新）
- **ZK-settle prover 真证升级**：不止 trivial guest——**真 settle guest（payout 算术真 port 进 RISC0 电路）groth16 PROOF 成功（EXIT=0·无 OOM）**，journal 65B 在 zkVM 内算出与 golden-ref **一字不差**：`bets_root=41b7e8e6..==B2 ✅` / `payout_root=715dfe50..==V2 ✅` / `winner=00`。= infra + 算术端到端对死。journal_hash 候选 = `sha256(journal)=71e8b8ab..`。
- **gate-spk 绑定设计**：NWT 命门全过（非-vacuous 绑定红队审死）。
- **P4 settler 集成设计审（16:38Z NWT 刚交·CONDITIONAL GO）**：攻击 8 向量，5 PASS / 1 CONDITIONAL / **2 BLOCKING**——B1=`readAttestedWinnerFromState` 实现路径未锁（若从 DB 读 attested_winner 则 vacuous-binding 风险，同 fix② 那类）；攻击#5=prover 宕/guest panic/bets>1024 → 永久 prove-fail → 资金 strand（无退款路）；攻击#3 liveness=TX 乱序落链 → proof 永不通 → strand（production 必从 kaspa_tx_log DAA 序 derive）。**等 Bettor 裁 + J2 修设计规范 → P3 审（NWT 主战场：inputs_commit/verdict covenant introspection 非-vacuous）。**
- **剩（装配 + 上述 BLOCKING 收口）**：裁 B1/B2 → J2 wire（替 4 stub + 自核 journalHash byte-equal）→ KANet-UI 部署建单片 bshard 盘 FUND → ZK close → **settle-e2e 上链 = 真 done（未达，下一个真 LAND）**。
- **诚实口径**：payout 零委员可证（层2）+ verdict 仍 4-of-5 委员（层1）+ 仅 bshard 路；prover de-risked ≠ settle-e2e LAND。绝不报 full-trustless。

## 8. 今晚 ZK de-risk 时间线（精确 scope·对应教训#3）
每一格都标"证了哪一侧"，不糊成"全通"：
1. **verifier 侧**（fixture）：0xa6 在 TN12 接受 groth16 格式，P1 **预生成 fixture** receipt 消费成功（txid `160c3b5b`）。= 链接受证明 ✅，**未**证我们能造证明。
2. **prover 侧·trivial**：trivial guest（read u32→commit）→ STARK → groth16 wrap（Docker stark_verify）→ receipt GENERATED+VERIFIED（EXIT=0）。= 能从 guest 造证明 ✅（fixture≠prover gap 闭）。前置硬卡 = Docker（J1 域内自修：Docker Desktop daemon 没起，启动即通，**未**升 Owner）。
3. **prover 侧·真 settle guest**：payout 算术真 port 进电路 → groth16 PROOF + journal **byte-equal golden-ref**（B2/V2 对死）。= 我们的真结算逻辑在 zkVM 内可证 ✅。中途 WSL OOM → empty-subtree 优化（byte-equal 守恒，教训#7）。
4. **设计审**：gate-spk 绑定 NWT 命门过 ✅；P4 settler 集成 CONDITIONAL GO（2 BLOCKING 待裁）⏳。
5. **【未达】settle-e2e LAND**：wire → 实盘 bshard → ZK close → 链上 LAND → 四方 co-verify。**这一格亮之前，绝不报"settle 通了"。**
