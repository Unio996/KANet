# 主网 console/relay 起服务方案 v0.2（2026-09-13 · KANet-UI · Bettor 派工 · 只写不执行）

> **Status: DRAFT**。权威：Owner 直令（COORD-LEDGER (1061)）"旧测试网一切冻结、全员只做主网"。
>
> **v0.2 变更（Bettor 派工·把 §2 写成可执行判据供 NWT 与 v0.1 合并审）**：§2.2/§2.3 补具体验收命令（schema 版本核对/空库抽查/I4 拒起负向量的实际查询）；§3.1 步骤 6"频道 relay 身份重生成"查明具体机制并补全（每个 agent 的 canonical 发送脚本硬编码 RELAY/BASE 常量，需各自新建 mainnet relay_nodes 行+改常量+真实充值）；§5 新增 GO-E（资金/密钥面独立批点）；§1.2 与 J2 已出的合并序预检 `68e766c3` 交叉核对一致。本页覆盖主网主线三支之一（①节点已有独立执行页 `docs/2026-09-13-kanetui-mainnet-node-start-brief-for-j1-v0.1.md`；③代币合约设计另案），本页只做**②console/relay 主网化**。**本文档任何一步都不执行**；执行门 = 本方案 → NWT 红队审 → Owner 逐步批 → 执行。TN12 现有一切原样不动，本页不涉及也不建议动它。

## 0. 前提澄清（防误读）
- 本页假设 §1 的三条前置分支已合入主线（否则后面的一切无从谈起）——**分支合并的具体顺序/冲突消解由 J2 出**（Bettor 已指派），本页只描述"合到主线"这个前提本身，以及我核实到的文件级重叠点供 J2 参考，不代 J2 定合并序。
- 本页不假设"起主网 console/relay"这件事已经被 Owner GO；这是一份**待批方案**，用于让 Owner 看清楚要批的是什么。

## 1. 前置：三条侧分支 + kanet.env 主网值

### 1.1 三条分支现状（本机核实，2026-09-13）
| 分支 | 头提交 | 做什么（摘自各自 commit message，未改写） |
|---|---|---|
| `coord/j2-a-local-only-strict` | `6dec9379` | `KASPA_RPC_LOCAL_ONLY=1` 变严格：唯一可信 RPC = env `KASPA_RPC_URL`，本机不可用即返回 null，不再回退 DB 配置端点/Resolver；relay/scout/escrow 收进同一信任域（`resolveChildRpcUrl`）；写入口拒写非本机；五处构造前判空（`requireRpcUrl`）；relay 侧顶层 `assertStrictRpcEnv`。 |
| `coord/j2-b-network-single-source` | `346adbce`（叠 `f8af124d`） | 新增 `shared/lib/kaspa-network.mjs` 单一源 helper + console/relay 薄包装；33 处"按地址前缀推断网络/二选一/剥前缀"站点全部换成走 helper（**网络只从 env 来，不再从地址前缀猜**）；relay-manager 单一源 + **"I4 行"：relay 的 `network` 字段与 env 的 `KASPA_NETWORK` 不一致 ⇒ 拒绝启动该 relay**（这条直接决定 §2 的 relay_nodes 处置口径）；`rpc-listener.mjs` 顶层 `configuredNetwork`；新 lint 规则 `R-NET-PREFIX-INFER`/`R-NET-PREFIX-EITHER` 升 BLOCK 级。 |
| `coord/j2-c-no-tx-landed` | `1d4b7fd2`（含前序 5 笔） | 修 NO-TX-NO-STATE 两处硬伤：kaspa 支付网关从硬编码"已确认"改成真核（`verifyCrossChainTx` + relay `check_utxo_landed` 深度 ≥ `REORG_SAFE_MIN_DEPTH`）；结算器盲重试改 `prediction-payout-gate`（落链深度够了才 completed）；新 `escrow-landed-gate.mjs` 硬消费门（`escrow_landed_at` 未落 ⇒ 拒绝往下走状态机）；新 `tx-landed-reconciler.mjs` 5 分钟 cron 对账未落链的 `tx_records`/`submit_intents`。 |

