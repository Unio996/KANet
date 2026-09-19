> **Status**: CURRENT（2026-09-20，NWT；对象 = `origin/coord/kanetui-d028-watch-only-accounts-design` 头 `0df8b5ea`：`docs/2026-09-20-kanetui-d028-watch-only-accounts-design-v0.1.md`；设计审，只读）

# D-028 冷存只读账号进主网 console 资产页 —— 设计 v0.1 NWT 审

方法：独立检出（`D:\kanet-nwt-cand`，`0df8b5ea`）读全设计稿；对设计引用的现有代码逐处核（`getKasBalance` / `getWorkingRpc` / `_readNodeSynced` / `portfolio.js` / `backup.js` / 通用表枚举）；对活节点与活库做**只读实测**（形状、布尔、计数——**不打印任何地址 / 余额 / 账号名**）；不改任何东西。D-021：本页不含地址、金额、账号名↔地址对应。

## 结论：**设计方向 GREEN（选独立表 + 只 GET + 诚实读数）；1 条 MUST（须 Bettor / Owner 显式裁）+ 5 条 SHOULD，出 v0.2 再审。**

选 B（新表 `watch_accounts`）我认同，并且核实了它的关键论据成立：**没有任何现有代码读这张表，也没有任何通用"遍历所有表"的代码会把它扫进去**（§二-①）。要改的是三处：公网回落与主网既有策略冲突、`api/backup.js` 那条"必须"不该做、"读数诚实"的判据还不够硬。

## 一、MUST

### M-D1（MUST，须显式裁）公网回落保留，与主网已配置的 `KASPA_RPC_LOCAL_ONLY=1` 冲突
设计 §4-2 与 Bettor 的裁定都是"保留公网 API 回落（地址本就链上公开）"。**我核到的事实**：
- 主网 `kanet.mainnet.env` **设了 `KASPA_RPC_LOCAL_ONLY=1`**（只核了键的存在与是否恰为 `1`：present=1、equals1=1，没读别的值）。`rpc-health.js:27` 注释写的语义是"⇒ 不做 Resolver 发现（fail-closed 到 null）"，`getWorkingRpc()` 在这个模式下本机不行就返回 `url:null`——即运维**已经选了"严格只用本机"**。
- 现有 `getKasBalance`（`api/relay.js:704-726`）的 REST 回落（`api.kaspa.org`，`:719`）**不受这个模式约束**——RPC 失败后无条件外发（这是**既有行为**，热钱包地址今天就这样）。设计稿把它当"既有做法，可接受但须知"。
- 新增冷存读取若同样走 REST：① 在一台**已声明严格本机策略**的机器上**新增**一条公网外发面；② 更实质的是**关联性**——"地址本就链上公开"成立，但**"这几个冷存地址与这几个热钱包地址由同一个 IP 在同一时刻查询"这层归属关联不是公开的**；把冷存地址加进同一批外发，等于把归属线索交给第三方。
**要求**：v0.2 必须**显式**写明取哪一种，不能沿用默认：(a)（**我的建议**）新读取模块**遵守 `KASPA_RPC_LOCAL_ONLY`**——为 `1` 时**不做 REST 回落**，本机未同步 ⇒ 显示"—（无法读取）"；冷存余额在追块期几小时显示"—"是**诚实且可接受**的，代价远小于泄露归属关联；再给一个显式 opt-in（例如 `WATCH_PUBLIC_FALLBACK=1`）供 Owner 另批；(b) 保留回落，但把"与 `KASPA_RPC_LOCAL_ONLY=1` 的冲突、以及归属关联"**写给 Owner 并取得明确同意**，且冷存查询**不与热钱包地址同批**、页面来源标注区分"公网 REST"。Bettor 的"保留"裁定我理解是基于"地址公开"，可能没看到主网已设严格模式——请带着这两条事实重裁。

## 二、Bettor 的五个审点

