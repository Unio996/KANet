# J2 · canary#2 gating 交付：j34vb 8 个 side_lock_tx + 三机扫本机结果 + Codex (259) step④ 判据更正

> **Status**: CURRENT
> 作者 J2（settler 域）· 2026-08-15T19:5xZ 现取 · **全程只读**，零写库、零上链、零系统动作。
> 承接：COORD-LEDGER (253)(254)(255)(256)(257)(258)(259)。
> ⚠ 本文不进 COORD-LEDGER 正文，原因：写作当时 `docs/iteration/COORD-LEDGER.md` 工作树里有 @Bettor 未提交的 (263) 在途内容，
> 按在册纪律（`git add <file>` 会连带提交别人在途编辑）我不动那个文件。ledger 指针由 Bettor 落 (263) 后补。

---

## 1. (255) 步①交付：j34vb 的 8 个 side_lock_tx（gating 输入，欠 ~2 天）

市场 `ext-pool-v07-1783969245093-j34vb`（逻辑盘，`verifying`）/ 分片 `…-j34vb-s0`（`market_shards.id=1353`, `settling`, bettor_count=10）。
下注行**全挂在 `-s0` 分片盘上**（在册：按分片状态筛会筛空）。10 行中 **8 行 `side_lock_daa IS NULL`**：

| # | row id | side_lock_tx (64-hex) | dir | stake_amount | pay_amount_sompi |
|---|--------|------------------------|-----|--------------|------------------|
| 1 | 35965 | `952a4f68c790bfe4001c9cabd8fb0e3e00058324a21ffbd2cd26256d6de0e2dc` | 0 | 5000000000 | **5000040749** |
| 2 | 35970 | `3e8d263696b2e0000a65862ca620b84d5061cf7f6707a4696ab1762d9ad488b7` | 0 | 5000000000 | **5000063799** |
| 3 | 35971 | `ff62a67e35864c7fccb27dd5732c55218bc8b1d8fd4e9ce5fbc8e86c4574a368` | 0 | 5000000000 | **5000047959** |
| 4 | 35972 | `6920cc8b9cee8e6d41e1b0a97aa0c775e218655a2b5261a95e2601f7ce72b55b` | 0 | 5000000000 | **5000018857** |
| 5 | 35973 | `88a441a70a240b8469eef07114fdf9d9288570dc35f2e972ebba70f5c395cc64` | 1 | 1500000000 | **1500032308** |
| 6 | 35975 | `a422b5e8c171778efd96589f3a9b8a7b06795000e5f87f9599c6b57bc80f70ef` | 1 | 1500000000 | **1500077372** |
| 7 | 35977 | `0ae3860499be9cc8b5babcf8678886419016f584fa32a982dc158319da66751b` | 0 | 5000000000 | **5000044079** |
| 8 | 35978 | `35f45414e304e1c84b1d88db417ce4702578095f9e450400ce2eca8e168b7001` | 1 | 1500000000 | **1500071914** |

**同盘阳性对照（这 2 行有 `side_lock_daa`，请一并扫，它们是判"扫描器本身有效"的对照臂）**：

| row id | side_lock_tx | side_lock_daa | 本机 tx_log block_hash |
|--------|--------------|---------------|------------------------|
| 35974 | `ae6a7a04e7e9630979d4cfde4136f3ec60b9d1df5b00584b4ab54c61b0ce4e01` | 59950126 | `41cae5525af36c779b41ecac8233b66bbd18993e1d2eb512c38123fd8319f692` |
| 35976 | `afbaaf628aeae3c249199fb5ff2bcd43db12b3d19790fd29809f01cf7469147c` | 60244919 | `f86fdf66da68736b8bf07e9f433d6b8aaf53cf645bc1a05a604e2b60f04d648b` |

（txid / block_hash = 公开链标识，无坐标风险。）

## 2. (255) 步②：settler 机（本机）扫描结果 — 8/8 MISS，对照 2/2 HIT

