# J2 DONE · S1 + S2 + S3：主网「不收 KAS」形态的建盘与下注（账本 1845/1846，设计 v0.1 §3.2/§3.3/§3.5）

> 分支 `coord/j2-pm-ktt-s1s2-20261004`（基 `86f9fa2e`，新分支新提交，无 amend/rebase）。无部署、无重启、无主网广播、无写主网库、无改主网 env、无 .sil 改动。
> 证据目录 `docs/provenance/2026-10-04-j2-ktt-only-s1s2s3/`（日志一律 `.txt`，避开 `.gitignore *.log`）。
> 提交：`ba4b8055`（S2 底座）· `07fd5e47`（S1+S2 路由）· `9c979e35`（Bettor 评审加固）· 本报件与证据另一笔。

## 0. 结论

1. **S2：create-v07 在不收 KAS 模式下只开 ZK 原生盘**：不建 spine、零转账、无 100/5 KAS 下限、`maker_stake_amount=0`；zk_native=false / 非法 spec 仍 403；其余 create 路由全 403。
2. **S1：register-v07 在不收 KAS 模式下走网关代付**：下注人钱包零转账、`bettor_pk` 仍由下注人地址推出、只认 `stake_ktt`（代币单位整数，下限沿用 `BETTOR_MIN_STAKE_POLICY` 的数值）、`stake_kas` 不读；prep/confirm 与其余 7 条仍 403。加固（你评审的 SHOULD）：目标盘不是 zk_native 或带 spine ⇒ 403。
3. **S3 simnet 全链**（官方 kaspad 2.0.1 真共识，复用 seg4 harness）：建盘 → 两方下注 → 自治 7 tick 全走完 → 两笔 claim 落链。**最终一轮（run4）31 条断言全绿**，其中：
   - 下注人 bettorA / bettorB 钱包余额盘前盘后**逐 sompi 相同**，窗口内**没有任何被接受的交易触碰过它们**；
   - 网关（= 盘的 maker relay）与 pm-settler（settler relay）的每一笔 KAS 变动按链上交易逐笔归类，**Δ == −(手续费 + 净锁进 covenant 的 dust) 对每个钱包逐 sompi 成立**；落到第三方 P2PK 地址的输出 = 0；
   - 赢家拿到的是 KTT：每笔 claim 的 `claim_out`/`tok_out` 地址 == 用 (市场 cov, 赢家 pk, 额度) 重算的 KanetTokenClaim / KTT 地址，且仍是链上未花 UTXO，没有输出落到任何下注人/开盘人钱包。
4. **两个必须你知道的坏消息**（§5）：① **同时跑两个盘，第二个盘卡死在 close 提交**（费用 UTXO 被占，没手推）；② **Q1 的 KAS 问题仍在**：本次实测确认每个盘末留在 covenant 里的系统 KAS = 4.4 KAS（2 张票 0.4 + 4 个 claim 输出 4.0），赢家密钥/下注人密钥仍可取出——等 Owner 对 strict Fix 1/2 的决定，本次未碰 .sil。

## 1. 改了什么（提交内容）

| 文件 | 内容 |
|---|---|
| `lib/mainnet-no-kas-stake-gate.mjs` | 新增 `REOPENED_ROUTES`（单源，恰 `create-v07`→`S2-zk-native-no-spine`、`register-v07`→`S1-gateway-sponsor`）、`assertNoKasStakeUnlessReopened`（id 对不上/未登记 ⇒ 403）、`noKasStakeModeOn`（主网 ⇒ 开；网络未配 ⇒ 开(fail-closed)；simnet 彩排可设 `KANET_NO_KAS_STAKE_MODE=1`，**只会加严**）、`mainnetCreateV07Branch`、`parseStakeKtt`、`sponsorMarketGuard` |
| `api/pool.js` | create-v07 / register-v07 两处显式重开；`/settle` 与 `buildBettorRefundClaim` 对无 spine 盘 409 `no_spine_market`（原先会 500 或把盘翻到 verifying 交给 legacy 结算器） |
| `db/migrate.js` v221 | `pool_markets.spine_p2sh` 去 NOT NULL，用 SQLite 官方文档「去 NOT NULL」的 `writable_schema` 单行改写（`db.unsafeMode` 仅在块内临时关 defensive）；自带 integrity_check / foreign_key_check；幂等。不重建表（该表有表达式索引、触发器、两个 FK 子表） |
| 旧 spine 读取路径跳空 | `pool-commingle-detect`（NULL 恒不算 commingled，测试钉住）、`pool-card-groups`、`broker-fee-emit`（无 spine 时用配置网络单源；**原先会静默跳过，导致这类盘的 broker fee 审计永远发不出**）、`reclaimBshardMakerBond`（`noSpine`）、`pbs8-2-signreq-anchors`（专用 `NO_SPINE_MARKET` 拒签码，fail-closed，不是放行）、`trade-protocol-filter` 入站 bet-reg（显式丢弃）；`_broadcastMarketPublished` 无 spine 不发 |
| `docs/DATABASE.md` | v221 说明 |
| 测试 | `lib/spine-null-readers.test.mjs`、`api/no-kas-reopened-routes.test.mjs`（60 条）、`api/mainnet-no-kas-stake-routes.test.mjs`（S0 测试更新：15 条必 403 + 2 条重开）。lint-kanet 0 errors |