| # | 审点 | 我的判 |
|---|---|---|
| ① | 独立表是否真把 watch 账户挡在所有花钱 / 身份路径之外（`exchange-machine` 候选 agent、`market-seeder`、`scanner`、anti-spam `isSibling`、`trade-protocol-filter` `localAddrs`——KANet-UI 只按文本分类） | **结构性成立**。这五处读的都是 `relay_nodes` / `agent_wallets`（设计 §3.2 表的文本判定），而**新表不被任何现有查询读到**——这是"默认拒绝"的内容本身，不依赖我去逐个读函数体。我另核了**两条绕过通道**：(i) **通用枚举**——全仓非迁移、非测试代码里没有"遍历所有表"的重置 / 导出 / 清理 / 备份（`sqlite_master` 只出现在**按名字的存在性检查**与索引检查里）；(ii) 现有 `address_balances` 表是巨鲸 / 交易所余额的历史追踪（`api/chain-data.js`），与冷存读取无关、也不冲突。**未逐个读函数体**：我没有去证明"选 A 会真出事"——不需要，选 B 已使这个问题消失。 |
| ② | "读数诚实"对 IBD 期 `getBalancesByAddresses` 返回形状的假设，要不要实测 | **我实测了能测的一半，另一半不能**：活节点（此刻 `isSynced=true`）上——对已知有余额的热地址返回 1 条 `{address, balance:bigint}` 且 `>0`；**对一个从未使用过的合法地址也返回 1 条条目、`balance === 0n`（不是缺项）**；批量按输入顺序返回。所以**同步节点上的"0"是合法的真 0**，值本身区分不了"真 0"与"IBD 期的合法空值"，只能靠**状态判据**。我**无法复现未同步形状**（节点现在是同步的、我也不该让它掉队），沿用我们既有记录（IBD 期链读返回合法空值、`isSynced` 会在追块后段的 nearly-synced 窗内提前变 `true`）。所以设计的诚实度**取决于判据够不够硬**——见 S-D2。另外**现有 `getKasBalance` 恰是反例**：`Math.round(Number(entries?.[0]?.balance \|\| 0n)/1e8…)`——空 / 未同步 ⇒ 静默 `0`，且完全不看同步状态（我用它的原表达式跑了从未使用的地址：得 `0`，与"节点没读到"无法区分）。设计明确不复用它，**对**。 |
| ③ | 公网回落保留有无异议 | **有异议**——见 **M-D1**。 |
| ④ | `api/backup.js` 含新表列为必须 | **不同意，建议撤销这条"必须"**。我读了它：`/api/backup/export` / `/api/backup/import` 备份的是**社交 / mind 配置**（identities、relation_states 的分类信任字段、`relay_nodes` 的 mind 字段，`backup.js` 头注与 `:55-75`），**不是资产 / 账户注册表**；而 `POST /api/backup/import` 是个**写路径**——把 `watch_accounts` 加进去，就等于给冷存表**开了一个 HTTP 写入口**，与设计 §2.1"不开 HTTP 写接口（少一个可被误调的面）"和 §2.3"没有 POST/PUT/DELETE"**直接矛盾**。整库备份（拷 `console.mainnet.db`）本来就含这张表。若仍要导出，只能**只导出、导入侧显式跳过**并有测试钉住。 |
| ⑤ | 登记脚本拒重复地址的判据够不够（`relay_nodes` / `agent_wallets` 之外还有哪张表存地址） | **对"总额不重复计"这个目的，两张表够了**——总额只由 `relay_nodes.address`（热）+ `agent_wallets`（多链）汇入。活库实测：`relay_nodes.address` **18 行、全带 `kaspa:` 前缀、全小写、互不相同**；`agent_wallets` **0 行**（今天该检查是空转，将来才有意义）。**但判据要补两点**（S-D4）：① **规范化后再比**：`kaspa-wasm` 的 `Address` 能解析大写形式，而表上的 `UNIQUE(chain, network, address)` 是**原文**唯一——大小写 / 前缀变体绕得过。脚本入库前应统一成 `Address.toString()` 的规范形式，并用同一规范形式去比对两张表；② 我在真实 schema 里扫了带地址语义的列：**122 张表、64 个地址类列**，"本地地址"语义的有 `pending_actions.local_address`、`relation_states.local_address`、`tx_records.local_address`、`oracle_pool_membership.relay_address`、`oracle_stake_enrollments.relay_address`、`reputation_summary.address` 等——它们引用的都是 relay 地址（本来就在 `relay_nodes` 里），**不改变总额**；但如果冷存地址**出现在这些列里**，说明它**曾经是本地 relay 身份**（例如 TN12 时期的遗留），值得让脚本**只警告不拒绝**并列出命中的表，交给人判断。 |

## 三、SHOULD

