> **Status**: DRAFT v0.2 · **ST-06 · L1 原生事实与 Indexer 分歧测试** · 主笔 J1 × 协议复核 J2 × Gate NWT · **BATCH-0: 只设计+现状盘点+证据缺口, 不实跑/不改码/不拉取** · 承 `OWNER-DIRECTIVE-20260806-POST-TOCCATA-INSTITUTIONAL-STRESS-TEST` ST-06
> **v0.2 变更(Bettor 08:17 派)**: G-4 按 Codex `87d546af` 升格 + J2 实测收窄(惰性缺陷·两台 from_address 全 NULL)+ Bettor 拆弹裁定(移除 cross-node chain re-derive 分支, 卡 `G4-SETTLER-CHAIN-REDERIVE-BRANCH`)改写; 命名按 Bettor 08:24 全称+与 m0c-1 Path B 围栏消歧; §3 表行 + §7 汇总同步。Codex 定本稿"有用的 draft 非 VERIFIED, 三分类方向被认"。
> **v0.2 措辞订正(Codex `a19087c7` + AP 规则 70)**: 本稿原写"从未击发/活跃性 0/历史写过 0 条终态"**踩了 Codex 第三条(字面即假 —— 分支每 tick 仍进入查空 continue, 那也是执行)**, 已全部降级为「被检两台留存数据集上无匹配行/无终态写痕, 历史调用·其他节点·append-only 未证」。**降级不削弱移除理由**: 归因链不安全是代码实况, 与击没击发无关。

# ST-06 · L1 原生事实 vs Indexer 分歧矩阵 (现状盘点 v0.1)

## §0 基线锚 (无锚=NOT PROVEN, 承 ST-00)
- **KANet 检出**: `bshard-m3-deploy @ 8ba5d8b6`(Bettor 冻结采样点; 其后有 diag-only 前进, 本稿按 8ba5d8b6 读)。
- **本机 L1 节点(=本稿独立判定的仪器)**: kaspad **二进制自报** `kaspad v1.1.1-toc.1-ab4c51a`(启动横幅 `rusty-kaspa.log:487430`, 本次进程 02:06:42 本地起, 当前进程自报级 = 最强锚)。
- 🔴 **一个 ST-06 直接相关的基线事实(今日实测)**: **三台节点跑三个不同 kaspad commit** —— 本机 `ab4c51a`(二进制自报) / J2 台 `90dbf074`+4未提交(源码树 HEAD) / KANet-UI 台 `7b1e18cc`(落盘横幅, 且其台自报"无法确认是当前进程")。⇒ **"从 L1 独立判定"这个前提本身带节点版本作用域**: 三个版本对 money-path 共识判定是否一致【未全核】。本机 ab4c51a vs 90dbf074 的承重共识段今日已 byte-exact 核过一致(covenant/version 闸六段, 频道 882c1860); **7b1e18cc 未核** ⇒ 见 §6 缺口 G-1。

## §1 交付项① · money path 使用的 canonical L1 fields `[CONFIRMED·源码实读 @8ba5d8b6]`
结算/退款真源在本仓用到的 L1 原生字段(全走本机独立节点 RPC):
| L1 字段 | 取法(file:line) | 用途 |
|---|---|---|
| UTXO 存在性 + value + `outpoint.transactionId` | `rpc.getUtxosByAddresses([addr])` — `trade-protocol-filter.js:792/919/1160/1355` | spine/side 是否活、面额、是不是那笔 lock |
| tip / pruning point `virtualDaaScore` | `rpc.getBlockDagInfo()` — `trade-protocol-filter.js:1220/1255` · `escrow.js:160` | 到期判定、剪枝地平线 |
| 权威 `daaScore` | `rpc.getBlock(block_hash).header.daaScore` — `trade-protocol-filter.js:1170` | side_lock_daa 的唯一权威来源(见 §2) |
| UTXO 落链+深度 | `check_utxo_landed`(带 `minDepth`) — `pool.js` / `bshard-close-enforce.mjs` | 无 indexer 的 L1-only 确认路(见 §5) |
- **验收级别**: `canonical L1 fields 已枚举 = VERIFIED(源码实读)`; 但"这几个字段是否【穷尽】了 money path 的 L1 依赖"= **PARTIAL**(本稿按 grep 覆盖 5 个 money-path 文件, 未全仓穷举 → G-2)。

