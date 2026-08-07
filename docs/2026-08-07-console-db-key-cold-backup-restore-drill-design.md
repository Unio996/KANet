# 运营方 console.db + CONSOLE_ENCRYPTION_KEY 冷备 / 恢复演练 · 设计稿 v0.1

> **Status**: CURRENT

**Owner**: KANet-UI
**日期**: 2026-08-07
**授权范围**: Bettor 07:20Z 派工④(design-only)+ 07:28Z 裁决(现状收执,设计稿按计划出)。**本稿本身不 authorize 任何写操作**——不做真实备份部署、不复制 CONSOLE_ENCRYPTION_KEY 到任何位置、不动生产 `data/` 目录。过审后才排执行窗。
**触发背景**: J2/J1 剪枝地平线调查(链上归属证明已不可逆丢失,详见频道 07:23-07:25Z 系列)暴露出运营方 DB 现在是相当一部分市场数据的唯一来源;本稿单独审这个唯一来源自身的可靠性(与"DB 数据能不能替代链上重建"这个更大的问题——归 J1/J2/NWT 的归档线——正交,不重复)。

---

## §0 现状(只读调查,2026-08-07 上午)

### 0.1 console.db
- 生产路径: `kasia-console/data/console.db`(`kasia-console/src/db/client.js:10`,`DB_PATH` env 覆盖,默认此路径),当前 12.5GB,WAL 文件 118MB,持续增长。
- **无任何标准化备份机制**:无 cron / 无 Windows Task Scheduler 条目 / 无部署脚本步骤(`kanet-start.sh`/`kanet-start-headless.sh`/`kanet-stop.sh`/`scripts/kanet-console-supervisor.sh` 全部 grep 过,零命中)。
- 现存的只有散落、手工、无轮换、无留存策略的 ad-hoc 快照(如 `console.db.bak-armwindow-20260723` 8.65GB),没有脚本引用它们,发生磁盘故障时**没有人知道该拿哪一份**。
- 既有 `GET /api/backup/export`(`kasia-console/src/api/backup.js`)**不是**本稿意义上的备份——它自己的注释明写只覆盖 `identities`/`relation_states`/`relay_nodes` 配置,明确排除 DB 文件本身、`CONSOLE_ENCRYPTION_KEY`、以及全部 `pool_markets`/`pool_bettor_sides`/`market_shards`/`payout_shards` 等钱相关表。名字容易被误读成"已有备份",特此点破。

### 0.2 CONSOLE_ENCRYPTION_KEY
- 位置: `kanet.env`(仓库根),单机单文件,`.gitignore` 排除(从不进 git,故 git 历史也不构成备份)。
- 加密范围: `relay_nodes.privkey_encrypted`/`.mnemonic_encrypted`(relay/agent 私钥)、`tg_custodial_wallets.mnemonic_encrypted`(托管钱包助记词)、`broker_onboarding.bot_token_encrypted`、多个 CEX/链 API key。
- **预测市场关键字段不受此 key 影响**——`side_lock_tx`/`side_p2sh`/`side_lock_daa`/`current_leaf_outpoint`/`current_leaf_state`/`payout_redeem_hex` 在 `pool_bettor_sides`/`market_shards`/`payout_shards` 里是明文列,key 丢失不直接摧毁这部分。但 key 丢失摧毁 relay 私钥与托管钱包助记词——这两类资产同样是真钱。
- **零备份、零工具化**:`backup.js` 自己的注释把 key 备份推给"owner 单独备份";`install.sh:117` 只在首次安装时打印一行提示文案,没有任何自动化。CLAUDE.md/README/系统架构文档三处都写着"丢失=不可恢复"的警告,但今天没有任何机制兜着这句话。

### 0.3 可复用先例
`docs/2026-07-19-gate0-pruning-margin-blast-radius-report.md` Artifact 2——J2 执行过一次只读 restore-drill,方法与教训直接可复用:
- 用纯文件系统 `cp` 三件套(`console.db`+`-wal`+`-shm`),**不用** `sqlite .backup()` / `VACUUM INTO`(会对活库强制 WAL checkpoint,造成争用——已有独立记忆 `feedback-heavy-read-ops-on-live-wal-db-cause-contention.md` 记录过 40-60x 延迟尖峰)。
- 拷贝目标必须是隔离路径(`scratch/` 下),绝不写回 `data/`。
- 已有操作纪律(Bettor 2026-07-16 定):重活读操作应在 **tree-kill console(quiesce)之后**做,不对活库直接跑,即使是"只读"操作。
- 该次演练做了 `PRAGMA integrity_check`(7.3GB 上耗时 82962ms)+ `pool_markets`/`pool_bettor_sides` 行数与抽样行比对,**没有**专门校验 `side_lock_daa`/`current_leaf_outpoint`/`current_leaf_state`/`payout_redeem_hex` 这几个"一旦损坏就不可能从链上补回"的字段——本稿在这一点上比 Gate0 多做一步。