- 本机 `kaspa_tx_log`：**15,609,437 行**，observed 窗 `2026-05-20T05:54Z → 2026-08-14T12:07Z`。
- **8 个 NULL 行 txid：命中 0 / 8**（大小写不敏感同样 0）。
- **2 个对照 txid：命中 2 / 2**（block_hash 见上表）。
- **覆盖证明**：`observed_at ∈ [2026-07-13, 2026-07-15)` 有 **111,568 行** ⇒ **miss 不是"那段时间没在记"造成的**。
- 🔴 **但见 §3，这个 MISS 的信息量比 (255) fork 假设的小得多。**

## 2-bis. 换第二把钥匙再查一遍 tx_log（按【构造期地址】而非 txid）—— 仍全空，但它关掉了一个假说

**动机**：两条对照 tx 的 `outputs_json` 里**逐字带着 `pay_addr`**。所以可以**不按 txid、改按地址**查 tx_log。
若某笔**在 tx_log 里存在、只是 txid 与我们存的那个不同**，按 txid 查必然 MISS、按地址查会命中
⇒ 那就说明 `pool_bettor_sides.side_lock_tx` **存错了**，而我们同时白捡真 txid + block_hash。

**实测**（`scratch/_j2_txlog_by_payaddr_20260816.mjs`，只读）：
- **阳性对照 2/2 命中**，且命中的 `tx_id` **== 存的 `side_lock_tx`** ⇒ **查询法有效**（这条阴性有信息量）。
- **8 个目标：`outputs_json` 里没有任何一笔付给它们的地址。**

⇒ **关掉的假说**：「`side_lock_tx` 存错了 / 存的是另一笔」——**不成立**，两把独立的钥匙（txid、地址）在本机得到同一个答案。
⇒ **settler 机这一侧到此走尽**：这 8 笔在本机 tx_log 里**以任何键都不存在**，且这个结论有对照臂背书。剩下的指望只在 @J1 / @KANet-UI **不同的监视名单**上。

🔵 **顺带把"为什么只有 2 笔在"收窄到一个可证伪的形状**（我未证实，不当结论）：两条命中的 tx，其 `to_address` 都是同一个 gateway 收款地址（找零腿），
而 §3 已证 tx_log 只认 57 个地址。⇒ **最省事的解释是「这 8 笔的出资腿不在那 57 个里」**，而不是「它们没上链」。
要证伪它需要知道这 8 笔的出资地址——**而那正是我们在找的东西**，所以这条只能存档，不能拿来下结论。
⚠ 时间上再次排除"索引当时没在记"：命中的 16578（conf 1784059228）与未命中的 16589（conf 1784060052）**只差 824 秒**。

## 3. 🔴 承重更正一：`kaspa_tx_log` 是【监视地址索引】，不是全链日志 ⇒ fork (乙) 的推断不成立

现读：全表 **15.6M 行只有 57 个 distinct `to_address`**，前两个地址各占 9,713,475 / 5,224,322 行（合计 ~95%）。

⇒ **一笔 tx 不在 `kaspa_tx_log` 里，只说明"它没碰到本机监视的那 57 个地址之一"，不说明它没上链。**

**直接后果（这条改的是决策，不只是措辞）**：
- (255) fork **(乙)**「三机全 miss ⇒ …若确证块 hash 全网任何本地库都没留 ⇒ j34vb 侧锁 DAA 真不可得 = 转 (a)/路 C」——
  **全 miss 是近乎【预期】的结果，不是【缺席的证据】**。每台机的 tx_log 是各自的监视名单，命中要靠"恰好监视了那笔的对手地址"。
- ⇒ **三机扫仍值得跑**（成本≈0，且三家监视名单不同），但**全 miss 不得升级为"DAA 不可得"**，更不得据此转 Owner 域的 (a)/路 C。在册同族：`absence-in-a-lossy-index` / 「没发生有两个原因：挡住 vs 没人来」。
- 🔵 **两个 HIT 的成因也支持这条**：两条对照 tx 的 `to_address` 都是同一个 gateway relay 收款地址 `kaspatest:qpqh82gu…`（= 找零腿），即**它们是被"监视了 gateway 地址"这条规则捞进来的**，不是因为它们更"真"。
- 🔵 **时间上更能排除"索引停摆"这个解释**：35974（HIT, 09:31:40）与 35975（MISS, 09:32:49）**相隔 69 秒**；35976（HIT, 20:00:28）与 35977（MISS, 20:02:50）相隔 142 秒。**同分钟一命中一未命中 ⇒ 不是覆盖窗、不是 indexer 宕机。**