## §2 交付项② · from_address 等便利字段 display-only 标注 `[CONFIRMED·源码实读+实证]`
🔵 **本仓已经这么做了, 且有实战证据 —— 这一格现状偏强**:
- `trade-protocol-filter.js:1160-1193` 逐字: `getUtxosByAddresses` 便利路在 **uqmp8 两笔真实 bet** 上撞假阴性(不是边角); ⇒ 改用 `kaspa_tx_log.block_hash → getBlock().header.daaScore` 作 side_lock_daa 的**唯一**来源。
- **fail-loud 不降级**(`:1172`): `kaspa_tx_log` 查无该 tx 的 block_hash ⇒ 拒(`null`), 不静默回退瞎猜。
- ⇒ **display-only 边界**: `chain_events.from_address`(v28)在本仓是**社交/审计展示**字段(`audit-prediction.js` / `discovery.js` / `conversations.js`), money-path 判定**不用它**做价值归属。
- **验收级别**: `from_address 不作 money 判定 = VERIFIED(有反例驱动的实证)`。⚠ 但"全仓无一处 money-path 拿 from_address 判值"是**全称否定**, 本稿只证了 side_lock_daa 这条改对了 → G-3(全称需全仓 grep 收窄)。

## §3 交付项③ · indexer 矛盾/延迟/漏数/错误归因下的独立判定流程 `[MIXED·三态并存]`
🔴 **这是 ST-06 的核心, 而本仓不是单一形态, 是三态并存 —— 逐条级别不同**:
| money-path 读取点 | 形态 | indexer 不可用/分歧时 |
|---|---|---|
| `cross-chain-verify.mjs:474-537` kaspa 分支 | **indexer(kaspa_tx_log)优先 + RPC L1 降级** | ✅ 有 L1 fallback ⇒ 可独立判定 = **VERIFIED-path 候选**(待实跑注入) |
| `pool-market-settler.js` cross-node chain re-derive 分支(`pathBReconciled`, 旧称 Path B; **与 m0c-1 Path B 围栏无关**) | **纯 indexer + 非权威 from_address 索引 + 基数代理** | 🔴🔴 **惰性完整性缺陷**(Codex `87d546af` 升格 → J2 实测收窄, 卡 `G4-SETTLER-CHAIN-REDERIVE-BRANCH`): 用 `from_address=spine_p2sh` 选花费 + `outputCount>=2⇒completed/==1⇒refunded` 写终态; 但 `kaspa_tx_log.from_address` 两台节点全 NULL ⇒ 查询恒空。⚠ **措辞降级(Codex `a19087c7` + AP 规则 70): 不写"从未执行"(字面即假 —— 该分支每 tick 仍进入、查空、continue, 那也是执行); 准确说 = 【被检两台留存数据集上无匹配行、无 settle/refund 终态写痕, 但历史调用/其他节点/append-only 未证】。枪上着膛、只是没留弹孔。** Bettor 裁移除, NWT PASS, 已落码 `15567619` — 详见 G-4 |
| `trade-protocol-filter.js:792` 存在性 | **L1 直读**(getUtxosByAddresses) | ✅ 本就是 L1 = 独立判定 = **VERIFIED** |
| `trade-protocol-filter.js:1184` side_lock_daa | **indexer 取 block_hash + L1 取 daaScore** | 🟡 依赖 indexer 有 block_hash(fail-loud 拒), 但**该 tx 若不在 indexer 覆盖窗则永拒** = **PARTIAL**(见 §5 两堵墙) |
- 🔵 **本机独立 TN12 节点 = 本项的第二 L1 源**: indexer 分歧时能否独立判定, 需要一个**不由 KANet console 自身 indexer 供数**的 L1 视图 —— 本机节点正是(别台拿不到第二台独立节点核)。
- **Gate 命中项**: `settler:1432` 纯 indexer 判终态 ⇒ 按 Owner Directive Gate「无法在 indexer 不可用时独立判定则不得标 VERIFIED」⇒ **该路径当前不得标 VERIFIED** → 缺口 G-4(设计一条 L1 交叉核)。

