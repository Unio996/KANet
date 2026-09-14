> **Status**: CURRENT

# V-T-6 撤稿：决定性 A/B/C 对照（账本 1417/1418，Bettor 审 V-T-6 上报草稿时提出反证假说）

## 假说（Bettor）

原 4 探针（`ProbeBoutCov`/2/3/4）的失败交易只有 1 个输出，`covenant_id` 是外部值，本组（leader 自己的
covenant）的续约输出数 = 0，但 `next_states` 传了 1 个元素——`binding=cov` 生成的 wrapper 在跑用户函数体
前会先做"本 covenant 组续约输出数 == `next_states.length`"这条基数检查（DECL.md 规则），报错里
`__cov_out_count = 0` 正对应这个，失败位置在 `1:1`（wrapper 层），不在用户的 `require` 那一行。真正失败的
可能是这条基数检查，不是 `OpOutputCovenantId`。

## 决定性对照（D-019 pin 真实编译+真实跑通，中性重写）

`Repro.sil`（有检查）：

```
pragma silverscript ^0.1.0;
contract Repro(int init_amount, byte[32] init_owner, int max_ins, int max_outs) {
    int amount = init_amount;
    byte[32] owner = init_owner;
    #[covenant(binding = cov, from = max_ins, to = max_outs, name = transfer, delegate_name = transfer_delegator)]
    function transferPolicy(State[] prev_states, State[] next_states) {
        require(OpOutputCovenantId(1) == next_states[0].owner);
    }
    #[covenant.delegate]
    function transfer_delegator() {
        require(true);
    }
}
```

`ReproNoCheck.sil`：同上但 `transferPolicy` 函数体只有 `require(true)`——用来证明交易形状本身合法，不是靠
判据空转蒙混过关。

`max_ins = max_outs = 1`（组内只有 1 个续约输出，与 `next_states.length = 1` 对齐——这正是原探针没做到
的地方）。交易形状：2 个输入（leader covenant `0xaaaa...` 带 State + 外部 covenant `0x3e4b...` 的 filler），
2 个输出（输出 0 = leader 的真实续约、`authorizing_input:0`、`state` 与 `next_states[0]` 一致；输出 1 =
外部 covenant `0x3e4b...`、`authorizing_input:1`）。

**结果**：

| 向量 | 合约 | 内容 | 预期 | 实测 |
|---|---|---|---|---|
| A | `Repro.sil` | `next_states[0].owner = 0x3e4b...`(与输出1真实 covenant 一致) | pass | ✅ pass |
| C | `Repro.sil` | `next_states[0].owner = 0x9999...`(与输出1真实 covenant 不一致) | fail | ✅ fail，**精确失败在 `require(OpOutputCovenantId(1) == next_states[0].owner)` 那一行**（`7:9`，不是 wrapper 的 `1:1`），且 `__cov_out_count = 1`（不是 0，基数检查这次通过了） |
| A（同交易）| `ReproNoCheck.sil` | 无检查 | pass | ✅ pass（确认交易形状本身合法） |
| C（同交易）| `ReproNoCheck.sil` | 无检查 | — | 实际以 PASS 收场（"expected failure but bytecode passed"）——**证明 C 的交易形状本身也合法，C 在 `Repro.sil` 上的 FAIL 完全是那条 `require` 造成的，不是形状被基数检查拒绝** |

**结论：Bettor 假说成立。V-T-6 不存在**——原 4 探针的失败是向量自己的基数构造错误（组内续约输出数与
`next_states.length` 不一致），触发的是 `binding=cov` wrapper 自己文档化的基数检查（不是 bug），不是
`OpOutputCovenantId`/`binding=cov` 对外部输出内省本身有问题。补齐基数后，`OpOutputCovenantId` 在
`binding=cov` 函数体内对**外部**（不属于当前 covenant 组的）输出读值完全正确，`want` 值对时 PASS，
`want` 值错时精确在检查那一行 FAIL——跟一个手写 `entry` 里的行为没有任何差异。

## 处置

- `docs/upstream/2026-09-15-silverscript-issue-vt6-final.md` 标记 **RETRACTED**，不上报上游。
- `docs/DECISIONS.md` D-018、`docs/provenance/2026-09-13-j2-t1-token-sil-implementation/KNOWN-GAP-V-T-6.md`、
  `docs/2026-09-13-nwt-redteam-j2-v-t-6-root-cause-v0.3-review-v0.1.md` 三处补状态注记（不改原文，只加
  带日期出处的更正）。
- 不需要回退任何已落码内容——H1(b)/b-out 本身已被 Owner 更晚的独立裁定（D-017 注记，账本 1408）撤销，
  `sum_in>=sum_out` 降级的论证不依赖 V-T-6 是否成立。

## 文件清单

- `Repro.sil` / `ReproNoCheck.sil` / `ctor.json` / `vectors.test.json`
- `run.log`（含编译+跑通全过程 + C 的交互式 trace + 二进制 sha256）
- `MANIFEST.sha256`
