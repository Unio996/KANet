# RootClose.sil v1.0.0 纯语法迁移（T3 v0.3 §7 第一步）

同 CloseZkV2 一批（Bettor ledger 1131），机械迁移到编译通过，不动业务逻辑、不加 scan。

## 改动清单（全部机械，零逻辑变化）

1. `entrypoint function` → `entry`（4 处：close_commit/refund_flip/convert_to_claim/convert_to_refundclaim）。
2. 裸 struct 字面量 → `State { ... }`（`close_commit`/`refund_flip` 的 `validateOutputState` 各 1 处）或
   `ClaimState { ... }`（`convert_to_claim` 的 `validateOutputStateWithTemplate`，桥接 RootClaim 的 8 字段
   State，字面量类型须显式指名对应 struct，不是本合约自己的 7 字段 `State`）——`convert_to_refundclaim` 桥接目标
   与本合约同 7 字段布局，用 `State { ... }` 本身即可，不需要额外 struct。
3. `tx.time` 只收 `temporal`（同 CloseZkV2 撞的坑）：2 处（`close_commit` 的 `deadline_ms`、`refund_flip` 的
   `deadline_ms + 7200000`）都改 `temporal(...)` 包裹。
4. 本文件未见 `ScriptPubKeyP2PK`/两参 `byte[](x,N)` 用法（实查确认，非假设）。

## 验证：无既有 test.json（如实记，非本次引入的缺口），新增 3 条冒烟向量全 PASS

`RootClose.sil` 此前没有配套 `.test.json`，本次机械迁移无法比对"既有向量不变"。为了不是纸上声称"编过了"，
新增 3 条**冒烟**向量（不是完整覆盖，只覆盖 `close_commit`/`refund_flip` 的关键路径）：

- `SMOKE-close_commit_fail_no_valid_sigs`：committee_hash 匹配、`temporal(deadline_ms)` 通过后，5 个格式合法但
  非真实签名的 sig 全部 `checkSig` 失败 ⇒ `validSigs<4` ⇒ 拒。证明 State{} 字面量、committee_hash 校验、
  temporal 迁移三处都实际被执行到（不是编过就没跑）。
- `SMOKE-refund_flip_pass` / `SMOKE-refund_flip_fail_before_deadline_grace`：`temporal(deadline_ms+7200000)`
  边界前后各一条，验证纯 flip 路径。

`convert_to_claim`/`convert_to_refundclaim` **只confirm 编译期完整类型检查通过**（用真实 ctor 参数完整编译，
非空 ctor 提前退出的假阴性检查），**未构造运行期向量**——需要真实 foreign-template prefix/suffix 字节码桥接
（同 T1/T3 前几份 provenance 里 TokenStub/PoolSideStub 的做法），超出"纯语法迁移"这次改动的必要验证范围，
如实记录为未覆盖，非漏洞。
