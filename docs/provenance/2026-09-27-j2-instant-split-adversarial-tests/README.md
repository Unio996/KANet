# InstantSplit 对抗测试证据（simnet 真共识）

设计稿：`docs/2026-09-27-j2-instant-split-covenant-template-design-v0.2.md`
合约：`kasia-console/src/lib/sil-v1/InstantSplit.sil`
SDK：`kasia-console/src/lib/instant-split-sdk.mjs`

- `run_adversarial.mjs` — 对抗测试 #1-#8、#12-#14、#17、#18a-c，17/17 PASS（`adversarial_run2.log`）。
- `test_15_refund_fee_boundary.mjs` — 对抗测试 #15（退款手续费边界），2/2 PASS。
- `independent_third_party_test.mjs` — MUST-3：对抗测试 #10/#11/#16，零 import 本仓 JS 帮助函数（不用 `compileSilV100`/`encodeEntryActionGeneric`，只用公开 silverc 二进制 + 官方 kaspa-wasm 包独立重新实现编译调用与 witness 编码），2/2 真实广播成功（`independent_test.log`）。

对抗测试 #9（伪造规则承诺）不在此列——`rule_commit` 不参与任何 `require()`（设计 §2.6），是审计层/业务层问题不是共识层问题，交付报告里单列说明而非链上测试。

kaspad 二进制：`D:\rusty-kaspa-v201\kaspad.exe`，`--version` 报告 `kaspad 2.0.1`（D-017 官方 v2.0.1 release），sha256 `8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38`。
silverc 二进制：`D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe`，sha256 与 `scripts/silverc-pin.json`（D-019）一致，`4378ba6557f7b7b088d6ad7a400422acb51a7ffd04f86ed974055c4177ef8643`。

跑法（本地 simnet，需先起对应 kaspad 实例，wRPC borsh 端口 29717）：
```
node run_adversarial.mjs
node test_15_refund_fee_boundary.mjs
node independent_third_party_test.mjs
```