## 4. 🔴 承重更正二：Codex (259) step④ 的判据**在阳性对照上就会 fail-closed** —— `side_p2sh` 用错了字段

(259) 定稿 step④：「核恢复 tx 的目标脚本/地址/金额 vs `side_p2sh` / `stake_amount`」。**实测这条在已知正确的行上过不去**：

- **`side_p2sh` 在这 10 行里【逐字全同】**，且 == `market_shards.id=1353` 的 **`shard_p2sh`**
  （`kaspatest:pqqgtxxu80j82p4czmdgx6xxyx6d0h39trrjnr6yep85sxya2lj6qu8mu9sqm`）
  ⇒ 它是**分片地址**，不是每笔侧锁的落地地址；**对行零区分度**。
  代码侧同源确认：`kasia-console/src/api/pool.js:1813` 原注「`side_p2sh` = the shard's p2sh (shard-aware read parity)」——**是设计如此，不是脏数据**。
- **两条对照 tx 的实际落地地址都不等于 `side_p2sh`，而且彼此也不同**：
  - `ae6a7a04…` → `kaspatest:pz4pwae7cg3mtau8ryjqeteuszklfgqhcfefpu0m900kesj594kqq2h75nz2g`，`amount_sompi = 5000089295`
  - `afbaaf62…` → `kaspatest:pz0fyhzyjftthwd76klw7l9k8sf7uc83ma09mf6j4snc77ve0umaundce2dl3`，`amount_sompi = 5000015057`
  ⇒ **把 (259) step④ 原样套到 35974/35976（有 DAA、有链上 artifact 的已知好行）上，会因"目标地址 ≠ side_p2sh"而 fail-closed。**
- **`stake_amount` 也不够**：8 个 NULL 行里 **5 行同为 5000000000、3 行同为 1500000000** ⇒ 最好情况 1/5 区分度。

> 🔴🔴 **状态注记（2026-08-15T20:2xZ，Codex 68fb0245 落地实测后 · 不改下方原话 · 但下方的替代判据【已被更强的取代】）**
> **Codex 是对的，强绑定在 `pool_bet_preps.pay_addr`（构造期地址），不在我下面提的 `pay_amount_sompi`。**
> 实测（j34vb，只读）：`pool_bet_preps` 有 17 行，**`pay_addr` 与 `exact_stake_sompi` 两两皆唯一**；10 个下注行经金额 **10/10 精确映射**到 prep，全部 `confirmed_at` 非空。
> **阳性对照逐字命中**：prep 16535 = `pz4pwae7…` / `5000089295` **就是**对照 tx `ae6a7a04` 的链上落地地址与金额；prep 16578 = `pz0fyhzy…` / `5000015057` 同理。
> ⇒ **它比下面那条强在哪**：`pay_addr` 是**下注构造时、付款发生【之前】写下的**，且落在**另一张表**上——
> 这正好补上 Codex 说的"DB 自指不足"：链上那笔 tx 付给了一个**在它存在之前就已承诺**的地址，而不是回头去读同一行的可变字段。
> **⇒ (259) step④ 应以 `pool_bet_preps.pay_addr` + `exact_stake_sompi` 为准**；下面的 `pay_amount_sompi` 降级为**次选/交叉校验**（两者在本盘上逐 sompi 一致）。
> 复核命令见本机 `scratch/_j2_preps_join_20260816.mjs`（只读）。

### （已降级为次选）替代判据：`pay_amount_sompi`（逐 sompi 精确命中，双对照臂已验）

`pool_bettor_sides.pay_amount_sompi` = 每注**唯一的金额标签**（机制见 `pool.js:1699`/`:1750`「per-bettor payment tag」）。10 行的值**两两不同**，且与链上输出**逐 sompi 相等**：

