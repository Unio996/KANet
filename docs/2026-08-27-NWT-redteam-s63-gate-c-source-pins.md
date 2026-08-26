# NWT 红队 — §6-3 gate (c)-1 源码坐标表

> 作者 NWT · 2026-08-27 · 派工 Bettor (16) · 被审 = `docs/2026-08-27-j2-s63-gate-c-source-pins.md`（**48a9d1af**，未推）
> 审法：**坐标表的唯一失败模式 = 行号/hex 错 → 误导 J1 读错码，或偷偷夹带语义裁定。** 我逐 pin 用 `git show 7b1e18cc:` 独立复核原文片段是否真在声明的 file:line；并查它有没有越出"只钉坐标"的边界。
> **总评：全部承重坐标逐字命中 7b1e18cc、版本纪律对（工作树确为 90dbf074 ≠ 7b1e18cc，我实测 `git rev-parse` 坐实）、边界诚实（只述不裁）= GREEN。** 一处 §0 图 range-end 微瑕（不阻塞）。

## 1 · 版本纪律核（Bettor 🔴 的那条，先坐实）
- `cd /d/rusty-kaspa && git rev-parse --short HEAD` ⇒ **`90dbf074`**；`git cat-file -t 7b1e18cc` ⇒ `commit`（存在）。
- ⇒ **任何人用编辑器打开 /d/rusty-kaspa 工作树都在读 90dbf074（无 TESTNET12_PARAMS 块、无 covenant opcode 语义）**——Bettor 抽核与本稿读法纪律**成立且必须遵守**。我下面每一条都用 `git show 7b1e18cc:`，非工作树。

## 2 · 逐 pin 复核（原文片段 vs 声明坐标 @7b1e18cc）
| pin | 声明 | 我 `git show 7b1e18cc:` 实读 | 判 |
|---|---|---|---|
| 1.1 派生 | `hashing/covenant_id.rs:16-30` H(outpoint.txid‖index‖n‖∀(index,value,spk.ver,spk.script)) | :8-30 逐字命中，含 :13-14 "excluding the covenant binding itself to avoid self-reference" | ✅ |
| 2.2 continuation | `covenants.rs:124-136` `input_covenant_id == covenant_id ⇒ push input_ctxs.auth_outputs + shared_ctxs.output_indices` | 逐字命中（"Continuation case" 注释 + 两 push）| ✅ |
| 2.4 genesis 重算 | `covenants.rs:147-160` 用 `input.previous_outpoint` 重算，`expected_id != covenant_id ⇒ WrongGenesisCovenantId` | 逐字命中 | ✅ |
| 2.5 genesis 不进上下文 | `covenants.rs:96-100` "Genesis outputs are validated but do not populate covenant contexts" | 逐字命中 | ✅ |
| 3.1 UTXO 落 cov_id | `utxo_diff.rs:232-242` `UtxoEntry::new(…, output.covenant.map(\|x\| x.covenant_id))` + block_daa_score 同处写 | 逐字命中 | ✅ |
| 1.3 CovenantBinding | `tx.rs:185-197` `{ authorizing_input: u16, covenant_id: Hash }` | 命中（Copy/Borsh derive + 两字段）| ✅ |
| 1.5 populate | `tx.rs:363-367` `covenant_id(input_outpoint, group.outputs…)` → `CovenantBinding::new` → `outputs[out].covenant = Some(binding)` | 逐字命中 | ✅ |
| 4.1 OpInputCovenantId | `opcodes/mod.rs:1499` `<0xcf,1>` | @1499 `<0xcf, 1>` | ✅ hex+行 |
| 4.2 OpOutputCovenantId | `:1597` `<0xd5>` | @1597 `<0xd5, 1>` | ✅ |
| 4.3 OpCovOutputCount | `:1548` `<0xd2>`，body `num_covenant_outputs` | @1548 `<0xd2,1>`，body `vm.covenants_ctx.num_covenant_outputs(covenant_id)` + `ScriptSource::TxInput` 守卫 + else InvalidOpcode | ✅ 连 body |
| 4.4 OpCovInputCount/Idx/OutIdx | `:1516/:1531/:1563` `0xd0/0xd1/0xd3` | @1516 `<0xd0>`、@1531 `<0xd1>`、@1563 `<0xd3>` | ✅ |
| 4.5 OpAuthOutputCount | `:1436` `<0xcb>` | @1436 `<0xcb,1>` | ✅ |
| 4.6 OpOutputAuthorizingInput | `:1614` `<0xd6>` | @1614 `<0xd6,1>` | ✅ |
| 4.7 OpCheckSigFromStack | `:1633` `<0xd7>` | @1633 `<0xd7,1>`（`:1644 OpCheckSigFromStackECDSA<0xd8>` 相邻）| ✅ |
| 2.7 拒因全集 | `errors/src/lib.rs:113-124` WrongGenesisCovenantId/InvalidCovInIndex/InvalidAuthCovOutIndex | :115/:119/:123 命中 | ✅ |
| 5.1 激活 | `params.rs:669-696` TESTNET12_PARAMS，`:694 covenants_activation: always()`，选择 `:528-532 Some(12)=>TESTNET12_PARAMS` | :669 `TESTNET12_PARAMS`、:680 Testnet12、:687 mass 500k/500k/1M、:693 crescendo always、:694 covenants always、`..TESTNET_PARAMS`；选择映射逐字命中 | ✅ |
| 5.5 sighash | `sighash.rs:233-235` `write_bool(covenant.is_some())` + `write_u16(authorizing_input).update(covenant_id)` | 逐字命中 | ✅ |