- **S-D1（= ④）**：撤销"`api/backup.js` 含新表列为必须"。
- **S-D2 "读数诚实"的判据要更硬**：设计 §2.2 的 `ok` = "本机节点 `isSynced===true` 且读到"，同步判据取 `isNodeSyncedCached`（30 s TTL，`_readNodeSynced` 读的是 `env.KASPA_RPC_URL` 那台节点的 `getServerInfo.isSynced`）。三处收紧：
  ① **同一个 RPC**：余额读取用 `getWorkingRpc()`（可能是本机、局域网或——非严格模式下——发现来的公网节点，返回 `isLocal`），而同步判据读的是 `env.KASPA_RPC_URL`。两者在主网（`LOCAL_ONLY=1`）恰好一致，但设计应**要求 `getWorkingRpc().isLocal === true` 且 `isSynced` 取自同一个客户端**才标 `ok`；读自非本机节点标 `ok_public`（并按 M-D1 的决定处理）。
  ② **`isSynced` 要紧邻余额读取**（同一次调用序列里前后各读一次，两次都 `true`），别用 30 s 缓存——追块后段 `isSynced` 会提前翻 `true`，缓存窗内可能已经翻回。
  ③ **同批阳性对照**：`isSynced` 是必要条件不是充分条件。同一次 `getBalancesByAddresses` 里**并入一个已知有余额的热地址**（页面本来就要读 18 个热地址）作阳性对照——对照项读到 `0` / 缺项 ⇒ 整批判 `unavailable`，冷存显示"—"。这样"IBD 期合法空值"被读成"冷存清零"的假警报，**不靠任何同步标志也能被抓住**。测试加：对照项为 0 ⇒ 冷存不渲染 0。
- **S-D3 总额口径与热钱包侧的一致性**：① 设计 A2 的 `totals.kasAll = totals.kas + totals.watchKas`，但 `portfolio.js` 现有还有 `grandTotalKas`（含 USD 资产折 KAS）。页面头部的"总计 = 热 + 冷"到底取哪个要写死（建议：headline 用 `grandTotalKas + watchKas`，并同时保留 `kasAll` 作纯 KAS 口径），否则页面会出现两个"总计"。② 热钱包侧走的是**会静默返回 0 的** `getKasBalance`：追块期页面会出现"热钱包 = 0（静默）+ 冷存 = —（诚实）"的**不对称**。这是既有缺陷、不在本设计范围——但请在设计里写一句，并记一条后续票让热钱包读取也带状态。
- **S-D4 登记脚本**：① 规范化后比对（见 ⑤）；② **地址与名字不要放命令行**：设计 §2.1 写"执行人从私有清单读入命令行"——命令行参数会出现在进程表、PowerShell 历史、日志里。改成 `--from-file <仓库外的路径>`（或 stdin），执行后由执行人删除该文件；脚本回执只打印**条数与规范化后的前缀 / 末 6 位**，不回显完整地址。③ 命中"曾是本地 relay 身份"的表时**警告**（见 ⑤）。
- **S-D5 按地址匹配，不按下标**：`getBalancesByAddresses` 我实测按输入顺序返回，但**别依赖顺序**——`readWatchBalances` 用 `entry.address` 与规范化后的登记地址匹配（批里混入阳性对照后更需要）。
- **观察**：① 迁移号（今天末尾 v210）与 `docs/DATABASE.md` 同步更新（CLAUDE.md 铁律）。② 验收 A4 的"`watch_accounts` 标识符只允许出现在白名单文件"静态检查，用 **F2-1 的共享扫描器**（`kasia-console/test-fixtures/source-scan/`）实现，别再写第三套；扫描根含 `kasia-console/scripts/`。③ 缓存：30 s 内存缓存 + 页面显示 `readAt`——同意，不落库。④ 用户面（冷存区块的版面 / 文案 / 徽标）须 Owner 批，我不评。

## 没做 / 未证
- **未复现"未同步节点"的返回形状**（节点现在同步、不该让它掉队）；②里"IBD 期返回合法空值、`isSynced` 提前翻 `true`"沿用我们既有记录，未在本次重测。
- §3.2 的 271 行 / 63 文件 `relay_nodes` 消费者审计我**没有重做**（选 B 后不需要）；我只核了五个点名的消费者读的是 `relay_nodes` / `agent_wallets`。
- 没读 `api/backup.js` 的每一行，只核了它的备份范围（社交 / mind 配置）与 import 是写路径。
- 我没有主网 env 里其它键的值；`KASPA_RPC_LOCAL_ONLY` 只核了"存在且恰为 1"。
