# J2 DONE — 严格零方案 Fix 1 + Fix 2(账本 1850, Owner 2026-10-05「批改合约」)

分支 `coord/j2-pm-strict-zero-20261005`(自 `bshard-m3-deploy` e889eb39 切出; 仅新增提交, 无 amend/rebase)。未部署、未动 mainnet env/console/kaspad; 全部真广播只在 simnet(官方 2.0.1)。

## 1. 合约改动
| 合约 | 改动 |
|---|---|
| `sil-v1/PoolSideTicket.sil` | 删 `authorize_spend(bettorSig)`; 唯一入口 `sweep()`: `this.ageDaa >= sweep_daa`、单入单出、输出 0 = P2PK(`sink_pk`)、输出值 ≥ 输入 − 0.05 KAS。ctor 追加 `sink_pk`、`sweep_daa`(**模板常量, 非 State**, State 四字段布局不变) |
| `KanetTokenClaim.sil` | 删 `spend`; 唯一入口 `retire(tok_in_idx, tok_prefix, tok_suffix)`: `this.ageDaa >= retire_daa`、恰 2 输入(本 claim + 经模板核验的真代币 UTXO, owner==本 claim cov id, amount 对得上)、恰 1 输出(P2PK sink, 值 ≥ Σin − 0.05 KAS)、代币销毁。无需签名。ctor 追加 `sink_pk`、`retire_daa` |
| `mainnet-sil-set.json` | 仅重钉这两条: KanetTokenClaim `ec95b339…74ca`/6945B, PoolSideTicket `4aa6dbf2…782d`/5171B; 其余 9 个未动 |

**TOKEN 与 GATE 均未变**: KTT 模板 hash 仍 `225ebcdec51f5439326e6bc48e47c288ceacbd3bea07aea6771548eeed44d80e`(测试断言 + e2e 实算); GATE hash 未动(console 的 `ensureGateTmplHashFresh` 在 e2e 中通过, handoff/zk_close 真广播成功)。CloseZkV2 anchor 运行时由新 CLAIM hash 自动重算。

## 2. 偏离你原话的一处(你已批: 票龄分离)
sweep 带票龄门。原因: 委员级2-B 用 `check_utxo_landed` 读【当前 UTXO 集】(p2sh.mjs:1581-1590), 若任何人可立刻扫票(费从票里出, 零成本), 可卡死任一市场 close_attest。按你的指示: **票龄 `ZK_TICKET_SWEEP_DAA` 默认 315,360,000(365 天)与 claim 的 `ZK_CLAIM_RETIRE_DAA`(30 天)分离**; create-v07(不收 KAS 模式)拒 `deadline > now + 票龄 − 60 天`(400 `deadline_exceeds_ticket_age`)。
> ⚠ 注意单位: 默认值按 Kaspa 主网 10 DAA/s 换算(30 天 = 25,920,000; 365 天 = 315,360,000)。simnet 出块慢于此, 彩排用 `KANET_DAA_PER_SECOND` 覆盖守卫换算, 且 e2e 里 retire 用小 RD=400。

## 3. env / 哈希交接(给你写 Owner env 脚本)
新 env 键(主网缺任一 ⇒ fail-closed; 不收 KAS 模式同):
- `ZK_SYSTEM_SINK_PK` — 64 位小写 hex x-only 公钥(Owner 自定, 全零拒)。**无默认**(任何网络缺失都 throw)。
- `ZK_CLAIM_RETIRE_DAA` — 整数 ∈ [1, 2^32−1], 建议 25920000。主网缺 ⇒ throw。
- `ZK_TICKET_SWEEP_DAA` — 可选, 默认 315360000。
- `ZK_CLAIM_TMPL_HASH` — **必须重算**(随 sink/retire_daa 变): 离线只读脚本 `kasia-console/scripts/zk-strict-zero-hashes.mjs`:
  `ZK_SYSTEM_SINK_PK=<hex> ZK_CLAIM_RETIRE_DAA=<n> KASPA_NETWORK=mainnet node scripts/zk-strict-zero-hashes.mjs`
  (输出 `ZK_CLAIM_TMPL_HASH` + TOKEN 核对值; 对 sink=c0c2…e9c9/RD=400 的 simnet 值 = `6176b00a…1b04`, 旧值 `395949e1…21e1`。真实主网 sink 定下来后你/我跑一次即可, 我没有也不需要 sink 私钥。)
