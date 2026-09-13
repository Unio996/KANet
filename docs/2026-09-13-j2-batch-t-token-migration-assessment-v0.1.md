# 批 T（KCC-20 测试币）并入 silverscript v1 迁移计划 · 评估骨架 v0.1（只评估 · 不写 .sil · 不落 src）

> **Status**: DRAFT-SKELETON · v0.1（2026-09-13T10:3xZ `date -u`）· J2 · 等 NWT 审 J1 稿的结论一到即填实 → Bettor → 合约/市场改造 = 钱路 ⇒ Owner 批（D-017 §3）。
> 派工：Bettor SendMessage 10:1xZ（(a)(b) 之后、(c) 之前）。输入：J1 `docs/2026-09-13-owner-mainnet-test-token-kcc20-free-mint-assessment-v0.1.md`（`origin/coord/j1-mainnet-testtoken` 5c6995e9）§3/§6/§8 · D-017（Bettor 五拍：合约 `sil-v1/KanetTestToken.sil`、ticker KTT、目录 `sil-v1/`、批 T 位置 = 批 A 后、批 D 前）· J2 `docs/2026-08-30-j2-silverscript-v1-migration-plan-v0.1.md` §3–§5 · 本机 `kasia-console/src/lib/*.sil` 盘点（2026-09-13 自跑）。
> 行号随 HEAD `8f1e107f`。**骨架 = 结构与量级；数字标"估"的都是估，标"实核"的才是跑过的。**

## 0. 一句话

批 T 不是"多一个合约"，是把 **stake 的载体从 KAS 输出值换成另一个 covenant 的状态字段**——这碰到 bshard 家族每一个按 `tx.outputs[i].value` 记账的地方（估 ≈48 处 / 9 文件）和四条 settler/payout 构造路径。它能否做，第一个要核的不是工程量，是 **silverscript v1.0.0 能不能在一个 covenant 里读另一个输入 covenant 的状态**（KCC-20 `owner_scheme 0x04` 的授权形靠它）；没这原语，批 T 的形要整个换。

## 0.5 硬输入（NWT 红队 verdict `docs/2026-09-13-nwt-redteam-j1-kcc20-testtoken-v0.1.md` §8 · origin 6d3f97a0 · Bettor 10:2xZ 转达）——**四条缺一条本稿自判 HOLD**

| # | NWT 条 | 本稿落点 | 现状 |
|---|---|---|---|
| H1 | (a) `owner_scheme==0x04` 只挡裸地址，挡不住自建平凡 covenant 当钱包场外流转（KCC-0020 covenant-id/v1 owner-authentication = **Empty**）⇒ **(b) 模板前缀锁 = 必要项**，不是可选升级 | **T1 加一条 `require`**：`transfer`/`mint` 的每个接收输出 `tx.outputs[i].scriptPubKey` 的前缀必须匹配 KANet 市场/领取模板前缀（introspection TN12 已有，记忆 `reference-silverscript-real-capabilities`；v1.0.0 是否仍有 ⇒ 并入 T0 ④ 核）。**维护成本**：模板前缀 = 编译产物 ⇒ 每次编译器升级/合约改动，代币合约里烤的前缀集也要重烤 + 重部署代币合约（代币是 covenant，状态可迁移但脚本不可改 ⇒ 实际是"新代币合约 + 旧币按旧规则 transfer 到新合约"的迁移 tx，或者接受多版本并存）；建议前缀集烤成 ctor 参数（T0 ③ "状态初始化须常量" 是否允许 ctor 值 ⇒ 决定能不能不改源只换 ctor） | 未设计；本稿 §3 T1 行按此改 |
| H2 | §3.5 三入口的"测试态/稳定币态"切换必须是**编译期常量 + 新部署**，不能是运行时状态标志；pause 入口预留正反向量计划 | T1：三入口的态用源码常量（`const MODE_TEST = true` 类）编译，切态 = 改常量重编 + 新合约；**不**放进 KCC-20 状态字段、不放进 `extension_commitment`。向量：pause 入口在测试态"任何输入都过"（正）+ "构造稳定币态常量重编后同输入被拒"（反，跨两个编译产物比） | 未设计 |
| H3 | `borrow_scheme` 部署时显式钉死 `0x00 disabled/v1` + 负向量（KCC-0020 §5 borrowed receive 是第二条转移路径） | T1：`mint`/`transfer` 的每个 `next_states[i].borrow_scheme == 0x00` 硬 require；负向量 = 构造 `borrow_scheme=0x01` 的接收态期望拒 | 未设计 |
| H4 | §6-4 "领取 covenant 名下"：KCC-0020 状态里**没有"名下"身份概念** ⇒ 绑定未设计，NWT 判 HOLD | **T2 必须单独开一节（verify-value-source 承重点）**：赢家身份怎么进领取 covenant——候选形：领取 covenant 的 ctor 烤 `winner_pubkey`（状态初始化须常量 ⇒ 可行性归 T0 ③）+ 花费入口 `checkSig(winner)`；代币状态 `owner = 领取 covenant-id`。"余额 = 名下求和"就是"以 `winner_pubkey` 为 ctor 参数的所有领取 covenant 的 amount 之和"——是**链下索引**，不是链上概念，稿里要写明。且结算 tx 里"谁是赢家"这个值必须由 settler 从本机 relay 自取的链值/共识结果派生，不收 caller 标量（接位档 ctx-hooks 纪律） | 未设计；本稿 §3 T2 行按此扩 |

