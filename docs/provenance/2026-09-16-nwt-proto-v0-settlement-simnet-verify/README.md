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

## 追加验证：`RootClaim.sil:103 require(payout>=1000)` 是代币化前遗留字面量——结构性阻塞点

Bettor 复核（账本1484）指出：本轮第一次因 `payout>=1000` FAIL 而把 `min_bet` 从 API 真实默认值 `1`
（`src/api/proto.js:118`）临时改成 `1000` 才跑通全链——**这掩盖了一个真实的结构性阻塞**：`RootClaim.sil:103`
的 `require(payout >= 1000)` 是代币化之前（KAS sompi 时代）遗留的字面量，**代币化后 `payout` 是 KTT 数量，
不是 sompi**，两者量级完全不可比。后果：**任何 `min_bet=1`（API 真实默认值）的小额市场，只要赢家最终
`payout < 1000` 枚代币，就永远无法 `claim_draw`**——不是"构造错误"，是合约本身对代币化后语义的一处
真实待修点。

**追加复现（同一份脚本，`WINNER_SIDE` 参数化后重跑，不需要新 builder）**：精确复刻 Bettor 点名的
"活市场 `a59c7b48` 同形状"——`min_bet=1`，第一笔 `YES stake=1`，第二笔 `NO stake=999`
（`pool_value=1000`），裁决 `winningSide=YES`（唯一赢票，全池 `payout=pool_value=1000`，**恰好卡在
门槛上**），走 `claim_draw` full 分支 + `KanetTokenClaim.spend`：

| # | 入口 | txid | mass | requiredFee(sompi) |
|---|------|------|------|---------------------|
| 1 | `market_genesis` | `72a6422eb282b4061623e8ececea5795fdda12b1a88546d6f76f6932635889e1` | 200,006 | 20,000,300 |
| 2 | `register_append`#1（YES, stake=1） | `7119172f7309310cf34473fb621b83bdcd23377c0d8b47753ea5e44bf2cca0d0` | 448,870 | 44,886,300 |
| 3 | `register_append`#2（NO, stake=999, held） | `958d14fe52edd31be097239a316ea57f17fc6bd59ffef13272f813f668175b70` | 446,880 | 44,687,300 |
| 4 | `convert_to_rootclose` | `59c816b304961d5c2366df5786fc182d7d8782e096f72d5c3e001904ba94418c` | 396,794 | 39,678,700 |
| 5 | `close_commit`（winningSide=YES） | `8740b94b5e93cd85f05f95e990ed09d0420d09f714d11a722dc3665ab1ad8d9a` | 198,771 | 19,876,700 |
| 6 | `convert_to_claim` | `baca652593f3d9d805e96991cc96a8948ca927394e61a0c924263a82359f11ee` | 396,718 | 39,671,100 |
| 7 | `claim_draw`（payout=1000, 恰在门槛上） | `baedb222f1a7652d3e7cc65674356b2ca404220a19ca7c1c9f5d25b98043b06d` | 393,781 | 39,377,400 |
| 8 | `KanetTokenClaim.spend` | `849c01d9e52537dec7a31f9e619c82758c573c21efde5a1c139cb1ca162e7cfd` | 196,628 | 19,662,500 |

**全部 8 步真实共识 ACCEPT**——确认 `payout==1000`（门槛值本身）可行；`market_id` 与前一轮无关
（独立新市场，脚本对 `WINNER_SIDE` 做了泛化，close_commit/claim_draw/spend 现在都能选 bet1 或 bet2
作为赢家，不再硬编码只支持 bet2 赢）。**未测试 `payout` 严格小于 1000 的情形**（例如 `payout=999`）
——按 `.sil` 源码字面（`>=`，非 `>`），`999 < 1000` 会命中同一条 `require` 直接 FAIL，这条不需要
再上链验证即可从源码确定，本报告不再重复消耗测试网资源去证实一个源码已经写死的边界。

**RootClaim 待修清单（新增，供后续修改）**：
- `RootClaim.sil:103 require(payout >= 1000)` —— 需要重新评估这条下限在代币化后的正确取值（是否
  应删除、改成远小的值、还是改成与 `min_bet`/`pool_value` 关联的动态下限），**与 claim_draw partial
  分支那次已知修改（账本记录的既有 partial-branch 待修项）放在同一次修改里一并处理**，避免重复改
  `RootClaim.sil` 两次。