- `ZK_TOKEN_TMPL_HASH`、`ZK_GATE_TMPL_HASH`、`ZK_MARKET_SUFFIX_HASH` 不变。

## 4. 面值下限(KIP-9 精确公式, 不是估算)
公式取自 rusty-kaspa `consensus/core/src/mass/mod.rs::calc_storage_mass`(C=1e12; 覆盖 UTXO plurality=2); 先对 S3 run4 的 24 笔链上交易逐笔重算(`storage_mass_scan.mjs`)——claim 家族 277,146、首注 register 约 286k 与节点实收一致(旧设计 5×0.2 KAS 实测 659,134 被拒, 公式同值)。共识上限 500,000(simnet Toccata 放宽后; 100k 的 pre-Toccata 标准上限早已被 PayoutShard 自身 0.2 KAS p2 输出 ≈ 200k 打破, 故按 500k 设计)。

| 项 | 旧 | 硬下限(≤500k) | 采用(留 ≥25% 余量) | 采用值下的最坏交易 |
|---|---|---|---|---|
| `ZK_CLAIM_OUT_VALUE_SOMPI`(claim_out/tok_out/remain 各一) | 1.0 KAS | ≈0.30 KAS(497,620) | **0.5 KAS** | claim 非末位 364,076(e2e 真广播通过) |
| 票面值 `TICKET_DUST` | 0.2 KAS | ≈0.04 KAS(0.05⇒433k; 0.03⇒566k 超限) | **0.07 KAS** | 首注 register 376,335(e2e 真广播通过) |
想再压低可把采用值往硬下限推, 余量会变薄(在下表 `floor_calc.mjs` 里改数即得)。retire 费 2M sompi(compute mass ≈ 20k, 预算 claim 60/tok 20), 远小于 claim+tok 面值 1 KAS; sweep 费 ≈ 0.011 KAS。

## 5. create-v07 与铸票守卫
- 一次一盘: 不收 KAS 模式下另有未完结 zk_native 盘 ⇒ 409 `another_zk_market_unfinished`(带 blocking_market_id)。未完结 = 非 shard_internal ∧ spec.zk_native ∧ protocol_status ∉ {completed,refunded,cancelled,expired} ∧ `zk_continuation.exhausted≠true`(ZK 盘走完 close 后 status 停在 `attested_v2`, 真正"领完"标记是 exhausted)。对 S3 真库核过: 唯一返回 btduw(卡死盘), 其余 6 个 exhausted。⚠ 局限: 并发两个 create 同时通过检查的竞态未封(与 market lock 无关); 卡死盘会挡住新盘, 需运维手工标终态。
- 铸票守卫(你的条件 1): `assertTicketMintAllowed` 在 `registerBettorOnShard` 入口(任何网络): `zkNative===true` 且 `spineP2sh` 明确为 null/'' 才放行; 未传 spineP2sh 也拒; pool.js 两个调用点传 `market.spine_p2sh ?? null`。

