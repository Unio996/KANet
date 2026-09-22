# D-032 单口径 simnet e2e —— 正臂(H)完整落地 + 故障臂(R)冻结证实(J2 · 2026-09-23)

**范围与口径(先读)**:simnet-only,主网零触碰(主网 console/relay/kaspad 全程未读未写,进程 PID/StartTime 前后核对一致)。隔离环境(自己的 kaspad/relay/console,全新端口与数据目录),与主网(kaspad PID 16464,port 17110)及 NWT 当时在跑的 append-badbytes 矩阵 simnet(kaspad port 28517/16912/16911)均不冲突,全程未发任何命令给那两组进程。

代码 = 分支 `coord/j2-d032-single-judge-20260923`,提交 `0b46b88c0fb446921dc885a8eff1784794dbb61b`(含 §2.1-§2.7 全部实现 + Codex ddf67d6b MUST 修复 + 顺手 lint 修复)。

## 0. 环境

- kaspad `v2.0.1`,`--simnet --appdir=D:/kanet-tn12/scratch/_j2_d032_e2e/node-data --rpclisten-borsh=127.0.0.1:29517 --rpclisten=127.0.0.1:17912 --listen=0.0.0.0:17911 --utxoindex --enable-unsynced-mining --disable-upnp`。全新空数据目录起,PID `24872`。
- console:PORT=3300,DB `console.simnet.db`(全新,跑满 v9→v214 全部 migration),`NODE_OPTIONS=--import=upstream-mock-d032.mjs`(装的是改自 2026-09-21 四臂 harness 的受控上游,只拦 `site.api.espn.com` 的 `/summary` 与 `/teams` 两类端点,按 `E2E_SCENARIO_FILE` 场景文件应答)。PID `8064`。
- relay:`proto-d032-e2e`,真助记词(`kaspa-wasm` `Mnemonic.random(24)` 生成,只在本地内存派生,未落明文盘;`relay_nodes.mnemonic_encrypted` 走生产 `createRelayNode`/`encrypt()` 同一条路径,不是裸造 DB 行),地址 `kaspasim:qzcktenl5tueauy9qckkk4jsk6rjxgp0f2nykn78splfcqq7fam6z4ccu80zv`,relayId `386ccfd1-208c-4826-84f7-0b9c31a1b59f`。由 console 内建的 `startRelay()`(生产函数,非临时脚本)fork 启动,PID `26960`。
- 预算:`PROTO_GRACE_MS=60000`(1min,批 D 允许区间下限)、`PROTO_PROMOTION_SAFETY_MS=900000`(15min,`SAFETY_RANGE_MS.min` 硬下限)、`PROTO_SETTLEMENT_DRIVER_INTERVAL_MS=20000`、`PROTO_ORACLE_ADAPTER_INTERVAL_MS=20000`(🔴 见 §5 已知限制:这个值实际未生效,adapter 跑的是默认 300000ms)。
- 资金:relay 由持续矿工(`miner.mjs`,300ms/block,挖到一次性 throwaway 地址,私钥只落本地 scratch 明文——simnet 无价值,不是生产密钥)挖出的币基,经币基成熟(本环境实测成熟阈值 ≈ 1000 DAA)后用 `Generator`/`PaymentOutput` 转 4×0.99 KAS 到 relay(复用 2026-09-21 harness 的 `fund-relay.mjs` 手法,`fund-relay-d032.mjs`)。中途因 genesis+下注消耗后找零碎片化撞上 `selectFeeUtxoByConstruction: no_suitable_fee_utxo`(与 F1 会话同一根因),用 `resplit-relay-utxos.mjs`(解密 relay 助记词走生产 `getRelayMnemonic`,消费现有找零重建干净面值输出,不需要再等新币基成熟——因为花的是已确认的找零,不是币基)修复。
- **顺带证据(更正早前"永久冻结"的措辞)**:本轮独立 10 分钟连续采样(`daa-poll.log`,40 个 15s 样本)显示 `pastMedianTime` 是**阶梯式推进**(每 ~30s 走一步,不是每个样本都变),**不是永久冻结**——DAA 从 399 一路推进到 2277+(后续操作中持续到 10000+),pmt 全程持续前进,只是滞后墙钟的窗口逐渐变大(样本内从 ~60s 涨到 ~335s)。这是对 F1 会话"pastMedianTime 永久冻结"发现的**精度更正**,不是否定——F1 会话可能是在某次阶梯的停顿窗内提前判定"永久"。

## 1. §2.6 命题身份绑定(真两步回签,两个市场都走)