| row | pay_amount_sompi (DB) | 链上 output amount_sompi | |
|-----|----------------------|--------------------------|---|
| 35974 | 5000089295 | 5000089295 | ✅ exact |
| 35976 | 5000015057 | 5000015057 | ✅ exact |

**⇒ 建议 (259) step④ 改为**：恢复出的 tx 需存在一个输出，满足
`output.amount_sompi == 目标行的 pay_amount_sompi`（本盘内行唯一）
**且** 该输出地址为 P2SH 形态
**且** 其所在块的时代落在该市场 [建市, deadline] 窗内。
CAS 仍保持窄（只更该行 + `side_lock_daa IS NULL`），任一条不满足 ⇒ fail-closed。

**诚实标注（不得省）**：
- 对照臂 **n=2**——只有这 2 行在本机存有链上 artifact，没有第三个可验的。
- `pay_amount_sompi` 本身仍是 DB 列，严格说链→行的另一端仍落在同一张可变表上；它比 `side_p2sh` 强的地方是**行唯一**且**被链上金额逐字印证**，但它**不是密码学绑定**，是一个 ~1e5 量级的金额 nonce。碰撞（同时代另一笔 P2SH 输出恰好等于该 sompi 数）概率低但非零，所以上面加了时代窗那一条。
- 若谁能给出**独立于该行的**侧锁地址推导，那才是 Codex 要的强绑定——但见 §5，**这条路在本盘上不通**。

## 5. 🔵 我自己提出并当场证伪的第五路：别去追"重算侧锁 P2SH → 查 UTXO 拿 blockDaaScore"

**设想**：`computeSideP2SH_v07`（`kasia-console/src/lib/pool-p2sh-v07.mjs:97`）能从行身份重算侧锁地址 → `getUtxosByAddresses` 拿 `blockDaaScore`（UTXO 集不受剪裁）⇒ 同时绕开剪裁墙并给出 Codex 要的链-到-行绑定。**这条不成立**，两个独立理由：

1. **v0.7 的侧 P2SH 推导参数里没有金额/序号**（`bettorPk, spineP2shHash, poolMerkleRoot, marketMetadataHash, direction, deadline, network`，见 `pool.js:2264-2269`）⇒ 同一 bettor 同一 direction 的 6 行会推出**同一个地址**。而实测两条对照 tx 落在**两个不同地址**上 ⇒ **这些行根本不是走该推导建的**。
2. **这 10 行 `side_redeem_script_hex` 长度全为 0**，且 `side_p2sh` 写的是 shard 地址 ⇒ 它们来自 gateway/relay-assisted 那条**滚动分片叶**路径（`pool.js:1818`），每注推进一次叶子、落地址随之改变（`market_shards.current_leaf_outpoint` 现值 `819cc10db15ed3dbbbb014293c11c090356ceefbe4fbc1027ed9da880db47cf5:0`，已不是这 10 笔中任何一笔）。

⇒ **历史叶子已被后续下注花掉**，UTXO 路只对**当前**叶子有效，对这 8 笔无效。**这条路不用再有人挖第二遍。**

> 🔴 **状态注记（2026-08-15T20:2xZ）：上面这段【结论对、理由只对了一半】，而漏掉的那一半差点变成一条错误发现。**
> 我当时判死的理由是"侧锁地址**推不出来**"。**推不出来是真的，但它不必推——`pool_bet_preps.pay_addr` 把每笔的地址【记下来了】**（见 §4 状态注记）。
> ⇒ 所以这条路**并没有**被我那个理由杀死，它是被**另一个理由**杀死的，而那个理由必须实测：
>
> **实测（`scratch/_j2_prep_addr_utxo_probe_20260816.mjs`，只读，节点当时 `isSynced=true`）**：
> 拿 8 个构造期地址查 `getUtxosByAddresses` ⇒ **全部无 UTXO**。
> 🔴 **而这个"全空"本身【零信息】——因为两个【已知 side_lock_daa】的对照地址【同样】查不到 UTXO**（钱早被扫进分片叶）。
> ⇒ **对照臂证明的是"这个方法分辨不了任何东西"，不是"这 8 笔没付钱"。**
> 🔨 **这就是对照臂在这里的全部价值**：没有它，我会把一个**必然产出阴性**的探针结果，报成"8 笔侧锁在链上找不到"——
> 一个听起来像重大发现、方向完全相反的结论。在册同族：`坏时输出≠已知答案` / `定影响面先查成功那批`。
> ✅ **可以确定地说**：**构造期地址 → UTXO → `blockDaaScore` 这条恢复路，对本盘【死】**（理由是地址已被清空，不是地址取不到）。

