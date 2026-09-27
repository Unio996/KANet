# D-034 §8 后续票⑥ 浏览器直连节点广播 — 证据快照(2026-09-27, KANet-UI)

## 范围（Bettor 2026-09-27 派工确认，D-034 §7 验收②"资金出口自主"既有范围内）

(a) 只读监视：浏览器经内置 wss 端点池直连节点，查订单地址付款状态（到账/不足/超付）+ 确认深度 +
    节点 PMT。
(b) 触发花费：付款落地后构造并广播 CommissionSplit 的 split 交易（零签名，任何人可触发）；超时后
    构造并广播 refund（退回合约内写死的付款人地址）。

## 硬约束落实情况

| 约束 | 落实 |
|---|---|
| ① 不新写交易构造逻辑，复用已审 SDK builder | `broadcast-commission.js` 逐字对应 `commission-plan-sdk.mjs` 的 `buildCommissionSplitTx`/`buildCommissionRefundTx`/`mkSpkOut`；唯一改动 Buffer→Uint8Array，签名 ABI 编码器（`generic-entry-witness-browser.mjs`）与浏览器/Node 两版逐字节 parity 测过（395 组向量，含全部 param kind + 错误路径，零不一致） |
| ② 零私钥/零钱包 | 两个入口沿用 SDK 既有"零签名"设计——covenant 脚本本身是判据，页面从不持有/传输私钥 |
| ③ refund 判据用节点 PMT | 沿用 `30343762` 的既有 MUST 修复思路：`monitor.js` 的 `getCurrentPmtMs()` 现查 `getBlockDagInfo().pastMedianTime`，不用 `Date.now()`/tip 时间戳 |
| ④ 广播前完整三维 mass 预检 + 广播后核实落地 | `tx-mass-ub-browser.mjs`（逐字对应 `kasia-relay/src/lib/tx-mass-ub.mjs`，唯一改动移除 `node:buffer` 依赖，56 组随机/边界向量 parity 验证零不一致）在广播前对**真实构造好的 tx 形状**（不是近似估算）跑 compute/storage/transient 三维检查，超限直接拒绝广播；广播后轮询收款地址直到资金真正离开（不是拿到 txid 就算数） |
| ⑤ 先在全新 simnet 真共识跑通 | 本快照的全部证据 |

## 真实 simnet 环境

- 全新独立 simnet（`kaspad v2.0.1`，官方二进制 `D:\rusty-kaspa-v201\kaspad.exe`，与主网 da9 同版本），
  独立 appdir/端口，不共用任何既有 agent 的检出
- `--enable-unsynced-mining`（无对等节点的孤立测试网必需，允许接受本地挖出的块）+ `--utxoindex`
- 持续真实挖矿（`getBlockTemplate`+`submitBlock`，simnet 难度可忽略，不需要真实 PoW 搜索——同仓库
  内既有 `miner.mjs` 惯用手法）
- 真实资金：单 UTXO 干净 funder 钱包（挖矿+等真实币基成熟，`coinbase maturity period = 1000` DAA
  分——本机实测踩过的坑：`Generator` 传入几千个碎片化 UTXO 会撞 storage mass 上限，改成每个场景专用
  一个干净单 UTXO funder）

## 五个场景真实结果（`run6-results.txt` 完整输出）

| 场景 | 结果 | 关键证据 |
|---|---|---|
| ① split 无找零 | PASS | 广播后订单地址资金离开；provider 收到分账余额 ≥9.9 KAS |
| ② split 有找零 | PASS | 超额付款 2 KAS(远超 max_split_fee)，找零 1.96 KAS 正确回到付款人退款地址 |
| ③ refund 到期后退款 | PASS | 短 deadline(15s) 场景，真实等节点 PMT 追上 deadline（本机实测滞后约 3.5-4 分钟，即使持续快速挖矿——这正是 `commission-plan-sdk.mjs` `PMT_LAG_GUIDANCE` 头注描述的现象本身，不是猜测），退款到账 ≈4.99 KAS |
| ④ premature-refund-rejected | PASS | UI 按钮正确保持 disabled；直调底层 `buildCommissionRefundTx` 用远未到期的 `currentPmtMs` 强制尝试，函数正确拒绝并给出明确错误 |
| ⑤ duplicate-trigger-rejected | PASS | 第一次分账后收款地址查询返回 `unfunded`（UTXO 已被消耗）——CommissionSplit 订单地址结构上只接受一次性资助，"重复触发花同一笔钱"在协议层不存在可能性 |

## 真实撞过的坑（如实记录，不是设计就想到的）

1. **excess 必须够付真实网络最低手续费**：split 的 hasChange=false 分支把全部 excess 当手续费——
   第一次只留 0.001 KAS(100,000 sompi) excess，被 kaspad 真实拒绝("fees which is under the required
   amount of 931,600 for compute mass 9316")。这不是代码 bug，是测试数据没考虑真实最低费——改成
   0.02 KAS，远超最低费又远低于 `max_split_fee`(0.4 KAS)阈值。
2. **PMT 滞后墙钟的真实量级**：`debug-refund2.mjs` 独立测过，即使持续快速挖矿，本机这台 simnet 的
   PMT 仍滞后真实墙钟约 3.5-4 分钟才追上一个仅 15 秒之后的 deadline——`PMT_LAG_GUIDANCE` 头注"没有
   协议保证的上限"这句话在本轮真实复现了，不是文档里的假设性警告。
3. **按钮 enabled/disabled 在门槛附近的瞬时闪烁**：`renderMonitorState()` 每次渲染都现查一次节点
   PMT，高并发访问同一节点时偶发瞬时 RPC 失败会让那一次渲染临时判"未到期"（fail-closed 正确行为,
   不是 bug）——测试脚本原来"看到一次 enabled 就点一次"撞上这个窗口，改成在更长窗口内反复重试点击。
4. **UTXO 碎片化撞 storage mass 上限**：矿工地址持续挖矿几千个块后有几千个 50 KAS 的 coinbase
   UTXO，把全部丢给 `Generator` 会撞 "Storage mass exceeds maximum"——改成每个测试场景用一个独立的
   干净单 UTXO funder（同 `fund-relay.mjs` 既有惯例，不是新发明）。

## 覆盖边界（如实标注）

- 本轮只测 CommissionSplit 的单角色（仅 provider）订单——多角色（含渠道分账）split/refund 的构造
  逻辑与角色数无关（`buildCommissionSplitTx` 遍历 `protocol.roles`），但本轮没有专门为多角色场景
  单独跑一遍广播路径的真实回归，视为与已有的 checkout.js 角色解析测试（⑤ QR 交付等）正交、低风险。
- 广播路径仅在**真 silverc 编译器主路径**（`usedWasmCompiler===true`）可用；降级路径
  （order-template.js 固定偏移覆写）没有 `entries` ABI，页面已明确提示原因，不冒充能触发。
- 未做主网小额真实广播（按 Bettor 指示，等这份交付+NWT 审过后由 Bettor 安排，Owner 已批手续费量级
  花费）。
