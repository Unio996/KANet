# 批 7 withdraw（KanetTokenClaim.spend，路径 (ii)）链上字节层 + 上游 VM 独立验证，及 withdraw 专属 fee cap — NWT 2026-09-19

对象：J2 simnet chain3 第八步 withdraw，txid `39f4f2c6a0070b183fa7e5ffb241974b19db3b4346790ff4dfc1ab901c1ae508`（J2 builder `fd3bbbeb`，侧分支 `5efbc8fa`）。节点 = 官方 kaspad 2.0.1 simnet（PID 15972，与批 3–6 同一二进制）。交易与两个父交易（claim_draw `0c1d9666…c06f`、fee 父交易）由我用 `getBlocks` 只读取回（`fetch_withdraw.mjs`，数据存 `withdraw_txs.simnet.json`），没有读 J2 落盘的记录，也没有向节点提交任何东西。
交易形状：3 输入 = KanetTokenClaim（20M，covenant）/ held KTT（20M，covenant，owner = 该 claim 的 covenant_id）/ fee（85M，普通）；3 输出 = 新代币输出（20M，genesis）/ 目的地 covenant 输出（20M，genesis）/ 找零 51,023,600。区块记录：storage 219,598、compute 30,371，version 1。

## 结论：PASS

| 检查 | 独立来源 | 结果 |
|---|---|---|
| 见证结构（KTC 输入，sigScript 4,508 B） | 自写 push 解析器 | `s`(65 B，hashtype 0x01) / `tok_in_idx=1` / `tok_out_idx=0` / `to_market_input=false` / `dest_idx=1` / `tok_prefix`(1 B) / `tok_suffix`(3,078 B) + tag `86d6cb9e` + redeem(PUSHDATA2 1,347 B) |
| KanetTokenClaim redeem 重编 | pinned silverc-v100（sha256 `4378ba65…8643`，脚本内硬校验），ctor 四字段由链上 redeem 状态区读出：`market_cov_id=5ba466b2…`、`winner_pk=e929dde5…`、`amount=1000`、`token_tmpl_hash=225ebcde…` | **逐字节相等（1,347 B）**；`spend` 参数声明序与链上一致，tag `86d6cb9e` 一致 |
| 出处链 | `blake2b256(redeem)` 算 P2SH（不经 J2 代码） | == claim_draw（批 6）输出 0 的 spk ⇒ 该 redeem 确是 claim_draw 当时放上去的那一个；`winner_pk` == 批 6 那张 ticket 的 bettorPk；`market_cov_id` == 批 6 claim_draw 所花 RootClaim 的 covenant_id |
| held KTT redeem 重编 | 同上，ctor `[1000, owner, 4, 0, 0…0, 0…0, 3, 3]`，owner 由 redeem 读出 | **逐字节相等（3,191 B）**；`transfer` tag `24a3e4a8` 一致；owner == KTC 输入的 covenant_id；P2SH == claim_draw 输出 1 的 spk |
| 新代币输出 owner == 目的地输出的 covenant_id | 用我的重编生成 KTT(amount=1000, owner=out[1].covenant_id) → blake2b256 P2SH | == out[0] 的 spk（对照：owner 换成旧 KTC covenant_id ⇒ 不等）。这是"target_owner 只能是本 tx 内某个 covenant_id、且合约要求它 == 输出状态 owner"的**字节层**证据，不依赖节点是否接受 |
| 上游编码器 | 把我解出的参数喂 patched cli-debugger（3ed9733 + 仅 eprintln，sha256 `c8072cfa…3a34`） | KTC `spend` action（3,158 B）、held KTT `transfer` action（21 B）与链上 sigScript 去掉尾部 redeem push 后**逐字节相等** |
| 上游 VM 执行真实交易 | 链上真实 tx，各输入分别作 active input，其余输入给真实 sigScript 与父输出 spk | KTC.spend **PASS**；held KTT.transfer(`next_states=[]`, `witness=0x`, `owner_input_idx=[0]`) **PASS** |
| 我的 sighash 对 KTC 签名 | 自移植 `calc_schnorr_signature_hash` + schnorr 验签，公钥 = 链上 redeem 里的 winner_pk | 对最终 tx **有效**；反向臂 ① 去掉 out[0] covenant ⇒ **无效**；② 改动目的地 out[1] 的 spk ⇒ **无效** ⇒ 签名绑定 covenant 与目的地，B4-1 类缺陷在批 7 不存在 |
| 节点值 | 我自己的 KIP-9 公式（输入 plurality 按真实 spk/covenant：输入 2,2,1，输出 2,2,1）+ 我的 compute 公式 | storage **219,598**、compute **30,371**，与区块记录逐位相同（本批 storage 与 compute 两个节点值全部命中） |

