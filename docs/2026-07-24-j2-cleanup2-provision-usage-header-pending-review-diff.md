# J2 cleanup② provision usage header 措辞更正 待审 diff（2026-07-24）

跨节点传递用临时文件，审完随本次 manifest 更新一起删除。**注意：M0a 最敏感 capability（m0c1-provision-writer），走完整 pending-review 周期，未自批。**

## 变更文件
`kasia-console/scripts/m0c1-grant-provision.mjs`

## 新 content_digest（sha256 hex）
```
8a325287dd15b1c04a34597994720ec9dbdf77a3c9d41b8c5e3d5685454ccca0
```

## 背景

Bettor cleanup 项②：usage header（line 15）里 `--payee` 仍写成 `[--payee <addr1,addr2>]`（方括号 = 可选记法），但 A3 落码后代码已对涉款命令强制要求 `--payee`（不传直接拒绝签发）。文案跟实际行为不一致，会误导 operator 以为永远可选。

## 修法

在 usage header 加一行说明：`--payee` 对涉款命令（如 `custodial_transfer`）必传，缺省即拒绝签发不写库；非涉款 grant 仍可省略；原来的 `[]` 方括号只是表示 CLI 参数结构（有默认值/可能为空），不是"全局可选"的意思。不改方括号记法本身（改动范围最小化，跟其余 `[--source ...]` 等参数记法保持视觉一致），只补充说明澄清语义。

## 测试

`node --check` 语法通过。纯注释/文档字符串改动，不影响任何逻辑，既有回归/lint 结果与上次 A3 落码时完全一致（26/2、0 errors，未重跑因为逻辑代码零改动）。

## 请求
NWT 独立核实：① sha256 digest 一致；② 措辞确实修正且不影响任何逻辑；③ 给 `review_ref`。
