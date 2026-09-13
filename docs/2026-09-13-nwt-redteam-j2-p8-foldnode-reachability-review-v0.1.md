# NWT 红队 · P8 可达性论证复核——J2 一条关键陈述有误，结论方向仍对但依据要换

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only，全部只读核实，未改任何代码/未发任何交易）
> 审对象：J2 P8 两步结果（频道 11:33Z + `docs/2026-09-13-j2-p8-foldnode-seal-to-root-double-count-offline-test-v0.1.md` 6d268f79）中"relay 无 1→N 路径"这条 J2 自己标注"只 grep 了 p2sh.mjs 的 CovenantBinding/GenesisCovenantGroup 用法"、要我独立核实的部分。

## 结论：**"不开事故账"方向仍然对，但 J2 给的理由里有一句是错的，必须换成正确的理由才能签字**

| 项 | J2 原话 | 我核实结果 |
|---|---|---|
| "relay 只有单输出 genesis 与 1→1 续约" | 只对 **PayoutShard** 家族成立 | ✅ 对（`p2sh.mjs` 里 PayoutShard 相关的 `unlockBshard*` 函数确实全是单输出 genesis / `self_out_idx` 单输出续约） |
| "无 1→N 路径 ⇒ 造不出同 cov-id 两个并存 FoldNode，fold 链上从未可执行" | 🔴 **这句不对** | ❌ **`p2sh.mjs:3099 unlockBshardFold` 是一个完整实现的 k 输入→1 输出 fold 交易构造函数**（leader/delegate scriptSig 分别编码，children UTXO 逐个匹配），**且它被 `relay.mjs:937-939` 的 `case 'bshard_fold':` 命令分支直接调用**；姊妹函数 `unlockBshardSeal`（`p2sh.mjs:3160`）同样完整实现且被 `relay.mjs:965-967` 的 `case 'bshard_seal_to_root':` 调用。**relay 二进制里这条 1→N（k→1）路径是真实存在、可执行的代码，不是"没有"** |
| "builder 们互相 import 无入口 = 死代码" | ✅ 这句对，但这才是真正的、且唯一成立的"不可达"理由 | ✅ 我独立用 `Grep` 工具核实：console 侧对应的命令构造模块 `kasia-console/src/lib/pool-fold-builder.mjs`、`pool-seal-builder.mjs`**没有被任何其它文件 import**（全仓只有它们自己文件内的注释提到自己的名字，`pool.js:449` 提到的字符串 `'bshard_fold'` 只是一条 409 拒绝响应里的说明文字，指向的是另一个文件 `pool-refund-builder.mjs`，跟这两个 fold/seal builder 无关）。**relay 端点是活的、可执行的；只是没有任何活的 console 服务会去构造并发送触发它的命令** |

## 为什么这个区分很重要，不是较真字面

J2 论证的骨架是"relay 结构上造不出这种交易"（permanent, structural），我核实后骨架应该换成"relay 结构上能造，但 console 侧没有任何活代码会去调用这个 builder"（contingent on nobody having wired a caller）。**这两句话对"不开事故账"这个当下结论一样有效**，但对**风险的稳定性**判断完全不同：

- 如果理由是"relay 没有这个能力"，那这个安全边界几乎不会意外被打破（要打破得改 relay 源码本身）。
- 如果理由（正确的那个）是"console 没人调用这两个 builder"，那这个安全边界的稳定性只取决于"以后有没有人写一行 `import`"——**这是一个远比"结构上不存在"脆弱的不变量**，未来任何人（哪怕出于无关的重构/UI 功能需求）不经意地接上这两个 builder 到某个服务，就会重新打开一条已知带脚本层双记漏洞的路径，而且**relay 里对应的 fold/seal 执行代码本身没有任何"角色1"式的组检查**——这次是 console 侧疏忽，不是 relay 侧结构限制在挡着。

## 我核实的具体方法（全部只读）

1. `grep -n "CovenantBinding|GenesisCovenantGroup|covenant" kasia-relay/src/lib/p2sh.mjs`——找到并读了 `unlockBshardFold`/`unlockBshardSeal` 两个函数的完整源码（`:3091-3212`）。
2. `grep -rn "unlockBshardFold|unlockBshardSeal"`——确认两者被 `relay.mjs:937/965` 的 `case` 分支直接 import 并调用，**是活的分派路径，不是孤立函数**。
3. `Grep` 工具（比 Bash grep 更可靠，之前几次 Bash 全仓 grep 超时）核对 `pool-fold-builder.mjs`/`pool-seal-builder.mjs` 是否被除自身以外的任何文件引用——**结果：无**。
4. 读了 `pool.js:449` 附近上下文，确认那里的 `'bshard_fold'` 字符串只是错误提示文案，不是真实调用点。
5. 只读查询本机 `console.db` 的 `chain_events`，确认 `event_type LIKE '%fold%' OR '%seal%' OR '%convert%'` 为**空结果**——与 J2 claim 一致，TN12 全史没有一次真实的 fold/seal/convert_to_foldnode 落链记录。
6. 读了 `ShardLeaf.sil` 文件头注释，确认 2026-06-20 的废弃记录属实：fold-tree 路径被**我自己此前的一次红队发现**（"template-match 可被 recreatable-UTXO 造假 PayoutShard 击穿"）直接推动废弃，换成了 `(A) cov_id provenance-bind` 方案（`unlockBshardConvert`/`unlockBshardConsolidate` 现在走的是这条新路，不再走 FoldNode fold-tree）。

## 给 Bettor 的处置建议

**(a) §4 是否够关**：**够，但请把 ledger/文档里"relay 无 1→N 路径"这句改成"relay 有该路径的完整实现且被命令分派挂钩，但 console 侧无任何调用者（`pool-fold-builder.mjs`/`pool-seal-builder.mjs` 全仓零 import）——这是 TN12 上唯一实际生效的不可达理由"**。这不是文字游戏，是让下一个接位的人（或六个月后的自己）知道这个安全边界靠的是"没人接线"而不是"结构上做不到"，防止将来有人不知情地把这两个 builder 接回某个服务。

**(b) 主网集瘦身 v2（剔除 fold-tree 家族）**：**同意剔除**，理由比"避开一个不确定的脆弱性"更强——fold-tree 本来就已经在 2026-06-20 被**架构性废弃**（有明确的安全动因，替代方案 `(A) cov_id` 已经是生产在用的正路），继续把 FoldNode/PoolLeaf/PoolShard_fold/FoldNode_sealonly/PoolLeaf_nofold_probe 迁进主网集本来就没有意义——它们不是"这次批T发现有洞所以踢掉"，是"这条路线半年前就已经被换掉了，批T的检查只是顺手确认了废弃是对的"。C1 角色1 patch 可以只留设计不落码（这几个文件不再进任何迁移批次，patch 没有落点）。

**额外一条不阻塞、但建议记一张后续小票**：relay 二进制（`p2sh.mjs`/`relay.mjs`）里 `unlockBshardFold`/`unlockBshardSeal` 及其命令分派现在仍是**活代码**（TN12 live 进程里就有），只是没人调用。既然 fold-tree 已经架构性废弃，这两个函数+对应的两个 case 分支本身也是可以清理的死代码——不清理不构成当前风险（没有调用者），但留着它们本身就是"下一个人可能意外接上"这条脆弱不变量的来源。这条不必现在做，排进 TN12 收尾/退役工作的候选清单即可。