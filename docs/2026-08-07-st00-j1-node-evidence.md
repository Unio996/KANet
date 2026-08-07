> **Status**: CURRENT · ST-00 exposure 证据包 **J1 节点侧**(补 J2 主证据包 `st00-exposure-evidence.md` 跑不出的那部分 —— 本机 RPC/DB 读数, 跨节点第二源, 别台重跑不出) · 承 Codex ST-00 v0.2 审(3486cb17)八项形态要求

# ST-00 J1 节点侧 exposure 证据包

## §0 身份锚(Codex 八项之: branch/commit/kaspad/network/DB 身份)
- KANet 检出: `bshard-m3-deploy`(证据落库时 HEAD 见本文件 commit)
- 本机 kaspad **二进制自报**: `kaspad v1.1.1-toc.1-ab4c51a`(启动横幅 `D:\kaspa-tn12-data\kaspa-testnet-12\logs\rusty-kaspa.log`, 本次进程 02:06:42 本地起)
- network: `testnet-12`(RPC `getBlockDagInfo().networkName` 每次核过)
- DB: `D:\kanet\kanet\kasia-console\data\console.db`(⚠ 无可查询 schema 版本, `PRAGMA user_version=0`, 无 migrations 表 — 同 J2 证据包的 schema 锚缺口; 唯一锚 = `migrate.js` 最高标记)
- 🔴 **作用域**: 以下全部是【本机】读数。跨节点第二源, J2 台重跑不出(其 `pool_bettor_sides`/`market_shards` 与本机不同步; 本机 RPC UTXO 读数是本机节点的 L1 视图)。

## §1 (b) 过剪枝点 UTXO 仍可花 —— ST-00 §3-bis #3 引用的"J1 38/38"
**命题**: 产生块已过 pruningPoint 的 UTXO 仍在 UTXO 集、getUtxosByAddresses 仍返回 ⇒ 仍可花(剪枝丢块历史不丢 UTXO 集)。
- **RPC 原文**: `rpc.getUtxosByAddresses(<120 个 spine_p2sh 地址>)`; 地址来源 SQL `SELECT spine_p2sh FROM pool_markets WHERE spine_p2sh IS NOT NULL LIMIT 120`。
- **观测锚**: `virtualDaaScore = 75,921,835`; `pruningPoint daaScore = 74,644,233`(getBlockDagInfo().pruningPointHash → getBlock().header.daaScore)。
- **结果**: 返回活 UTXO = **38**; 其 `blockDaaScore` 范围 **51,607,750 → 52,431,603**(全部 < pruningPoint 74,644,233, 即产生块早被剪 ~22M DAA); 仍被返回、仍是 100.00 KAS 活 UTXO。⇒ **38/38 过剪枝点仍可查/可花**。
- 脚本: `scratch/j1-utxo-past-prune-0807.mjs`(gitignored, 本文件为其可复现证据落库形态)。
- 🔴 **措辞**(承 AP 规则 70): 这是"被检本机 UTXO 集上 38 个过剪枝点 UTXO 仍存在且可查", 不推广到"全部过剪枝 UTXO 都可花"(只测了这 38 个)。

## §2 TN12 DAA/秒 校准 = 9.134 —— 修正全队"天数"高估约 9 倍
**命题**: 剪枝窗口/地平线的"天数"换算依赖 DAA/秒, 而全队一直用 ~1(错), TN12 实测 ≈9.13。
- **方法**: `pruningPoint block`(daa 74,644,233, header.timestamp = **2026-08-05T16:38:03.492Z**) vs `sink block`(daa 75,922,949, ts 2026-08-07T07:31:11.507Z)。
- **计算**: ΔDAA 1,278,716 / Δ139,988 秒 = **9.134 DAA/秒**。
- **后果**: 剪枝窗口 1,278,716 DAA ÷ 9.13 ≈ **1.62 天(~39h)**, 不是 ~1 DAA/秒 给的 14.8 天。⇒ **判到期用纯 DAA 比(准); DAA→天换算前必须实测 DAA/秒。** 绝对时间锚 = pruningPoint block ts `2026-08-05T16:38:03Z`(不经 DAA/秒, 任何产生块早于此刻的市场已过剪枝)。
- 脚本: `scratch/j1-daa-per-sec-0807.mjs`。

## §3 kaspa_tx_log.from_address 本机全 NULL —— G-4 引信保险销的第二源
- **SQL**: `SELECT COUNT(*) FROM kaspa_tx_log`(=16,219) · `... WHERE from_address IS NOT NULL AND from_address <> ''`(=**0**) · `... WHERE from_address IS NULL`(=16,219)。
- **结论**: 本机 from_address 全 NULL(有值 0/16,219)⇒ 与 J2 台(14,928,354 行全 NULL)一致 ⇒ **relay block-added indexer 根本不填此列**(两台行数差数量级却都全 NULL ⇒ 非覆盖窗函数)。⇒ G-4 的 chain re-derive 分支查询恒空(被检数据无匹配, 非"从未执行" — 每 tick 仍进入查空 continue)。

## §4 306 spine / 30,600 KAS(本机 cross-node ext-pool-v07)—— 见 [[project_j1tn-0806-spine-30600-open]]
- 本机 `pool_markets` `id LIKE 'ext-pool-v07%'` = **1,317**(全 cross-node); protocol_status 全 = `unresolved_needs_authorization`(1,293)/`pending_bettors`(24)—— 🔴 **本机不推进 cross_node status**(ingest 对方 publish 看不到对方 settle), 故本机 status 无区分力, 不能用于 A/B 分类。
- 链上: 306 个 spine_p2sh 有活 UTXO, 100.00 KAS × 306 = **30,600 KAS**; txid == spine_lock_tx 306/0(outpoint 级 1:1, 污染 0)。观测锚见 [[project_j1tn-0806-spine-30600-open]](三夜锚 74,686,029/74,738,752/74,772,006; 本轮重取 75,537,869 逐格相同 ⇒ 跨一天未被动过)。
- ⚠ 证据等级: 出自 gitignored scratch 脚本 ⇒ 本文件为其落库形态; 行级数据不入库, 阈值/锚/SQL 原文入库供重查。

## §5 与 J2 主证据包的关系
- J2 `st00-exposure-evidence.md` 落: 171,227/81,665/48%/701/36,012/99.5%/40-40 等(其台 DB + 普查)。
- 本文件补: **凡本机 RPC/DB 读数**(§1-§4), J2 台重跑不出。两份合起来覆盖 ST-00 全部引用了 J1 侧的数字。
- 去重/分类规则(spine 定义等)以 J2 主证据包为准; 本文件不重定义, 只提供本机侧读数的可复现锚。
