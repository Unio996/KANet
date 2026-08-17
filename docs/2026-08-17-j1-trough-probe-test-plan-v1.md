# J1 trough 探针测试计划 v1.4(Codex MSG-235/236 五条合规版)

> **Status**: AUTHORIZED-PENDING-CODEX-ACCEPT · J1tn · 2026-08-17 15:2xZ · 取代 v1.3
> **授权链**: 同 v1.2(Owner 双通道直令 (420)(421))。**仪器改为纯 Node 实现** `scripts/j1-trough-probe-instrument.mjs`(v3, 与本文件同 commit)——弃 shell 内嵌解析(今晚同族引号/括号缺陷四发, 根治=单语言)。

## Codex 四条 MUST-FIX 对照
1. **依赖 sha256 启动强制**: 测量链唯一外部依赖=发送器, **git-tracked 副本** `scripts/probe-deps/j1-send-one.sh`(sha256 `c70c76d4…` 钉在仪器常量, 启动实算比对, 不符拒跑并打印两值)。旧依赖 j1-node-sync.mjs/j1-remote-node-check-0812.mjs **已从测量链移除**(RPC 采样与第二节点读改为仪器内嵌 kaspa-wasm 直连)。**披露**: ssh 隧道用的 askpass 脚本=登录凭据, 非测量语义, 不入库不参与 hash 链; 第二节点读失败一律 {absent, reason} 不伪造。
2. **完整 submit txid**: 发送器仅暴露 8 位前缀 ⇒ 仪器记 `txidPrefix`(发送器输出) + 经唯一内容 TAG 从 console 行取 **64-hex 完整 tx_hash** 作 `txidFull`, 校验前缀一致(不符打 WARN 入档)——console=应用暴露点, 属 Codex 许可的绑定路径。
3. **firstSeen 闸**: 仅当 console 行 `tx_hash` 匹配 `/^[0-9a-f]{64}$/` 才置位, 完整 hash 为结构化字段; 无 tx_hash 的本地行=零 node-health credit。
4. **第二节点同期**: **trigger 检出后、发送前立读**(at-trigger, 真时戳)+ confirmed 后补读(at-confirm)。不可达记 {absent, reason}, 永不 backfill。

## 失败分类学(超出 v1.2 的一格, 由 probe#1 事故立)
- `node-not-synced-submit-reject`: 本机节点 trough 中翻 false 时 kaspad 拒收 submit——**逆相位的真实行为, 全字段入档但零确认 credit**(它测的是"能不能提交", 与"提交后多久确认"分开记)。
- `utxo-too-small(SEND-leg)` / `sender-refused`(中止) / `connection-refused`。全部 excluded 样本带 logTail。

## probe#1 事故披露(v1.2 仪器, 已废)
14:09:59Z 触发的第一发: 发送被节点拒收(not synced ×2)**从未上链**; v1.2 仪器误入轮询臂空等——该行为已按 (434) 停机, 无任何数据被计入 node-health。v1.2 仪器(.sh)废弃, 以本 v1.3(.mjs)为准。

## 范围(不变)
≤3 条唯一内容频道消息 · J1tn relay · 仅 trough(2min 速率<1/s)触发 · ≥15min 间隔 · 3 样本/360min/发送器异常/tips>500 四停 · 非 money-path。JSONL=`scratch/j1-trough-probe-artifact3.jsonl`, 制品#3 内嵌全量。

## v1.4 增量(Codex MSG-235/236 五条)
- **#2 submit 全量 txid**: 发送器新版(sha256 b01f88b1…)在成功判据成立后、read-back 前发射 SUBMIT_TXID=<64hex> 机器可读行; 仪器解析持久化后才轮询; 无该行=excluded。
- **A 身份矛盾硬拒**: console 行 tx_hash 与 SUBMIT_TXID 全 64-hex 相等才计; 不等=excluded(txid-identity-contradiction) 零 credit; 前缀比较已删除。
- **B 执行身份绑定**: 仅准经 scripts/j1-trough-probe-launch.sh 启动——启动器校验两源路径工作树干净 + 仪器 git blob==钉定值, 注入 {EXPECTED_SELF_SHA, SOURCE_COMMIT, INSTRUMENT_BLOB}; 仪器自算 self sha 比对后写 run-header JSONL(全量执行身份+发送器 hash runtime 比对结果), 每样本带 runId。
- **C 时限硬顶**: TIME_CAP 须有限、>0、<=360(硬顶), 否则拒启; NaN/超值不再静默放行。
- **D 精确行绑定**: content 全文逐字相等 ∧ sender_address==J1tn 地址; tag 子串仅预过滤; txid 相等为独立第二绑定。
- 附录 hash 更新: 发送器=b01f88b18139654d36fb4bdcad6950d7201ea4c38c82101ccc21353f6128364b(scratch 副本已同步防漂移); 仪器 blob/sha 钉在启动器内(与本文件同 commit)。
