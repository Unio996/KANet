> **Status**: DRAFT v0.1 · 作者 J3(J1 顶替工作代理,Bettor 派工)· 2026-08-06 · DESIGN-ONLY 零实现授权 · 待 NWT 红队
> **授权**: D-012 §6-1 冻结前置③(`docs/DECISIONS.md:69` 六条前置之③「v0.7 完整交易形状 + sighash 分析」)。Bettor 2026-08-06 直令派工。
> **约束**: 本稿只新增本文件,零代码/零 DB/零链上/零频道/零 commit。每条事实断言带 file:line(现读核实,非记忆);推断显式标注。
> **证据分级**: `[CONFIRMED·源码实读]` 现读代码坐实 / `[CONFIRMED·协议实读]` 现读协议/共识源码坐实 / `[推断]` 带依据的推理 / `[未验]` 需链上实测或他人 domain 知识才能定。

# v0.7 委员签名交易 —— 完整形状约束 + SIGHASH 域分析(D-012 §6-1 冻结前置③)

## §0 本稿要回答的那一个问题(承 DECISIONS §2-bis 补注)

`docs/DECISIONS.md:58` 的 Codex 作用域补注把前置③ 的原始要求钉死为一句:

> `require(outputs[selfOutIdx].value == consolidated_pool)` 只证**那一个 covenant 输出自身守恒**;而 **SIGHASH_ALL 签名承诺的是整笔序列化交易** —— 同一笔中仍可含**他方控制的额外输入 / 搬走无关价值的额外输出 / 被改的 fee 与 change**。⇒ **自输出守恒 clamp 本身不能证明「该签名挪不动别的钱」。**

`docs/DECISIONS.md:60`:「该先例要成立的前置:需给出**完整交易形状约束 + sighash 域分析**(今天没有)。」

**本稿即那份分析。** 结论提前说(§3/§4 展开):**v0.7 委员签名今天确实挪不动池子里的钱,但这个安全性【完全】来自 covenant 的链上自输出 clamp + kaspa 共识的价值守恒,不来自委员签名本身、也不来自委员侧的任何形状校验(D2 只验 covenant continuation 输出的 SPK)。** 委员对整笔交易(输入集、输出集、fee、change)是 **SIGHASH_ALL 盲签**。这恰好证实 Codex 的补注:clamp 成立 ≠ 委员验过别的钱不动。前者(池子挪不动)成立,后者(委员签名受限于「只签事实」)不成立。

---

## §1 事实底座:close_attest_v2 交易的完整实际形状

### 1.1 构造点与调用链(全部现读)

| 环节 | 位置 |
|---|---|
| SS 合约 close_attest entrypoint(链上自执行) | `kasia-console/src/lib/PayoutShardV2.sil:80-181` |
| 交易组装(preimage / submit 两阶段) | `kasia-relay/src/lib/p2sh.mjs:2015-2076` `unlockBshardCloseAttestV2` |
| relay 命令入口 | `kasia-relay/src/relay.mjs:1006` `case 'bshard_close_attest_v2'` |
| 委员签名 IPC 原语 | `kasia-relay/src/relay.mjs:711-777` `case 'sign_input_for_settle'` |
| 委员侧 enforce(签名前复核) | `kasia-console/src/lib/bshard-close-enforce.mjs:501-591` `enforceCloseAttestV2` |
| 委员 cron 驱动(自治路,默认 OFF) | `kasia-console/src/services/bshard-close-voter.js:436-534` |

### 1.2 输入(恰 2 个) `[CONFIRMED·源码实读]`

组装于 `p2sh.mjs:2023` `const matched = [psUtxo, feeUtxo];`,注入交易于 `p2sh.mjs:2068-2071`:

- **input[0] = PayoutShardV2 covenant UTXO**。value = `consolidated_pool`(池面值;`_utxoValue(psUtxo)`,`p2sh.mjs:2036`)。
  - 授权方式:**不是** input signatureScript 里放签名,而是委员的 4-of-5 签名进 witness data,由 SS 合约内 `checkSig(c0Sig,pubkey(c0Pk))…`(`PayoutShardV2.sil:100-104`)逐个验、`require(validSigs>=4)`(`:105`)。scriptSig 结构见 `p2sh.mjs:2048-2051`:`selfOutIdx + new_payoutRoot + new_attestedWinner + new_betsRoot + new_refundRoot + new_attestedAtMs + [5×sig] + committeePkHash + [5×pk] + [5×idx] + [40×sibling] + OP_1('51') + redeem`。
  - **委员签的就是这个 input(input_index=0)的 sighash**(`bshard-close-voter.js:497` `input_index: req.input_index ?? 0`)。