---

## §1 设计目标与边界

**要回答的问题**:如果 `data/console.db` 或 `kanet.env` 今天丢失/损坏,我们能不能恢复,恢复出来的东西是不是真的对——不是"有没有备份文件"这个弱问法,是"演练过一次真实的恢复流程并验证过结果"这个强问法。

**明确不做的**(本稿边界):
- 不设计/不实施 `kanet.env` 的异地存放方案本身——这是留白项,见 §4。
- 不动生产 `data/` 目录,不重启 console,不做任何 write 路径操作。
- 不回答"DB 数据能否替代链上重建"(归 J1/J2/NWT 归档线,§0 已注明正交)。
- 不在方案过审前复制 `CONSOLE_ENCRYPTION_KEY` 到任何位置(Bettor 07:28Z 硬约束:好心备份=把最高价值秘密散到未经决策的地方,比不备份更险)。

---

## §2 提案 Ⅰ:console.db 标准化快照

- **触发时机**:console tree-kill(常规重启/supervisor 自愈)之后立即执行,而不是活库时定时执行——复用 Gate0 已验证的"quiesce 后 cp"安全窗口,避免新引入活库争用面。
- **方法**:文件系统级 `cp` 三件套(不用 sqlite 层 API),目标为独立于 `data/` 的快照目录,文件名带 UTC 时间戳。
- **完整性校验**(比 Gate0 多一层):
  1. `PRAGMA integrity_check`(基础)。
  2. **byte-exact 校验四个不可逆字段**——对快照与拷贝时刻的 live 库跑同一条 `SELECT` 取 `side_lock_daa`/`current_leaf_outpoint`/`current_leaf_state`/`payout_redeem_hex` 逐行 diff,而不是只信 schema 层面的 integrity_check(它查的是 B-tree 结构完整,不查内容语义正确)。
- **轮换/留存**:建议保留最近 N 份(N 待定,不在本稿拍死——量级取决于磁盘容量,交 Bettor/Owner 定,§4 一起送审)。
- **落点**:落码前需要一份具体脚本 spec(路径/触发钩子/校验命令),本稿只定方法论,脚本 spec 过审后另出。

## §3 提案 Ⅱ:真实恢复演练(扩展 Gate0)

在 §2 快照产出后,定期(或至少一次,用于验证流程本身可行)做:
1. 在**隔离环境**(非 live 路径)用快照重建一份可查询的 DB 副本。
2. 跑 §2 的 byte-exact 校验清单,记录耗时量级(Gate0 那次 integrity_check 在 7.3GB 上花了 83 秒,现在 12.5GB 应等比预期更久——演练本身要给出"恢复要多久"这个运维现实数字,不能事后才发现要等几个小时)。
3. 记录"如果这是真事故,从发现到验证可用总共要多久"——这是运维 SLA 层面的产出,不只是"数据完整"这个技术层面的产出。

## §4 留白:CONSOLE_ENCRYPTION_KEY 托管方案(不由本稿拍定)

这是本稿唯一答不了的一格,如实留白,不硬凑答案:
- 需要决定:几份副本 / 各自存放在哪(异地机器?离线介质?)/ 谁持有 / 访问权限模型。
- 这是一个**人与流程**决策,不是纯技术设计,涉及"谁可信、丢失后如何轮换"等超出 KANet-UI operator 域的问题。
- 按 Bettor 07:28Z 裁决:本稿交付后,Bettor 合成单一推荐上报 Owner 终拍;在此之前**任何人不得顺手复制 key**。

---

## §5 与 U1 隔离 scoping(D-012 §1 行②-a)的关系

本稿是独立的运维韧性问题,**不是** U1(密钥隔离/委员会拓扑)那条线的一部分——两者都归 KANet-UI 主笔但问的是不同问题(U1 问"谁能签",本稿问"数据丢了能不能找回")。两份产出会分开交付,不合并成一份文档,避免把两个不同性质的风险面糊在一起(同 ANTI-PATTERNS 里"合并会把最弱那条藏起来"同一条判据)。

---

## §6 下一步

1. 频道过审(NWT 审两条既有预告判据:归档物完整性判据/执行窗风险——本稿虽非 J1/J2 那条归档线,但校验方法论可交叉复核)。
2. 过审后出落码 spec(快照脚本 + 校验脚本),排执行窗(优先在非高峰期,quiesce 窗口内)。
3. §4 留白项另行由 Bettor 合成推荐,上报 Owner。
