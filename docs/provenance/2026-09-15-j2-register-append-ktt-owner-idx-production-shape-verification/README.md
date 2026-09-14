> **Status**: CURRENT

# buildRegisterAppendTxJson 生产真实形状下 held/stake 两个 KTT 输入的 transfer sigScript 逐字节验证
# (Bettor 回执要求, 账本1436续) —— 过程中发现并修复一个真实 bug

## 起因

Bettor 对 `cf6423bc`(`buildRegisterAppendTxJson`)的回执要求补一项证据：`docs/provenance/2026-09-15-
j2-ktt-transfer-witness-abi-verification/` 只用**孤立**向量（`owner_input_idx=[3]`）证明了
`encodeKttTransferZeroOutAction` 的编码器本身没错，但没有证明 `buildRegisterAppendTxJson` 里**实际调用
这个编码器时传的参数**（对 held/stake 分别传了哪个 `owner_input_idx`）在生产真实形状下也是对的——而
`#253`（debugger 忽略 active 输入的 `signature_script_hex`）意味着这一层不能靠"把 builder 的输出喂给
debugger 执行"来验证，必须用同一套 debug-print 手法，在**生产真实交易形状**下分别捕获 held/stake 各自
的真实 `active_sigscript`，与 `buildRegisterAppendTxJson` 里实际会产出的字节逐字节比对。

## 🔴 过程中发现的真实 bug（不是本笔预期结果，是核对时撞出来的）

核对 `buildRegisterAppendTxJson`（`kasia-console/src/lib/proto-tx-assembly.mjs`）源码时发现：stake 的
`owner_input_idx` 硬编成 `[0]`（leaf 的 input index）——

```js
const stakeAction = encodeKttTransferZeroOutAction(kaspa, stakeInput.entryAbi, stakeInput.stateFieldCount, [0]);
```

这与已经真实验证过的设计（`docs/provenance/2026-09-15-j2-stake-chip-owner-unbound-verification/` 向量
②`stake_transfer_owner_unbound_via_leaf_input_fail`）直接矛盾：stake 的 `owner=STAKE_CHIP_OWNER_UNBOUND`
(全零32字节)，在场证明靠 `OpInputCovenantId(owner_input_idx) == ZERO32` 成立——这要求 `owner_input_idx`
指向一个**非covenant**输入（P2PK 的 fee 输入，`OpInputCovenantId` 对它返回 `ZERO_HASH`）。指向 leaf
（真实非零 covenant_id）正是向量②明确证伪、必定 FAIL 的写法。这是把 held 的语义（`owner=leaf`的
covenant_id，`owner_input_idx=[0]`指向leaf自证）和 stake 的语义（`owner=ZERO32`，`owner_input_idx`必须
指向非covenant的fee输入）搞混了。

**已修复**：`kasia-console/src/lib/proto-tx-assembly.mjs` 的 `buildRegisterAppendTxJson` 里 stake 的
`owner_input_idx` 改为 `[feeIdx]`（fee 输入在该次调用里的真实 input index，第一笔下注=2，第二笔下注=3）。

**这个 bug 之前为什么没被抓到**：`proto-tx-assembly-register-append.test.mjs` 只验证 kaspa-wasm 能不能
构造出交易 + relay 真代码接不接受这个形状 + 签名后 txid 对不对——这三条都不检查 witness 参数在真实
consensus 层面是否会通过 covenant 脚本的验证（那需要真实执行 `KanetTestToken.sil`，而 console 侧测试
从不调 cli-debugger）。这正是 Bettor 这次回执要求的意义所在：construction-level 测试证明不了
consensus-level 正确性，两层必须分别验证。

## 决定性验证（修复后）

沿用 `docs/provenance/2026-09-15-j2-register-append-entry-witness-abi-verification/debug-print.patch`
的手法（D-019 pin `3ed973335b59269293564805cc2c58a14595ec03`，临时加一行 `eprintln`，验证后 `git
checkout` 还原+重编回原始二进制，`git status`/`git rev-parse HEAD` 确认干净）。构造三笔生产真实形状的
完整交易（复用 `2026-09-15-j2-stake-chip-owner-unbound-verification` 已验证过的构造手法），分别在
held/stake 是 active input 时真实执行 `transfer`，捕获真实 `active_sigscript`：

