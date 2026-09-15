# 2026-09-16 NWT — proto-v0 结算全链 simnet 真实共识验证

账本1473/1479/1482/1483/1484 委派，Bettor 批准的隔离 simnet 全链真共识验证。目标：cli-debugger 对
`RootClose.close_commit`（5委员 checkSig）持续 FAIL（账本1479/1482/1483），排除了"参数占位符过短""harness
重建缺陷"两个假设后，根因仍锁定在 sighash 计算本身、非 witness 内容——用与生产主网**完全同一份**
v2.0.1 二进制、同参数跑一个安全隔离的本地 simnet 节点，把整条结算链（genesis → register_append×2 →
convert_to_rootclose → close_commit → convert_to_claim → claim_draw → KanetTokenClaim.spend）真实提交，
让真实共识（而非 debugger 的部分模拟）做最终裁决。

## 结论（先说结果）

**全部 8 步，在同一条真实构造、真实广播、真实共识确认的链上，全部被 v2.0.1 simnet 节点接受。**
其中 `close_commit`（5-of-5 committee checkSig + `validateOutputState` 续约）是本轮验证的**决定性问题**：
**cli-debugger 对它持续 FAIL，而真实共识【接受】**——判定为 **debugger 结论与真实共识不一致，
debugger 已不作为 close_commit 是否可执行的依据**（根因未定案前不下"上游缺陷"结论，只记录这一不一致事实）。

途中另发现两项此前完全未知、cli-debugger 无法测出的**节点级真实约束**（详见下方"CLTV / 节点级
finality 规则"一节）——这些是本轮 simnet 验证相对 cli-debugger 的核心增量价值：debugger 只模拟"active
input 的合约逻辑"，从不模拟 kaspad 的节点级交易 finality 检查、KIP-9 storage mass、以及**其它输入自身
的脚本执行**（本轮也踩了两次这个坑，见"施工中的构造错误"）。

## 环境 / 安全约束（严格执行，全程未违反）

- 节点二进制：`D:\rusty-kaspa-v201\kaspad.exe`，sha256 `8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38`，`--version` = `kaspad 2.0.1`——**与主网节点跑的完全同一份二进制**（Bettor 1483 核实要求，全程逐次核对版本号，未再用错分支构建）。
- 启动参数：`--simnet --appdir=<独立目录，gitignored> --rpclisten-borsh=127.0.0.1:18510 --rpclisten=127.0.0.1:... --listen=127.0.0.1:... --utxoindex --disable-upnp --enable-unsynced-mining`（simnet 无对等节点，需此 flag 让节点接受 RPC 提交的区块）。
- 网络隔离：P2P/RPC 只监听 127.0.0.1，不开防火墙端口，不注册系统服务，不设开机自启，进程低优先级。
- 主网节点（PID 8268，16110/17110 端口）全程未被触碰，启动前后均核实其同步状态/`virtualDaaScore`持续增长/console 无新 FATAL（30 分钟观察窗，账本1484）。
- 资金：simnet 挖矿获得的测试币 + 一个独立生成的测试 relay 身份（私钥仅存本机 scratch JSON，非任何真实账户，非任何生产 relay 实例）。
- 生产 relay/console 进程全程未启动、未修改配置指向 simnet；全部广播由本目录下独立脚本发起。

## 生产 builder / 审计构造 归属（逐步标注，按 Bettor 对齐要求）