- 影响面：API 默认 `min_bet=1`（`src/api/proto.js:118`）的现有/未来小额市场，赢家 `payout<1000`
  时结构性无法领奖——这不是"边缘情况"，是**默认配置下的常见情况**（默认值本身就在这条门槛之下）。

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
   本身的 checkSig 判定是本轮认定的例外。）**此项当时只当"我的构造要跟着 stake 规模走"处理，未追问
   `1000` 这个门槛本身是否合理——Bettor 复核（账本1484）指出它是代币化前的 KAS sompi 遗留字面量，
   与 API 真实默认 `min_bet=1` 冲突，是结构性阻塞，非本轮构造问题。见下方"追加验证"一节与
   RootClaim 待修清单。

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

## 追加验证①：节点侧权威mass分维度抽核（账本1489/1490 Bettor要求，`probeMempoolMass`工具）

**背景**：J2的结算设计v0.6（`docs/2026-09-16-j2-proto-v0-settlement-design-v0.1.md` §0.14b）用手算
KIP-9公式给出"register_append真实margin约93.6%（比kaspa-wasm本地`calculateTransactionMass`看到的
约89%更紧）"这个结论，理由是"kaspa-wasm本地mass计算漏算v1交易的`compute_budget`项"。Bettor要求用
真实节点RPC（`getMempoolEntry`，不是本地wasm计算）逐维度（compute mass / storage mass / transient
mass）抽核，margin按"最大那个维度/500,000"算，并注明每列对应哪个RPC字段。

**方法**：新增`probeMempoolMass(txid, label)`函数（`run-full-chain.mjs`），在`submitTransaction`成功
后、`mineOne`确认前，调用`rpc.getMempoolEntry({transactionId, includeOrphanPool:true,
filterTransactionPool:false})`——此时交易仍在mempool里，节点已经对它做过完整的`calc_non_contextual_
masses`真实共识层计算并存进mempool entry，取得的数字是节点自己算出来的权威值，不是我方本地估算。

**RPC返回字段映射**（`getMempoolEntry`响应结构，逐字段核对过）：
- `mempoolEntry.transaction.mass` — 本轮实测**始终等于**`mempoolEntry.transaction.storageMass`（8/9
  笔样本无一例外）；未见独立的"transient mass"字段——**这个RPC不暴露transient mass**，若KIP-9协议
  层确有这个独立维度，需要换一个更底层的RPC（或读源码确认是否只在特定场景才产生非零transient mass，
  本轮未继续深挖，留作后续）。
- `mempoolEntry.transaction.verboseData.computeMass` — 独立字段，与`mass`/`storageMass`不是同一个数
  （第9笔样本里`computeMass`(7,750) > `mass`/`storageMass`(5,555)，证实两个维度确实各自独立计算，
  `mass`字段不是`max(compute,storage)`合并值，而是单独就是storage mass；margin判定必须**分别**核对
  两个维度各自是否超500,000，不能只看`mass`这一个字段）。

**8步+1步节点侧权威mass表**（8步为§0.4的边界形状复现`min_bet=1/stake=1,999`，第9步为下方"追加验证②"
的输家ticket自我回收；`margin`列取`max(storageMass, computeMass)/500,000`）：

| # | 步骤 | storageMass(=`mass`字段) | computeMass | 二者较大值 | margin(较大值/500,000) | 本地kaspa-wasm mass(对照) |
|---|------|---|---|---|---|---|
| 1 | `market_genesis` | 200,013 | 8,083 | 200,013 | 40.00% | 200,013(完全一致) |
| 2 | `register_append`#1 | 445,518 | 33,927 | 445,518 | **89.10%** | 448,342(高出2,824) |
| 3 | `register_append`#2 | 435,969 | 44,198 | 435,969 | 87.19% | 445,350(高出9,381) |
| 4 | `convert_to_rootclose` | 385,410 | 60,422 | 385,410 | 77.08% | 395,159(高出9,749) |
| 5 | `close_commit` | 194,960 | 35,560 | 194,960 | 38.99% | 198,120(高出3,160) |
| 6 | `convert_to_claim` | 384,865 | 48,618 | 384,865 | 76.97% | 394,977(高出10,112) |
| 7 | `claim_draw` | 377,634 | 40,407 | 377,634 | 75.53% | 390,434(高出12,800) |
| 8 | `KanetTokenClaim.spend` | 184,263 | 29,914 | 184,263 | 36.85% | 194,766(高出10,503) |
| 9 | 输家ticket自我回收(见下) | 5,555 | **7,750** | **7,750**(compute占优) | 1.55% | 814(严重低估, 见下方说明) |