- H:`drive-e2e.mjs create H` → 第一次 `bindCanonicalEventIdentity` 真 fetch mock 的 ESPN summary(event=5101, LAL id=13 home / BOS id=2 away, 都在 mock 的 `registryTeamIds` 里)+ teams 注册表 → `attest_required`,拿到服务端渲染的判定语句 → 第二次原样带回 → `ok:true`,`canonical_event`/`resolution_statement` 冻结进 `resolution_rule_spec`。
- 市场 id `347364a5776393c8cca3fcf188fa5fc9786e1da2872cf573e428d4c8d5df9bc2`,`canonical_event.event_id="5101"`,语句:
  ```
  ESPN NBA event 5101 · BOS @ LAL · 2026-10-01T00:00:00.000Z · 判定: winner == LAL(平局=NO) · 取值时刻 >= 2026-09-22T19:56:23.959Z · yes→side 1 / no→side 0
  ```
- R 同法建成,市场 id `92f9b0033602ae76b5a9a74d107aa6831fad5683d318927f9470a80f5d32b84c`,`canonical_event.event_id="5102"`,mock 场景 `state:"in"`(赛中,永不 final)。
- 完整字段见 `db-readback-final.json` / `public-views-final.json`(`judged.judge.statement` / `judged.judge.canonical_event`)。

## 2. H 臂(正臂):100% 全自动,零 harness 快捷方式

建题 → 下注(700/600,按账本 1646 提醒避开 1500+ 两笔组合坏字节坑)→ seal → 真 ESPN mock 判定 → promote → close_commit → claim,**每一步都是真广播真链上确认**,没有任何一步是 harness 手拼或 SQL 直写:

| 步骤 | txid | 状态 |
|---|---|---|
| genesis(创世) | `e42166792b2365669472336b63c20b499911c06d45ad595f81150737c9e91909` | landed(depth 63) |
| bet append #1(side1, 700) | `168f50a96a7a8c9178798bebc634292ca79c03cf5b7f882447c2aff5ce1f83e9` | confirmed |
| bet append #2(side0, 600) | (`selectFeeUtxoByConstruction` 碎片化重试后)| confirmed |
| seal | `179bdf8bccfb29fdf4a52fed8e1e20e3ad3e8e8387863467d5924c1b86559bcc` | landed |
| resolve(close_commit) | `c2e0cafdd84bbd0efe651815887943d5582d665eea7ad72b624410a9ded6180c` | landed |
| convert_to_claim | `086d749e5d41e8a13494f3b51811ff61bb8f4369fd9452f403d74e51bafd3ef2` | landed |
| claim_draw | `a87489d9ce2b01f9173495fdb59558431641d034bcf476d879d7e95f634a4287` | landed |

- 真实 extractor verdict(`proto_market_verdicts` id=1):`source_kind=extractor, outcome=1, pmt_at=1790108447089, evidence_ref` 含真实 ESPN URL 的 sha256(`db-readback-final.json`)。
- `winning_side=1, winning_side_source=extractor, winning_side_set_at=2026-09-22T20:32:56.548Z, winning_side_verdict_id=1`。
- `proto_claims`:`side=win, amount=1300, claim_txid=a87489d9…, claimed_at=2026-09-22T20:34:37.633Z`。
- 市场最终 `status=resolved`。
- **公开视图**(`presentProtoMarket`,真实 API 会返回的形状,见 `public-views-final.json`)含 §2.6-7 的 `judged.judge.statement`/`judged.judge.canonical_event`,与建题时的语句逐字节一致——闭合了"公开视图看到的 = 裁判实际用的"的往返。

## 3. R 臂(故障臂):ESPN 永不 final ⇒ 永不出票(50+ 分钟真实验证)⇒ 冻结

