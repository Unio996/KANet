# 主网账号迁移 · 第 4 批（Trader-B + MarketMaker-A，导入不起relay）执行证据（2026-09-14 · KANet-UI · Bettor 1312/1313 派工 · NWT GREEN `4c479a52`）

> 执行依据：执行页 v0.1（`docs/2026-09-14-kanetui-mainnet-migration-batch4-large-import-only-exec-v0.1.md`，commit `b8fff6d9`）。**本页不含任何密文/明文密钥材料**——地址是公开链上信息，余额是只读查链结果，无助记词/密钥字段。

## 结论

**两账号均在导入步被冷名单拒绝，未创建行——结果记为"两账号冷存于源库"（Bettor 1312 默认裁定 (a)）。**

| 项目 | 结果 |
|---|---|
| 导入尝试 | Trader-B / MarketMaker-A 各 1 次，**均被拒绝**（`302` + `hotwallet_denied=cold_address_denied`） |
| 目标库这两个名字行数 | `0`（未创建，本页执行前后均为 0） |
| 目标库总行数 | `17`（导入前后一致，未增加） |
| relay 子进程数 | `17`（导入前后一致，未增加） |
| 链上余额（只读，导入前后各核一次） | Trader-B `20301.71703562 KAS`、MarketMaker-A `1004.99573821 KAS`——两次读数逐位一致 |
| 观察窗口 tick | 4 组（health+hotwallet 各 4 次），全部 `eligible=17 deadCount=0` / `checked=17 killed=0`，无异常 |
| stderr FATAL/error | `0` |
| 日志含密钥物？ | 否——全量 stdout+stderr `grep -Eo "[0-9a-f]{64}"` 零命中 |

## §0 前置源码核实回顾（见执行页 b8fff6d9 §0，NWT `4c479a52` 补出 startRelay 共六处调用点，均同一函数、准入在解密前——本页只记结果，六处清单另出）

导入是否必然 startRelay：不会；三条自动拉起路径（NWT 复核后为**六处**调用点，均收敛到 `startRelay()`）会尝试但对超 800 上限的行在解密前短路拒绝——本批因为**先在导入步就被冷名单拒绝**，连"尝试拉起"这一层都没有机会触发（见下方结论，比预期更早一层拦截）。

## §2 执行前检查（全部通过）

- `C:\KANet` 下无 node 进程，`:3100`/`:3200` 均未监听。
- 当前 mainnet console：PID `29872`（合并四线重启后的 PID），`127.0.0.1:3202` 监听中。
- 🔴 冷清单 env 同时含两地址：`RELAY_HOTWALLET_COLD_ADDRESSES` 核实含 `kaspa:qrxw...` (Trader-B) 与 `kaspa:qqku...` (MarketMaker-A) 两个地址；`RELAY_HOTWALLET_PER_RELAY_MAX_KAS=800`、`RELAY_HOTWALLET_TOTAL_MAX_KAS=1000` 未变。
- 批1+2+3 累计 17 行仍健康：目标库只读核得 17/17，`relayHealthMonitorTick` 最近几次 tick 均 `eligible=17 deadCount=0`。
- 源库只读查得 2 行（`Trader-B`、`MarketMaker-A`），逐字匹配名单。
- 目标库执行前这两个名字 `COUNT=0`。

## §3 导入尝试结果（2/2，均被拒绝——预期路径）

| name | address | 响应 | 拒绝原因 |
|---|---|---|---|
| Trader-B | `kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l` | `302` `/relays?hotwallet_denied=cold_address_denied` | `cold_address_denied` |
| MarketMaker-A | `kaspa:qqkulfjva2r20f3zj3hzs3hwh869zrezdz2rqm4nd9tfpdw2upsxqvkk6rhw4` | `302` `/relays?hotwallet_denied=cold_address_denied` | `cold_address_denied` |

两条 stderr 拒绝日志（`relay.js` 早失败层，导入这步、非 `startRelay()` 层）：
```
[relay] refuse import "Trader-B" (kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l): hotwallet admission cold_address_denied
[relay] refuse import "MarketMaker-A" (kaspa:qqkulfjva2r20f3zj3hzs3hwh869zrezdz2rqm4nd9tfpdw2upsxqvkk6rhw4): hotwallet admission cold_address_denied
```
两行确实在**导入这一步**（`relay.js:102-107` 早失败层，因为两行都传了 `mnemonic` 服务端会自动派生地址，派生出地址即触发这层检查）就被拒绝，**未走到 `createRelayNode()`**——比执行页 §0 预期的"会尝试 startRelay 但解密前被挡"更早一层拦截，是比预期更强的结果，不是异常。

导入调用后明文助记词在同一次脚本调用返回后立即从变量中丢弃，脚本全程只 `console.log` 过 `name`/`status`/`location`/`denied`/`deniedReason`，从未打印助记词或旧密钥（脚本源码 `kasia-console/scratch/_kanetui_batch4_migrate.mjs`，`scratch/` 目录 gitignored，不会进 git）。

## §5 观察（≥3 tick 窗口，实际观察 4 组）

- `relayHealthMonitorTick`：连续 4 次 tick 均 `eligible=17 deadCount=0`——因为两行从未被创建，候选查询（`WHERE address IS NOT NULL AND (mnemonic_encrypted IS NOT NULL OR privkey_encrypted IS NOT NULL)`）里根本不包含它们，不会出现在 `eligible` 计数里，更不会有拉起尝试的日志。
- `relayHotwalletMonitorTick`：连续 4 次 tick 均 `checked=17 killed=0`。
- 子进程核实：`Get-CimInstance` 核得 **17 个**（导入前后不变）。
- 链上余额：导入前后各查一次（`getBalancesByAddresses`，只读，不经过任何 relay 行），两次读数完全一致（见上方结论表）。
- stderr：观察窗口内除上述两条拒绝日志外无新增 `FATAL`/`error` 行。

## §6 回滚

本批未触发任何回滚条件（两行均在导入步被正确拒绝，未创建，无需清理）。

## 结论

Trader-B（20,301.72 KAS）与 MarketMaker-A（1,004.996 KAS）两账号按执行页 v0.1 流程尝试导入，均在**导入这一步**（早于 `startRelay()` 准入门，比预期更早一层）被冷名单正确拒绝，未创建 `relay_nodes` 行、未解密、未启动任何 relay 进程、链上余额只读核实前后一致。结果记为**"两账号冷存于源库"**（Bettor 1312 默认裁定 (a)——两账号继续留在源库 `C:\KANet\kasia-console\data\console.db`，本次迁移窗口不处理，Owner 可另行改判）。

原始日志留档：`console-mainnet-stdout-PID29872.log` / `console-mainnet-stderr-PID29872.log`（本目录内独立副本，已核实 zero 64-hex 序列）。