**核心发现（订正J2 §0.14b的方向性结论）**：**全部7个非平凡步骤的节点权威mass都比本地kaspa-wasm数字
更低**（低2,824-12,800不等），方向与J2"本地漏算compute_budget、真实值应该更高"的假设**相反**。
`register_append`的真实margin是**87.19%-89.10%**，不是J2手算的93.6%——好消息是真实margin比J2估计的
更安全，但§0.14b那张表的具体数字（尤其"93.6%"这个引用值）需要重新写，不能沿用手算结果。**倾向解释
（供J2核实，不代下结论）**：本地`calculateTransactionMass`看起来已经内含一个接近storage mass的计算
（不是"只有一个不完整的compute mass分量"），只是这个本地公式本身比真实KIP-9公式系统性偏高几千到
一万出头个单位——这与"漏算compute_budget"是两件独立的事，可能是J2手算时把"本地基线本身有小偏差"
和"漏算了一整项compute_budget"这两个问题合并成了一个，方向判断反了。

**第9步的独立新发现**：本地`calculateTransactionMass`对这笔"单covenant输入(p=1)+单P2PK输出"的极简
交易反过来**严重低估**（本地814 vs 节点真实7,750，本地只有真实值的约1/9.5）——与上面7步"本地略高"
是**不同方向、不同量级**的另一处独立的kaspa-wasm本地mass不可靠实例（交易形状差异很大：那边是
2-4输入的复杂covenant交易，这里是1输入的极简交易）。**结论：kaspa-wasm本地`calculateTransactionMass`
在两种不同交易形状下都不可信，且偏差方向不统一（复杂covenant交易本地偏高，极简单输入交易本地偏
低）——任何依赖本地数字做margin判断的代码，必须换成`getMempoolEntry`真实核对，不能假设本地数字
有固定方向的偏差可以简单加减修正**。

**结论对§0.14b的具体影响**：全部9笔（含追加验证）都远低于各自维度的500,000上限，"资金充足/mass全部
安全"这个总结论不变；但§0.14b"register_append真实margin约93.6%"这句具体表述需要改成"87-89%
（节点getMempoolEntry真实值，见本节）"，且"kaspa-wasm本地漏算compute_budget"这个归因需要重新表述为
"kaspa-wasm本地mass计算与真实节点值有偏差，偏差方向随交易形状变化，不能假设单一修正方向"。

## 追加验证②：输家ticket并非永久锁死——`authorize_spend`可自我回收（账本1490 Bettor读合约发现）

**背景**：§0.14/§0.4曾把"输家ticket（0.2 KAS）在(A)路线执行完毕后永久锁死"记为一条产品问题
（"要不要给输家ticket设计sweep回收路径"，见J2设计v0.4 §0.12选项组3）。Bettor直接读
`PoolSideTicket.sil`发现该合约**唯一入口**是：

```
entry authorize_spend(sig bettorSig) { require(checkSig(bettorSig, pubkey(bettorPk))); }
```

没有其它约束——bettor自己随时可以用自己的私钥签名把这张ticket花掉，取回其中的0.2 KAS，不需要等
`claim_draw`/`refund_payout`消费它，也不需要任何新增合约entry。

**真实验证（本轮边界形状市场的输家ticket，bet2/side=NO/stake=999，本市场YES赢，bet2票是输家票）**：
构造真实`authorize_spend`交易——单输入（该ticket UTXO）+单输出（0.2 KAS减fee转给relay测试地址），
用bet2自己的真实私钥（`kaspa.createInputSignature`）签名，真实广播：

- txid：`f86a9535a844b3bf5a36ebc870ace894104ecc7294af0c46448065a5f67b2e1d`
- 节点侧mass：`storageMass=5,555`，`computeMass=7,750`（本轮唯一一笔compute mass占优的样本，见上表#9）
- fee：2,000,000 sompi（固定给的、远高于观测门槛的值——本地mass预估在这个交易形状下不可靠，见上节）
- 结果：**✅ simnet真实共识ACCEPT**，成功取回18,000,000 sompi（0.2 KAS减2,000,000 sompi fee）

**结论：`PoolSideTicket.sil`当前代码没有"永久锁死"这回事**——这是**builder/流程设计缺口**（现有
proto-v0结算流程从未构造过这笔`authorize_spend`交易，不是合约层面做不到），修法是**只需新增一个
builder**（`buildTicketReclaimTxJson`或类似命名），**不需要改任何`.sil`文件**、不需要新增合约entry、
不改变任何`_tmpl_hash`、不影响既有市场P2SH（这点与§0.8"要不要修合约"那类选项性质完全不同——这里
根本不涉及合约变更）。

