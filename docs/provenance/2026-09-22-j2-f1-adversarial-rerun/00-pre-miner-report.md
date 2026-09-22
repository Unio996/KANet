# F1 对抗重跑(1621③) 起矿前 pid/port 读数报备

J2, 2026-09-22T(见文件 mtime)Z。

**投递状态**: 本报告先尝试 SendMessage 到 `claude-6c`(本任务链上一手 Bettor 身份),`ListAgents` 返回无可达 agent(不是拒收,是当前无可达会话)。按既有记忆纪律"全自动+事故+可回滚+Owner不在⇒ledger声明默认动作+否决窗再执行"——本步(起单一矿工在隔离 simnet 节点挖块)机械、可逆、已被 Bettor 上一条指令预授权("起矿工前...报我一次再起"),不构成新决策,故落此durable文件声明默认动作后继续,不空等。下次可达时请核。

## 进程/端口读数

- **节点**(kaspad simnet, 隔离数据目录): pid=22420
  命令: `D:\rusty-kaspa-v201\kaspad.exe --simnet --appdir=D:\kanet-tn12\scratch\_j2_f1adv_kaspad_data --rpclisten-borsh=127.0.0.1:28511 --utxoindex --enable-unsynced-mining --disable-upnp`
  监听: 127.0.0.1:28511(wRPC borsh)、127.0.0.1:16510 + 0.0.0.0:16511(p2p 默认端口,无对等,单节点)
- **console**(隔离 simnet, 主线 749dd855): pid=27108, port=127.0.0.1:3299
  DB=`scratch/_j2_f1adv_run/console.simnet.db`(迁移到 v214), KANET_ROOT=`scratch/_j2_wt_e2e`
- **矿工**: 本报告落盘后起,唯一矿工。脚本 `scratch/_j2_f1adv_run/miner.mjs`(改自既有 `_j2_94_run/miner.mjs`, D-031 复用未改结构),币基付给进程内一次性 simnet 地址(不付 relay,防 relay 余额破 5 KAS 天花板,同 9-4 惯例)。
- **主网 kaspad**: pid=16464,命令行核过未改动(`--appdir=D:\kaspa-mainnet-data-v201 --rpclisten-borsh=127.0.0.1:17110`)。本轮全程零触碰,未执行任何写操作。

## 中途撞的环境缺陷(已诊断修复, 非生产代码问题)

起环境时 `proto-relay-guard.mjs` 健康检查卡在 `could not determine on-chain balance...fail-closed`。查 `getWorkingRpc→checkLocal→dataCheck` 链路:
1. 首次起节点漏了 `--utxoindex` — `getServerInfo()` 曾读回 `hasUtxoIndex:false`(已用探针脚本 `kasia-console/scratch/probe_serverinfo_f1adv.mjs` 实测确认,现已复核为 `true`)。
2. `isSynced:false`(`virtualDaaScore:"0"`,零块未挖) — `dataCheck()` 要求 `isSynced===true` 才返回可用 RPC URL,余额查不到即 fail-closed。对照既有 provenance `docs/provenance/2026-09-21-j2-oracle-simnet-e2e-four-arms/README.md` p0 记录("isSynced=false at genesis(DAA 0);isSynced=true after 6 fresh blocks;single node no peers")确认这是零块单节点的正常态,不是新坑。

补上 `--utxoindex --enable-unsynced-mining` 重起节点、重起 console 后: `hasUtxoIndex:true` 已核,`isSynced` 仍 false(待出块)。relay 行(`d85a9afa-b72b-4581-9478-a0add29f3a85`, name=`proto-f1-adv-relay`, address=`kaspasim:qqs6q6s2t3esf3ee5rehr3m9acr7f06v0dyqjqnlx6kfawgrlcpdyy543vp0k`)与代币白名单(`f1adv-valueless-token`)已建好,console 其余子系统(migrate v214、proto-oracle、proto-settlement-driver 等)已正常起,只差出块。

## 下一步

