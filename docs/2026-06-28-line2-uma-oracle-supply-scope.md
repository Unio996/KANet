# 线2 — UMA-on-Polygon 预言机供给 · scope-first 现状+plan (J1, 2026-06-28)

> Owner 钦定线2 = polymarket-UMA 预言机供给 (剩余最高优先, Owner 生死线). Bettor: scope-first → NWT 红队标缝 → 一起报 → **Owner 拍实现节奏**. 本文 = J1 scope (实码核实, 防重造). 执行 pacing 待 Owner.
> **读源铁律 (Bettor)**: 源 = **UMA-on-Polygon on-chain bonded (Optimistic Oracle)**, **非 Gamma-API** (centralized, off-chain).

## 一、现状 (实码核实)

KANet oracle 现在怎么判市场结果:
- **source-aware extractor → judgeLine → committee**: `oracle-evidence-extractors.mjs` 按源抽 StructuredEvidence (`__STRUCTURED_EVIDENCE_FIELDS__` = winner_side/home/away/score; `extractEspnFields` / CoinGecko) → `canonicalFieldHash` (determinism 源轴) → `judgeline.mjs` 整数定点判 verdict → committee 投票 (field_hash/manifest_hash quorum gate).
- **窄门可靠**: sports (ESPN) + price (CoinGecko) 已 495/495 真实结束赛实证 (judgeLine memory). 其余 domain 判不了 → ABSTAIN-not-guess.
- **5 缺口** (docs/2026-06-15-oracle-expansion-parallel-board-plan.md): ① frontier domain 判不了 (KNOWN_EXTRACTORS 只 ESPN+CoinGecko) ② 单源零交叉验证 ③ 主观题硬判 ④ **UMA 学习引擎只 RECON 未 build** ⑤ deriveVote 未红队.

防重造确认 (#27a 教训):
- **无既有 UMA OO on-chain reader** (grep `OptimisticOracle|ethers...uma` 仅 substring 假阳性). `bettor-fundamental-reasoner.js` 读 Polymarket/gamma 但那是 **#50 硬-NO 禁路** (settle 不复用). → 线2 = **新建**.
- **ethers ^6.16.0 已装** → 读 Polygon 链零新依赖/新原语.

## 二、线2 边界 (防与既有混淆 — 两个不同的 "UMA")

| | 板块 C (NWT 卡, 2026-06-14) | **线2 (J1, 本文)** |
|---|---|---|
| UMA 角色 | **老师** — 学"这类问题去哪个权威源查" (C1: 不拿 UMA 裁决判分, 拿真相判分) | **直接源** — 消费 UMA OO 链上 bonded resolution 作 ground truth |
| 性质 | shadow-accuracy 学习引擎, advisory, **不接管 settle** (C2) | 生产 source extractor, 接 settle 路 (新增一个高信源) |
| 数据 | UMA resolution rule + cited source (学方法) | UMA OO 链上已 settle 的 resolution (链锚, 经济终局) |

**与 gamma 铁律 (#50 硬-NO) 的调和 (= 线2 合法性命门, NWT 红队重点)**:
- 禁的是 **gamma-API** = 市场自己的价格/共识 → 用市场共识判市场自己 = 隐性循环 = 假并行.
- 线2 用 **UMA OO bonded** = 独立去中心 oracle (proposer bond + DVM token-holder vote + dispute), **≠ 市场价格** → 合法独立 ground truth. Polymarket 本就由 UMA OO 裁决 → 对 Polymarket-mirror 市场, UMA OO 就是该问题的 ground-truth resolver (设计如此, 非循环).
- ∴ on-chain bonded OO 可用, gamma-API 禁用 — Bettor 的源铁律精确切在这条线上.

## 三、设计骨架 + red-team 攻面 (给 NWT)

**新建**: UMA OO on-chain reader + 一个 extractor + 接 determinism/settle.
1. **Reader** (ethers + Polygon RPC → OptimisticOracleV2/V3 + DVM): 给一个问题的 `ancillary_data`, 读其 **已 settle** 的 resolution + settling block.
2. **Extractor** (oracle-evidence-extractors 模式): `extractUmaOoFields(...)` → {resolved_outcome, ...} + `canonicalFieldHash` (复用单源 determinism).
3. **Wire**: deriveVote 路由 Polymarket-mirror 市场 → UMA OO 源 (继承不替换, 同 judgeLine wire 的 additive 模式).

🔴 **red-team 攻面 (NWT 标缝)**:
- **A. finality**: 只消费 **bonded+DVM-settled (终局)** 的 resolution, 禁 proposed-但-可争议的 (proposed≠final = 偷跑攻面). dispute 窗 + DVM 投票完成才算.
- **B. determinism**: 读在 **固定 Polygon block** (block-anchored, 同 ESPN field_hash 跨委员 byte-equal); 跨节点同 block 同 RPC → 同 resolution. RPC 不一致/reorg = 攻面.
- **C. ancillary_data 绑定**: KANet 市场 → UMA OO request 的映射必精确 (ancillary_data hash 匹配), 错绑 = 读错问题的 resolution = 发错 winner.
- **D. ABSTAIN-not-guess**: 该问题无 settled UMA OO resolution → ABSTAIN, 不猜.
- **E. RPC 信任**: Polygon RPC endpoint 是新信任面 (centralized RPC 可撒谎) → 多 RPC cross-check or light-client / 区块头验证 (NWT 重点).

## 四、缺什么 + Owner 待拍

**需 build**: ① UMA OO reader (ethers/Polygon) ② extractUmaOoFields + field_hash ③ deriveVote wire + determinism block-pin ④ ABSTAIN/finality gate.

**Owner/Bettor 待拍 (open questions)**:
1. **市场映射**: 哪些 KANet 市场用 UMA OO 源? Polymarket-mirror only? KANet 市场 → UMA OO `ancillary_data` 怎么映射 (建市时绑?)?
2. **Polygon RPC infra**: :3200/:3300 从哪拿 Polygon RPC? 多 RPC cross-check?
3. **finality 策略**: DVM-settle 后多久消费 (reorg 安全余量)?
4. **pacing**: 板块 C (NWT 学习) 与线2 (J1 供给) 并行? 谁先?
5. **testnet**: UMA OO 在 Polygon mainnet; testnet 演练用 Polygon Amoy 的 UMA 部署还是 mock?

## 五、J1 自评边界
- scope grounded 实码 + docs, 零新原语 (ethers 已装), 明确承接现有 extractor/judgeLine/determinism 设计 (继承不替换).
- 线2 ≠ 板块 C (NWT), ≠ gamma reasoner (#50 禁) — 三者别混.
- 实现切片可拆 (reader → extractor → wire → determinism), 每片低风险快出. 待 Owner 拍节奏 + NWT 红队标缝后定。