**关于"提前花自己的ticket"的后果核实（Bettor第二问）**：读`RootClaim.claim_draw`/`RefundClaim
.refund_payout`源码确认——两者都通过`readInputStateWithTemplate(ticketInIdx,...)`直接消费**当前这笔
交易里作为输入提供的那个具体ticket UTXO**，市场的`pool_value`/`count`等聚合账目在`register_append`
阶段就已经写死进`ShardLeaf_direct`/`RootClose`自己的state（不依赖任何ticket UTXO是否还存在于链上）。
**结论：某个bettor提前（在`resolve`之前，或在`refund_flip`之后但在自己触发`refund_payout`之前）
自行`authorize_spend`花掉自己的ticket，唯一后果是这个人自己放弃了该票日后的`claim_draw`/
`refund_payout`资格（因为票已经不在了，没有UTXO可以再拿去做那笔交易的输入）——不影响其他任何
bettor的资金或权利，也不影响`pool_value`/`winning_side`/`payout_root`等市场级账目（这些账目的权威
来源是RootClose/RootClaim自己的state，不是ticket UTXO集合）**。这是一个纯粹的"个人选择放弃自己
权益"场景，不构成安全问题，也不需要额外的合约层保护。

**对J2设计文档的影响（J2待更新，本报告只提供验证证据）**：§0.12选项组3（"输家ticket永久锁死要不要
设计回收路径"）与§0.14"永久锁死的dust"这条发现，需要改写为——不存在"永久锁死"，回收路径已经存在于
合约层（`authorize_spend`），唯一缺的是backend/relay侧的一个builder（暴露"回收自己的ticket"这个
操作给用户），不涉及任何`.sil`修改、不改变模板hash、不影响既有市场P2SH。

## 测试环境说明（非共识规则，供后续复现者参考）

本轮验证过程中，close_commit一度被真实节点拒收（`"transaction input #0 is not finalized"`），
排查后确认**不是新的共识规则发现**，是**本机这个simnet的测试环境本身的问题**：该simnet节点在本次
长会话里断续挖矿、稀疏出块（大量mint-loop批量挖矿与真实业务交易穿插，出块节奏很不均匀），怀疑其
`PastMedianTime`窗口（最近若干区块时间戳的中位数，`check_tx_is_finalized`用它判断CLTV的`deadline`
是否"已经真实过去"）在这种稀疏挖矿场景下**滞后**于真实墙钟——原本`DEADLINE_MS = Date.now() -
3600_000`（1小时缓冲）在正常连续出块的场景下绰绰有余，但在本机这个断续挖矿数小时的simnet实例上
不够。**修法**：把缓冲从1小时放大到6小时（`run-full-chain.mjs`当前值），问题消失，全部重跑通过。
**这条只是本机测试环境的出块节奏问题，不是MUST-1记录的CLTV/节点finality规则本身有任何变化**——
生产环境的真实市场deadline是以天为单位的真实业务截止时间，真实钱包/节点在正常持续出块下不会遇到
这种"稀疏挖矿导致中位数滞后小时级"的情况，MUST-1的规则描述本身不需要改动。

## 文件清单

- `kasia-console/scripts/simnet/run-full-chain.mjs` — 全链 8 步 + 输家 ticket 自我回收（第9步）构造+
  签名+提交脚本，含 `probeMempoolMass` 节点侧权威 mass 抽核工具（本报告的可执行来源）。
- `kasia-console/scripts/simnet/mine-loop.mjs` — simnet 出块循环（`skip_proof_of_work=true`，无需真实 PoW）。
- `kasia-console/scripts/audit/generic-entry-witness.mjs` — 通用 entry witness ABI 编码器（J2 原作，账本1473，从 `coord/j2-proto-v0-settlement-design-v0.1` 分支同步，本轮依赖但未改动）。

## 后续

- 生产 builder 覆盖④⑤⑥⑦⑧五步后，须用生产字节在 simnet 重跑，才是最终验收依据（本报告结论范围仅限
  "合约逻辑可被真实共识接受"，不代表生产 builder 的具体字节实现已验证）。
- KIP-9 mass 精确 compute/storage 拆分（`calculateStorageMass` wasm 崩溃）留待后续解决。
- close_commit 的 cli-debugger FAIL 根因未定案，暂不起草上游 issue；若后续钉死根因，再评估是否需要。