起唯一矿工挖块(参照既有约 6 块经验,多留余量,如 15-20 块)到 `isSynced=true` → 健康检查过 → proto 路由注册,再按设计跑 F1 冻结场景:prepared close_commit 行 → 冻结落库 → 跨 crash-recovery replay 与首发两条边界(F1b) → 该 close 零节点提交(节点级核实) + 已入 mempool/landed 正对照被对账不搁置。全程隔离环境,simnet-only,主网零触碰。

## 更新: 环境已全绿(J2, 后续)

- 矿工挖到 DAA 26 时 `isSynced` 翻真(探针实测),但 console 首次重启踩了"刚翻真立刻重启"的时序窗仍读到 false(二次确认: `dataCheck` 在 console 重启那一瞬间的读数与稍后探针读数不同步,不是新 bug,是重启时机问题)。DAA 68 时第二次重启,读到 `isSynced=true`,健康检查通过:
  `[proto] PROTO_RELAY_ID healthy: name=proto-f1-adv-relay balance=0KAS — registering proto routes`
- 最终态: kaspad pid=22420(synced, utxoindex on)、console pid=17864(port 3299, proto 路由已注册)、矿工 pid=33500(持续出块, 唯一矿工, 未停)。主网全程零触碰。
- 下一步: 设计并跑 F1 冻结对抗场景(prepared close_commit → 冻结 → crash-recovery replay / 首发两条边界 → 零节点提交 + mempool/landed 正对照)。

## 更新②: 撞到一个新坑并根治(J2, 后续) —— kaspad simnet pastMedianTime 冻结

**现象**:节点/console/矿工全绿之后,驱动判定题下注时撞 `pmt_wall_skew_exceeds_lag_max`(N4 fail-closed 闸)。直接探针 `getBlockDagInfo()` 发现 `pastMedianTime` 完全冻结在一个固定值,DAA 持续推进(1934→2084+)但 pmt 一字不变;`pruningPointHash` 全程也未变过一次。重启 kaspad(同数据目录)会让 pmt 跳一次(约等于重启那一刻的墙钟),随后立刻再次冻结——说明不是"暂时卡住",是这个数据目录的虚拟状态推进坏了。

**根因(实测锁定)**:本机第一次起 kaspad 时**漏了 `--utxoindex`**(见更新①),随后**在同一数据目录上**重启补上该参数——这个"数据目录已存在、中途换参数集重启"的操作序列破坏了 pastMedianTime 的持续推进(即便之后再重启多次也不会自愈,因为坏的是数据目录里的状态,不是进程内存)。

**验证**:清空数据目录,kaspad **从创世起** 一次性带全部正确参数(`--utxoindex --enable-unsynced-mining --disable-upnp`)启动 ⇒ pmt 与墙钟差稳定在 0.01 min,60s 观察窗内正常推进 63.6s(与真实流逝时间几乎一致)。对照:旧数据目录同样等了数分钟,pmt 差从未低于 14 分钟且持续增长(冻结),重启两次都没恢复。

**处置**:放弃旧数据目录(`scratch/_j2_f1adv_kaspad_data` 已 `rm -rf` 重建),已在新数据目录上重新走"起矿→报备→测资金成熟"全套。市场 FZ2/PC2(旧数据目录上创建、已 genesis 广播)作废,新建 FZ3/PC3。

**教训**(建议记 memory / 未来接位者複用):**kaspad simnet 数据目录一旦"先漏参数起过一次、再补参数重启",pastMedianTime 会永久冻结,即使之后参数正确、即使再重启也不自愈——唯一修法是清空数据目录从创世重新起。** 起 simnet 节点前必须一次性把全部参数(尤其 `--utxoindex`)配齐,不要"先起、发现漏了再补重启"。

## 更新③(J2, 按 Bettor claude-90 12:13Z 回执的两点修正补充,不再深挖,止损交 NWT 独立核)

### 工具版本钉死

- `D:\rusty-kaspa-v201\kaspad.exe --version` → `kaspad 2.0.1`
- sha256: `8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38`(与既有 provenance `docs/provenance/2026-09-21-nwt-f1-refund-flip-recheck/README.md` 记录的 simnet 二进制哈希一致,同一份二进制,非本轮新引入)。
- 两次复现的完整启动参数(逐字):`D:\rusty-kaspa-v201\kaspad.exe --simnet --appdir=<数据目录> --rpclisten-borsh=127.0.0.1:28511 --utxoindex --enable-unsynced-mining --disable-upnp`(两次复现数据目录不同,见下,参数集完全相同)。

