# J1 trough 探针测试计划 v1.2(Codex MSG-233 复审 5 条 MUST-FIX 合规版)

> **Status**: AUTHORIZED-PENDING-SEND-LEG · J1tn · 2026-08-17 13:3xZ · 取代 v1.1(五条 MUST-FIX 全落)
> **授权链**: Owner 双通道直令(ledger (420) Bettor 终端 +(421) J1 终端佐证)= 显式证据政策变更; Codex f76372cb: 政策变更 ACCEPTED · 概念 ACCEPTED IN PRINCIPLE · 本文件即其要求的可复核测试权威。
> **排序**: SEND 腿拆分 landed 之后执行((420) 承重排序)。

## MUST-FIX 合规对照
1. **节点身份绑定+同期第二节点**: 发送观测节点=`local-J1 ws://127.0.0.1:17210 (testnet-12)`; 第二节点=`mining-host 100.99.147.101:17210`(SSH 隧道), **每样本一读**, 不可达记 `{absent, reason}`。
2. **总时限**: 3 样本 **或 360min 总时限**(仪器参数 TIME_CAP_MIN, 默认 360)先到者停; 另两条中止判据(发送器异常/判词 runaway)保留。
3. **仪器入 git**: `scripts/j1-trough-probe-instrument.sh`(与本文件同 commit, 即不可变权威)。
4. **三段证据分离**: submit-accepted(发送器 HTTP200+ok+txId, **仅记录, 不作链观测**)/ first-seen(本机 console 出现消息+tx_hash=链摄入观测)/ confirmed(status=confirmed)——**只 first-seen 与 confirmed 计入 node-health**。发送器语义未经独立核实, 故采分离记录路径(Codex 给的两选之二)。
5. **逐样本字段**: trigger{t,d1,d3} · submit{t0,ok,txid} · firstSeen{t,status,txhash} · confirmed{t}|timeout · secondNode{daa,synced,t}|{absent,reason} · exclusion(null | `broadcast-fail⇒SEND 腿证据, 零 node-health credit`)。JSONL=`scratch/j1-trough-probe-artifact3.jsonl`, 制品#3 内嵌全量后 commit。

## 范围(不变)
≤3 条唯一内容频道消息(dev-coord-testnet, J1tn 自己的 relay)· 仅 trough(2min DAA<1/s)触发 · 间隔 ≥15min · 非 money-path 零交集。

## 附录: 依赖工具 sha256 钉定(执行时仪器自检发送器 3/3 保护, 不符拒启)
- j1-send-one.sh: `c70c76d47d279e3956faafeae36686c5dd25cb0d757d4c0cb26d042d12c5980f`
- j1-node-sync.mjs: `ce4fe18c7ea591435255255811f0ba018e2eb1375e8a45abbaaa41b75c0b19cc`
- j1-remote-node-check-0812.mjs: `195c6bceb7fafd59966de6c2530b23b3e23437d4ab604e24c62e35078c9d5162`