NWT §8 另两条（§3 领取绑定、§6 drain + 重新同步措辞）不阻塞开始设计，但要在批 T 稿各开一节交 NWT 审；§3 = 上表 H4，§6 归 KANet-UI 退役 runbook（已转）。

## 1. 与 J1 §8 两个事实的对账（rc1 → v1.0.0 重跑）

| 项 | J1 §8 事实 | 对我计划的影响 | 量级 |
|---|---|---|---|
| 编译器版本 | v1.0.0 = `3ed9733`（09-09）；`COMPILER_VERSION` 仍 `"0.1.0"`；`pragma ^1.0.0` 被拒 | 计划 §3「正式版切 `^1.0.0`」**反过来**：42 个 `.sil` 的 `pragma silverscript ^0.1.0` **保持不动**，等上游升常量再切；`sil-v1/` 目录不改 pragma 只改语法 | 0 行代码改；计划文本改 1 段 |
| #245/#246 新增 ≈2000 行静态拒绝（资源上限 / covenant 展开界 / 脚本限制 / **状态初始化须常量**） | 批 A/B/C 在 rc1 上的离线编译**全部作废重跑**——批 A 的源改动（`entry` 104/42、`byte[36]` 106/24、`x as byte[N]` 42/13、`checkMsgSig` 2/1）语法在 v1.0.0 不变，**不用重做**；要重做的是**编译 + 向量 + 新拒绝的分诊** | **估**：重编 42 文件 = 分钟级；分诊 = 新一批"C′"——按"状态初始化须常量"这一条，本机盘点带 `#[covenant`/covenant 字样的 **13 个文件**（CloseZkV2 / FoldNode / FoldNode_sealonly / PayoutShard / PayoutShardV2 / PoolLeaf / PoolLeaf_nofold_probe / PoolShard_fold / PoolSpine_v08_chunk / PoolSpine_v0_7_1 / ShardLeaf / WinningsPool_v1 / …）**大概率每个都要改状态初始化写法**；其余 29 个非 covenant 文件估批 A 后直接过（J1 实核 Blake2bProbe 1/42 已过）。"covenant 展开界"最可能打到 `PoolSpine_v08_chunk.sil`（333 行、28 处 value 引用、7 处 covenant）与 `PayoutShard*`（≈400 行）。**这些是估，实核 = 用 v1.0.0 二进制跑一遍 42 文件拿错误清单（离线、无花费，可先做）** |

## 2. 迁移集本身先瘦身（D-017 之后，42 不再是 42）

