# 批 9-1 首批 A / B 两笔审（`9b3205a0` / `cef3f6f5`，分支 `coord/j2-batch9-1-code-v0`，基线主线 `c8089747`）—— NWT

2026-09-20。对照：设计 v0.3.4（`bdf799a1`）与我的 `680b8bb8`。方法：在我的独立检出 `D:\kanet-nwt-cand`（切到 `cef3f6f5`，A 是 B 的祖先）亲跑全部相关测试，并做自己的变异（脚本 `nwt-mutate-a-caps.cjs`、`nwt-mutate-b-chain-checks.cjs`；每次还原，`git status` 干净，JSON 逐字节核过还原）。D-021：无密钥 / 余额 / 地址。

## 结论：**A 笔 GREEN；B 笔 GREEN。** 范围核：A+B 相对主线只动 6 个文件（4 个 lib/test + 1 个 relay 测试 + 1 处注释），`services/`、`api/`、`db/`、`index.js`、`proto-relay-ipc.mjs`、m0a manifest 的 diff 全为空——9-1 首批仍无运行时效果。

## A 笔（我的合入审三条 SHOULD）
- **S1 钉 cap 字面值** `proto-fee-profile-caps.test.mjs`：亲跑 10/10。字面值（52M/30M/52M/50M/55M/100M）与账本一致，且**是独立来源**（测试里的常量，不是从 JSON 读来的）。我另做 **28 个变异**（六个 kind × {cap +1、cap −1、条目删除、`_source` 清空} + 数值型 cap / 十六进制串 / 超全局硬顶）：**27 被抓，1 存活 = 把 cap 存成 JSON 数字（值不变）——等价变异**（`loadFeeProfileCap` 按值比较、`BigInt` 接受数字），不是缺口。
- **S2** `:889` 注释：仅注释，`ticket_reclaim` 的占位注释未动（合理）。
- **S3 前提 fail-loud**：`broadcaster-utxo.test` 无 `--experimental-test-module-mocks` ⇒ 打印缺什么与正确命令、**exit 1**（我实测退出码 1）；带 flag 14/14。`drain-finality-safe-blocks.test` 无 `KASPA_NETWORK` 与设为非法值 ⇒ 同样 exit 1 并给正确命令；`KASPA_NETWORK=simnet` ⇒ ALL PASS。前提清单 `['mainnet','testnet-12','devnet','simnet']` 与 `shared/lib/kaspa-network.mjs` 的 `NETWORKS` 逐项一致。
  - **SHOULD**：drain 测试里的网络名清单是手写副本，将来 `NETWORKS` 增减会漂移——可改为从 `shared/lib/kaspa-network.mjs` 导入（该模块是纯逻辑，不触发 `rpc-listener` 的顶层 throw）。不阻塞。

## B 笔（C1 M6 必填参数 + `SettlementChainCheckError`）
- 亲跑 `proto-settlement-chain-checks.test` **51/51**（J2 报 21→51）；受波及的 `proto-claim-draw` 47/0、`proto-settlement-inputs` 15/0、`proto-tx-assembly-settlement` 43/0、`-golden` 12/0、`proto-covenant-builder` 16/0，全过。该函数在 `src/` 内**无非测试调用方**（`git grep`），所以给它加必填参数不影响任何生产路径。
- **对照我的 §19.6 verdict**：①两个 M6 参数**必填、无默认值**，缺参 ⇒ `chain_check_params_missing`（✓）；②类型化错误 `SettlementChainCheckError`，`.code` **闭集 26 个**（6 角色 × 4 类 + 2 个通用码，`chainCheckCodes()`），**保持原标签文本**，现有三类错误也带 `.code`（✓）；③outpoint 比较含 **txid 与 index**、大小写不敏感；covenantId 是**相等**而不只是有/无，`null` = 必须无 covenant，`hasOwnProperty` 要求链上条目**有** `covenantId` 键（缺键 ⇒ `_covenant_class_mismatch`，不当 null）。
- **我另做 17 个变异**（去 index 比较 / 去 txid 比较 / 去整段 outpoint 检查 / `null` 期望放行任意 / 只比有无不比相等 / covenantId 大小写敏感 / 链上缺键放行 / 两个必填参数各改可选 / 忽略 `spent` / 面值改 `>=` / 跳过 spk / 改一个 `.code` 名 / 去标签文本 / 预期 outpoint 格式检查删除 / `chainCheckCodes` 少一类）：**16 被抓，1 存活 = 删掉"`expectedCovenantIds` 有该角色的键"这一句显式检查——等价变异**：紧随其后的"格式须为 64 位 hex 或 null"检查会把 `undefined` 同样拒成 `chain_check_params_missing`，行为相同、只是报错文本不同。两条检查重叠，无害。
- 没发现与 v0.3.4 / 我 §19 要求相反之处。

## 没做 / 未证
- 没审 C/D/E 三笔（`proto-settlement-c1.mjs` 等；J2 报 C 有三处超出设计文字：第 11 个错误码 `facts_step_budget_exceeded`、`classifyC1Error` 多一类 `programming_error`、`FeeWindowError` saturated/none 判据——那些等 C 笔到了我逐条判）。
- 没在生产检出上跑任何东西；`D:\kanet-nwt-cand` 仍是我的独立检出。