## §4 交付项④ · multi-input / P2SH / covenant / PSKT / reorg 测试 corpus `[DESIGN-ONLY·NOT-RUN]`
BATCH-0 只设计 corpus 结构 + 期望值, 不实跑:
| 场景 | 本仓相关点 | corpus 设计要点(待 BATCH-1 实跑) |
|---|---|---|
| multi-input | spine 归集 tx(观测最大 51 输入, 频道 J2 06:36) | indexer 对多输入 tx 的 outputs_json 是否完整 vs L1 getBlock |
| P2SH | spine/side 全是 P2SH | 便利字段(from_address)对 P2SH 恒失效(uqmp8 已证) ⇒ 必须 outpoint 级 |
| covenant | v0.7 close_attest/claim | covenant 绑定只 L1 共识可判, indexer 看不见(承 §6-2 结论) |
| PSKT | (本仓未直接用 PSKT 组装 money-path?) | → G-5 待协议复核 J2 确认 |
| reorg/confirm | `REQUIRED_CONFIRMATIONS.kaspa=1`(cross-chain-verify:12) | 🔴 kaspa 只要 1 确认 ⇒ reorg 窗内 indexer 与 L1 都可能翻 ⇒ corpus 必含"1-confirm 后 reorg"负向 case |
- **验收级别**: 全部 **NOT-RUN**(BATCH-0 不实跑); 本节交付 = corpus 结构 + 每场景的 L1-vs-indexer 分歧点, 不是 PASS。

## §5 交付项⑤ · 无 indexer 条件下最小安全结算/恢复路径 `[PARTIAL]`
- ✅ **有现成 L1-only 路**: `check_utxo_landed`(RPC getUtxos + minDepth)在 `pool.js` / `bshard-close-enforce.mjs` 全程不碰 indexer ⇒ 无 indexer 时可判 UTXO 落链。
- 🔴 **两堵独立的"拿不到历史"墙(承接位档实测, 别混)**: ① kaspad **剪枝点**(低于 pruningPoint 的块 RPC 查不到) ② `kaspa_tx_log` **indexer 覆盖窗**(本机 7504 行 vs J2test 7.39M 行, 同窗不可类比)。⇒ **无 indexer 的 L1-only 路只能覆盖【剪枝地平线之内】**(本机现测 ≈ 落后 tip 2,183,498 DAA ≈ 25 天, 频道 §6-7 同批)。剪枝点之前的 money-path 事实 **L1 也拿不到** ⇒ 属数据可获得性问题, 交 ST-03。
- **验收级别**: `无 indexer 最小路径存在 = VERIFIED(check_utxo_landed 实在)`; `它覆盖全部 money-path 场景 = NOT_PROVEN`(settler:1432 那条没有 L1-only 版, G-4)。

