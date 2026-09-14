> **Status: CURRENT**

# startRelay() 全部调用点清单 v0.1（2026-09-14 · KANet-UI · NWT `4c479a52` 补齐·Bettor 1312/1316 派工）

本仓 `startRelay(relayNodeId)`（`kasia-console/src/services/relay-manager.js:157`）目前**共 6 处调用点**，均是同一个函数，均在准入检查（`checkHotwalletAdmission`，`relay-manager.js:196-198`）之后才调用 `getRelayPrivkey`/`getRelayMnemonic`——任何调用点触发的启动尝试，对超过 `RELAY_HOTWALLET_PER_RELAY_MAX_KAS`/命中 `RELAY_HOTWALLET_COLD_ADDRESSES` 的行都会在解密前被拒绝，不因调用点不同而有差异。逐条核实：

| # | 位置 | 触发方式 | 说明 |
|---|---|---|---|
| 1 | `relay-health-monitor.js:111` | 30 秒 cron，自动 | `relayHealthMonitorTick()` 内 `doStartRelay(r.id)`（DI 默认值即 `startRelay`），扫 `relay_nodes` 里 `address IS NOT NULL AND (mnemonic_encrypted IS NOT NULL OR privkey_encrypted IS NOT NULL)` 且当前不存活的行，逐个尝试拉起。 |
| 2 | `relay-manager.js:346` | console 进程启动/重启时，自动 | `startAll()` 内（`index.js:582` 启动时调用），跟 #1 用同一份无余额过滤的候选查询（`relay-manager.js:337-340`）。 |
| 3 | `system-repair.js:231` | 人工触发（`POST /api/system/repair`，`fixId=restart_relay_<id>`） | 运营者在 console"系统修复"面板点一下触发，不是自动路径，但同样直接调 `startRelay(relayId)`。 |
| 4 | `relay.js:200` | `POST /relays/:id/assign`，人工触发 | 给某行分配 adapter 时，若该行已有 `address`+`(mnemonic_encrypted 或 privkey_encrypted)`，自动顺带 `startRelay()`。 |
| 5 | `relay.js:215` | `POST /api/relay/:id/restart`，人工/API 触发 | 显式重启端点：先 `stopRelay()` 再 `startRelay()`。 |
| 6 | `relay.js:1805` | onboarding 向导流程 step 11，人工触发 | 新建账号走完整 onboarding 流程时，创建完立即 `startRelay(relayId)`。 |

## 结论

6 处调用点全部收敛到 `relay-manager.js:157` 这一个 `startRelay()` 函数体，没有任何调用点绕过它自己内部的准入检查逻辑（准入检查是函数体内部第一件事，不是调用方各自选择要不要检查）——GO-E 清单 v0.6 §5 第 2 点原本只静态列举了前 3 条（cron/console 重启/人工 repair），本次由 NWT 复核补齐后 3 条（`/relays/:id/assign`、`/api/relay/:id/restart`、onboarding），均已确认走同一份准入逻辑，第 4 批（`docs/provenance/2026-09-14-kanetui-migration-batch4-large-import-only/`）"会尝试拉起但解密前被挡"这条安全结论对全部 6 处调用点同样成立，不因调用点是哪一个而有例外。

**关联文档**：GO-E 身份与充值清单 v0.6 §5 第 2 点（`docs/2026-09-13-kanetui-mainnet-relay-identity-funding-checklist-v0.1.md`，本清单是对该处"静态列举有盲区，以实测兜底"这句话的一次补全，非推翻）；第 4 批执行页 §0（`docs/2026-09-14-kanetui-mainnet-migration-batch4-large-import-only-exec-v0.1.md`）。