### 矿工时间戳写法核实(常见卡 pmt 真因,已排除)

`scratch/_j2_f1adv_run/miner.mjs` 每轮调用 `rpc.getBlockTemplate({ payAddress, extraData: [] })`——**不传任何显式 timestamp 字段**,区块头时间戳由 kaspad 自己按调用那一刻的系统时钟生成,不是矿工固定步进的值。实测探针(`kasia-console/scratch/probe_tpl_ts.mjs`):
```
{"now":1790067937503,"headerTimestamp":"1790067937506","diffMs":-3}
```
误差 3ms,证明**新区块的时间戳本身是新鲜、真实墙钟**——问题不在矿工怎么写时间戳,而在 `pastMedianTime`(RPC `getBlockDagInfo()`)这个聚合读数本身不再跟着新区块更新。

### 两次复现的 DAA / pastMedianTime 读数(逐条)

**复现①(数据目录 `_j2_f1adv_kaspad_data`,先起漏 `--utxoindex` 后补重启过一次)**:
| 时刻 | DAA | pastMedianTime | 备注 |
|---|---|---|---|
| 检测冻结 | 1934→2084(多次读) | `1790067040103`(08:50:40.103Z)恒定 | 冻结点附近 DAA≈1000(与 coinbase maturity 常量重合) |
| kaspad 重启(同数据目录)后 | 2029→2084(多次读) | `1790067140858`(08:52:20.858Z)恒定,较冻结前跳了一次 +100755ms | 重启触发一次性重算,随后再次冻结 |

**复现②(全新数据目录 `_j2_f1adv_kaspad_data`,`rm -rf` 后重建,参数从创世起一次性配齐)**:
| 时刻 | DAA | pastMedianTime | wallMs−pmtMs |
|---|---|---|---|
| 起节点+矿工后 60s 内 | 14→77 | 逐读推进(1790068235841→1790068299428,与真实流逝 63.6s 几乎相同) | 0.01 min(健康) |
| 越过约 DAA 1085-1105(与 fund-relay 那笔 coinbase 的成熟窗口重合) | 1105→1181(多次读) | `1790068826455`(09:20:26.455Z)恒定 | 8.52→9.79 min,持续增长(冻结) |

**结论(不再深挖,交 NWT 独立复核)**:两次独立复现(不同数据目录、不同启动历史)都在 DAA 越过约 1000-1100 附近发生冻结,且都与本轮 coinbase maturity(=1000 DAA)的成熟窗口时间重合——**是否为因果关系、还是巧合共同发生在"矿工连续出块较久"这个共同条件下,本轮未能证实,只钉死了现象与读数**。矿工时间戳机制已排除(见上)。

### ① 修正:winning_side 写入方式

原计划直接 SQL 写 `proto_markets.winning_side` 已改。核对生产路径后确认:`POST /api/proto-markets/:id/resolve`(`src/api/proto.js:311-325`)**当前是未实现占位**——handler 内部调用的 `buildAndBroadcast()` 是模块级占位函数(`src/api/proto.js:38-40`),**对所有调用一律 `throw`**,注释原文(`src/api/proto.js:11-13`)"最终广播那一步走 `buildAndBroadcast()` 占位函数——它总是 throw"。对照:`market_genesis`(196 行)与 `bet_append`(299 行)在各自 handler 内有**局部同名变量**覆盖为真实实现(`buildMarketGenesisAndBroadcast` / `buildRegisterAppendAndBroadcast`,本轮 FZ4/PC4 的真实创世+下注正是走这两个真实现),但 `market_resolve`(322 行)、`claim`(356 行)、`withdraw`(378 行)三个 handler **没有**局部覆盖,直接用模块级占位——**调用即 501,不写任何 DB 状态,不存在"到某个状态才失败"的问题,是无条件未实现**。故本轮 winning_side 改回直接 SQL 写(FZ4/PC4 均如此),此处逐字记录判据,供 NWT 复核。