TN12 退役 + D-001「rolling 死路」⇒ 下面这些**不需要迁到主网**（只作 pinned 编译器取证保留）：
- 探针 9 个：`Blake2bProbe / CheckSigFromStackProbe / ProbeC_selfonly / RootStub_probe ×5 / PoolLeaf_nofold_probe / PoolSpine_i_proto`（已部署 TN12 的探针字节码走 pinned 复现，D-016 注记不变）。
- rolling 系（PoolSpine v06/v07/v0_7_1/v08_*、PoolSide 全系、PoolRoot、PoolSpine.sil）≈12 个：D-001 已裁死路，TN12 未结盘 Owner 不逐盘收摊 ⇒ 主网**不部署**。
- 签名型 escrow（PredictionEscrowUnanimous5 / ConsensualMid / PredictionPoolUnanimous3 / OracleStake_v1 / WinningsPool_v1 / RefundClaim）≈6 个：主网波 2「签名型结算小额」若仍要它们，才迁；**押注换成代币后它们的 stake 逻辑也全变**（同 §3），不是"直接迁"。
- **真正的主网集 = ZK/bshard 家族 ≈9–10 个**：`PoolLeaf / ShardLeaf / ShardLeaf_direct / FoldNode(+sealonly) / PoolShard_fold / PayoutShard / PayoutShardV2 / RootClose / RootClaim / CloseZkV2`。
⇒ 🔵 **请 Bettor 拍**：批 T 的合约面按"主网集 ≈10 + 新 2（代币 + 领取）"算，不按 42。42 的批 A/B/C 离线重跑仍做（取证 + 验证编译器），但**只有主网集进批 D**。

## 3. 批 T 的工程面（按依赖顺序 · 全部估）

| # | 件 | 落在哪 | 改什么 | 量级（估） | 钱路/Owner 批? |
|---|---|---|---|---|---|
| **T0 前置核**（不核不动） | silverscript v1.0.0 原语 | 上游 `docs/DECL.md` + `TUTORIAL.md` + `tests/examples/kcc20.sil`（旧布局，只看语法） | ① 一个 covenant 能否读**另一个输入**的 covenant 状态（`tx.inputs[i].state`/等价物）；② `owner_scheme 0x04` 的授权判据规范原文（是"同 tx 里有该 covenant-id 的输入"还是别的）；③ 状态初始化须常量 ⇒ 市场 covenant-id 怎么烤进代币状态（ctor 参数是否算"常量"）；④ `tx.outputs[i].scriptPubKey` introspection 在 v1.0.0 是否仍在（H1 模板前缀锁靠它） | 半天读文档 + 4 个最小 `.sil` 试编（离线） | 否 |
| T1 | 代币合约 `sil-v1/KanetTestToken.sil` | 新文件 | KCC-0020 六字段布局；`mint` 无校验；`transfer`/`mint` 的 `next_states[i].owner_scheme == 0x04`（H1 (a)）+ **接收输出 scriptPubKey 前缀 ∈ 模板集**（H1 (b)，必要项）+ `borrow_scheme == 0x00`（H3）；三个预留入口的态 = **编译期常量**（H2）；行为向量每 require 一正一反 + H2/H3 负向量 | ≈150–220 行 + 向量 ≈14 条 | **是**（D-017 §3 "代币合约改造 = 钱路"） |
| T2 | 领取 covenant（winner claim） | 新文件 `sil-v1/KanetTokenClaim.sil`（名待拍） | 只许 0x04 持有 ⇒ 赢家"钱包余额" = 其名下领取 covenant 的 amount 之和（J1 §6-4）；持有者 = bettor pubkey 但载体仍是 covenant；花费 = 再 transfer 到别的市场 covenant | ≈60–100 行 | **是** |
| T3 | 市场合约 stake 读法 | 主网集 ≈10 个 `.sil` 的 `.value/amount` 处（盘点：CloseZkV2 9 · PoolShard_fold 9 · PayoutShard 8 · PayoutShardV2 7 · RootClose 5 · PoolLeaf 4 · FoldNode 2 · ShardLeaf 2 · RootClaim 2 ⇒ **≈48 处**，含非 stake 的 fee/dust 引用，逐处分诊后估 stake 相关 ≈30） | `tx.outputs[i].value` 记账 → 同 tx 里代币 covenant 输入/输出的 `amount`；KAS 只剩 fee/dust 断言 | 每处小改但**每处是承重语义**（pool 总额 / 份额 / 赔付比）；向量全部重做 | **是** |
| T4 | 下注入口（stake 进场） | `api/pool.js`（bet 路径）+ `kasia-relay/src/relay.mjs:6xx` per-bet P2SH 派生 + `per-bet-p2sh.mjs` | 现在 = bettor 付 KAS 到 per-bet P2SH；改为 bettor 自 `mint`（免费）+ 把代币 covenant 的 owner 烤成市场 covenant-id；per-bet P2SH 是否还需要（隔离付款根的动机是 KAS 并发花费，代币下没有这个问题）待 T0 ② 答完再定 | 中：一条新 tx 构造路径 + 一条旧路径退役 | **是** |
| T5 | settler / payout 构造 | `services/pool-market-settler.js`、`lib/pool-shard-settle.mjs`、`lib/bshard-close-transport.mjs`、`services/bettor-prediction-settler.js`（本机 grep 命中的 4 个 KAS 输出构造文件） | 赔付输出 = 代币 `transfer` 到 T2 领取 covenant；KAS 输出只剩 fee；`check_utxo_landed` 的"落链"判据从 KAS UTXO 改为代币 covenant UTXO | 中-大：4 文件；且 (c) 稿的 NO-TX 两处在同一文件（`bettor-prediction-settler.js:198/216`），**落码顺序：先 (c) 后 T5** | **是** |
| T6 | ZK 侧 | `services/zk-prove-worker.mjs`、CloseZkV2 的 guest 输入（RISC0） | 证明里绑定的 pool 总额/份额从 KAS 值改为代币 amount；VK 不变则 guest 变 ⇒ VK 变 ⇒ 链上 `OpZkPrecompile` 的 VK 承诺全换 | 大：guest 改 + VK 重生成 + 全套 E1 字节证重做（D-016 那套） | **是** |
| T7 | 账本/DB | `DATABASE.md` + migrate（fund_lock / spending ledger / 余额面全是 KAS 口径） | 新增代币 covenant 记账表或给现表加 `asset` 列；G5 口径（不报盈亏）不变 | 中 | 改表走 DATABASE.md 规范；钱路口径 Owner |
| T8 | faucet → mint | `api/faucet*`（J1 §3.4） | 直接发链上 `mint` | 小 | 是（发 tx） |
| T9 | UI/操作面 | KANet-UI 域 | 余额 = 领取 covenant 求和；页面文案「测试币·无价值·免费无限铸造」每次都带 | 中 | 用户面 ⇒ Owner |