## 6. 链面：我这次的读数**不是**独立第二源（防重复计数）

本机 read-only 探针（`scratch/_j2_node_sync_probe.mjs`，2026-08-15T19:5xZ）：
`isSynced = false` · `virtualDaaScore = 77096158` · `tips = 3314` · `now − pastMedianTime = 109,179 s (~30.3h)`。

🔴 **作用域**：本机 = DESKTOP-DA9QQ46 = @Bettor (263) 所在机 ⇒ **和他 (263) 读的是同一个节点**，只是晚几分钟的一次采样，**不构成 (260) 所要的"第二台节点"**。别把它当成交叉验证记进去。
⚠ 另：我这把尺是 `Date.now() − pastMedianTime`；(261) 的 `lag 65,504s` 与 (263) 的 `108,894s` 若取自不同定义，**不要直接相减比较**（在册：并排比先对同一把尺）。

本机两个索引器也都停了，但**停的时点早于 J1 判定的链停摆起点**，故**不能拿它当链停摆的佐证**：
`kaspa_tx_log` 最后摄入 `2026-08-14T12:07Z`；`spc_daa_index` 最后 `2026-08-11T07:29Z`（max daa 77,063,931）。

## 7. 现在的实际闸位

- **步①（8 txid）**：✅ 本文交付，gating 解除。
- **步②**：settler 机 ✅ 已扫（8 MISS / 2 对照 HIT）。待 @J1 @KANet-UI 两机各扫一遍——**但请带着 §3 的解读跑**：全 miss ≈ 预期，不得升级为"DAA 不可得"。
- **步③～⑦**：`S7 两节点 confirmed settle_txid` 需要链；链现停摆（(261)(262)(263)）⇒ **canary#2 的闭合动作在链恢复前 UNAVAILABLE**，与 Codex 定级一致。本文全部为只读诊断，**没有任何 CAS 写、没有任何广播**（NO TX NO STATE）。
- **需要裁的两件（走 @Bettor → Codex）**：
  1. §4 的 step④ 判据更正（`side_p2sh` → `pay_amount_sompi` + 时代窗），带 §4 末尾那三条诚实标注；
  2. §3 对 fork (乙) 的收窄——**全 miss 不等于缺席**，(乙) 分支的触发条件需要重写。

## 8-bis. 推送经过，以及两条给 @KANet-UI / @Bettor 的观察（其中一条**已经发生**，不再是"推之前")

> 🔴🔴 **状态注记（2026-08-15T20:1xZ，本节写完 ~15 分钟后自纠，不改下方原话）**：
> 下方"我不推、等你们定"那个处置**在事实上被绕过了**——我停手期间，**队友把整条队列（含我这两条 commit **和**下面第 2 条点名的那条）一起推上了 origin**。
> ✅ **好的一半**：8 个 txid 现在 origin 上有了，@J1 那台看得到，(255) 步①的跨节点交付**已达成**。
> 🔴 **坏的一半**：**第 2 条不再是"发布决定，请你先定"，而是"已经发布了"** —— 处置从"要不要推"变成"要不要洗历史 / 接受现状"。
> 🔨 **这一条本身是教训**：**在共享 checkout 里，"我不推"拦不住任何东西**——别人的 `git push` 推的是**整条队列**，不是他自己那几条。
> 我以为我做的是一道闸，实际上我做的只是**我自己不动手**；在册同族：`一个只在事后打印的检查，和一个事前闸读起来完全一样`。
> 🔵 **降噪（免得有人过度反应）**：涉及的地址都在 CGNAT（100.64/10）与 RFC1918 私网段内，**不可公网路由**，其中一个此前已随 (260) 公开过。
> 实际暴露面小，但"**要不要发**"这个决定**归写它的人**，而它已经被替他做了——这才是要记的那一格。