| # | 入口 | 构造来源 | txid | mass | requiredFee(sompi) |
|---|------|---------|------|------|---------------------|
| 1 | `market_genesis` | **生产 builder**（`proto-covenant-builder.mjs::computeMarketGenesisArtifacts` + `proto-tx-assembly.mjs::buildMarketGenesisTxJson`，主线代码，逐字对照 `src/lib/proto-tx-assembly-register-append.test.mjs` 生产参考用法） | `43eec62833f96c3a2f8978592d9db541b69bbb50201562c392e730385cb57179` | 200,005 | 20,000,300 |
| 2 | `register_append`#1（first_bet，无 held） | **生产 builder**（`buildRegisterAppendTxJson`） | `75a807f876042848fa56906b85b0517d23d19dae17f429d3a3300034e37e9dbc` | 448,986 | 44,898,100 |
| 3 | `register_append`#2（second_bet，held=第一笔合并KTT） | **生产 builder**（同上，三输入形状） | `75820ba56a78e527ffe1f16069d5adea55871bc0712c9dc7e27cd79a68b9ab3d` | 447,216 | 44,721,000 |
| 4 | `convert_to_rootclose`（ShardLeaf_direct） | **审计构造**（`scripts/audit/nwt_04_audit_convert_to_rootclose.mjs` 模式扩展；held 输入改用真实 `encodeKttTransferZeroOutAction`/`combineKttActionAndRedeem`——见下方修正记录①） | `5d21f501e2d6ec0ca0e13b6d9186aa7dc3e046ce6a5ea6a8ccb1fe4b8be96d6b` | 397,149 | 39,714,400 |
| 5 | **`close_commit`（决定性）** | **审计构造**（委员签名走 `kaspa.createInputSignature`，与 kasia-relay 生产签名底层同一函数；见下方修正记录②③） | `7d7d0aeb0daf7a4ae6b49fa8ae6548a81f00509214220de5cd7c00b43ceaced8` | 198,909 | 19,890,600 |
| 6 | `convert_to_claim`（RootClose） | **审计构造**（结构同④，held 同样用真实 transfer zero-out action） | `e795ec88bd8b05d5edb334f6bc357636b4d38e32e4ac1de72ef5d32f9c5a97cc` | 397,085 | 39,708,000 |
| 7 | `claim_draw`（RootClaim，full 分支：payout==pool_value，无续约） | **审计构造**（ticket 消费需真实 bettor `authorize_spend` 签名——见修正记录④⑤） | `c1fef3f539754f53d4aa40677cb1cd9c52e7286b775bc82ce8e75b875e435686` | 394,487 | 39,448,100 |
| 8 | `KanetTokenClaim.spend`（提取） | **审计构造**（赢家 checkSig，见修正记录⑥⑦） | `08d59aea292fb7c168a05ee41ea45db375dd907fc7df0017433da00ff26f9d8f` | 197,016 | 19,701,300 |

**审计构造结论的地位**：④⑤⑥⑦⑧五步目前**没有生产 builder**（proto-v0 结算侧尚未落码），结论范围
限定在"这套合约逻辑在真实共识上可执行、参数/witness 形状如上表"——**等生产 builder 实现后必须用生产
字节在 simnet 重跑，才是最终验收依据**（不能拿本轮审计构造的 PASS 直接当生产验收凭证）。①②③生产
builder 已是 mainline 代码（主线 fa6e5790 之后），可直接作为验收依据。

签名口径：①②③的 fee 输入签名与④⑤⑥⑦⑧全部签名（committee/bettor/fee）均通过
`kasia-relay/src/lib/covenant-broadcast.mjs::signOnlyDeclaredInputs` 或 `kaspa.createInputSignature`
（两者底层是同一签名函数），独立进程调用，**不经过任何生产 relay 实例**。

每步 implied fee 恒等式（Σ真实inputs.utxo.amount − Σ真实outputs.value == 内部算出的 netLoss/requiredFee）
均已从反序列化的真实 tx 对象独立复算一遍确认一致（账本1455纪律），全部 ✅。

市场参数：`min_bet=1000`，两笔下注 `stake=2000(YES)/3000(NO)`，`pool_value=5000`，NO 方胜出
（`winningSide=1`），单一赢家全池提取（`payout=5000=pool_value`，走 claim_draw 的 full 分支，无
`remainTokenOutIdx`/`rootOutIdx` 续约）。

## 决定性发现：close_commit — debugger FAIL，真实共识 ACCEPT

`RootClose.close_commit`（`kasia-console/src/lib/RootClose.sil:131-159`）在 cli-debugger（D-019 pin
`3ed973335b59269293564805cc2c58a14595ec03`）上持续报 `require(validSigs>=4)` 一行 FAIL（账本1479起，
最近一次复跑见 `scripts/audit/rootclose-close_commit-audit-run.log` 仍 FAIL）——此前逐 push 字节比对
已排除"witness 参数是短占位符""debugger 内部见证重建缺陷"两个假设，根因仍锁定在 debugger 自己的
sighash 计算路径本身（`silverscript#253`：`signature_script_hex` 只填充 introspection 对象，实际执行
走独立重建的 `active_sigscript`，可能存在未知分歧）。