- **input[1] = fee UTXO**(`cmd.inputs.fee`,`p2sh.mjs:2022`)。地址 = `cmd.inputs.fee.address`。
  - 授权方式:submit 侧 relay 钱包亲签:`p2sh.mjs:2067` `const feeSig = createInputSignature(un, 1, wallet.getPrivateKey(), SighashType.All);`。**这是提交者(settler/submitter)自己的钱**(见 §3-2 论证)。

### 1.3 输出(典型 2 个,可变) `[CONFIRMED·源码实读]`

组装于 `p2sh.mjs:2038-2041`:

- **output[selfOutIdx] = PS continuation**。`new TransactionOutput(psOutValue, payToAddressScript(new Address(psContAddr)), new CovenantBinding(0, new Hash(psCovId)))`(`p2sh.mjs:2039`)。
  - value = `psOutValue = _utxoValue(psUtxo)` = `consolidated_pool`,**close 不动 value**(`p2sh.mjs:2036` 注)。
  - SPK = 新 continuation 地址,烤入 closed=1 + 5 个 attest 字段(`psContAddr`,`p2sh.mjs:2035` `_continuationAddressV2`,新 state 见 `:2030-2034`)。
  - 带 `CovenantBinding`。
- **change output(条件性)**。`_appendChange(orderedOut, matched, cmd.outputs?.change_address, _bshardFeeV1(matched.length))`(`p2sh.mjs:2041`)。
  - `p2sh.mjs:1717-1723`:`change = Σin − Σ业务out − fee`;`if (change >= 1000n && changeAddress) orderedOut.push(new TransactionOutput(change, payToAddressScript(new Address(changeAddress))))`。
  - **收款地址 = `cmd.outputs.change_address`,由调用方(driver)提供**,纯 P2PK,**无 covenant、无 SS 侧约束**。
  - change < 1000 sompi 或无 change_address ⇒ **不追加该输出** ⇒ 输出数退化为 1。⇒ **输出数不是常数,由 change 是否 dust 决定。**

### 1.4 fee `[CONFIRMED·源码实读]`

`p2sh.mjs:1712-1713`:`_BSHARD_FEE_PER_INPUT = 1_000_000n`(0.01 KAS/input);`_bshardFeeV1(2) = max(2×1e6, _BSHARD_MINER_FEE)` = 0.02 KAS(除非 miner-fee 常量更高)。**这是一个下限口径的固定值,非上界约束**(见 §4)。

### 1.5 交易信封 `[CONFIRMED·源码实读]`

`p2sh.mjs:2068-2071`:`version:1`,`lockTime:BigInt(lockTime)`(默认 0),`gas:0n`,`subnetworkId:'00…00'`(native),`payload:''`。每 input `computeBudget:_BSHARD_COMPUTE_BUDGET`(=70,`p2sh.mjs:1709`),`sigOpCount:0`。**version=1 关键**(见 §2.4:covenant 字段只在 version≥1 进 sighash)。

---

## §2 SIGHASH 域分析

### 2.1 签名用什么 sighash 类型(实读,不假设) `[CONFIRMED·源码实读]`

**两个 input 都用 `SighashType.All`(SIGHASH_ALL)**:
- 委员签(input 0)经 `sign_input_for_settle`,两条反序列化分支都硬编码 `SighashType.All`:safe_json 分支 `relay.mjs:738`,默认分支 `relay.mjs:772`。**该 IPC 原语没有任何参数可换 sighash 类型,也没有对 tx 内容做任何校验**(见 §3)。
- fee 签(input 1)`p2sh.mjs:2067` 亦 `SighashType.All`。

kaspa 支持的 sighash 类型:`SIG_HASH_ALL=0x01 / SIG_HASH_NONE=0x02 / SIG_HASH_SINGLE=0x04 / SIG_HASH_ANY_ONE_CAN_PAY=0x80`(`D:\rusty-kaspa\consensus\core\src\hashing\sighash_type.rs:6-9`)。**v0.7 路径只用 ALL,从不使用 NONE/SINGLE/ANYONECANPAY。**

### 2.2 SIGHASH_ALL 下,签名承诺了什么(kaspa 权威 preimage) `[CONFIRMED·协议实读]`

