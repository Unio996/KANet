# NWT 红队 · J2 (a)(b) 设计 v0.2 复审——核对上一轮反馈是否忠实落地

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`docs/2026-09-13-j2-local-only-strict-rpc-design-v0.1.md`（(a) v0.2）、`docs/2026-09-13-j2-network-single-source-and-prefix-consistency-helper-design-v0.1.md`（(b) v0.2）。上一轮 verdict = `docs/2026-09-13-nwt-redteam-j2-local-only-and-network-prefix-designs-v0.1.md`（`7149e3a5`）。

## 结论：两稿 v0.2 均 **PASS**，忠实且正确地落地了上一轮全部反馈，未发现新问题

### (a) v0.2 核对
- **C13 已加**（§4 表新行）：覆盖的 5 处坐标（`oracle-pool.js:371/469`、`pool.js:1120`、`oracle-pool-renewal-cron.mjs:125`、`oracle-pool-chain-scanner-cron.mjs:32`）与我原始 F7 清单逐一对上，无遗漏无新增。修法是"`getWorkingRpc()` 之后、`new RpcClient(...)`/`getSharedRpc(...)` 之前判 `!rpcUrl` 早退"，**明确覆盖了 `getSharedRpc` 这条路**（不只是裸 `new RpcClient`）——我核过这条必要性：共享池最终也会内部构造同一个致命调用，若只挡裸构造会漏；本稿两条路都挡了，对。
- 明确写"**禁止用 try/catch 代替**（NWT 实测包不住 wasm 陷阱）"——把我的发现原样当作约束写进设计，没有留后门。
- 与 C1 同批的要求（§4 末段）保留，未被弱化成"建议同批"。
- N9 行（§5）如实记录我的三种复现形态与结论，措辞准确（"既非默认走公网，也非优雅错误"）。
- 唯一非阻塞的小瑕疵：§7 的 Q1/Q2/Q4 仍以"待 NWT 判/我倾向"的语气留着，而 header 已经写明这三条"全采纳"——文字没跟着状态更新，纯粹陈旧措辞，不影响执行，不需要另开一轮。

### (b) v0.2 核对
- **§2.3 新增**（events 限频）：给了两个可选实现形（`ALL_FAILED_NOTE_MS` 同形 / `(sender前缀,reason)` 聚合），限定"helper 本身不写 events"（保持纯函数），限频状态放调用站点旁——设计干净，没有把状态污染进共享 helper。回归判据"连续 1000 次坏前缀 ⇒ events 新增行 ≤ 1"直接可测，不是空话。
- **V12 已补**（§4）：11 组对抗输入与我脚本里的完全对应，且补充说明"helper 对同 11 组 ⇒ reject invalid-checksum/empty"（这是我脚本本身没跑到的下一层——我只测了 `Address.validate()`，J2 补了 helper 包一层之后的预期行为，是合理的延伸，不是编造）。**同时正确点出了"`validate()` 与 `RpcClient.connect()` 不是同一鲁棒等级"这条我强调的核心结论**，没有把两者混为一谈。
- V3′（B-5 反向向量）已补，形式正确（V2 地址在 testnet-12 环境下应 reject）。
- 33 处替换清单、lint 规则、类 A 45 处独立一笔——均未变动，与上轮 PASS 的部分一致，未引入新坐标漂移。

## 本次复审新查的点（不只是对表格，重新读了一遍找新洞）

- 检查了 C13 的判空时机是否也覆盖 `getSharedRpc` 内部路径（见上，覆盖了）。
- 检查了 (b) 的限频状态是否被塞进了本该是纯函数的 helper 里（没有，状态在调用站点，helper 保持无副作用，这点很重要——纯函数才好单测、好复用到 relay 侧）。
- 检查了两稿之间的落码归属重叠点（`relay.mjs:1106`、`relay-manager.js:79-80`）是否被两稿各自重复认领导致落码时冲突——两稿都写了"归 (a) 的 C4/C9，不重复改"，口径一致，没有各说各话。

未发现新问题。两稿可进入 Bettor 提到的 patch 阶段（D-011 内部双审），不需要再走一轮完整 NWT 红队。

## 给 Bettor 的处置建议
- 两稿 PASS，落码可以开始（钱路部分仍是 Owner 批，非钱路 Bettor 批，两稿口径一致）。
- (a) §7 的陈旧措辞可以在下次改稿时顺手清一下，不必现在专门开一笔。
