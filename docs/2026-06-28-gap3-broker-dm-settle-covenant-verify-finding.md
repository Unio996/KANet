# Finding — gap③ broker-DM live settle: covenant-verify frontier (J2/J1/NWT/Bettor co-diagnosis)

**日期**: 2026-06-28 (通宵 session) · **状态**: gap③ 核心证毕 · 根因锁定到 **sighash 计算不符**(clear-resign 实验排除 stale-sig) · 待清醒 J1 sighash 字节级修

> **2026-06-28 ~11:10 更新 — 根因从"神秘 verification failed"逼到"sighash 计算不符"**:
> - **系统排除 ~12 假说**(全字节验): commit_v2 / merkle-align / validSigs-count / sig-PK序 / committee_pk_hash / 守恒(实=mass-aware dynamicFee 8.44M 非漏) / output[5](stake-weighted 正确) / spine-only-vs-merged / claim_winner-selector(relay 硬编 OP_0) / redeem→P2SH(byte-exact) / **路B 重编译 source==deployed**(排除编译层差异) / A-E + ctor guards 全 PASS(NWT 5th-vantage 1-21 除 validSigs 全过)。
> - **clear-resign 决定性实验**(Bettor 批准): 清 5 stored sig → 委员重签【body 未变的 f9e64afc】→ 5 fresh sig → 重提交 → **又 "verification failed"** → **stale-sig 排除**(fresh sig 对一致 body 仍失败)。
> - **∴ 根因 = sighash 计算不符**: relay createInputSignature(SighashType.All) 算的 input0 sighash ≠ covenant OpCheckSig 验时算的 → checkSig false → validSigs<4。**jepu1-特有**(118 成功 v07 settle 没此问题)。
> - **唯一 jepu1-特有结构异常 = dup-pk**: f5bb64c6 同 pk 押两边(idx1 YES 20.65 + idx3 NO 18.16)。tx 结构其余与成功盘 thcyx 全同(sigOpCount=8/seq=0/lockTime=0/version=0)。**dup-pk 为头号 sighash-mismatch 嫌疑**。
> - **clear-resign 副作用 + 恢复**(已处理): 清 sig→sigCount=0→watchdog-b(collecting_sigs TIMEOUT)误触 refunding(refund_txid=null 未广播)→J2 surgery(Bettor NOD): revert collecting_sigs + reset phase2_dispatched_at + 清 refund_tx_obj + 保留 refund_dispatched_at 挡 watchdog。jepu1 现稳定挂 collecting_sigs(不 settle 不 refund)·refund grace=deadline+2h(~11:20 解锁)。
> - **清醒诊起点(J1 sighash 域)**: relay p2sh.mjs createInputSignature 的 sighash preimage(input0 spine·redeem 作 script-code·prev-output amount=20000000000)逐字节 vs Kaspa node checkSig 算的。重点查 dup-pk 是否让某 prev-output/sighash 字段语义出错。
**市场**: `ext-pool-v07-1782637930699-jepu1` (非-bshard·9-local committee) · **被拒 settle TX**: `f9e64afc11fe9b346911c327ca99137a10f82e820a180aca67cc65e853f4a723`
**报错**: `failed to verify the signature script: script ran, but verification failed`(持久·同 txid fail#1→#N)

---

## ✅ gap③ 核心证毕(这次没白跑)
1. **8B fix node-执行层有效**: settle 脚本 "script ran"·跑过 NUM2BIN(非 16B 拒)。区别 zzwzd(f169647)仍 NUM2BIN-16(16B 老盘)。
2. **委员全本地修复有效**: 5/5 委员全 :3200 本地(active=0 pool-gate 把 J1 4 个 :3300 oracle 排除·snapshot pool_size=9)。VRF 抽 5 必全本地·跨节点 sig 卡根除。
3. **commit_v2 字节匹配**(Bettor 52B 预像重算 == 585e0293)。
4. **merkle 对齐**(committee_indices [1,7,6,4,8] = sortedPks 位置·proof on baked snapshot)。
5. **5/5 委员全真签**(c0-c4 全 input_idx=0 @09:27:10·signer 全 match committee PK)。

## 🔴 剩前沿: covenant verify 失败(5 真 sig 正确序对正确 PK 仍 checkSig fail)

### 系统性 ruled-out(5 假说·全字节验)
| # | 假说 | 排除依据 |
|---|------|---------|
| 1 | commit_v2 不符 | Bettor 重算 585e0293 MATCH; J1 .sil 里只 L332 sanity require(!=poolMerkleRoot)·非字节 require |
| 2 | merkle proof 错 | committee_indices→sortedPks 位置正确·proof on baked snapshot |
| 3 | validSigs count<4 (L2767 ‖3) | **5 个 REAL sig 全组进**(committeePksForSort=5·bySender 全 match)·非 3。L2767 ‖3 不限组装(组装用 committeePksForSort 非 oracleNcollecting) |
| 4 | sig-push 序 ≠ PK-push 序 | phase2_committee_pks(PK·L2114)== committeePksForSort(sig·L2655)== selection·完全一致(J2+J1 双验) |
| 5 | committee_pk_hash 序 | selection 序(deriveCommitteePkHash 不 sort·committee_pks 存 selection)·一致 |

### 剩 2 前沿(需清醒诊)
- **(a) sighash 不符**: 委员 09:27 签的 sighash ≠ 提交 tx 算的(签后改了某 output/fee/input-range/sighash-类型·或 voter 计算差)。
- **(b) 非-checkSig require**: payoutRoot / 10-output 结构(金额/址)/ spine continuation 某 require 返 false。

### 🔑 J1 钦定决定性 bisect (清醒诊第一步)
取 1 个委员 sig + 组装好的 tx f9e64afc 的 spine-input(input0)sighash·**手动 schnorr verify**:
- ❌ sig 验失败 → **(a) sighash 不符**(查 voter 签的 message vs 提交 tx 的 sighash·逐字段 diff)。
- ✅ sig 验通过 → **(b) 非-sig require**(逐 .sil require re-derive: payoutRoot / output 金额址 / continuation)。

## 次要(独立·非 jepu1 当前 blocker)
- **L2767 `oracleNcollecting = oracleArr.length || 3`**: 对 v0.7 committee 路·若 oracle_relay_ids 在读时为 '[]' → 落 3(latent)。jepu1 现 oracle_relay_ids=5 故未咬·但建议改读 pool_committee.committee_pks.length / threshold·杜绝 latent。(NWT 发现·J2 验 jepu1 未触发·仍值得修 + lint)
- **LLM upstream DOWN**(ports 3010-3013 无 listener): 投票/共识需 LLM(deriveKanetNativeVote)·签名不需。jepu1 5/5 都签了故非签名 blocker·但 LLM 宕影响后续盘投票·infra 需恢复。
- **register 路 bshard/logical 误用**(qkzh6 教训): register-v07=bshard(建 market_shards→isBshard-skip)·register(L1310)=非-bshard。第3次同类误用·Bettor 钦定上 lint rule(COORD-LEDGER 线11)。

## 可复用资产
- demo 建盘配方: 非-oracle maker(broker-1)+ broker_address=Owner 托管址 + ESPN-final 源(MLB 401815924 BOS 4-1 NYY·predict-then-verify 对死)+ register(L1310)非-shard 双边种注 + active=0 pool-gate 全本地委员 + deadline +8min。
- co-verify 脚本/法: oracle-pool/chain-snapshot 验 pool=9; pool_committee 验 5/5 local; chain_events pool_oracle_tx_sig 数 sig; phase2 metadata 全图。

## 元教训(J2)
verify-before-code 挡住 2 次"修错地方"(L2767 假说被 5/5-real 字节验推翻)。配铁律 [[feedback-mainline-design-review-before-any-action]]: 即使 reviewer/coordinator 指了根因·改前仍先字节验真源。