节点真实 sighash preimage:`D:\rusty-kaspa\consensus\core\src\hashing\sighash.rs:245-280` `calc_schnorr_signature_hash`。逐字段:

| preimage 段 | 覆盖范围 | 源码行 |
|---|---|---|
| `tx.version`(u16) | 交易版本 | `sighash.rs:254` |
| `previous_outputs_hash` | **全部 input 的 outpoint(txid+index)** | `sighash.rs:254` → `:140-152`(遍历 `tx.inputs.iter()`) |
| `sequences_hash` | **全部 input 的 sequence** | `sighash.rs:254` → `:155-166` |
| (仅 version<1)`sig_op_counts_hash` | 全部 input 的 sigOpCount | `sighash.rs:260-262` |
| **被签 input 的 outpoint** | 这一个 input 的 txid+index | `sighash.rs:264` |
| **被签 input 的 scriptPublicKey** | 这一个 input 的 spk(version+script) | `sighash.rs:265` → `:240-243` |
| **被签 input 的 amount + sequence** | 这一个 input 的面值与序号 | `sighash.rs:266` |
| (仅 version<1)被签 input 的 sig_op_count | | `sighash.rs:268-270` |
| `outputs_hash` | **全部 output 的 value + spk (+ version≥1: covenant flag/authorizing_input/covenant_id)** | `sighash.rs:273` → `:197-221`,`:228-238` |
| `tx.lock_time` / `subnetwork_id` / `gas` | 交易信封 | `sighash.rs:274-276` |
| `payload_hash` | payload | `sighash.rs:277` |
| `hash_type`(u8) | sighash 类型本身 | `sighash.rs:278` |

**⇒ SIGHASH_ALL 承诺(签名一旦出,以下任一改动都令签名失效):**
- 全部 input 的 outpoint 集合(增删改任一 input ⇒ `previous_outputs_hash` 变);
- 被签 input 自身的 outpoint / spk / **amount**(kaspa 承诺被花 UTXO 的面值,类 BIP143);
- 全部 output 的 value + spk + **covenant 绑定**(增删改任一 output ⇒ `outputs_hash` 变);
- 交易信封(version/locktime/subnetwork/gas/payload)。

**⇒ SIGHASH_ALL 没承诺(不在 preimage 内):**
- **其他 input 的 scriptPublicKey / amount** —— preimage 里全 input 只进 outpoint 与 sequence,**非被签 input 的 spk 与面值不入 hash**(`sighash.rs:140-152` 只写 outpoint;per-input spk/amount 段只对被签 input,`:265-266`)。`[CONFIRMED·协议实读]`
  - 🔵 这不构成漏洞:每个 input 要被花仍须各自满足自己 spk 的解锁条件(共识层),outpoint 已被承诺即锚定了「就是这个 UTXO」。但它意味着**委员签名本身不对别的 input 的性质(是谁的钱、多少钱)作任何密码学声明**。
- **哪个 output 是「找零」、fee 具体多少** —— fee = Σin−Σout 是隐含量,preimage 不单列;committee 无从只凭 sighash 语义判断哪个 output 该属于谁。

### 2.3 kaspa sighash 与 BTC 的差异 `[CONFIRMED·协议实读 + 推断]`

- **哈希算法**:kaspa 用 blake2b 族 `TransactionSigningHash`(`sighash.rs:1` import;`:145` `TransactionSigningHash::new()`),非 BTC 的双 SHA-256。`[CONFIRMED·协议实读]`
- **结构类 BIP143(segwit)而非 legacy BTC**:分段承诺 `previous_outputs_hash`/`sequences_hash`/`outputs_hash`,且**承诺被签 input 的 amount**(`sighash.rs:266`)—— legacy BTC SIGHASH_ALL 不签 input 金额,BIP143 才签。kaspa 全程如此。`[CONFIRMED·协议实读]`
- **covenant 承诺是 kaspa 特有且版本门控**:`sighash.rs:232-237` —— `if version >= 1 { hasher.write_bool(output.covenant.is_some()); … covenant_id … }`。**version<1 的交易,sighash 完全不覆盖 covenant 绑定。** BTC 无此概念。`[CONFIRMED·协议实读]` ⇒ 这正是委员侧 D2 强制 `version>=1` 的根因(`bshard-close-enforce.mjs:232` `_ver<1` 弃签;注释 `:226`「covenant binding 仅 sighash 覆盖于 tx.version>=1」)。
- **无 SIGHASH_ALL|ANYONECANPAY 组合被使用**:虽然 kaspa 支持 `ANY_ONE_CAN_PAY=0x80`(`sighash_type.rs:9`,置位后 `previous_outputs_hash`/`sequences_hash`/`sig_op_counts_hash` 返 `ZERO_HASH`,`sighash.rs:141-143` 等),但 v0.7 从不使用 ⇒ **委员签名默认锁死全 input 集**,这对 §3-1 是有利的既成事实。`[CONFIRMED·协议实读]`