本轮用**相同的 5 委员 checkSig 结构**（v0 单委员会，5 槽同一把私钥重复签，`kaspa.createInputSignature`
产出真实 ECDSA/Schnorr 签名，非任何占位符）构造真实交易，提交给运行**生产同款 v2.0.1 二进制**的
simnet 节点：**真实共识接受**，交易落链（txid 见上表，5 委员签名 + `validateOutputState` 续约
`closed:0→1`、`winningSide`、`payoutRoot` 全部真实生效）。

**结论（按 Bettor 要求的措辞纪律）**：debugger 结论与真实共识不一致，**debugger 已不作为 close_commit
是否可被共识接受的依据**。根因未定案（不排除是 debugger 自身某处未公开的 bug，也不排除是本次未曾触及
的其它边界条件），**不下"上游 silverscript 缺陷"结论**——待后续若能钉死 debugger 侧根因，再起草面向
上游的中性 issue 草稿。

## CLTV / 节点级 finality 规则（cli-debugger 完全测不出的真实节点约束）

`close_commit` 与 `refund_flip` 都用 `require(tx.time >= temporal(deadline_ms[+7200000]))`，编译为
`OpCheckLockTimeVerify`。真实提交时踩到两条相互制约、cli-debugger 从不模拟的节点级规则：

1. **`OpCheckLockTimeVerify` 本身要求 ACTIVE input 的 `sequence < MAX_TX_IN_SEQUENCE_NUM`**
   （`rusty-kaspa` `crypto/txscript/src/opcodes/mod.rs:1055`，错误原文
   `"transaction input is finalized"`）——这条规则**专门防止**用 `sequence = MAX` 把 CLTV 检查短路掉。
2. **节点级交易 finality 检查**（`consensus/src/processes/transaction_validator/tx_validation_in_header_context.rs:71-92`，`check_tx_is_finalized`）：若 `tx.lock_time >= 当前区块时间/DAA`，交易被判"未最终化"直接拒收
   （`NotFinalized`），**除非**该交易的**全部** input 的 `sequence == MAX`。

**两条规则叠加的唯一自洽解**：committee-签名 input（ACTIVE input）的 `sequence` 必须是普通值（本轮用
`0`），这就迫使规则2 必须走"`lock_time < 真实当前时间`"这条分支才能通过——**没有任何 sequence 组合能
绕开"deadline 必须已经真实过去"这个前提**（第一次尝试用"部署时刻+1小时"的未来 deadline 配合两个
input 都 `sequence=MAX`，被真实节点拒收：`"Unsatisfied lock time: transaction input is finalized"`，
根因即上述规则1）。

**对生产 builder 的含义（若后续落码 close_commit/refund_flip 的生产 builder，必须遵守）**：
- `close_commit`/`refund_flip` 只能在市场 `deadline_ms`（`refund_flip` 为 `deadline_ms+7,200,000`）
  **真实已经过去**之后提交，不能靠脚本层设个未来值就当作满足——deadline 未到时构造出的交易会被
  节点直接拒收，不会进入 mempool，更不会触发合约层的 checkSig 逻辑。
- committee-签名 input 的 `sequence` 用标准值（`0`）即可；fee 输入的 `sequence` 无此限制。
- **对当前活市场 `a59c7b48`（Bettor 1484 点名）的含义**：其 deadline 已过，`close_commit` 现在即可
  提交；`refund_flip` 同样已满足 `deadline+2h` 窗口，理论上任何人现在都能提交（`refund_flip` 无签名
  门槛，见 `RootClose.sil:163-172`，这是既有设计——市场取消路径本就是permissionless）。

## mass 观察（Bettor 要求：占比最大来源，作为后续优化观察项）

八步 mass 从 197,016（spend）到 448,986（register_append#2），**register_append 系与 convert_to_*
系（约 397k-449k）已逼近 simnet `500,000` compute mass 上限的 80%-90%**（`maximumStandardTransactionMass`
实测为该值量级，具体见 `kaspa-wasm` 同名导出）。

