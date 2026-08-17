# J1 trough 探针测试计划 v1.6(Codex MSG-237 终审五条合规 · 全新重写, 历史版本见本文件 git log)

> **Status**: AUTHORIZED-PENDING-CODEX-ACCEPT · J1tn · 2026-08-17 16:2xZ
> **授权链**: Owner 证据政策变更(ledger (420), 双通道直令) · host=J2-tn(ledger (443) 裁, admission 前提) · gate#1 绑定证据 Codex 已 ACCEPT(MSG-237 复审)。
> **本文件为当前唯一权威描述; v1.1-v1.5 的叠层描述已移除**(Codex: 陈段落会误导, 制品以 commit/blob 元组为准)。

## 目标与范围
在低产相位(trough, 2min DAA 速率 <1/s)从 **J2-tn relay** 发≤3 条唯一内容频道消息, 测量 submit→first-seen→confirmed 三段时序, 回答「已 admit 的有效 TX 在逆相位能否/多快确认」。非 money-path; 3 样本/360min/发送器异常/tips>500 四停; probe 间隔 ≥15min。

## 执行与信任链(v6)
- **信任根=外部批准 commit**: 执行方(J2)从 Codex ACCEPT 记录抄入 `J1_PROBE_APPROVED_COMMIT`。启动器强制: HEAD==approved · 全仓 tracked 零改动(untracked 不计, 标签如实=`tracked-clean@approved-commit`) · **启动器自身磁盘字节==approved commit 版本(外绑非自证)** · 仪器 blob==approved 版本。
- **仪器内闸(依序)**: self-sha==启动器注入值 → **绑定模块 sha 在 import 之前核**(被换模块零执行) → 发送器 sha==`b01f88b1…` → **RPC 运行时实体**(kaspa-wasm 入口 JS `07f86beb…` + kaspa_bg.wasm `51cec45e…`, resolve 落 vendored git-tracked 路径)==钉定。全链结果+批准 commit 写入 run-header JSONL, 每样本带 runId。
- **host profile(启动器钉死)**: SENDER_ADDR=J2-tn 完整地址(安全承重, 行绑定用) · NODE1=J2 机器本地节点 · NODE2=J1 笔记本观测者 `ws://100.111.126.10:17210`(tailnet 直读) · RELAY_ID=传输寻址(J2 供给完整值+前缀 102cbb99 校验+全量入档; 错值⇒sender 不符⇒not-bound 零 credit, 结构上无法伪造)。

## 证据判定(gate#1, Codex 已 ACCEPT)
绑定判定=纯模块 `kasia-console/src/lib/j1-probe-binding.mjs`(词表封闭): content 全文相等 ∧ sender 精确相等 ∧ 行 tx_hash 64-hex ∧ **与 SUBMIT_TXID 全等**才计 first-seen/confirmed; 不等=contradiction 零 credit。证据: .test 9/9(含 N-1 负测) · .mutants 隔离执行器 7 detected/0 MISSED/0 INERT/0 BROKEN(含 fail-closed→放行点名变异) · 双验(Bettor 代码审+J2 harness-owner 复跑)。
失败分类学(excluded 样本全字段入档, 零 node-health credit): node-not-synced-submit-reject / utxo-too-small(SEND-leg) / sender-refused(中止) / connection-refused / no-machine-readable-submit-txid / txid-identity-contradiction。

## 每样本字段
trigger{t,d1,d3,rate,node1 态} · node2AtTrigger(发送前立读, 失败{absent,reason}) · submit{t0,ok,txidFull} · firstSeen{t,txHash,status}|none · confirmed{t}|timeout · node2AtConfirm · runId。

## J2 执行命令(Codex ACCEPT 后, 其检出根)
`J1_PROBE_APPROVED_COMMIT=<ACCEPT 记录中的 commit> J1_PROBE_RELAY_ID=<J2-tn 完整 relayId> bash scripts/j1-trough-probe-launch.sh 360 0`
样本 JSONL 交 J1 复核, 制品#3 内嵌全量后 commit。

## 附录: pin 值(与本文件同 commit 的字节)
发送器 b01f88b18139654d36fb4bdcad6950d7201ea4c38c82101ccc21353f6128364b · 绑定模块 b54d8af1bd166000be82019142043ebf3cf96500a596b9c4a90ce920a867d55d · RPC entry 07f86bebfb8496628f30a8637f90fcfcee67043612ce50f40c578d61f8064bb3 · RPC wasm 51cec45e7f21dd7962bcc1830a4236c514d8f829d2babca30e77602a214c3791 · 仪器/启动器 blob 见启动器内嵌与 ACCEPT 记录。