测试断言要点：主网创建 zk_native 盘 ⇒ 200、`spine_*` 为 NULL、`maker_stake_amount=0`、`transferAndConfirm` 零调用、只发了只读 `get_pubkey`；主网下注 ⇒ 零转账、**没有任何命令发给下注人 relay**、`registerBettorOnShard` 收到的是 `stake_ktt` 原数（无 ×1e8 换算）、`bettor_pk` 等于下注人地址推出的 x-only；simnet（不设模式位）仍要求 `maker_stake_kas ≥ 100`、仍向网关转 stake+2 KAS（老行为不变，用转账桩参数断言）；变异检查：把 S1 的转账条件或 S2 的 spine 转账条件改回无条件，测试按预期变红。

**v221 在主网库副本上验过**（`v221_mainnet_copy_test.txt`；副本 = 2026-10-04 重启前模拟留下的 `console.mainnet.pre-migrate.db`，**从没碰过活库**）：迁移前 `spine_p2sh TEXT NOT NULL`；迁移后 `TEXT`，integrity_check ok、foreign_key_check 0 违例、表上 4 个索引 + 触发器原样、NULL spine 行可插入、再跑一遍零操作。注意：真正在主网生效是重启时（migrate 在 console 启动时跑），那一刻才对活库执行。

## 2. S3 做了什么、怎么做的

- 环境：官方 kaspad 2.0.1 simnet + 8 个矿工 + 从 `_j2_wt_s12` 起的 console（`KANET_NO_KAS_STAKE_MODE=1`，七个自治 tick 全开，`ZK_PROVE_MIN_FREE_MB=6144` 未被触发——主机空闲 ~24 GB）。relay 层仅有一处 harness 专用改动（`api.mjs` 加一行 simnet 条目，沿用 seg1 的 `harness-relay-api-simnet.patch`），**未提交，已还原**。
- 驱动 `s3_e2e.mjs`：用生产路由 `create-v07`（不传 `maker_stake_kas`）→ `register-v07`（`stake_ktt` 1e9 / 2e9，bettorA→YES，bettorB→NO）→ 等自治 tick → 扫链。
- 余额口径：窗口开始前取 UTXO 快照→取 `startHash`→再取快照，两次相同才算静止（避免漏记/重记）；窗口内用 `getVirtualChainFromBlock` 的被接受交易集 + `getBlocks` 全量交易逐笔重算。
- 公钥身份：因为本盘的 `maker_relay_id` 同时是网关，**maker 钱包 = 网关钱包 = 系统钱包，它会付手续费与 dust**。所以「maker 逐 sompi 不变」这条对 maker 不成立，成立的是：**下注人钱包不变**，且网关/settler 的支出全部归类。主网要让开盘人钱包也零支出，需要 `maker_relay_id` 指向系统钱包（见 §5-4）。

### 2.1 run4 结果（最终证据，market `ext-pool-v07-1791124315416-fvyvm`）

下注：bettorA YES `stake_ktt=1_000_000_000`（leaf tx `414f16ce…`）、bettorB NO `2_000_000_000`（leaf tx `bb4c91f1…`）；判定 `winDir=0`（YES）。

**钱包 KAS（sompi）**

| 钱包 | 盘前 | 盘后 | Δ |
|---|---|---|---|
| bettorA | 26390389200 | 26390389200 | **0** |
| bettorB | 23390389200 | 23390389200 | **0** |
| maker（= 网关） | 23146782700 | 22973561100 | −173221600 |
| settler | 34056191300 | 33551968600 | −504222700 |
| fee（未用） | 30000000000 | 30000000000 | 0 |