## 6. simnet 证据(`docs/provenance/2026-10-05-j2-strict-zero/`)
**合约向量**(`sz_contract_probe.mjs`, 21 项全符合预期): retire 正向(销毁代币, sink 收 Σin−fee 逐 sompi)、sweep 正向; retire 负向 = 太早 / sequence=0 / 输出给 attacker / 给 winner / 少给 sink / 多一输出 / 同笔重铸代币给他人 / 不带代币 / tok_in_idx 指自己; winner 单独花 claim_out(无 spend 入口)与 tok_out(owner 不在场)被拒; ticket 负向 = 早扫(<票龄) / seq=0 / bettor 密钥扫给自己 / 任意非 sink / 少给 sink / 多一输出 / 旧 authorize_spend 形状。**KTT 接受零代币输出销毁**(你问的第一件事, 已答)。
**全链 e2e**(`sz_e2e.mjs`, run2 ALL PASS, 0 失败; 2 注 1e9+2e9 KTT, 官方 kaspad 2.0.1): 沿用 S3 的 A/B/C(下注人钱包逐 sompi 不变且从未被触碰; 网关/settler Δ == −(费 + 净锁 covenant) 逐 sompi; 第三方 P2PK 输出 0; 赢家只拿到 covenant 里的 KTT) + 新增:
- 开头真 console 验 409 一次一盘(库里 btduw 未完结 ⇒ 409), 标终态后开新盘 200。
- 两张 ticket 链上地址 == 新模板重算地址 且 ≠ 旧模板(bettor 可签)地址, 仍在链上、面值 0.07 KAS。
- 两笔真实 claim: 太早 retire 被拒; 满龄后 `sequence=0` 被拒; 满龄正向 retire(txid fff458f8…a5b7、c4382de4…eae)→ sink 余额增量 == Σ(claim_out+tok_out−费)= 196,000,000 sompi; 两对 UTXO 均已花(代币销毁)。
- **赢家/下注人密钥可达 KAS = 0**(旧: 4.4 KAS 全可被赢家/下注人钥匙取走)。系统净锁: 两注一盘 = 2.14 KAS(maker 0.94 + settler 1.20; 旧 4.4 KAS), 其中 1.96 KAS 经 retire 进 sink, 0.14 KAS 在两张票里(365 天后才能 sweep, 只能进 sink)。
- ⚠ 诚实说明: e2e 里 "retire 输出给赢家钱包被拒" 那项, 因年龄未到, 拒因是 sequence lock 而非输出校验(输出校验的独立证据在合约向量里, 满龄后同形被拒 "script ran, but verification failed")。票的 sweep 正向只在合约向量里做(e2e 里票龄是 365 天, 等不到)。

## 7. 你问的第 2 点: ZK 原生 void/refund 路径不需要票
代码实核: `CloseZkV2.sil` / `PayoutShardV2.sil` 全文无 ticket 引用; `escape_claim` / `refund_claim` 走 `refundRootBaked`/`refundRoot` merkle 叶 + 同一个 `_unlockClaimFamily` 构造器(无票输入)。旧 co-spend 票的只有 legacy `RootClaim.claim_draw` / `RefundClaim.refund_payout`, 现由铸票守卫挡住(legacy 盘拿不到新票)。**未在 simnet 单独跑 escape/refund 路径**(本轮 e2e 是 claim 路径, 共用同一构造器); 如需要我补一轮 refund 的 simnet 实跑。

## 8. 其它须知
- **缺口(需另派)**: retire / sweep 目前只有我的 harness 构造器, **生产里没有 relay 命令/运维脚本去做这两件事**。不影响"赢家拿不到 KAS"(那靠合约), 但 KAS 回收到 sink 需要一个运维工具。要的话我另起一单。
- `legacy-proto/` 保留旧票/旧 claim 原文, 仅供 proto-v0 的 8 个既有测试(全绿); 不在主网集。
- 顺手修: `pool-zk-template-env.test.mjs` 夹具(S1 加固后它一直红, 我上次漏改, 现与 S1 对齐)。预存失败未动: `zk-prove-enqueue.test.mjs`(`no such column: id`, s12 基线同样红)。
- harness 专用 relay 补丁(`kasia-relay/src/lib/api.mjs` 加 simnet 死端点)只在本机跑 e2e 时临时加, **未提交**; run1 因漏加而失败, 日志留档。
- 范围外未碰: fee-UTXO 竞态真修(已立票)。
