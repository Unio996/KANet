# KANet-UI 交件：主网 kaspa-scout 已启动 + oracle-mn-01 入池成功（账本 (1824)，选项 B）

作者自报；Bettor 请独立核。未改 env/代码、未重启 console、未设 `is_oracle`。D-021：不含余额/地址；relay 名与 txid 为链上公开信息。

## 一、基线（启动 scout 前，16:15Z 前后）
- console PID 3436（listen 3202 = 3436，pidfile 一致）；17110 监听者 kaspad PID 4752；空闲提交 55.1 GB；console 工作集 145 MB；kaspad 工作集 813 MB；`scout_checkpoint` 0 行；`scanner_enabled` 键不存在；`GET /api/discovery/scanner/status` → `running:false`。

## 二、启动 scout 与 10 分钟监控
- `POST /api/discovery/scanner/start` → `{"ok":true,"pid":35040}`；status：`running:true, mode:"rpc"`，startedAt 2026-10-03T16:15:48Z。
- 核对：命令行 `node src/index.mjs`，父进程 = console 3436，cwd 取自 scanner.js 的 `SCOUT_DIR`（= `D:/kanet-tn12/kaspa-scout`；进程 cwd 本身我没直接读，靠代码+命令行推断）；连接：到 17110 ×3（本机节点）、到 3202 ×1~2（console），**无其它外部 TCP 连接**（监控期内 Established 仅这两个端口；api.kaspa.org 未出现，history-fetcher 仍可能在启动时短连，未捕获）；`SCAN_MODE` 实际 `rpc`；console 日志 `[scanner] started scout (rpc) seed=086n8wqv PID 35040`。
- 9 轮每分钟采样（16:17–16:25Z）：scout 存活，工作集 95→100 MB，CPU 累计 0.8→3.0 s（10 分钟约 3 s）；空闲提交稳定 55.3 GB；kaspad 工作集 784–950 MB 无异常；`scout_checkpoint` 出现 `_global_` 行且 `updated_at` 每分钟前进（`last_blue_score` 一直为 null，我没追原因）；console stderr 致命/uncaught/unhandled/403 命中 0；scout 状态行 `report: ok=0 fail=0`（尚无命中广播时的正常值）。
- 收尾时（16:35Z）：scout 仍存活，工作集 100 MB，CPU 累计 5.5 s，stderr 命中仍 0。**scout 留在运行**，`scanner_enabled=true` 已由 start 写入（console 之后重启会自动拉起，看门狗接管）。

## 三、oracle-mn-01 重播 enroll（同一 lock_until_daa=566300000）
### 凑 UTXO（钱包内部自转，只花手续费）
开始时 mn-01 无 ≥3 KAS 的单笔。自转 txid（均 api.kaspa.org is_accepted=true）：
- a095b86e…309c（3.1 KAS 自转，fee 0.034272）
- 9bfb1410…ab17（3.1，fee 0.033154）
- dcec2eed…6598（4.5，fee 0.03539）
- 722042a3…027e（4.5，fee 0.03539）→ 钱包 UTXO = 4.5 / 3.1 / 0.31（两笔 ≥3.1 且已确认）
- 偏离派工之处：任务写「自转 3.1 两次」，实际第二次 3.1 自转把上一个 3.1 又并掉了（relay 选币按升序、凑不够单笔时 merge 一部分），所以改用 4.5 自转把零碎并成一个大 UTXO，再保留已有的 3.1；仍是钱包内部转账。

### 为什么中间两次重播失败（都零成本损失，仅 ~0.003 KAS 手续费各一段）
- 第一次重播（紧跟 4.5 自转之后，<60 s）：第 1 段成功（txid 8e4f45e4…20b9，525 B，accepted），第 2 段失败「have 0.356291」。
- 第二次重播：第 1 段 txid `54b1d7e4…`（accepted），第 2 段失败「have 1.496914」。
- 原因（读码 + 现象）：relay 的 `_pendingSpentUtxos` 会把「本次选入的所有 UTXO」标 60 秒待花（`kasia-relay/src/lib/transaction.mjs:52,60-65,259`），merge 模式下它标了全部候选而 Generator 只花了一部分，**未被花的 3.1 也被隐藏 60 秒**；自转后马上发 enroll 就看不到它。第二次失败是第 1 段挑了 3.0（恰在门槛边缘，门槛 = 2×max(估费,1.5 KAS)），第 2 段无 ≥3.05 可用。两个孤立第 1 段（8e4f45e4、54b1d7e4）已被 console 收进 `broadcast_messages` 缓存，**没有造成误处理**（chain_events 里只有真正完整的那条）。
- 解法（已执行）：4.5 自转后等 ≥110 秒（超过 60 s TTL）再重播。

### 成功的重播
`POST /api/oracle-pool/enroll`（`staker_pk_x`=mn-01 公钥，`lock_until_daa=566300000`，`signing_relay_id`=mn-01）→ `status:already_enrolled`，`broadcast.ok:true`，两段 envelope：
- dd17ab72f7a72cfff1a91bb5dc8489609ce5d40997425d5452e3d740aa3f0810（525 B，accepted=true）
- dc707d442115ef496df82c285866c77a1091fc5c7aca05ed3b1930a4b3712358（319 B，accepted=true）

## 四、入池核对（只读）
- `broadcast_messages` 由 0 行 → 4 行（频道 `kanet-prediction`）：8e4f45e4、54b1d7e4（两条孤立第 1 段，各 491 字符）+ dd17ab72、dc707d44（hash `941c7fe3…` 的两块，重组成功）。
- `chain_events`：出现 1 条 `oracle_stake_enroll`（tx dc707d44，重组完成那一块）。
- `oracle_stake_enrollments`：那一行由 `source=manual` 变为 **`source=chain_envelope`**，`active=1`；扫描器一轮后 `amount_sompi=100000000`、`last_scanned_at` 有值。
- `oracle_pool_chain_view`：16:34:17 出现快照，`snapshot_daa=556249341`，`pool_size=1`，叶子含 mn-01 公钥，`stake_sompi=100000000`，`lock_until_daa=566300000`。
- `GET /api/oracle-pool/state` → `total_members:1, active_members:1, total_active_stake_kas:"1.00000000"`，成员 relay_address 为 mn-01 的地址。
- 押金：c8f63c5bf5af1b8216921240c6b992fcf42a3137ff0259dcd33f290543455d48（1.0 KAS，前序已交），未再押。

## 五、状态 / 如实
- mn-01 已入池（pool_size 1）。02~06 未动，等你放行。
- 02~06 的钱包各 3 个 UTXO（4.8 / 3.1 / 1.2）；按本次经验，**做第一段前必须先等 60 秒不动 relay，且需保证重播时有两笔已确认 ≥3.1 且互不被 merge 隐藏**；它们没做过自转，直接重播应能成功（这是推断，未实测）。押金每个还需 1 次 1.0 KAS 转入各自 P2SH。
- 每个钱包仍有「残余」的孤立第 1 段风险：重播失败会留下孤立 envelope 第 1 段（无害，已验证）。
- lock_until_daa=566300000 约比当前 DAA 多 10.0M（≈11.6 天），续期 cron 阈值 3M，最早约 7M DAA 后才会尝试续期。
- 本次 scout 启动后主网 console 的 `chat.js` 自动回复路径：绑 adapter 的 relay 数仍为 0（Bettor 已核），未触发。