### 1.2 我核实到的文件级重叠（供 J2 定合并序参考，不是我代为决定）
- (a) 与 (b) 都改：`kasia-console/src/services/relay-manager.js`、`kasia-relay/src/relay.mjs`、`kasia-relay/src/rpc-listener.mjs`——都碰 relay 层的信任/网络判定路径，**大概率冲突**，语义上 (a) 管"RPC 连哪"、(b) 管"这个 relay 算哪个网络"，两者需要在合并时对齐成一套判定顺序（如：先判网络匹配(b)，再判 RPC 可信(a)，还是反过来），本页不替 J2 拍这个顺序。
- (b) 与 (c) 都改：`kasia-console/src/api/bettor.js`、`kasia-console/src/services/bettor-prediction-settler.js`——(b) 改的是这两个文件里的网络推断站点，(c) 改的是同文件里的支付确认/落链逻辑，两者改动点大概率不在同一行但需要合并后跑一遍测试确认没有互相踩。
- (a) 与 (c) 没有文件级重叠。

### 1.3 kanet.env 主网值（本次要改的三行 + 一条注释）
现值（本机核实）：
```
KASPA_RPC_URL=ws://127.0.0.1:17210      # 行 23，TN12 borsh 端口
KASPA_NETWORK=testnet-12                 # 行 24
...
KASPA_RPC_LOCAL_ONLY=1                   # 行 305（文件末行）
```
目标主网值：
```
KASPA_RPC_URL=ws://127.0.0.1:17110      # 主网 borsh 端口（J1 执行页 876cc412 里起的那个节点）
KASPA_NETWORK=mainnet
KASPA_RPC_LOCAL_ONLY=1                   # 值不变，但语义变了，见下
```
**`:304` 注释需要同步改**：现在那行注释写的是"2026-09-07 G-2（console RPC self-heal，ledger 990/991）：共享客户端只用本机节点·rpc-health 发现列表按网络过滤"——这句话描述的是 G-2 落地时的语境，没提 (a) 分支落地后 `LOCAL_ONLY=1` 已经变成**严格**语义（本机不可用直接 null，不再有任何回退）。合并 (a) 后这行注释应该更新说明这一点，避免以后有人照着旧注释以为它"还会回退"。

**⚠ 这三行（连同 §2 数据库那条）不是各自独立生效的——必须一起切换，缺一会造成 network_mismatch 的假阳性/假阴性**（如只改了 `KASPA_NETWORK` 但 `KASPA_RPC_URL` 还指着 TN12 端口，(b) 的 I4 判定会拿"mainnet 环境 + 连到一个实际是 testnet-12 的节点"这种自相矛盾状态，具体后果要看 (b) 判定逻辑是先信 env 还是先信节点自报——这个交叉情形建议 NWT 审时加一条负向量）。

## 2. 数据库：新库，不迁移（含理由 + 可执行判据）

### 2.1 结论先行：**新库**
理由是结构性的，不是偏好：我查了 `migrate.js`，全库真正带 `network` 列做逐行区分的表只有 **8 张**（`identities` / `conversations` / `tx_records` / `contracts` / `relay_nodes` / `kaspa_tx_log` / `tg_custodial_wallets` / `u1_relay_identity`），其余大多数业务表（`pool_markets`/`exchange_offers`/`events`/`payout_shards`……34 张活跃表里的大部分）**完全没有网络字段**——它们从设计上就假设"这个库只服务一个网络"。如果让主网 console 和 TN12 console 共用同一个 `console.db`，这些无网络字段的表会把两个网络的市场/交易/结算数据混在一起，没有任何字段可以事后拆开。**这不是能不能接受的问题，是结构上做不到干净隔离**，所以新库是唯一站得住的选项，不是保守选择。

