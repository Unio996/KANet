# J2 A3(provision 侧：--payee 强制传) 待审 diff（2026-07-24）

跨节点传递用临时文件，审完随本次 manifest 更新一起删除。**注意：本次改动的是 M0a 最敏感 capability（m0c1-provision-writer，grant 铸造权威），任何改动失配即重审，禁止自批。**

## 变更文件
`kasia-console/scripts/m0c1-grant-provision.mjs`

## 新 content_digest（sha256 hex）
```
99759f7600ec37a7e13a2311a840f26770e0465fe82b413baa87edc9ce284822
```

## 背景

`docs/2026-07-24-m0c1-pilot-comprehensive-defect-sweep.md` A3 项（Codex 三审）：`--payee` 目前是可选参数（`m0c1-grant-provision.mjs:100` 默认 `null`），不传 → `payee_scope` 写 `NULL` → relay 侧"缺维度默认最严"会拒所有触及 payee 的 intent。技术上这是 fail-closed 安全的，但会让 operator 误以为 grant 签发成功、pilot 却整体不可用（排错噪音），尤其 Path B pilot 首签本就该是收窄成单 smoke 目标的 singleton payee_scope。

## 修法

在 `issue` 子命令新增检查：`--commands` 含涉款命令（当前只有 `custodial_transfer`，用一个 `MONEY_MOVING_COMMANDS` 数组列举，不硬编码单一字符串比较，方便未来若有其他涉款命令类型时补充）且未传 `--payee` → 报错退出（`process.exit(1)`，不写库）。

**范围克制**：只对涉款命令强制，不对全部 `issue` 调用强制——这个脚本是通用 provision 工具（不止 Path B pilot 用），非涉款的只读类 grant 本来就不该被这个维度约束，硬性要求会过度约束通用工具，偏离"缺维度默认最严"这个设计精神本身的适用范围。

`payee_scope singleton 写法`（Bettor 派工里提到的另一半）：脚本本身已支持任意数量的逗号分隔地址（`csv()` 函数），首 pilot 传单个地址即可得到 singleton 数组，不需要额外代码改动——这半是 runbook 操作流程层面的事（operator 实际只传一个地址），已在评论里注明，不在本文件重复约束。

## 测试

- `node --check` 语法通过。
- 真实调用测试：`--commands custodial_transfer` 不传 `--payee` → 报错退出，不写库；传 `--payee` → 正常签发。`--commands get_arm_status`（非涉款）不传 `--payee` → 正常签发（不过度约束）。
- 既有回归 `scratch/m0c1-app-provision-selftest.mjs`：26 PASS / 2 FAIL（既有失败，零新增）。
- `lint-kanet.mjs`：0 errors。

## 请求
NWT 独立核实：① sha256 digest 一致；② `--payee` 强制检查真落码且范围克制（不过度约束非涉款 grant）；③ 给 `review_ref`。
