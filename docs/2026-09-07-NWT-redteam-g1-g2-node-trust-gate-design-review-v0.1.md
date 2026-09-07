# NWT 红队审 · G-1+G-2 设计（J2 `docs/2026-09-07-j2-g1-g2-node-trust-gate-and-console-rpc-selfheal-design-v0.1.md`）· v0.1 审 + v0.1.1 补 · 2026-09-07T07:4xZ

**判定：GREEN-conditional → v0.2**（4 MUST · 4 SHOULD · Q1–Q5 答 · v0.1.1 补 3 条）。钱路改动 ⇒ Owner 批（铁律 0），本审不代批。坐标本人 grep（HEAD 868e95bf 附近）。

## MUST-1 · `pending.submit(rpc)` 是 **4 处不是 3 处**
`grep -rn "\.submit(" kasia-relay/src --include=*.mjs`（去 test）：`lib/p2sh.mjs:306`（Generator 循环 `txId = await pending.submit(rpc)`）、`lib/transaction.mjs:226`、`lib/utxo-split.mjs:125`、`:275`。设计 §3.2 写"三处"漏 p2sh.mjs:306。改清单为 4；lint（v0.1.1 名 `R-REALCHAIN-SUBMIT-VIA-GATE`）保留为安全网。

## MUST-2 · S2：sink-lag 阈 ≥ 661 s 在三元组里是空判据；挡 R2/R3 只能靠"IBD 进行中"；建议 RPC 原生量 (d)
- `isSynced ⇒ lag<661`（rule_engine.rs:125）⇒ 任何 L≥661 的 (a) 在 isSynced=true 下恒过。900：R1（lag≈1200）本被 isSynced=false 挡；R2（21:56/22:28Z）isSynced=true ⇒ **不挡**；R3（05:19Z lag 575–612）**不挡**。600 只多 61 s。
- 能挡 R2/R3 的只有"IBD 进行中"。不采读日志 (b)（Q1 权限/轮转/40 relay 各自 tail）。**建议 (d) = `getBlockDagInfo().headerCount − blockCount`**（本人直读）：中继/READY 0（05:28Z、01:01Z）；头相位 106,200（03:27Z）；nearly-synced 窗内 2,971（05:19Z R3）/ 7,092（06:57Z）；爬行 0。阈 H=50，判别度 ≥60×，RPC 原生，Q1 消失。
- 占空比实测：D-c 周期 544 s / 轮 232–238 s ⇒ hold ≈43%（非 55%），只对 CHAIN_WRITE；代价 = cron 延 ≤4 min，收益 = 不出 R1 形状。
- 轮内放行风险面：submit 头相位已证丢，体相位未证；读路径方向保守（minDepth 低估 ⇒ 少判已落；DAA 锁判晚不判早；"未见付款"计时器 ≥30 min ≫ 8.5 min）⇒ 只 hold submit 是对的分界。

## MUST-3 · "未列入 type ⇒ 默认 hold" = **class=CHAIN_WRITE（T=false 才 hold）**，非无条件拒
加单测枚举 `COMMAND_TYPES` 全量，未分类即 fail。`api/relay.js:1774` 直通 type 走同一分类器。

## MUST-4 · G2-3 重建必须由 **rpc-health 自己的失败路径**触发
30 个 `getWorkingRpc/getSharedRpc` 调用点全为每次调用取实例（重建透明 ✓）；但故障形状 = `rpc-health.js:71` 数据核一直失败而业务不再碰本机 key ⇒ 若 `noteSharedRpcError` 只在业务路径，永不重建。写明 + 单测。顺序：网络过滤（G2-1）→ 可达 → 数据核（`getServerInfo().networkId === 'testnet-12'` 实串 ∧ isSynced）→ 才缓存；失败不缓存 + `REJECT` 行。

## SHOULD
- S1 重建硬上限（每进程 ≤N，超出 LOUD+停）：限频 26 MB/天，30 天 ≈0.8 GB 进 4 GiB wasm 顶；`sharedRpcStats().rebuilds` 露出。
- S2 ③ 门 skip-on-rpc-fail 加 `[ibd-gate] skip reason=rpc-fail streak=<n>` 每 10 min 一行，防静默停摆（S-1 jepu1 形）。
- S3 networkId 用实串 fixture（`testnet-12`），不匹配即拒。
- S4 影子统计按 `(reason, type, ibd-round-id)`，轮 id = `IBD started` 时刻。

## Q1–Q5
Q1 采 (d) 后不需要。Q2 600 可留作保险，900 无意义。Q3 手续费级 **hold**（relay `_sendKaspaInner:150` 今天已抛）。Q4 console `src/`、`tg-bot/`、`scripts/` 零直连 submit（本人 grep）；未扫 `scratch/`、根目录 launcher。Q5 见 S1。

## v0.1.1 补审（Bettor 裁 S2 = 900 硬判据、`ibdQuiet` 只观测）
1. **同意 J2 如实标注**：900 > 661 ⇒ isSynced=true 时 S2 永不单独绑定 = 双保险非新拦截面；真正新增拦截面 = networkId 核 + 覆盖面（p2sh 29 + pending.submit **4** + `_sendKaspaInner`）+ rpc-fail fail-closed。红队按这三个面压：MUST-1/3/4 与 S2/S3 即是。
2. **S2 保留意见**：保留，但 §7 Q2 的随动规则"S2 上界 = D-c 阈 + 轮长上界 + 120 s"要写成**不变量**：`S2_L ≥ isSynced 判据 661` 时它只是保险；一旦有人把 isSynced 判据或 D-c 阈改到让 `S2_L < 661`，它就变成真拦截面且与 D-c 周期互斥——那次改动必须重跑 R1–R5 表。**R2/R3 放行 = 接受 ≤661 s 陈视图下的 submit**，这是钱路上的明确风险接受，须以 Owner 决策一句话入 DECISIONS（不能只在设计稿 §7）。
3. **`ibdQuiet` 观测字段旁请并列记 `hdrMinusBlk`**（同一次 `getBlockDagInfo`，零成本）：影子期用它统计"若采 (d) 会多 hold 多少笔、落在 R2/R3 的有几笔"——让 Owner 用数字而不是占空比估计拍板。
4. D-c 观测（J2 报）：非 syncer peer 的 `not eligible` 通知在每轮完成后重置（每 ≈9 min 3 行 ≈ 480 行/天）——与 D-c 设计 §6"一次性"措辞不符。**记 SHOULD-低**（D-c 后续）：改为每 peer 每小时一次或只在 lag ≥ 阈时打；不阻塞 G-1。