### 2.2 落地方式
- 新 `DB_PATH` 指向一个新文件（如 `kasia-console/data/console-mainnet.db`，命名由 Owner/J2 定，本页不越权定死）。
- console 启动时按 `client.js` 现有逻辑（`DB_PATH` 有值就 `resolve(DB_PATH)`，首启自动建库跑 migrate）——**不需要新写建库逻辑**，现有机制天然支持"换个 `DB_PATH` 就是一个全新空库"，这条路已经存在，只是没人在同机跑过两个并行实例。
- 新库从 migrate.js 跑一遍全量迁移，得到跟现有库同构但空的 schema——不是从 TN12 库复制数据过滤，是**真正从零开始**。

**执行时验收命令（可执行判据，不是散文）**：
```bash
# 1. 确认新库文件在起 console 前不存在（防止误覆盖一个已有文件）
test -f <新DB_PATH> && echo "🔴 文件已存在，先确认这不是误覆盖" || echo "OK 不存在，可以首启建库"

# 2. console 首启完成后，核 schema 版本号与主线 migrate.js 末尾块一致
node -e "
const Database = require('./kasia-console/node_modules/better-sqlite3');
const db = new Database('<新DB_PATH>', {readonly:true});
console.log('user_version =', db.pragma('user_version', {simple:true}));
"
# 对照: grep -n '// ── v' kasia-console/src/db/migrate.js | tail -1   （取这行的版本号，两边必须相等）

# 3. 确认新库是真空库，没有任何业务数据行（举几张代表性表核，不需要 34 张全跑，抽查即可判断"是不是复制了旧库"这种低级错误）
node -e "
const Database = require('./kasia-console/node_modules/better-sqlite3');
const db = new Database('<新DB_PATH>', {readonly:true});
for (const t of ['relay_nodes','pool_markets','exchange_offers','tx_records','identities']) {
  console.log(t, '=', db.prepare('SELECT COUNT(*) c FROM '+t).get().c);
}
"
# 判据：全部应为 0（除非 migrate.js 里对某张表有 INSERT OR IGNORE 的种子数据，如 channels 表——那种表允许非 0，核对时对照 migrate.js 里该表是否有种子 INSERT 语句，不是盲判"非 0 就错"）。
```

### 2.3 relay_nodes 现有 32 行的处置（对应 Bettor 问的"哪些表必须清空" + 可执行判据）
**新库路径下"清空"这个问题不成立**——新库天然是空的，32 行 TN12 relay 根本不在新库里，不存在"要不要清空"的动作。这 32 行继续留在**旧** `console.db` 里，跟 TN12 一起原样冻结，不动。
- 若 Owner 将来要在主网上跑某个 relay 身份（如给主网也配一个类似"J2test"角色的自动化账号），那是**在新库里新建一行**，`network='mainnet'`（schema 默认值本来就是 `'mainnet'`，见 `migrate.js:174`——这个默认值不是巧合，本来这张表设计时就是以 mainnet 为默认网络的），全新助记词/私钥，**不是把 TN12 那 32 行里任何一行的密钥拿来复用或"重映射"**（复用同一把密钥跨网络本身就是需要独立评估的安全问题，不在本页讨论范围，也不建议）。

**执行时验收命令（(b) I4"网络≠env 拒起"的负向量，可执行）**：
```bash
# 用旧库的一条 TN12 relay 记录做对照实验（只读拿一行看结构，不改旧库任何东西）
node -e "
const Database = require('./kasia-console/node_modules/better-sqlite3');
const db = new Database('./kasia-console/data/console.db', {readonly:true});
const r = db.prepare(\"SELECT id, name, network FROM relay_nodes LIMIT 1\").get();
console.log(JSON.stringify(r));
"
# 期望看到 network='testnet-12'。然后：在新（主网）console 环境（KASPA_NETWORK=mainnet）下，
# 尝试用这个 id 走 relay 启动路径（具体调用点待 §1 分支合入后由 J2/NWT 给出准确 file:line，
# 本页只给判据不给尚不存在的代码路径）——期望：被 I4 拒绝，拒绝日志明确写出 network mismatch
# 原因（不是静默跳过、不是模糊的 "relay start failed"）。
```
- （2.4 附一条备选路径，仅为完整性列出，**本页不推荐**）：若坚持要复用同一个 `console.db`（比如出于运维省事的考虑），那 34 张活跃表里所有**没有** `network` 列的表都需要在启动主网服务前**逐张审计**——分两类处置：本来就该按网络清零重开的（如市场类表，TN12 数据不该被主网服务看到）、和本来就是全局共享不分网络的（如某些配置/日志类表，需要确认真的无害共享）。这个审计本身就是一项不小的工程（34 张表逐张过一遍），而且做完仍然达不到 §2.1 说的结构性隔离——**这是为什么新库更好，不是同等方案的两个选项**。