---

## §3 攻击面枚举:拿到「委员签名请求构造权」的 driver 能做什么

**威胁模型**:一个能构造 `sign_input_for_settle` 请求(或 close_attest_v2 组装参数)的 driver 进程。参照 D-012 §5(`DECISIONS.md:93`)与本稿 §4.4 引用的既登记事实——**本机拓扑(11 relay 含 4 oracle)下,自治 enforce voter 默认 OFF,live 走 driver-enforce 路,一个 driver 进程可取得全部 4 个委员签名且中间零独立 relay 侧检查**(`bshard-close-voter.js:263` `D4 relay-gate 未闭`;`bshard-auto-settler.mjs:378` 直接 `relayPost({type:'sign_input_for_settle'})`,relay 该原语对内容零校验,`relay.mjs:711-777`)。故本节按「driver 全控被签 tx 字节」评估。

| # | 攻击 | 结论 | 依据 |
|---|---|---|---|
| 1 | **附加他方(受害者)输入** | **不能**(靠委员签名单独);但 tx **可以**携带额外 input,委员从不清点 input 数 | 委员签的是 input 0 的 sighash(`bshard-close-voter.js:497`);任何额外 input 要被花仍须各自满足其 spk 解锁(kaspa 共识层),委员签名不满足别的 input。受害者 P2PK input 需受害者私钥。⇒ driver 只能加**自己**能花的 input(自己的钱)。委员侧 enforce 全程不校验 input 数/其余 input 归属(`bshard-close-enforce.mjs:501-591` 无 `tx.inputs.length` 检查)。`[CONFIRMED·源码实读+协议实读]` |
| 2 | **附加搬钱输出** | **不能搬走池子的钱**;**能**追加输出重定向【提交者自己的 fee-input 价值】 | 池面值被两道链上闸锁死:①SS `require(tx.outputs[selfOutIdx].value == consolidated_pool)`(`PayoutShardV2.sil:180`)+ `validateOutputState(selfOutIdx,{…})`(`:170-179`);②kaspa 共识 Σout≤Σin。⇒ 池钱只能原样进 continuation 输出。可自由追加的价值 = fee input 面值−minerFee,而 fee input 是提交者自己的(§3-3)。**委员侧对非 covenant 输出零校验**:D2 只 filter 出带 covenant 的输出逐个比对 SPK(`bshard-close-enforce.mjs:240-246`),change/额外 P2PK 输出不在其视野。`[CONFIRMED·源码实读+协议实读]` |
| 3 | **改 fee / change** | **能**(委员侧零校验),但动的是提交者自己的 fee-input 价值 | change 值与地址由 `cmd.outputs.change_address` 决定(driver 供,`p2sh.mjs:2041`/`:1722`)。委员 enforce 不校验 fee 上界、不校验 change 去向。`_assertTxInvariants`(`p2sh.mjs:42-74`)只在 **submit 侧**跑,且只查 `fee>0`(`:48`)/`dust≥1000`(`:52`)/`mass floor`(`:63-66`)—— **无 fee 上界、无输出数上界、无输出模板校验**。`[CONFIRMED·源码实读]` |
| 4 | **复用签名到另一笔** | **不能** | SIGHASH_ALL 承诺全 input outpoint 集 + 被签 input 的 outpoint/spk/amount + 全 output(§2.2),任一差异 ⇒ 不同 sighash ⇒ 签名失效(`sighash.rs:245-279`)。叠加:PS UTXO 单次花费;D1 dedup-by-market 对同 market 不同 root 拒签(`bshard-close-voter.js:454-464`);C3 TOCTOU 校验签的 tx hash == enforce 验过的 hash(`bshard-close-voter.js:491-493`,`bshard-close-enforce.mjs:589`)。`[CONFIRMED·源码实读+协议实读]` |

### §3 承重结论(直接答前置③)

