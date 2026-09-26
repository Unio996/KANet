# Kaspa vprogs 调研与 broker / 预测市场适配评估 v0.1

> Status: RESEARCH · Bettor 2026-09-26 · Owner 令「全面深入研究，并结合我们 broker」· 不是设计稿，不构成施工依据；方向由 Owner 定（GOAL.md 冻结期内不开工）。
> 来源：推文 x.com/Max143672/status/2103466359246270526（2026-09-25，Maksim Biriukov）；`kaspanet/vprogs` release-candidate；`biryukovmaxim/vprog-tictactoe`；本仓 DECISIONS D-001/D-012/D-015/D-025；本机 `D:\rusty-kaspa` v2.0.0 源码。

## 1. 事件
2026-09-25 Kaspa 测试网上线第一个 vprog（verifiable program）：井字棋，"真实执行、真实结算"，用户用自己私钥签 L1 交易押真实 KAS，赢家经 ZK 证明结算取款。作者邀请开发者基于 vprogs 构建应用。

## 2. vprogs 是什么（已核证据）
- 用户交易 = Kaspa L1 原生交易（payload 带资源声明+指令）；排序 = L1 DAG mergeset；数据可用性 = L1。无中心化 sequencer。
- 链下：runner 按 L1 顺序执行开发者用 Rust 写的 guest（RISC0 zkVM），三级递归证明 tx → batch → bundle。
- 链上：一个通用结算 covenant UTXO（`zk/backend/risc0/covenant/src/script.rs:1-37` 六条不变量：状态延续、journal 绑定、充值地址绑定、`OpChainblockSeqCommit` 防回滚、`OpZkPrecompile` 验证 RISC0 succinct/Groth16 证明、退出输出绑定）。结算无许可竞争提交，费用与批内笔数无关。
- 不用 SilverScript：脚本在 Rust 里用 `ScriptBuilder` 手写，但用的是同一批 covenant 原语。
- **主网能力已具备**：本机 rusty-kaspa v2.0.0 含 `OpZkPrecompile`(0xa6)/`OpInputCovenantId`/`OpCovOutputCount`/`OpChainblockSeqCommit`(0xd4)；主网 `toccata_activation` = DAA 474,165,565（约 2026-06-30），当前主网 DAA ≈ 5.5 亿，已激活。（调研子代理曾称"主网不支持"，经核为误。）vprogs 自身尚未上主网（`genesis.rs:4` 待正式创世仪式）。
- 成熟度：README 自称早期原型；settler 自述未实现 fee-bump、断点续传持久化、完整 reorg 检测（09-26 当天在补）；证明需 CUDA GPU（dev 模式为假收据）。

## 3. 与 SilverScript 的关系
同一地基、两种用法：SS 把业务规则直接写进 L1 脚本（每合约一套，受 storage/compute mass 各 50 万上限、单 UTXO 串行）；vprogs 在 L1 只放"验证证明的公证员"，业务规则在链下 Rust 里跑、用 ZK 担保。

## 4. 它解决的痛点（我们都撞过）
1. 链上脚本表达力/质量上限（ShardLeaf D-020 移植反复踩坑、debugger 与真共识分裂）。
2. 单 UTXO 争用（"第三个下注人卡死市场"、每注花旧 leaf 生新 leaf）——vprogs 用户各发 L1 交易，按 L1 顺序链下执行，多笔一次结算。
3. 无需中心化排序者；L1 即 DA。
4. 结算成本与笔数无关。

## 5. 它没解决的
1. **无外部数据/oracle 原语**：比分、播放量只能由指定私钥签名写入程序状态 ⇒ 我们的委员会 attest 仍必需，可作为 vprog 的"Resolve"输入方。
2. **无单方强制退出**：用户退出须被某个 runner 打进下一个 bundle。
3. **状态重建依赖历史**：新 runner 从 L1 回放；Kaspa 会剪枝 ⇒ 长期需要快照/归档。

## 6. 对 broker（长尾分成金库，D-025）的适配
| D-025 不变量 | vprogs 现状 | 判断 |
|---|---|---|
| 现值即真相（当前 UTXO 即全部事实） | L1 只有状态根；单个金库明细在链下 SMT | ❌ 冲突：需回放/快照，恰是 D-025 要去掉的"索引器"依赖 |
| 地址可推导 | 充值地址由 covenant_id 派生（`delegate_entry_spk_hash`） | ✅ 同构 |
| 自证回执 | 证明 + journal 可自证状态转移；单笔明细需 SMT 证明 | 🟡 可做，需补"金库级"回执 |
| 一步一花（共识防重复领取） | 由证明保证状态单调、seq commit 防回滚 | ✅ 更强（不再每金库一条 UTXO 链） |
| 退出写进脚本（不需要我们按按钮） | 退出须 runner 打包 | ❌ 冲突 |
| §6 承诺绑提交人 / attest 挑战窗 | 可在 guest 内实现（mergeset DAA 作时钟） | ✅ 更易实现 |
结论：vprogs 在"复杂分期规则、多金库不争用、挑战窗"上明显优于我们的 covenant 链设计；但与 D-025 的第 1、5 条冲突。若采用，需 Owner 决定是否放宽这两条，或等 vprogs 补上强制退出/状态可用性。

## 7. 对预测市场 / D-001 ZK 结算路线
D-001 已定 ZK 为 committed 结算架构；我们自建：`zk-payout-guest/`（RISC0 guest）、`zk-prove-server.mjs`/`zk-prove-worker.mjs`、`CloseZkV2.sil`/`PayoutShard(V2).sil`（仅 TN12 落链过）。vprogs 是 Kaspa 官方把同一路线做成的通用框架，按第一原则（不造轮子）应视为这些自建件的首选替代候选。仓库此前唯一提及：`docs/trade-protocol-on-chain-design.md:646/674`（远期 HTLC）、`docs/2026-08-07-st00-claim-inventory-v0.1.md`（"未集成任何 vProg 组件"）。

## 8. Bettor 建议（待 Owner 定）
1. GOAL.md 冻结期内不改主线、不迁移。
2. 记为候选决策：broker 金库与预测市场 ZK 结算，下一阶段优先评估基于 vprogs 实现，而非继续扩写自建 SS 合约与证明服务。
3. 解冻后第一步只做低成本实测：在测试网跑通井字棋 + 实测 GPU 证明时长/成本，再决定取舍。