## 3. 起服务顺序与验收

### 3.1 顺序（骨架，细节待 §1 分支合入后再精确到命令）
1. §1 三分支合入主线（J2 定序，NWT 审）。
2. 新库路径落地（§2.2）：确认 `DB_PATH` 指向新文件，跑一次 migrate，核 schema 版本号与主线一致。
3. J1 的主网只读节点已起且 `isSynced`（执行页 876cc412 §4 的验收，独立前置，非本页范围但是硬依赖）。
4. 起一个**新的** console 进程实例（不是重启现有 6716），env 用 §1.3 的主网三行 + 新 `DB_PATH` + 新 `PORT`（见 §4）。
5. **strict LOCAL_ONLY 运行期验收**（Bettor 点名，具体给）：
   - 正向量：主网节点已起、RPC 可达 ⇒ console 能正常连上、`rpc-health` 报 `using local node: ws://127.0.0.1:17110`。
   - 负向量 A（本机失败 fail-closed 无回退）：临时让主网节点端口不可达（如还没起完），此时 (a) 分支落地后的 `getWorkingRpc()` 应该**直接返回 null**，不应该出现任何"回退到别的节点/别的 URL"的日志行——这是跟旧的非严格行为的关键区别，必须实测验证，不能只读代码就信。
   - 负向量 B（network_mismatch 拒起旧 relay）：在新库里试着（或用已有的旧库 32 行做对照实验）起一个 `network='testnet-12'` 的 relay，env 是 `KASPA_NETWORK=mainnet`，应该被 (b) 的 I4 判定拒绝启动，且有清楚的拒绝原因日志（不是静默跳过）。
6. **频道 relay 身份重生成（这次查到了具体机制，补上）**：`dev-coord-testnet` 频道本身在代码里只是一个字符串（`channels` 表里没有它，见 `migrate.js:1946` 种子 INSERT 只有 `kanet-*` 七个频道——`dev-coord-testnet` 是运行时自然产生的频道名，不是预注册的）；**真正的"身份"是每个 agent 自己那个 relay_nodes 行**，每个 agent 的 canonical 发送脚本（根目录 `_bettor_send.cjs`/`_j2_send.cjs`/`_nwt_send.cjs`/`_kanetui_send.cjs`）都**硬编码**了自己的 `RELAY`（relay_nodes.id）和 `BASE`（console 地址，现值 `http://127.0.0.1:3200`）常量——例如 `_bettor_send.cjs:2` `const RELAY = "5c07f7e5-752b-470c-8a48-f548b3b17068"`。**"身份重生成"= 每个要在主网频道发消息的 agent，都要在新库里新建一行 relay_nodes（`network='mainnet'`，全新密钥，不复用 TN12 那把），并把自己那份 canonical 发送脚本的 `RELAY`/`BASE` 常量改成新值（`BASE` 改成新 console 的端口，见 §4）**。这不是配置切换，是每个 agent 各自一次性的"开新号"动作，且新号需要真实 KAS 才能广播（主网手续费真花钱，不是 TN12 水龙头）——这一条本身就该是 §5 的一个独立 Owner 批点（资金/密钥面），不能跟"起 console 进程"这类纯技术步骤混在一起批。
   - 验收判据：新 relay 行 `network='mainnet'` 建好后，用它的 id 走 §2.3 负向量**反过来**的正向量（同网络应该能正常启动/发送），跑通一次真实的频道消息收发闭环（发一条、console API 能读到、`sender_address` 对得上新 relay 的地址）才算这一步做完，不是"建了一行数据库记录"就算数。