**池子里的钱 driver 挪不动 —— 但这份安全性的承重件是 covenant 的链上自输出 clamp(`PayoutShardV2.sil:180`)+ kaspa 共识价值守恒,不是委员签名、不是 D2。** 委员对整笔交易是 SIGHASH_ALL 盲签,委员侧唯一验过的形状事实是「带 covenant 的 continuation 输出其 SPK 承诺了重算出的 root」(`bshard-close-enforce.mjs:240-246`)。⇒ **Codex `DECISIONS.md:58` 的补注逐字成立**:自输出守恒 clamp 只证那一个输出守恒;「委员签名挪不动别的钱」这个更强命题,今天靠的是 clamp+共识,而**不是**委员这一签名动作被结构性地限制在「只签事实」。

🔴 **这条差异对 §6-1 冻结的直接后果**:若把 v0.7 当「三权已分离」的**通用先例**引用,是错的(照 `DECISIONS.md:59` 禁止措辞)。准确表述:**v0.7 里,covenant 独立地把池子锁住了,以至于委员即便盲签也偷不走池子** —— 这是 covenant 强,不是委员签名弱到够不到钱。真正的「委员结构上够不到资金路径」要成立,须走 §5 的 typed-receipt 正路(委员改签**不含任何交易字节**的域分隔 receipt,由 covenant 独立消费),而非继续让委员 SIGHASH_ALL 签整笔 tx。

---

## §4 需要的交易形状约束(要让「委员签名挪不动别的钱」成为签名侧不变量)

前提澄清:silverscript **有**钉死完整形状的全部原语(现读 `D:\silverscript\docs\TUTORIAL.md`):`tx.inputs.length`/`tx.outputs.length`(`:923/926`)、`tx.inputs[i].value`/`.scriptPubKey`(`:951-952`)、`tx.outputs[i].value`/`.scriptPubKey`(`:970-971`)、`new ScriptPubKeyP2PK`/`P2SH`(`:991/1000`)。⇒ **下列「未强制」都不是「做不到」,是「没写」。**

| # | 需钉死的字段 | 现状 | 强制点/缺口 |
|---|---|---|---|
| A | **input 数 == 2**(PS + fee,无多余) | **未强制** | SS close_attest 无 `tx.inputs.length` 检查(`PayoutShardV2.sil:80-181` 通读无);委员 enforce 无(`bshard-close-enforce.mjs:501-591`);submit-side `_assertTxInvariants` 无。原语可用(`TUTORIAL.md:923`) |
| B | **output 数 == 精确期望值** | **未强制**(且当前随 change 是否 dust 在 1↔2 间漂,§1.3) | 同上,无 `tx.outputs.length` 约束 |
| C | **output[selfOutIdx] 的 SPK 模板 + value == consolidated_pool** | **已强制(双重)** | SS:`validateOutputState(selfOutIdx,…)` + `require(…value==consolidated_pool)`(`PayoutShardV2.sil:170-180`);委员 D2:`verifyClosePayoutV2Binding` 比对 continuation SPK(`bshard-close-enforce.mjs:228-247`) |
| D | **其余每个 output 的脚本模板 + 金额来源**(尤其 change 必须 = 指定地址且 = Σin−池−fee) | **未强制** | change 地址 driver 全控(`p2sh.mjs:1722`);SS 不看非 selfOutIdx 输出;D2 只看带 covenant 的输出(`bshard-close-enforce.mjs:240`),纯 P2PK change 不在其视野 |
| E | **fee 上界** | **未强制**(只有下界:mass floor + fee>0,submit-side) | `_assertTxInvariants:48/63-66`(submit-side,只下界);SS/enforce 无 fee 上界。⇒ driver 可把 fee-input 大半烧成 miner fee(自损,非池损) |
| F | **selfOutIdx 指向真 continuation** | **已强制** | `validateOutputState(selfOutIdx,…)` 使 selfOutIdx 必指向带正确 state 的 covenant 输出(`PayoutShardV2.sil:170-179`) |
| G | **被签 tx.version >= 1** | **已强制(委员侧)** | `bshard-close-enforce.mjs:126/232`;根因 §2.4 covenant 仅 version≥1 入 sighash。⚠ 链侧是否也拒 version<1 带 covenant 的 tx = §6 开放题 |

