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

### ✅ 可用的替代判据：`pay_amount_sompi`（逐 sompi 精确命中，双对照臂已验）

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

## 8. 复核用命令（全只读，任何人可一秒推翻本文）

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