- **hex 号全对**（0xcb/0xcf/0xd0/0xd1/0xd2/0xd3/0xd5/0xd6/0xd7）——这是 J1 最易被误导处（hex 错 = 建错 covenant），逐个核过。
- 未逐字复核但**同族连续、低风险**：3.2 utxo_entry wasm 名 `covenantId`、3.3 utxo_inquirer 三处、5.2-5.6 校验入口/EngineFlags——都在已核文件的相邻块，且非"选一个 hex 建 tx"级承重。J1 上链前可用 §3 的复核命令一键再扫。

## 3 · 边界核（有没有偷偷裁语义）—— 🟢 干净
- 全表 "只述不裁"：1.2 明标"是否成立由 J1 上链证"；2.5 那格"是否算续链由 J1/设计裁，本稿只指出它在计数外"；§2"给 J1"把"坐标能给的"与"J1 仍要上链做的"**分栏**；§3 列了不做项（不裁"相等==唯一"、不裁 SS 字节调对 opcode）。**没有把坐标表冒充成 (c) 的语义 PASS**——这正是我要防的越界，没犯。✅
- 🔵 **唯一实质提醒（非坐标错，是 J1 必须补的一步，J2 §2 行1 已标）**：坐标钉在 `7b1e18cc`，但"`7b1e18cc` == 部署中的 live kaspad 共识"这一步**本表不证、交 J1 写 build 坐标证据**。⇒ 整张表的效力**条件于**这个绑定，J2 正确地把它列为 J1 的活，没在表里假装已绑。posture 对。

## 4 · 微瑕（不阻塞）
- §0 生命周期图写 opcode 段 "`opcodes/mod.rs:1436-1631`"，而 `OpCheckSigFromStack` 实在 :1633、ECDSA 在 :1644 ⇒ **range-end 差 ~13 行**。详情表 §4.7 写对了（:1633-1642），只图注 range 收窄了。改成 `1436-1644` 即可。纯 cosmetic。

## 5 · 交付判词
- **§6-3 gate (c)-1 源码坐标表（48a9d1af）= GREEN。** 全部承重 file:line + opcode hex 逐字命中 `7b1e18cc`；版本纪律正确（工作树 90dbf074 ≠ live，实测坐实）；"只钉坐标不裁语义"边界干净；"7b1e18cc==live" 这步正确外包给 J1 未假装闭合。
- **GREEN = 坐标可信、J1 可照此读码**；**≠ (c) 六条 PASS**——(c)-2..6（两 genesis→两 cov_id / 只收 baked / 续链恰一 / terminal 零续 / 变异按正确理由失败）是 J1 上链要做的事，本表只给它们的坐标锚，J2 分栏标清了。
- 一处 cosmetic（§0 图 range-end 1631→1644），落码/交 J1 时顺手改，不阻塞推送。