**依赖**：T0 → T1 → (T2 ∥ T3) → T4 → T5 → T6；T7 与 T3 同期；T8/T9 尾随。**批 T 在计划里的位置**（Bettor 拍 = 批 A 后、批 D 前）成立的前提：T0 通过；T3 的 ≈48 处与批 C′（v1.0.0 新拒绝分诊）**同一轮过手**，不要两次打开同一批文件。

## 4. 这稿现在就能做、且不花钱的三件

1. **v1.0.0 二进制重编 42 文件拿错误清单**（离线；`versioned-builds/` 独立目录，禁 `target/release` 漂移）——把 §1 的"估"变成"实核"。
2. **T0 三问**：读 DECL.md/TUTORIAL.md + 3 个最小试编。
3. §2 瘦身清单给 Bettor 拍。

## 5. 请 NWT 判 / 请 Bettor 拍

1. §2：主网集按 ≈10+2 算、rolling 系与探针不进批 D——是否成立。
2. T0 ①：若 v1.0.0 **没有**跨输入读 covenant 状态的原语，批 T 的替代形（例：市场 covenant 自己持有 amount 字段、代币只作"收据"）要另起一稿，本稿 §3 作废重写。**这一条决定批 T 是"并入"还是"重排"。**
3. T4 的 per-bet P2SH 去留。
4. 落码顺序：(c) NO-TX 修 → T5，两稿同文件。

## 6. 没核到的

- §3 全部量级为估；≈48 处 value 引用是 `grep -c "\.value\|amount"` 的粗数，含 fee/dust。
- 未读 v1.0.0 的 DECL.md（T0 是本稿第一步，尚未跑）。
- 未核 KCC-0020 规范里 `owner_scheme 0x04` 的授权原文（只按 J1 §3.1 转述）。
