> **Status**: CURRENT

# PoolSideTicket.sil — 真票 co-spend 向量（ledger 1338，Bettor 派工）

## 背景

T3 provenance 里的 `PoolSideStub(2).sil` 是"替身实例"（`#[covenant.singleton] passthrough`，只允许
原样续约，没有 `authorize_spend`），T3 全套向量验证的是"能读回 ticket 状态"，**从未验过真票被 co-spend
消费**。这个缺口这次补上——主网集也因此从 10 个变成 **11 个**（`PoolSideTicket.sil`，
`PoolSide_v08_shard.sil` 的 §7 v1.0.0 语法迁移，见 `kasia-console/src/lib/sil-v1/PoolSideTicket.sil` 与
`kasia-console/scripts/mainnet-sil-set.json` 第 11 条）。

## 🔴 工具链边界（本次核实，非本次新发现——T3 全程一致的既有事实）

`cli-debugger` 从未在任何一次 T3 checkSig 向量里构造过真正验签通过的签名：

- `docs/provenance/2026-09-14-j2-t2-kanettokenclaim/mk_kanettokenclaim_vectors.mjs` 原话："placeholder
  sig, no real key available offline, same convention as close/cancel_attest B-class"。
- `docs/provenance/2026-09-14-j2-t3-v03-payoutshard-absorb-ab11-and-batest/` 的 close_attest/cancel_attest
  12/12 PASS 向量里，checkSig 相关的全部命名 `..._reaches_sig_gate`，`expect` 全部是 `fail`。
- `cli-debugger` 源码（`session/src/*.rs`）零 checkSig/schnorr 实现痕迹。

三方独立印证同一件事：**这个离线工具链从来没有能力构造一条真正验签通过的向量，只能证明"在正确的地方
失败"**（到达 checkSig 门限、不是被别的逻辑挡住）。

**⇒ 本次不写一条假的 `"expect":"pass"` 签名向量。** 两条向量都 `expect:"fail"`，都在 `checkSig` 那一行
失败——证明的是"门限真实生效、且不受是否处在真实 co-spend 上下文里影响"，这正是此前从未验过的部分。

**这个边界的后果（Bettor 已记账·报 Owner）**：整个 T3 集（`PoolSideTicket.authorize_spend` /
`KanetTokenClaim.spend` / `RootClose.close_commit` 4-of-5）的"真实签名通过"路径在离线工具链下从未被
证明，**唯一可证之处 = 主网真链**。原型第一次真实下注→结算→claim 就是 T3 真签名路径的首次实证，必须
按 GO-F 金丝雀纪律走（最小金额、Owner 单独批广播、每笔 landed 独立核），不得当作普通功能测试。

## 向量

| 名称 | 场景 | expect |
|---|---|---|
| `V-TICKET-1_fail_no_signature_reaches_sig_gate_realistic_cospend` | ticket 输入 + 一个 claim/refund 形状的 filler covenant 输入同在一笔 tx 里（= 真实 co-spend 上下文，不是 ticket 孤零零一个输入）+ 全零占位签名（= "无签名"） | fail |
| `V-TICKET-2_fail_wrong_key_signature_reaches_sig_gate_realistic_cospend` | 同上下文 + 一个结构合法、非占位符形状的 64/65 字节签名（= "错签名"，只是对不上 `bettorPk`） | fail |

两条都在 `checkSig` 那一行失败（`authorize_spend` 全文只有这一个 `require`，没有更早的结构性门可能
误挡——这与 close_attest 等多步骤合约不同，此处"到达签名门限"是平凡的，真正被验证的是**这条门限在
真实 co-spend 上下文里依然被正确执行**，不会因为交易里多了一个别的 covenant 输入而被绕过）。

## 实测

`node mk_poolsideticket_vectors.mjs` 生成 `PoolSideTicket.cospend.test.json`（真实编译，D-019 pin
`silverc-v100-3ed9733.exe`，`compileSilV100`+`extractTemplateArtifact` 单源适配层，非裸 CLI）；

`cli-debugger.exe`（**必须用 `D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/cli-debugger.exe`
这份与 D-019 pin 同 commit `3ed973335b59269293564805cc2c58a14595ec03` 的构建——`/d/silverscript` 工作树
本身是活的开发目录，可能已经在别的 commit 上，直接用会解析失败，本次踩过一次**）
`--test-file PoolSideTicket.cospend.test.json --run-all`：

```
2 tests: 2 passed, 0 failed
```

（`run.log` 为完整原始输出。）

## 🔴 两个落码期间踩到、值得记录的坑（防下一个人重踩）

1. **compileSilV100 的 `template_hash_bytes` ≠ `extractTemplateArtifact` 独立复算的 hash**：裸调 CLI
   编译 + 读编译器自报的 `template_hash` 字段，得到 `73f79f9e...`；用 `compileSilV100` +
   `extractTemplateArtifact`（`blake2b(prefix‖suffix)`，全仓每一处真正被消费的 `*_tmpl_hash` 都走这条
   路径）得到 `37de5497...`——**两者不同，且只有后者是全仓生产代码实际信任的值**（`compileSilV100`
   返回的 `template_hash_bytes` 字段从未被任何生产调用方读取，是未使用的直通字段）。已改用后者，
   与 `kasia-console/scripts/mainnet-sil-set.json` 第 11 条一致。
2. **debugger test.json 的 `constructor_args` 方言 ≠ `compileSilV100` 的 ctor 方言**：前者是扁平
   hex 字符串/数字（`"0xaa..."` / `1000`），后者是 `{kind,value}` 包装对象——混用直接解析失败。
3. **`WrongGenesisCovenantId` 报错来自声明了 `covenant_id` 但没有可溯源 genesis 结构的输出**：给
   `authorize_spend`（不做任何 `validateOutputState`）用的占位输出，一开始写
   `{value:1, covenant_id: hex(...)}` 触发 debugger 自己的一致性检查（要求声明 `covenant_id` 的输出
   能溯源到真实 genesis 结构），与本合约逻辑无关；改用 `{value:1, script_hex:'0x0000'}`（裸脚本占位，
   不声明 covenant_id）后通过。