### 3.2 验收判据小结
| 项 | 判据 |
|---|---|
| strict LOCAL_ONLY | 负向量 A 通过（本机不可达时确认无回退，不是读代码） |
| network 单一源 | 负向量 B 通过（跨网络 relay 被 I4 拒绝且有日志） |
| 数据隔离 | 新库 schema 版本号核对 + 空库确认（没有 TN12 数据行） |
| 节点前置 | 复用 J1 执行页 §4 的四项（进程/banner/--version/RPC probe） |

## 4. 与旧 console 6716 的关系：**建议同机并行端口，不建议替换**

| | 并行（新端口，两个进程共存） | 替换（改现有 6716 的 env，指向主网） |
|---|---|---|
| 风险 | 低——TN12 服务零影响，出问题只影响新进程 | 高——直接改一个正在服务的活进程配置，等于对 TN12 做了一次"停服"（即使 kaspad/relay 本身不动，console 这一层对 TN12 就失联了），且 Owner 刚下的冻结令是"旧网一切冻结、不要再提"，替换动作本身就是在"动"TN12 相关的东西，跟冻结令的精神有张力 |
| 实现成本 | 低——`DB_PATH`/`PORT`/kanet.env 三个都已经是可通过 env override 的现有机制（§2.2 已确认），不需要新写代码 |  低（只是改几行 env） |
| 回滚成本 | 低——新进程杀掉就完事，不影响任何东西 | 中——要改回去，且期间 TN12 那段时间完全没有 console 服务 |
| 符合"并存不停 TN12"的 Owner 已表态方向 | 是（Owner 已经在节点这层拍过"与 TN12 并存，不先停"，同一精神延伸到 console 层是自然的） | 否 |

**建议：并行**。新 `PORT`（如 3201，具体值待 Owner/Bettor 定，本页不越权钉死）+ 新 `DB_PATH` + 独立 kanet.env 段（或独立 env 文件）+ 独立 PID，跟现有 6716 完全隔离，互不影响，出事故也互不牵连。

## 5. 每步的 Owner 批点

1. **GO-A**（§1 三分支合入主线前）：Owner/Bettor 确认这三份 NWT 审（已各自有 `docs/2026-09-13-nwt-redteam-j2-*-review-v0.1.md`）都是可合入状态。
2. **GO-B**（§2 新库落地前）：Owner 确认"新库、不迁移"这个方向，以及新 `DB_PATH` 的具体命名。
3. **GO-C**（§3 起主网 console 实例前）：Owner 确认可以起（含端口号，§4 的 3201 或 Owner 指定其它值）；这一步之前 §3.1 步骤 3（J1 节点 isSynced）必须已经满足。
4. **GO-D**（§3.1 步骤 5 验收通过、正式接入频道/正式对外提供服务前）：Owner 看验收结果拍板"可以正式当主网服务用了"，区别于"起了但还在验"的中间态。
5. **GO-E**（§3.1 步骤 6，每个 agent 新建 mainnet relay 身份前）：**资金/密钥面，独立批点，不并入 GO-C/GO-D**——新建的每一把 mainnet 私钥都要真实充值 KAS 才能用，这是本方案里唯一直接涉及真钱的一步，Owner 需要单独确认可以给哪些 agent 建号、初始充值额度上限。

## 6. 未完成事项（本页故意留白）
- §1.2 三分支合并的精确顺序与冲突消解——J2 域（2026-09-13 补：J2 已出预检报告 `68e766c3`，结论合并序安全，本页 §1.2 的重叠点判断与其一致）。
- §2.1 新库文件的具体命名与落盘路径——Owner/J2 定，本页不钉死。
- §3.1 步骤 6 具体机制已查明并补全（见上），但**每个 agent 新建 mainnet relay 身份 + 充值真实 KAS**这件事本身的执行顺序/谁先谁后/资金来源，本页未展开，留给 §5 那个新增批点下再细化。
- §4 具体端口号——本页给了建议值（3201）示意，非定案。
