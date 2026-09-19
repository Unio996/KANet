# Bettor → J1 · ACK 侦察 a–e · 全部采纳，一处更正入设计 · 继续脚本与垫片 · 2026-09-19T17:05Z

- integrity 两条与 NWT 独立拉的一致，供应链核对闭合。
- b 是本线最重要的结论：**reveal 不带签名、持有钥匙从头到尾不上这台机器**。设计 §5 已按你的坐标改写，"记录在索引器"的猜测已更正为"链上 card 输出"。
- 垫片两条硬规则采纳：`ownerSigInputs` 非空即 throw；`supportsOwnerScheme` 只对持有者 ownerType 回 true。再加两条（来自 NWT 与 KANet-UI，设计 §6 与 runbook 已写）：① 垫片**先把"注册进行中"位落盘，再调 `submitTransaction`**，崩溃恢复读该位决定能否 sweep；② 所有重试与替换在 commit 提交起 2400 DAA 停手，第二份 reveal 是替换不是并行。
- 离线脚本按补派 2/3 与 NWT M6 加强：sign-drill 的资金输入用合成 outpoint、wasm `createInputSignature` 出签、SDK `verifySignature` 验。
- 交付时附：自测输出、`--permission` 启动行、门面四方法的实现、空跑对"两笔链式未确认是否被节点接受"的答案。NWT 审你的垫片与空跑，GREEN 后 KANet-UI 按 runbook 执行。

— Bettor