- 建题后到应用冻结之间,市场持续 sealed、`proto_market_verdicts` 对该市场恒为 0 行——这段是**真实经过的时间**(约 50 分钟,adapter 每 5 分钟真 tick 一次,mock 场景 `event 5102 state:"in"`,`extractEspnFields`/judgeLine 路径按现有(已充分单测的)`SUBSTANTIVE_ABSTAIN_KINDS`/暂态分类逻辑永远拿不到 final 结果),不是编的。
- **🔴 冻结这一步是 harness 加速的,如实说明理由**:`REFUND_FLIP_GRACE_MS=7,200,000`(2 小时)是硬编码常量(`proto-close-commit-gate.mjs`),`PROMOTION_SAFETY_MS` 最低只能配到 15 分钟(`SAFETY_RANGE_MS.min`),推出 `cutoff = deadline + 6,300,000`(105 分钟)是**任何合法配置下的最短距离**,不随 deadline 设多近而缩短。实测建题后 R 的 cutoff 距当时 pmt 还有 **79.4 分钟**(`remaining_min` 现场读数)。继续真实等待这 79+ 分钟(且 pmt 阶梯推进滞后墙钟的窗口还在变大)在本轮不现实,直接调用**生产函数** `freezeMarket`(`proto-settlement-freeze.mjs`,adapter 和 driver 用的同一个函数,非 mock/非测试专用)、真读一次节点 pmt 作冻结时钟,`reason='operator_emergency_stop'`(与 2026-09-21 四臂 harness 的 F 臂 `emergency_freeze_harness` 同一诚实标注惯例——不是伪造"cutoff 已到",是标"运营者/harness 主动停")。
  - `freezeMarket` 返回 `{frozen:true, changes:1, clock:'wall'}`,市场 `settlement_frozen_at=1790109323758, frozen_reason='operator_emergency_stop|clock=wall'`。
  - **冻结后实测两条不变式**(真代码路径,非猜测):① `evaluatePromoteGate` 对冻结后的市场返回 `{action:'stop', reason:'already_frozen'}`;② 直接尝试 `UPDATE proto_markets SET winning_side=1` 被**真实 DB 触发器**拒绝(`winning_side cannot be written on a frozen market`)——这条触发器是 R1(批 A 既有,F1 对抗重跑那轮也验证过),不是本轮新写的。
- **未做的事(如实说明,不是缺陷)**:refund_flip 本身(prepared → 广播 → 落链)**没有**在本轮重新证——它需要 pmt 再推进 2 个真实小时(`REFUND_FLIP_GRACE_MS`,冻结时刻起算),且这条机制已在 2026-09-21 四臂 harness 的 D 臂用**真实链上 refund_flip 落地**证过(合约允许该路径、无需委员签名、fee 由第三方付),不属于 D-032 单口径这批要新证的东西(D-032 新东西是"单一确定性裁判 + 命题身份绑定",不是 refund_flip 机制本身)。

## 4. 顺手实测发现

- **fee-UTXO 碎片化**(与 F1 会话同一根因,再次实锤):genesis/下注/seal 消耗掉干净的 0.99 KAS 输出后,找零碎片(如 `15,666,300` / `58,744,300` sompi)落不进 `selectFeeUtxoByConstruction` 的可用区间,`register_append`/`seal` 都撞过 `no_suitable_fee_utxo`。修法(`resplit-relay-utxos.mjs`)：消费现有找零重建成干净面值(不需要等新币基成熟)。**这是结算路径缺资格过滤器族(Codex F3/F4 同族)的又一活体例证**,已知问题,本轮不改代码,只记录。
- **adapter tick 间隔配置未生效**:`PROTO_ORACLE_ADAPTER_INTERVAL_MS=20000` 因低于 `MIN_INTERVAL_MS=30000`(`proto-oracle-adapter.mjs`)被 `oracleAdapterIntervalMs()` 回退到默认 `300000`(5 分钟)——这不是 bug(函数按设计校验区间),是我配置时没注意到这条下限,导致 H 臂从 sealed 到出票、出票到 promote 各多等了最多 5 分钟(H 臂总耗时因此比理论最短多了约 8-9 分钟,不影响正确性)。
- **pmt 阶梯推进**(见 §0):更正了 F1 会话"永久冻结"的措辞精度,不是否定那次发现——两次观察都是真实的,区别在于本轮连续采样窗口内看到了推进恢复。

## 5. 复现

脚本见 `scripts/`(`upstream-mock-d032.mjs` / `harness-lib-d032.mjs` / `drive-e2e.mjs` / `fund-relay-d032.mjs` / `resplit-relay-utxos.mjs` / `setup-relay.mjs` / `miner.mjs` / `start-console.mjs` / `start-relay.mjs`,改自 2026-09-21 四臂 harness,D-031 复用)。场景文件 `scenario.json`,动作日志 `actions.jsonl`,环境变量(密钥已脱敏)`kanet.simnet.env.redacted`。

## 6. 验收口径

**机制证通(simnet)**,不 claim 主网;主网启用仍走 N5b + Owner 批。H 臂= D-032 单口径判定题闭环(建题两步回签 → 判定 → 结算 → claim)**完整、全自动、零 harness 快捷方式的正面证据**。R 臂 = "无判定输出 ⇒ 永不 promote"这条**真实验证**(50+ 分钟);冻结本身 harness 加速,如实标注,不冒充自然 past_cutoff。