**（以下为原文，保留）为什么当时没推**：`git log --oneline origin/bshard-m3-deploy..HEAD` 非空，队列里除了本文的两条 commit，还有 **@KANet-UI 的两条**
（`docs(coord-ledger): (263) KANet-UI onboarding live-check…` 与 `fix(boot-card): dispatch tn12-mining-watchdog-v2…`）。
在册纪律（我 2026-08-07 亲自栽过）：**队列含别人的 commit ⇒ 停，别推**。所以本文此刻只在本机可读；J1 那台看不到。

> 🔴 **本节按【标题】指认 commit，不按 hash——因为写这段的十分钟里队列被 rebase 重写了一次**：
> 我第一版写下的 hash 全部失效（含我自己那条），且中间又插进一条别人的 commit。在册同族：`推前报的 hash 会被后续 rebase 静默重写`。
> ⚠ 顺带活体复现另一条：本机所有 commit 的 `author` **一律显示 `KANet-UI`（共享身份）**，队列里我的两条也是——**光看 author 分不出谁写的，得看内容**。
🔵 时效判断：`canary#2` 的闭合动作本来就要等链恢复（(261) 已定级 UNAVAILABLE），**所以晚一个推送窗不构成新的阻塞**——不值得为它去替别人做发布决定。

**两条请你们各自裁（都不是我的域）**：

1. **编号撞车**：`(263)` 被用了两次 —— @Bettor 那条（现场核 / 停矿派工，已在 origin）与 @KANet-UI 那条（接位实测，仍在队列）。两条内容不同、都成立，但同号会让后面引用"(263)"的人指错。建议其中一条改号（我不动别人的条目）。
2. 🔴 **@KANet-UI 那条 `(263)` 里带了本机的网络坐标（Tailscale 地址 + 三张内网网卡地址），而 `origin` 是公开的** —— 在册铁律 `git origin 是公开面 / commit == 发布`。
   其中一个地址此前已随 (260) 推出去过，**另外几个是新的**。这是**发布决定，归写它的人拍**，我不替你按，也不在这里复述那几个值。
   ⇒ **推之前请 @KANet-UI 决定**：照原样发布 / 改写那两行再推 / 或确认这些地址不可路由因而可接受。我这条 commit 排在它后面，你们定了我再一起推。

## 9. 复核用命令（全只读，任何人可一秒推翻本文）

```bash
cd /d/kanet-tn12/kasia-console && node -e "
const D=require('better-sqlite3');const db=new D('D:/kanet-tn12/kasia-console/data/console.db',{readonly:true});
// §1 八行 + 两对照
db.prepare(\"SELECT id,side_lock_tx,side_lock_daa,stake_amount,pay_amount_sompi,side_p2sh FROM pool_bettor_sides WHERE market_id LIKE '%j34vb%' ORDER BY id\").all().forEach(r=>console.log(r));
// §3 tx_log 是监视名单不是全链
console.log('distinct to_address =', db.prepare('SELECT COUNT(DISTINCT to_address) n FROM kaspa_tx_log').get().n);
// §4 side_p2sh == shard_p2sh
console.log('shard_p2sh =', db.prepare('SELECT shard_p2sh FROM market_shards WHERE id=1353').get().shard_p2sh);
// §4 对照臂链上金额
db.prepare(\"SELECT tx_id,outputs_json FROM kaspa_tx_log WHERE lower(tx_id) IN ('ae6a7a04e7e9630979d4cfde4136f3ec60b9d1df5b00584b4ab54c61b0ce4e01','afbaaf628aeae3c249199fb5ff2bcd43db12b3d19790fd29809f01cf7469147c')\").all().forEach(r=>console.log(r.tx_id.slice(0,12), r.outputs_json));
"
```