**要点**:C/F/G(池子那一个输出 + 版本门)已被三处独立强制,这是「池钱挪不动」的实证支撑。A/B/D/E(input 数、output 数、其余输出、fee 上界)**全无结构强制**。它们今天不致命,**只因为**池钱被 C 锁住、可动的余额是提交者自己的(§3)。但按前置③ 的判据(「委员签名挪不动别的钱」要成为**签名侧**不变量),A/B/D/E 就是缺口 —— 它们的存在意味着委员在盲签一个形状不受约束的交易。

🔨 **判据形状**:合格的形状约束必须使「委员这一签名动作」结构上只能对应到一种交易骨架,而不是「碰巧因为 covenant 把钱锁住了所以怎么签都偷不走」。前者是签名侧不变量,后者是把安全全部外包给 covenant+共识。

---

## §5 与 P1/P2/P3 的接缝(喂给前置① typed attestation 与前置⑥ 候选 A 规范输入集)

### 5.1 喂给前置①(typed attestation)—— 机械路径已确认存在 `[CONFIRMED·协议实读]`

冻结稿要求 P1 被签对象是**域分隔 typed receipt,对象内不含任何交易输入输出/地址/金额/fee/change**(`DECISIONS.md:61`;冻结稿 `2026-08-03-oracle-skill-interface-permission-boundary-freeze-design.md:97`)。**silverscript 恰好有一个与 tx-sighash 无关的签名验证原语**:

- `checkSigFromStack(datasig, byte[32] digest, pubkey)` / `checkSigFromStackECDSA(...)`(`D:\silverscript\docs\TUTORIAL.md:851-868`):「Verify a … signature against a 32-byte **digest supplied by the contract**」。**这不是对 tx sighash 的验证,而是对合约自定义 digest 的验证。**
- 对比今天 close_attest 用的 `checkSig(sig, pubkey)`(`TUTORIAL.md:843-848`)—— 验的是 **tx sighash**(即 §2 那整套 SIGHASH_ALL preimage)。

⇒ **接缝结论**:从「委员 SIGHASH_ALL 签整笔 tx」迁到「委员签域分隔 FactReceipt」的机械手段 = 把 `checkSig(txSighash)` 换成 `checkSigFromStack(blake2b(domain_tag ‖ receipt_fields), committeePk)`。委员签的 digest 里**没有任何交易字节**(满足 `DECISIONS.md:61`「receipt 内不得含交易摘要」),covenant 独立地①用 checkSigFromStack 验 receipt 签名、②用 §4 的 `tx.inputs.length`/`tx.outputs[i]` introspection 独立校验交易形状。**这一步同时关掉 §3 盲签面与 §4 的 A/B/D/E 缺口**,因为委员签名从此结构上够不到交易字节。

🔵 这不是本稿的实现提案(DESIGN-ONLY),是给前置① 主笔的**能力确认**:所需原语在 TN12 silverscript 全部存在,不必搭链下 fallback。

### 5.2 喂给前置⑥(候选 A 规范输入集/输出集重算与绑定) `[CONFIRMED·源码实读]`

- 委员侧今天**已有**独立重算并绑定被签 tx 的雏形:`enforceCloseAttestV2` 重算 payoutRoot/betsRoot/refundRoot/winner(`bshard-close-enforce.mjs:516-575`),D2 把重算值绑到被签 tx 的 continuation 输出(`:578-582`)。**但绑的是「输出侧承诺」,没有「输入集对象」把「委员和 driver 用的是同一堆注 + 同一堆 UTXO」钉死**(冻结稿 `2026-08-03-…freeze-design.md:235` 已标同类缺口)。
- §4 的 A/D(input 数、其余输出)正是候选 A「规范输入集/输出集」要覆盖的形状维度。候选 A 若落地为 covenant introspection(§4 原语),即把「输入集完整性」从 §4.5 那种「被信任的输入」升为「被合约强制的形状」。
- 🔴 承 `DECISIONS.md:66` PB-S8-2 候选 B 硬边界:`get_address_utxos` 快照**只能作便宜拒绝信号,永不升格为签名授权**。本稿 §3/§4 与之同源:**真正的授权绑定必须在 covenant 的 tx introspection(链上强制),不在委员侧的快照观察(可绕)。**

---

## §6 开放问题清单(如实列,不含糊)