### 负向臂（上游 VM，同一笔真实 tx，只改一处；用来证明 PASS 不是恒真）
| 臂 | 结果 |
|---|---|
| NEG1 签名首字节翻 1 bit | FAIL，失败点是 `require(checkSig(s, pubkey(winner_pk)))` 那一行，之前的所有 `require` 都已通过（与 J2 节点侧负向臂互为独立：节点拒 "script ran, but verification failed"） |
| NEG2 `dest_idx=0`（指向代币输出，owner 会变成它自己的 covenant_id） | FAIL，失败点是源码第 94 行 `validateOutputStateWithInputTemplate`（输出状态 owner 与目的地不符；此前的 `require` 都已通过） |
| NEG3 `to_market_input=true`（owner := `OpInputCovenantId(1)` = held KTT 的 covenant） | FAIL，同上（第 94 行） |
| NEG4 `tok_in_idx=2`（fee 输入不是代币） | FAIL，但失败原因是数组下标错误（`-3125 cannot be used as an array index`），**不是**"拥有者检查"命中；这条只说明越界会失败，不能当作 owner 检查的证据 |
| held KTT NEG `owner_input_idx=[2]`（fee 输入没有 covenant id） | FAIL（`OpInputCovenantId(owner_input_idx[i]) == prev.owner` 那一条） |

## 边界与观察（不是缺陷，是范围）
- **目的地是不可再花的测试输出**：`aa20` + `ee`×32 + `87` 是一个没有已知原像的脚本哈希。本批只证明"合约在真实共识下把代币转成以该目的地 covenant_id 为 owner 的新代币输出"，**不证明赢家能再花**（J2/Bettor 1520 的边界①已写明）。主网 builder 目的地允许清单 v0 为空，主网 withdraw 不可构造——这一点是 builder 侧闸，我没有测（本批未读该单测的覆盖，见下"未验证"）。
- **签名者 = 委员公钥**：v0 里 `winner_pk == committee_pubkeys_json[0]`，KTC 的花费权与 ticket 的花费权同属委员私钥（同批 6 的边界）。
- **新代币输出是 genesis 输出**：KTT 的 genesis 无金额校验（合约头注：genesis 免权限），所以"守恒"完全由 KTC.spend 的 `tk.amount == amount` 与 `validateOutputStateWithInputTemplate(amount)` 保证；已由上述字节层 + VM 在 n=1（1000）上证实，未测 amount≠1000。
- held KTT 走 `transfer(next_states=[])`（消耗、不产出同 covenant 状态），新代币是另一个 covenant 的 genesis。这一形状与批 6 的 held 输入一致。

## withdraw 专属 fee cap（F3' 同法：`fee_curve_withdraw.mjs`）
`requiredFee(v) = 100 × wasmLocalMass(draft)`，draft = builder 的 `mkTx(leftover)` 形状：只改 fee UTXO 面值 v，找零 = leftover = v（KTC 20M + held 20M 进、代币 20M + 目的地 20M 出，恰好抵消）。用真实 wasm `calculateTransactionMass` 对链上真实形状（真 sigScript、真 outputs、covenant）：

| v | 50M | 60M | 70M | 85M | 100M |
|---|---|---|---|---|---|
| wasm mass | 320,001 | 326,666 | 332,469 | 339,764 | 345,716 |
| = 公式（输入 plurality 恒 1） | ✓ | ✓ | ✓ | ✓ | ✓ |
| requiredFee | 32,000,100 | 32,666,600 | 33,246,900 | **33,976,400（= J2 实付，逐位）** | 34,571,600 |

v ≤ 1.0 KAS（`SIGNED_INPUT_CEILING`）时最大 requiredFee = **34,571,600**；cap = 1.5 × 最大 = 51,857,400 → 向上取整到 5M：**`feeProfile.withdraw.cap` = 55,000,000 sompi（0.55 KAS）**（`min(2×requiredFee, cap, 1 KAS)`：2×requiredFee ≥ 64.0M > 55M，所以 cap 起作用）。失效条件同 F3'：仅对此固定布局 [KTC, held, fee] 与常量输出（目的地面值 20M、`tok_suffix` 3,078 B 等）成立，任何 sigScript/输出规格变化必须重推；cap 是损失上界，不是 fee 预测，也不是降生产 fee 的依据（T-FEE-PRICING 另论）。

## 未验证
- n=1（金额 1000，单赢家）；路径 (i)（`to_market_input=true` 再下注）未实现，我的 NEG3 只证明它在这个形状上会失败，不证明它作为路径可用。
- 上游 VM 是 debugger（各输入分别跑）；节点接受由 J2 的 simnet 记录担保，我核了区块记录的 storage/compute，没有独立提交。J2 的节点侧负向臂（翻 1 bit 被拒）我没有复跑（不向节点提交）；我用上游 VM 的 NEG1 与之互证。
- 目的地允许清单（主网为空 ⇒ 不可构造）与 `assertWithdrawDestinationAllowed` 的单测，我只读了 builder 源码（`proto-tx-assembly-settlement.mjs` diff：闸先于解密/签名、`network !== 'mainnet'` 才认 `allowUnlistedTestDestination`），没有另写向量；批 9 接线审计时要确认调用点不会绕开该闸、也不会把 `network` 传成非 `'mainnet'` 的值。
- `assertClaimWinnerSigningKey` 的公钥推导（`computeKanetTokenClaimGenesisArtifact` 重算 P2SH == 链上 spk）我用了同一思路的独立重编（脚本里的 `blake2b256(redeem)` == 父输出 spk），未跑 J2 的单测。