本轮**独立确证**了 KIP-9 storage mass 对**小面值 covenant 输出**极度敏感这一既有记忆
（`reference-kip9-storage-mass-plurality-is-not-one-covenant-utxo-is-p2`）——首次尝试
`convert_to_claim` 时把 `claimOutIdx` 的输出值设成 `.sil` 里 `DUST_MIN` 常量的字面值（1000 sompi），
`selectChangeShape` 算出 `requiredFee ≈ 400,019,728,500 sompi`（约 4000 KAS！），比正常同结构交易的
fee 高出约 **10,000 倍**——**根因是 storage mass 公式含 `p²/v` 项，v=1000 这种极小面值配合 covenant
输出的 plurality p=2，storage mass 被放大到天文数字**，改用 `CONTINUATION_OUTPUT_SOMPI`（20,000,000
sompi，与其它续约/genesis 输出同一量级）后恢复正常。这条**不是 debugger 能测出的**（debugger 不实现
KIP-9），也是本轮除 CLTV 之外第二个"只有真实节点才会暴露"的约束——**`.sil` 注释里"KAS 侧只剩 dust
（DUST_MIN=1000）"这句话如果被生产 builder 字面理解为"用 1000 sompi"会直接产出天价 fee 交易，必须
用远高于字面 DUST_MIN 常量、与其它 covenant 输出同量级的真实"dust"值**——本轮统一改用
`CONTINUATION_OUTPUT_SOMPI=20,000,000`（0.2 KAS）后各步 fee 均恢复到 2000 万-4500 万 sompi 的正常区间。

细粒度 compute/storage/transient 拆分：尝试用 `kaspa.calculateStorageMass(network, inputValues,
outputValues)` 独立复算时撞上 `RuntimeError: unreachable`（kaspa-wasm 已知的 wasm 线性内存/参数格式
脆弱点，另案，非本次结算逻辑问题）——**未能拿到精确的 compute/storage 数值拆分，留作后续优化观察项**：
可确认的定性结论是"占比最大的来源是 covenant 输出的 storage mass（对输出面值的 1/v 敏感），不是
sigScript/witness 字节数的 compute mass"（由上面 4000 KAS 异常复现直接证实），但精确占比数字需要
绕开这个 wasm 崩溃点后再补。

## 施工中的构造错误（记录在案，均为 NWT 自己的构造问题，不是合约缺陷——诚实记录过程）

① `convert_to_rootclose` 首次沿用 `scripts/audit/nwt_04_audit_convert_to_rootclose.mjs` 的 held-token
   消费手法（裸 redeem 脚本当 sigScript，无 action 前缀）——该手法在 cli-debugger 下 PASS，但**只是因为
   debugger 只验证"active input"自己的合约逻辑，从不独立验证其它输入自己的脚本执行**。真实 kaspad 对
   **每一个**输入都独立验证脚本，held-token 输入必须走真实 `encodeKttTransferZeroOutAction`/
   `combineKttActionAndRedeem`（与 register_append 生产手法一致）才能通过——这是本轮除 close_commit
   本身外，第二个"debugger 验证范围窄于真实共识"的具体例证。

② `close_commit`/`convert_to_rootclose` 两个新建输出（genesis covenant）第一次尝试用单个
   `GenesisCovenantGroup(feeIdx, [0, 1])`（两个输出共享一组），真实 kaspa-wasm 算出的
   `covenant_id` 与手工用单条目数组预算的 `kaspa.covenantId(...)` 结果对不上——covenant_id 是
   `(outpoint, [outputIndices])` 的纯函数，**数组内容整体入公式**，合并两个 index 会同时改变两者的
   covenant_id，不是"各自独立算一次"。改为两个独立的 `GenesisCovenantGroup`（各自单元素数组）后一致
   （与 market_genesis/register_append 现有生产代码的唯一既有用法——均为单元素数组——保持一致）。

③ `close_commit` 的 mass/fee 决策（`selectChangeShape`）第一次在 input[0] 用空 `Uint8Array(0)` 占位
   sigScript 计算，签名后才把真实 700+ 字节的 5-pubkey+5-sig sigScript 塞回去——mass 严重低估，
   `requiredFee` 会不够。改为：先用 65 字节全零占位签名构造出**字节长度与真实签名恒定相同**的
   sigScript 参与 mass/shape 决策，shape 确定后再替换成真实签名（长度不变，不影响已选定的 shape）。

