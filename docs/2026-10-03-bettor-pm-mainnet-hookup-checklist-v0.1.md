# 预测市场主网接通清单 v0.1（合成稿）

> Status: CURRENT · 2026-10-03 · Bettor 合成 · 只列事实与现成物，不含新设计
> 依据：GOAL.md 第 1 条线；Owner 2026-10-03「按你建议，先出接通清单」（账本 (1810)）
> 来源：KANet-UI 走查 bcef800c（(1809)）、KANet-UI 配置侧 84b0e5de、J2 代码侧 094e1eb5（(1811)）。Bettor 抽核项注明"Bettor 核"，其余为作者自报。

## 总判断

- 主网上预测市场五步，现在只有"搜题"能用。建盘、下注、委员判定、结算都没接通。
- **主网上走通过的结算证据，全部来自已作废的 proto-v0 路径**（市场 a59c7b48）。正式的 pool/ZK 路径在主网零实链经历。
- 缺口分 7 组（A–G）。A 组纯代码、不花钱；其余各组都涉及钱、配置或外部环境。

## A. 代码修补（不花钱，需审 + 合并 + 重启 console 生效）

| # | 缺口 | 位置 | 现成解法 | 规模 |
|---|---|---|---|---|
| A1 | 下注注册漏传三个 ZK 模板参数 ⇒ 每个市场首注必抛错（先于广播，不丢钱） | pool.js:1603、:1864 → pool-shard-register.mjs:515/529/530 → :140/:428 抛错（Bettor 核） | 结算侧 bshard-close-transport.mjs:555-569 已从 env 读同三值，注册侧照同源取 | 两处调用点 |
| A2 | 主网真路径写死/走到 testnet-12 | pool.js:1519（Bettor 核）、pool.js:127、zk-prove-worker.mjs:100（资金转出地址）、bshard-close-transport.mjs:244 | 现成 configuredNetwork() | 连同其余回退约 14 行 |
| A3 | 证明 worker 调 wsl.exe 不指定发行版，落到默认 docker-desktop | zk-prove-worker.mjs:72（Bettor 核） | 加 `-d Ubuntu-24.04`（或 env 可配） | 1 行 |
| A4 | 结算守护默认连已退役 :3200 | bshard-settle-daemon.mjs:51（Bettor 核） | 设 env SETTLE_DAEMON_CONSOLE_BASE=http://127.0.0.1:3202（不改码也行） | env 1 行 |

## B. 委员池（要钱，需 Owner 定委员来源）

- 门槛：建盘要求池 ≥5（pool.js:1108、:1155，COMMITTEE_SIZE=5）；池恰好 5 且含 maker 时抽样会报错 ⇒ 实际要 ≥6。
- 注册：POST /api/oracle-pool/enroll（oracle-pool.js:200）→ 往返回的 OracleStake_v1 地址转 ≥1 KAS（ORACLE_STAKE_MIN_SOMPI，oracle-stake-v1.mjs:65）→ 扫描器 5 分钟入池。/oracle-pool/seed 已是空壳，造不了池。
- V2 判定还要求本机 relay is_oracle=1，代码里没有置 1 的接口；TN12 当年怎么置的未核。
- 主网 18 个 relay 可用性：broker、proto-v0 资金、KTT 面板、stress×10（余额 <1 KAS）都不能用；剩 J2 / NWT / Trader-M / Bettor / Qclaude 五个会话身份钱包（Qclaude 余额近下限），能否挪作委员待定。名单与余额：docs-private/2026-10-03-kanetui-mainnet-relay-roster-and-balances.json。
- 风险：委员押金地址仍经 pool-p2sh.mjs 用旧编译器生成，与 D-019 新编译器是否一致未核 ⇒ 上主网前需 simnet 验。
- 转账需 ADMIN_SECRET_FUNDS ⇒ 按 (1806) 先例由 Owner 本人执行。
- 估算成本：6 个委员 × 1 KAS 押金（押金可退）+ 手续费。

## C. ZK 五项配置（主网一个都没设；改 env 须 Owner 终端 + 重启）

| env | 现成来源 | 状态 |
|---|---|---|
| ZK_CLOSEZK_SIL_PATH | kasia-console/src/lib/CloseZkV2.sil（sha256 与 mainnet-sil-set.json 一致） | 可直接设 |
| ZK_GATE_TMPL_HASH | gate-tmpl-hash.mjs:45 / computeGateTmplHash，与 guest imageId 相关 | 可算，需跑一次 |
| ZK_TOKEN_TMPL_HASH | computeKttTokenArtifact；scripts/proto-v0-template-anchors.json 有 225ebcde… | v1/v2 该用哪个未核 |
| ZK_CLAIM_TMPL_HASH | 非 proto 路径无现成产出函数；anchors.json 有 395949e1…（proto 用） | **缺口** |
| ZK_MARKET_SUFFIX_HASH | 源字段已于 (1408)(1415)(1458) 删除，检查仍在 | 设什么值仓库无答案，需定 |

## D. 证明环境（外部环境，工作量未知）

- WSL Ubuntu-24.04 内无 cargo / RISC0 工具链（Bettor 核：/root 与 /home 下均无 .cargo/.risc0）。
- Docker 守护未运行；Groth16 是否依赖 Docker 未核。zk-prove-server(:3201) 不在，但自治链路不依赖它。
- 需要：在 Ubuntu-24.04 装 RISC0 工具链 + A3 修补。注意该 WSL 同时跑数字人渲染（显存共享）。

## E. 守护开关（全关 → 按依赖链开）

- TN12 当年全开：SETTLE_DAEMON、BSHARD_CLOSE_VOTER_V2、BSHARD_CLOSE_SUBMIT_V2、ZK_PROVE_WORKER、ZK_CLOSE_TICK_V2、CLAIM、HANDOFF、JUDGE_PROPOSE；V1 voter 与旧 ZK_CLOSE_TICK 关。
- 依赖链：JUDGE_PROPOSE → VOTER_V2 → SUBMIT_V2 → HANDOFF → PROVE_WORKER → CLOSE_TICK_V2 → CLAIM。
- BSHARD_SETTLER_RELAY_ID 未设。

## F. 结算资金

- settler relay 的 handoff 需要等于 consolidated_pool 的流动余额。
- 按代码推断 zk_close 会把整个 gate 余额作矿工费烧掉（未链上实测）——需 simnet 先验。
- FEE relay 与 settler 是否须同一钱包未核。

## G. 验证顺序（既有纪律，非新设计）

钱路合约上主网前，生产 builder 字节先在主网同款 2.0.1 simnet 真共识提交确认（接位文件"simnet = 钱路合约的真共识验证台"）；主网首盘按小额实测规矩定硬顶。

## 需要 Owner 定的

1. 委员从哪来（B）：挪用现有会话身份钱包，还是用控制台现成功能新建专用委员钱包。
2. 证明环境（D）：是否在跑数字人的同一个 WSL 里装 RISC0 工具链。
3. C 组两项无现成答案的值（CLAIM 模板、MARKET_SUFFIX）由 J2 查清后再报。