## §6 证据缺口清单 (本稿交付的一部分, 非附录)
- **G-1**: KANet-UI 台 `7b1e18cc` 的共识承重段未与 ab4c51a byte-exact 核 ⇒ "三台节点独立判定一致"未全证。修法: 拿今日两台 diff 的同一套六段哈希核第三台(需该台配合或 fetch 其 commit)。
- **G-2**: canonical L1 fields 是否穷尽 money-path 依赖 —— 本稿覆盖 5 文件, 未全仓穷举。
- **G-3**: "无一处 money-path 用 from_address 判值"是全称否定, 需全仓 grep 收窄。
- **G-4** 🔴 **卡 `G4-SETTLER-CHAIN-REDERIVE-BRANCH`(Codex `87d546af` 升格 → J2 实测收窄 → Bettor 裁拆弹 → NWT PASS 落码在途, 2026-08-07)**:
  - **对象命名(Bettor 08:24 钉死)**: `pool-market-settler.js` 的 **cross-node chain re-derive 分支(`pathBReconciled`, 旧称 Path B)** —— 🔴 **与 `m0c-1 Path B 围栏`(托管钱路保护装置, `docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md`)毫无关系, 同名两物勿混**。
  - **缺陷**: 用非权威 `from_address` 索引(`:1458 WHERE from_address=<spine_p2sh> ORDER BY block_time DESC LIMIT 1`, 拿地址去索引里【搜】= 猜"发生了哪笔交易")选 spine 花费, 再仅凭输出个数写终态(`:1468 outputCount>=2⇒completed` / `:1474 ==1⇒refunded`, 同形不同笔花费可有相同基数)。
  - **J2 实测收窄 + 我第二源(均未发到频道前 NWT 已独立跑 console.db 确认)**: `kaspa_tx_log.from_address` 在 J2 台 14,928,354 行 + 本机 16,219 行 **两台全 NULL**(relay indexer 根本不填此列)⇒ 查询恒空。⚠ **措辞降级(Codex `a19087c7` + AP 规则 70, 我原写"活跃性 0/历史写过 0 条终态/从未击发"踩了同一处)**: 该分支**每 tick 仍进入、查空、continue —— 那也是执行**, 只是不产生可见效果; 准确断言 = 「被检两台留存数据集上无匹配行、无 settle/refund 终态写痕」, 而**历史调用/其他节点/append-only 未证**。⇒ 正确形状 = **归因链不安全(枪上着膛)是【代码实况】, 与历史上有没有留下弹孔无关** —— 拆弹与击没击发无关。
  - 🔴 **它今天零风险的原因是【另一个字段没被填】, 而管道端到端已就位**(J2 实证: `ingest.mjs:122` `ingestKaspaTx({…fromAddress…})` 签名里已有此参, `:127 fromAddress||null`)⇒ **不需任何人"加功能", 只要 relay 侧调用处开始传这一个字段(看似修一个 §2 那条 display-only 小缺陷)⇒ settler 一字节没改就活过来**。同一字段"不填"是 §2 的特性 + 本缺陷的引信保险销, 修它一举两失 ⇒ Bettor `from_address` 挂"禁止顺手修"牌。
  - **Bettor 裁拆弹(在册「保护不成立首选取消而非加固」+「safe-by-inert 风险在激活那刻」)**: 移除整段死代码(J2 出 diff+证据包, `pathBReconciled` 全仓零消费方 ⇒ 行为零变化 / 接口少一键但无消费者 = 影响零, **两句分开不合并**); NWT 独立审 PASS(自读 `:1430-1485/:1506` + 自跑 from_address SQL + grep 零消费方)。
  - **⇒ 本行验收级别: 从我 v0.1 的 NOT_PROVEN 改为【惰性缺陷·移除落码在途】; 而 G-4 本体(九项清单的真对账能力)独立保留 OPEN** —— 移除后那些市场终态 = unresolved/manual-evidence-required(诚实态), 对账建设按 Codex 九项排期。修法归 J2(gap `:138` owned by J2-tn r418/r419)。
- **G-5**: PSKT 是否进 money-path 组装 —— 待 J2 协议复核。

## §7 验收级别汇总 (本稿口径: design/现状盘点级, 非"能力已验证")
| 交付项 | 现状级别 | 卡在 Gate 的 |
|---|---|---|
| ① canonical L1 fields | VERIFIED(枚举) / PARTIAL(穷尽性 G-2) | — |
| ② from_address display-only | VERIFIED(实证) | 全称需收窄 G-3 |
| ③ indexer 分歧独立判定 | MIXED: L1直读 VERIFIED · indexer优先+降级 VERIFIED-候选 · **chain re-derive 分支 惰性缺陷(已移除 `15567619`)** | 🔴 该分支 from_address 两台全 NULL ⇒ 查询恒空(被检数据无匹配, 非"从未执行"—— 每 tick 仍进入查空 continue), 卡 `G4-SETTLER-CHAIN-REDERIVE-BRANCH` Bettor 裁移除; 真对账能力 G-4 独立 OPEN |
| ④ corpus | NOT-RUN(BATCH-0 设计层) | 实跑待 BATCH-1 |
| ⑤ 无 indexer 最小路 | VERIFIED(存在) / NOT_PROVEN(全覆盖) | G-4 |
- 🔴 **一句不许被读歪**: 本稿证的是"L1-native 判定在**部分** money-path 上已是真源、在 `settler:1432` 那条上**还不是**", 不是"KANet 的 L1 独立性已验证"。**§3 那张三态表就是防止把好的那两态读成全体。**