**网关/settler 账本（链上 24 笔被接受交易，逐笔归类为 手续费 / dust(锁进 covenant) / 找零）**

| 钱包 | 手续费 | 净锁进 covenant | 合计 Δ | 校验 |
|---|---|---|---|---|
| maker（网关） | 0.53221600 KAS | 1.20000000 KAS | −1.73221600 | Δ == −(费+净锁) ✅ 逐 sompi |
| settler | 1.84222700 KAS | 3.20000000 KAS | −5.04222700 | Δ == −(费+净锁) ✅ 逐 sompi |
| 合计 | **2.37444300 KAS** | **4.40000000 KAS** | **−6.77644300 KAS** | |

- 24 笔里 12 笔是 relay 钱包的 UTXO 整理自发送（每笔费 0.032036 KAS，输出回自己地址 = 找零类），其余是下注/创世/close/handoff/zk_close/claim。完整逐笔表见 `s3_e2e_result.run4.json`（`txs[]`: owner、fee、covIn、covOut、toWallets）。
- 窗口末仍锁在 covenant 里的系统 KAS **4.4 KAS，共 6 个 UTXO**：2 张 `PoolSideTicket` 各 0.2（共 0.4）+ 2 笔 claim 交易的 4 个输出各 1.0（`claim_out` + `tok_out` × 2，共 4.0）。**这就是你 Q1 判的那部分**。
- `owner` 归属修正：zk_close 交易的输入全是 covenant（self + gate），没有钱包出资，只有 75_000_000 找零回 settler。run3 的脚本把这种交易漏归属，Δ 校验差了 75_000_000 而 FAIL；我把脚本改成「恰一个钱包出资 ⇒ 记它；无人出资而恰一个钱包收款 ⇒ 记收款方」，重跑（run4）全绿。run3 的原始结果与日志原样保留（`*.run3.*`），没有删。

**赢家得到的 KTT（链上核实）**

| claim | 受益人 | KTT 数量 | txid |
|---|---|---|---|
| idx=0 | bettorA（YES，赢方） | 2,943,000,000 | `53da93476073cbf3aa8079570374b38f36f85b1dcff6e1b14a02da47f82ec99c` |
| idx=1 | maker/网关 pk（费用叶：broker+oracle 费） | 57,000,000 | `80aba768513e0240c4cc2b9d32c16e456e7c0d0a902575e8310ae95c2aefe16b` |

合计 3,000,000,000 == 池总额（1e9+2e9）。两笔 claim 的 `claim_out`/`tok_out` 地址均与重算地址相等且仍未花；输出里没有任何钱包地址（只有 covenant 与 settler 找零）。自治链 txid：close_attest `dd5d8c8b…`、handoff `3fbd6e80…`、zk_close `4e4ee142…`。simnet 没有 api.kaspa.org，`is_accepted` 以「在 virtual chain 被接受的交易集」代替。

### 2.2 其它运行（如实记录，全部保留在证据目录）

| 运行 | 情况 |
|---|---|
| run1（`…btduw`） | 我误启动两次脚本；第一个脚本的监控被我杀掉，但它的两笔下注已完成、console 的自治 tick 继续结算这个盘。结果：**卡在 close 提交**，见 §5-1 |
| run2（`…z0g04`） | 与 run1 的盘并发。自治链全走完，两笔 claim 落链；`s3_verify_claims.mjs z0g04` 链上核实通过（bettorA 2,943,000,000 / maker 57,000,000）。run2 自己的钱包对账 4 FAIL——因为窗口与 run1 的在途交易重叠（窗口起点/快照之间有漏记），**这四条 FAIL 是我的并发操作造成的，不作为产品证据** |
| run3 | 干净单盘；31 条里 `settler Δ` 一条因归属 bug FAIL，原因同上（§2.1），其余全绿；其 claim 核实通过（受益人 bettorB，当次判 NO） |
| run4 | 修脚本后重跑，**全绿（31 条）** |

## 3. ageDaa（派工的顺带项，已答）