| 场景 | 交易形状 | active | owner_input_idx | 真实 debugger 结果 | 捕获字节 == 我的编码器字节 |
|---|---|---|---|---|---|
| A) 第二笔下注(有held) | `[0]leaf [1]held [2]stake [3]fee` | held(1) | `[0]`(=leaf) | PASS | ✅ 逐字节一致 |
| B) 第一笔下注(无held) | `[0]leaf [1]stake [2]fee` | stake(1) | `[2]`(=fee) | PASS | ✅ 逐字节一致 |
| C) 第二笔下注(有held) | `[0]leaf [1]held [2]stake [3]fee` | stake(2) | `[3]`(=fee) | PASS | ✅ 逐字节一致 |

（🔴 Bettor 回执订正：C 这条不能用 `2026-09-15-j2-ktt-transfer-witness-abi-verification` 里那条
`owner_input_idx=[3]` 的旧捕获代替——那条捕获发生在本笔修复 bug **之前**，是直接调
`encodeKttTransferZeroOutAction` 验证编码器本身，不是修复后的 `buildRegisterAppendTxJson` 在第二笔
下注形状里实际会走的那次调用。虽然两者理论上该编出同样的字节（编码器本身没变，只是调用方传参
从写死的 `[0]` 改成了正确的 `[feeIdx]`），但证据必须来自修复后 builder 的真实产出，不能靠"应该一样"
的推断代替实测——已按同样手法补上独立捕获，见下。）

捕获的三组字节：

```
A) held,  owner_input_idx=[0]: 000000000000000800000000000000000424a3e4a8
B) stake, owner_input_idx=[2]: 000000000000000802000000000000000424a3e4a8
C) stake, owner_input_idx=[3]: 000000000000000803000000000000000424a3e4a8
```

用 `encodeKttTransferZeroOutAction(kaspa, entryAbi, 6, [0])` / `[2]` / `[3]` 独立编码出的字节与上面三行
**逐字节完全一致**（`mk_and_run.mjs` 输出 `MATCH: true` ×3，`run.log` 留档）。

## leader (`transfer`) vs delegate (`transfer_delegator`)：确认后者在本设计下不可达

`KanetTestToken.sil:74-112`：`#[covenant(binding=cov, ..., name=transfer, delegate_name=transfer_
delegator)]` 生成的 `transfer` 是 **leader** 入口（真正跑 `prev_states`/`next_states` 守恒校验，覆盖
整个 covenant 组的 inputs/outputs）；`#[covenant.delegate] transfer_delegator`（`:111-117`）是
**非leader成员**各自证明自己 owner 在场、把守恒校验委托给组里的 leader 那个入口——只有当**同一条
covenant 血统**（同一 covenant_id）有**多个成员**同时出现在同一笔交易里时，才会出现"一个 leader +
若干 delegate"的分工。

bet_mint 的设计（`docs/provenance/2026-09-15-j2-ktt-dual-lineage-merge-cardinality-check/`）里 held 和
stake **永远是两条不同的血统**（各自独立的 genesis outpoint ⇒ 不同 covenant_id）——同一笔交易里每条
血统永远只有 1 个成员，组大小恒为 1，恒是 leader，`transfer_delegator` 在这个设计下**从不会被调用**。
这不是假设，是两次真实执行（`2026-09-15-j2-register-append-full-tx-three-execution` + 本笔）里 held/
stake 作为 active input 时，debugger 选中的 `function` 字段全部是 `transfer`（从未是
`transfer_delegator`）这一事实直接证明的——若未来设计改成"同一血统的多个 UTXO 在一笔交易里合并"，
才需要另开一笔补 `transfer_delegator` 的编码验证，当前不在范围内。

## 文件清单

- `mk_and_run.mjs`(生成两个向量+调用 debugger+比对, 含 bisect 出的 CLI 调用方式 `<sil路径>
  --test-file <json> --test-name <name> -r`)
- `debug-print.patch`(临时调试打印, 验证后已还原)
- `run.log`(两次真实 cli-debugger 执行 + 比对结果的完整输出)
- `ShardLeaf_direct.sil` / `KanetTestToken.sil` / `PoolSideTicket.sil`(D-019 pin 真实编译源, 冻结副本)
- `README.md`(本文件)
