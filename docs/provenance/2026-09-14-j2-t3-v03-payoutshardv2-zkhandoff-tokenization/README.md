# PayoutShardV2.zk_handoff — v0.3 §2/§3 A 类代币转移（ledger 1170/1181，联合项之一）

## 改了什么

`zk_handoff`（`selfOutIdx` 改名 `zkOutIdx`，同 Bettor 1170 的措辞）新增 `tokenInIdx`/`tokenOutIdx`/
`tok_prefix`/`tok_suffix` 四个参数：

1. `closeZkTmplAnchor` 全字节重构校验（**既有代码，一字不动，独立保留**）——证明 `tx.outputs[zkOutIdx]`
   真是编译过的 `CloseZkV2` genesis 字节。
2. KAS weld 从 `==consolidated_pool` 改 `>=DUST_MIN`（v0.3：KAS 侧只剩 dust）。
3. **新增 A 类代币转移**：P13 形核 `token_tmpl_hash` → 读本合约当前持有的代币（`heldTk`）→ H1 在场 +
   持仓量核对 → `zkCovId = OpOutputCovenantId(zkOutIdx)` 后立即 `require(zkCovId != ZERO32)`（NWT
   1158/1173 纪律：这条独立于第 1 步的模板校验，不是它的附属——一个输出可以脚本字节完全匹配却没声明
   `covenant_id`，两层各自独立承重）→ `validateOutputStateWithInputTemplate` 把代币全额转给新建
   `CloseZkV2` 实例的 covenant。

## 卡点与解决（ledger 1181：不要黑盒排查，用仓库里现成的 canonical pipeline）

**最初的错误**：我写了个量测脚本自己从编译产物里搜索 `betsRootBaked`/`refundRootBaked` 的字节位置来切分
`templateA/B/C/D`，搜索时用的 needle 是 `[0x20 tag, ...32字节]`（带 push-tag），切分点定在 tag 字节
**之前**。独立验证过这样切出来的四段拼回去等于完整编译字节码（100% 吻合）——但这只证明"切分+拼接自洽"，
不能证明"跟 `zk_handoff` 源码里 `templateA + betsRootBaked + templateB` 这个表达式实际需要的切分点一致"。
拿这样切出来的模板喂给 `zk_handoff`，`closeZkTmplAnchor` 检查能过（因为 anchor 只是 `templateA+B+C+D`
的 hash，切分点只要自洽就行），但**最终的 `expectedCloseZkRedeemHash` 重构对不上**——因为
`betsRootBaked`（`zk_handoff` 里是运行期状态变量，32 原始字节，不带 tag）在拼接时不会自己再插入一个
tag，而我切出来的 `templateB` 已经把 tag 排除在外，导致拼接结果整体错位一个字节。

**Bettor 1181 裁定**：不要继续黑盒试错，直接照抄仓库里**已经在跑的生产路径**
`kasia-console/src/lib/pool-shard-register.mjs:189` `computeCloseZkTmplAnchor()`（`bshard-close-transport.mjs:518`
调用它产出 `template_*_hex` 供 relay 侧 `bshard_zk_handoff` 命令使用，是真实创世/handoff 用的同源算法，
不是我这次临时发明的东西）。逐行核对后发现关键差异：**canonical 用 `findUnique(buf, needle)` 搜索的
needle 是不带 tag 的裸 32 字节**（`dummyBetsBuf = Buffer.from(dummyBetsRoot, 'hex')`），切分点
`templateA = templateSuffix.subarray(0, betsAbs)` 精确落在裸字节开始的位置——也就是说 **push-tag 字节
(0x20) 是 templateA/templateC 自己的最后一个字节，不是需要在拼接时单独补回去的东西**。改用这个精确算法
重新量测后，`templateA` 长度从 733→734、`templateC` 从 1006→1007（各 +1，正是那个 tag 字节归属换了
位置），`V-ZKHO-1`（正向全流程）随即一次跑通，不用再手工插补任何字节。

**量测脚本**（`measure_closezk_splice.mjs`）：不是照抄 production 模块本身（那个模块耦合了 DB/其它
pool 子系统的 import，且硬编码走另一条生产 silverc 路径，不能直接拿进这次隔离 worktree/工具链用），而是
把 `computeCloseZkTmplAnchor`/`findUnique`/`extractTemplateArtifact` 的**算法逐行移植**到一个独立、
自包含的脚本里，用**本次隔离工具链**（`_j2_silverc_v100`）编译验证，round-trip 自证（跟 canonical 同款
纪律：拼回去必须 byte-exact 等于原始编译产物，不等就 throw，不产出可能错误的值）。

## 向量（`run.log`，5/5 PASS）

| 向量 | 验证点 | 真实失败行（负向量均交互步进确认） |
|---|---|---|
| `V-ZKHO-1_pass_full_handoff` | pass：读本合约持有代币，全额转给新建 CloseZkV2 covenant | — |
| `V-ZKHO-2_fail_wrong_templateD_anchor_mismatch` | fail：`templateD` witness 被篡改，`closeZkTmplAnchor` 重构核对不过 | `require(blake2b(...)==closeZkTmplAnchor)`（既有代码，一字不动） |
| `V-ZKHO-3_fail_token_owner_diverted_to_stranger`（V-outbind 形） | fail：代币输出 owner 被导向陌生人而非新 CloseZkV2 covenant | `validateOutputStateWithInputTemplate` |
| `V-ZKHO-4_fail_witness_wrong_tok_prefix` | fail：代币模板 witness 错，blake3 现场核不过 | `token_tmpl_hash` blake3 核对 |
| `V-ZKHO-5_fail_zk_output_bare_no_covenant_id_zero32` | fail：新 CloseZkV2 输出脚本字节完全匹配（`closeZkTmplAnchor` 检查照样通过）但没声明 `covenant_id`——`OpOutputCovenantId` 回退 ZERO_HASH | `require(zkCovId != ZERO32)`（跟模板检查是两条独立的检查，`V-ZKHO-5` 就是专门证明这一点：结构正确≠covenant 绑定正确） |

## MANIFEST

见 `MANIFEST.sha256`（n/n 文件计数核对）。