`this.ageDaa`（= `OpCheckSequenceVerify`）在 2.0.1 simnet 真共识上语义正确：抛弃型合约 `AgeProbe`（`require(this.ageDaa >= 150)`，27 字节 redeem，不在仓库主网集）四次真实广播：age 未到 ⇒ 节点 mempool 拒（sequence lock）；age 够但 sequence=0 / 149 ⇒ 脚本拒（Unsatisfied lock time）；age 够且 sequence=150 ⇒ 过（txid `d5f9b5c4…`）。证据 `agedaa_probe_result.json`。strict Fix 2 的 retire 超时不需要备用设计。

## 4. 复用了什么（D-031）

`configuredNetwork()` 单源（S0）；`kttPanelGate`/`rejectRelayIdInBody` 式「纯函数返回拒绝对象」；S0 的路由测试骨架；`registerBettorOnShard` 的网关代付形态本来就在（freshBettor 分支同款）——S1 只是让不收 KAS 模式下带 `bettor_relay_id` 的请求也走它；SQLite 官方「去 NOT NULL」程序；seg1/seg4 的 simnet harness（lib/miner/console 起法/relay 注资）；seg4 的 `zk-autonomy` 七个 tick、`runTokenClaim` 全原样没动。**没有新造**任何结算/合约/路由。

## 5. 你必须知道的

1. **并发盘卡死（真实发现）**：run1 的盘 `btduw` 的 close 提交反复报 `UTXO not found at <settler 地址> for tx b02c0468…`（每 30s 一次，没有任何广播，也没有手推）。原因读码所得：`bshard-close-transport.mjs:405-410` 在 propose 阶段用 `transfer` 给 settler 自己打一笔 0.5 KAS 当 close 费用 UTXO，之后提交时按这个 outpoint 取；两个盘同时跑时，另一个盘的结算交易/relay 钱包的 UTXO 整理自发送把它花掉了。**单盘跑时（run3/run4、以及 seg4 的所有运行）没出现，但同一窗口两盘必现**。含义：主网首个小盘之后到结算完成之前**不要建第二个盘**（按盘分阶段，不是按开关分阶段——我 08:20Z 的重启前报件已这么建议，这次是实测）。要根治需要把 close 费用 UTXO 的占用做成互斥/按盘专用——这是一次新的钱路改动，未做，等你定。
2. **KAS 仍可被密钥取出（Q1，阻塞上线）**：本次实测 4.4 KAS/盘，见 §2.1。我没碰 .sil；等 Owner 对 strict Fix 1（票据只许扫回系统）+ strict Fix 2（claim 只剩超时 retire）的决定。S1/S2 不依赖它，可先合。
3. **`stake_ktt` 单位**：本次定为「代币单位整数」，下限沿用 `BETTOR_MIN_STAKE_POLICY` 的数值 100_000_000（即 1e8 个单位）。这是我选的口径，没有现成设计规定；如果要换口径（比如更小的最小注），是一行常量，但会影响 KIP-9 mass 估算，需要重测。
4. **主网 `maker_relay_id` 的选择**：因为它同时是网关，网关的 KAS 余额就是系统垫付的浮动资金。按本次实测，一个 2 注的盘共消耗：手续费 ≈ 2.37 KAS + 锁进 covenant ≈ 4.4 KAS（claim 之前 ≈ 1.2 + 少量，claim 时随 settler 出资）。**建议 `maker_relay_id` 用系统钱包（例如 pm-settler 或专用网关钱包），不要用 J2/NWT/Bettor 的个人钱包**；pm-settler 现有 20 KAS，够 1–2 个盘的量级，但需要为多盘预留。开盘人（调用方）本身不需要任何钱包余额。
5. **本次 simnet 用了 `KANET_NO_KAS_STAKE_MODE=1` 模拟主网语义**：路由行为与主网同款（测试也直接用 `KASPA_NETWORK=mainnet` 打过路由），但链上用的是 `kaspasim:` 地址；主网地址前缀路径在 S3 里没有真链覆盖（单测里有主网地址）。
6. 没有测的：主网真实节点上的混合负载（7 个 tick 同时在主网 console 上的资源占用，沿用上一轮保留项）；v221 对**活库**的执行（只在副本上验过）；`pool-auto-better`/`house-agent` 在 `DEMO_*_OFF=1` 之后的行为（你已加进 env 脚本，我没再测）。

## 6. 没做的事

没有部署、重启、主网广播、写主网库、改主网 env、改任何 .sil；S4（部署）与 S5（页面）不属本段；strict Fix 1/2 等 Owner 批准。simnet 的 console/矿工/kaspad 已停（只停了我起的进程，主网 kaspad 4752 与 console 31436 未动）。