④ `claim_draw` 第一次用随机 32 字节当 `payoutRoot`——`claim_draw` 会从 `payout`+`bettorPk` 沿 merkle
   路径爬回验证 `cur==payoutRoot`，随机值永远无法通过任何合法 merkle proof。改为单赢家场景用
   `tree_depth=0`（无 siblings），`payoutRoot` 直接等于 `blake2b(bettorPk‖payout_as_8byteLE)`。

⑤ `claim_draw` 第一次沿用早前小额单测夹具的 `stake=20/30`（`pool_value=50`），cli-debugger 定位到
   `RootClaim.sil:103 require(payout >= 1000)` FAIL——**真实市场 stake 规模必须让 pool_value 舒适地
   超过 1000**，不是随便给个非零值就行。改用 `min_bet=1000, stake=2000/3000`（`pool_value=5000`）后通过。
   （此项由 cli-debugger 正确 localize——claim_draw 不在"debugger 结论不可信"范围内，只有 close_commit
   本身的 checkSig 判定是本轮认定的例外。）

⑥ `PoolSideTicket.sil` 唯一入口 `authorize_spend(sig bettorSig)` 要求票据持有人真实签名——早前
   register_append 步骤给两笔下注生成的 `bettorPk` 是纯随机 32 字节（无对应私钥），`claim_draw` 消费
   赢家 ticket 时无法签名。改为用真实 `kaspa.PrivateKey` 生成 `bettorPk`（`toXOnlyPublicKey()`），
   私钥留存本地供 `claim_draw`/`spend` 后续步骤真实签名使用。

⑦ `KanetTokenClaim.spend` 第一次尝试让新输出的 `owner` 字段自引用**自己的** covenant_id——covenant_id
   是 `(outpoint, [index, output])` 的哈希函数，`output` 本身（含 scriptPubKey 字节）决定 covenant_id，
   而"owner=自己的 covenant_id"要求先知道 scriptPubKey 才能算 covenant_id、又要先知道 covenant_id
   才能写 scriptPubKey——**自指不动点方程无解**（与既有记录"shardLeafCovId 真实公式...自指不动点方程
   无解"同一类问题）。改为 `to_market_input=true, dest_idx=0`（指向正在被消费的 `KanetTokenClaim`
   自己，其 covenant_id 是已知值，不需要现算）。同一笔交易里还漏给 held-token 输入真实 sigScript
   （空 `Uint8Array(0)`），真实节点报 `"-3191 cannot be used as an array index"`（`readInputStateWithTemplate`
   对空 sigScript 算 `length − suffix.length` 得负数越界）——同①同一类"held 输入必须走真实 action"的坑。

## 复现

```
cd kasia-console
node scripts/simnet/run-full-chain.mjs
```

前置：本机需已起一个隔离 simnet 节点（appdir/RPC 端口按脚本头注配置），`scratch/_nwt_simnet_state.json`
需已有一个持久化、已挖矿资金的 relay 测试身份（首次跑需要先完成资金准备步骤，脚本会在缺失时报错提示）。
脚本对每一步都做幂等检查（`scratch/_nwt_simnet_chain.json` 记录进度），重跑会跳过已完成步骤。

## 文件清单

- `kasia-console/scripts/simnet/run-full-chain.mjs` — 全链 8 步构造+签名+提交脚本（本报告的可执行来源）。
- `kasia-console/scripts/simnet/mine-loop.mjs` — simnet 出块循环（`skip_proof_of_work=true`，无需真实 PoW）。
- `kasia-console/scripts/audit/generic-entry-witness.mjs` — 通用 entry witness ABI 编码器（J2 原作，账本1473，从 `coord/j2-proto-v0-settlement-design-v0.1` 分支同步，本轮依赖但未改动）。

## 后续

- 生产 builder 覆盖④⑤⑥⑦⑧五步后，须用生产字节在 simnet 重跑，才是最终验收依据（本报告结论范围仅限
  "合约逻辑可被真实共识接受"，不代表生产 builder 的具体字节实现已验证）。
- KIP-9 mass 精确 compute/storage 拆分（`calculateStorageMass` wasm 崩溃）留待后续解决。
- close_commit 的 cli-debugger FAIL 根因未定案，暂不起草上游 issue；若后续钉死根因，再评估是否需要。