1. **jepu1 sighash 探针从未真跑过** `[未验]`。`docs/tmp-jepu1-sighash-probe.rs` 是一份**脚手架残稿**:需在 J2 机器 `D:\silverscript` 建 `sighash-probe` crate、填 jepu1 真值、`cargo run` 才能出「节点真 sighash」并与 `ad7eb3a1` 比对(见该文件 `:5-17` 部署步骤、`:79` 期望值注)。**本稿只从 `sighash.rs:245-280` 源码坐实了算法,没有一次 live round-trip 拿真实 close_attest_v2 tx 验证「我们构造的 preimage == 节点算的 sighash」。** 需 J2 跑探针闭合。
2. **version<1 带 covenant 的 tx,TN12 共识层如何处理?** `[未验]`。委员 D2 在**委员侧**拒 version<1(`bshard-close-enforce.mjs:232`),根因是 §2.4 covenant 只在 version≥1 入 sighash(`sighash.rs:232`)。但若**链共识**接受一个 version<1、带 covenant 输出的 tx 而**不执行 covenant 强制**,则一个不走委员 enforce 的 driver(§3 威胁模型)设 version=0 可能绕过 §4-C 那道池钱 clamp —— 而 C 是池安全的唯一承重件。**需 TN12 实测:提交一笔 version<1 带 covenant 的 tx,看共识是拒绝还是接受且忽略 covenant。** 这是 NWT 最该打的点(§7)。
3. **cross-node driver-enforce 路的 fee-input 归属** `[未验/需 J2 domain]`。§3-2/§3-3 的「fee input 是提交者自己的钱」结论,读的是 submit 模式 `p2sh.mjs:2067` 用 relay 自己钱包签。但 live 的 driver-enforce 路(`bshard-auto-settler.mjs`)组装 fee input 的来源、以及跨节点场景下 fee input 是否可能是别方 UTXO,需 J2 确认。若 fee input 可为受害者 UTXO,则 §3-3 的「自损」结论要收窄。
4. **`_splicePayoutV2CloseRedeem` 字节偏移 vs 真实编译产物** `[未验]`。委员 D2 依赖一组硬编码 offset 常量(`bshard-close-enforce.mjs:148-154`)重建 continuation SPK。代码自己标注(`:142-147`)：这是源码级推导,**落码后必须用真实编译的 PayoutShardV2 实例 + 真实 close_attest tx 做 byte-exact diff**(NWT/Bettor DoD)。若 offset 漂,D2 的 SPK 比对会系统性失效或误判 —— 但**这属既登记 DoD,非本稿新发现**。
5. **多 covenant 输出下 D2 的 `for` 循环语义** `[推断,待 NWT 判]`。D2 对**所有**带 covenant 的输出逐个要求 SPK==expected(`bshard-close-enforce.mjs:242-246`)。若某未来/畸形 tx 含多个 covenant 输出,该「全部必须匹配」与 SS 只 clamp `outputs[selfOutIdx]` 之间的交互,值得对抗性推演(SS 只锁一个,D2 要求全对,两者边界不同)。

---

## §7 NWT 红队最该打的三个点

1. **version<1 covenant 绕过(§6-2,最承重)**:池安全的唯一承重件是 covenant 的 `require(outputs[selfOutIdx].value==consolidated_pool)`,而该 covenant 仅在 version≥1 被 sighash 覆盖(`sighash.rs:232`)。委员侧拒 version<1,但**不走委员 enforce 的 driver**(本机拓扑下可行,§3 前置)能否用 version<1 让链接受一笔忽略 covenant 强制的 tx、从而搬走池钱?**这是把「clamp 是唯一防线」这一结论推到极限的一击,必须 TN12 实弹。**
2. **委员盲签面的直接利用(§3-2/§3-3)**:委员对 fee/change/额外输出零校验(SIGHASH_ALL 盲签)。构造一笔 continuation 输出完全合法(D2 过)、但携带异常 fee 或额外输出的 close_attest_v2,验证「池钱确实动不了」是否真在**所有** change/fee/输出数组合下都成立 —— 即攻击 §3 结论「可动的只有提交者自己的钱」的边界(结合 §6-3 fee-input 归属)。
3. **selfOutIdx / 多 covenant 输出(§6-5)+ D2 offset(§6-4)合取**:driver 控 selfOutIdx(witness 值)与输出数组构造。攻 D2「所有 covenant 输出必匹配」与 SS「只锁 selfOutIdx」之间的缝:能否放一个 D2 视野外(非 covenant)或 D2 视野内但 selfOutIdx 不指向它的输出,配合 offset 假设,让价值从 §4-D 那个未强制的输出面漏走。
