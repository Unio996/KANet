# InstantSplit 对抗测试证据（simnet 真共识）

设计稿：`docs/2026-09-27-j2-instant-split-covenant-template-design-v0.2.md`（§4.6 已补 PMT 追加说明）
合约：`kasia-console/src/lib/sil-v1/InstantSplit.sil`
SDK：`kasia-console/src/lib/instant-split-sdk.mjs`

## 🔴 一次真实的假阳性事故 + 修复（NWT diff 审 MUST，2026-09-27）

第一轮交付的 `run_adversarial.mjs`/`independent_third_party_test.mjs`（现存档为 `*_v1_pmt_bug.mjs`）用
"tip 区块时间戳 − 若干分钟" 或 `Date.now()` 来判断/构造"订单已过期可退款"。NWT 在同一共享 simnet 上
重跑，T10（独立退款）、T15a（费恰等上限）均被拒 `"transaction input #0 is not finalized"`，T15b 的
"拒绝"因此也是假阳性（拒因同为 not finalized，不是真正要测的手续费 require）。

**根因**（对 `D:\rusty-kaspa` 共识源码逐行核实，非猜测）：Kaspa 判断"这笔交易是否已终结/可以现在打包"
用的唯一时间源是节点的 `virtual_past_median_time`（下称 PMT，`getBlockDagInfo().pastMedianTime`）——
`consensus/src/processes/transaction_validator/tx_validation_in_header_context.rs:72-93` 的
`check_tx_is_finalized` + `consensus/src/pipeline/virtual_processor/processor.rs:1216`/`:1319` 两个
调用点逐字传入的都是 `virtual_past_median_time`。**不是 tip 区块时间戳，也不是墙钟**。共享 simnet
自 2026-09-24 起断续挖矿（长期空闲 + 突击挖矿交替），PMT 采样窗口（约 263 个原始区块）里混着大量旧
时间戳，实测 PMT 落后 tip 约 17.7 分钟、落后墙钟约 21 分钟——远超过 v1 脚本 10 分钟的"提前量"。

合约自身的 `require(tx.time >= temporal(dl_ms))` 是完全独立的另一件事（对交易自身 `lockTime` 字段的
静态断言，同 Bitcoin CLTV 语义，不读实时链上时间）——从未是本次故障的原因。

**修复**：`instant-split-sdk.mjs` 的 `buildRefundTx` 第三参数从 `nowMs` 改为调用方现查的
`currentPmtMs`（`await rpc.getBlockDagInfo()` 读 `pastMedianTime`），未到期时给出"还需等 PMT 前进 N ms"
的明确提示。所有测试脚本相应改为现查 PMT。设计稿 §4.6 已补充完整推导与对 72h 默认 deadline 的影响评估。

**独立复现**：起了一个全新独立 simnet（同款 kaspad 2.0.1，appdir/端口独立，`_j2_instant_split_freshnet/`）
连续挖矿后测得 PMT 落后墙钟仅约 1 秒；隔几分钟不挖矿后落后拉开到约 170 秒——直接证实"滞后量取决于
最近出块节奏"这个机制，不是共享 simnet 的偶然故障。

## 文件清单

- `run_adversarial_v1_pmt_bug.mjs` / `independent_third_party_test_v1_pmt_bug.mjs` — 第一轮交付版本
  （存在上述 PMT bug），配对证据 `adversarial_run2.log` / `independent_test.log`（历史记录，不删除，
  但 T6/T10/T11/T15a/T15b 的结论已被下面的 v2 取代——T15b 那次"PASS"的拒因实际是错的）。
- `run_adversarial_v2_pmt_fixed.mjs` / `independent_third_party_test_v2_pmt_fixed.mjs` — PMT 修复后
  版本，配对证据 `adversarial_run3_freshnet.log`（17/17 PASS，全新 simnet）/
  `independent_test_v2_freshnet.log`（2/2 PASS，全新 simnet）。**这两份是当前权威结论**。
- `verify_pmt_fix.mjs` — 专门验证 PMT 修复的 4 项测试（T10/T11/T15a/T15b 重跑，含 T15b 拒因显式核对
  "是脚本 require 拒绝而不是 not finalized"），4/4 PASS，全新 simnet。
- `test_15_refund_fee_boundary.mjs` — 第一轮 T15 脚本（用的还是旧 `nowMs` 接口，已被 `verify_pmt_fix.mjs`
  的 T15a/T15b 取代，保留作历史记录）。

对抗测试 #9（伪造规则承诺）不在此列——`rule_commit` 不参与任何 `require()`（设计 §2.6），是审计层/业务层问题不是共识层问题，交付报告里单列说明而非链上测试。

kaspad 二进制：`D:\rusty-kaspa-v201\kaspad.exe`，`--version` 报告 `kaspad 2.0.1`（D-017 官方 v2.0.1 release），sha256 `8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38`。
silverc 二进制：`D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe`，sha256 与 `scripts/silverc-pin.json`（D-019）一致，`4378ba6557f7b7b088d6ad7a400422acb51a7ffd04f86ed974055c4177ef8643`。

跑法（本地全新 simnet，wRPC borsh 端口按脚本内常量为准）：
```
node run_adversarial_v2_pmt_fixed.mjs
node verify_pmt_fix.mjs
node independent_third_party_test_v2_pmt_fixed.mjs
```
