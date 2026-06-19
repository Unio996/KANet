# 严格对抗 audit 共识 — 找零核弹 / depth-20 无限 / 主权自取

> **性质**: Owner 钦定严格对抗+建设性 audit(2026-06-01,"来不得半点马虎")。5-agent 对抗讨论收敛 → 本文 = 共识存底(自决,Owner 终裁)。
> **主持**: Bettor-tn(架构/facilitator) | **对抗方**: J1(SS/silverc)/ J2(settler/relay)/ KANet-UI(bot/UI)/ NWT(攻击审)
> **缘起**: Owner 指出真命门 = UTXO 找零(隐形核弹级雷)+ 不限投注者人数(N+1)+ 主权参与方友好自取。
> **状态**: v1 收敛(部分实现细节收尾中,标注)。

---

## 0. 一句话

钱由合约 require 焊死分进各方地址(已链上证: 46f8a/xfu62)。剩下三根支柱、每根事关成败: **A 找零核弹焊死** / **B depth-20 ~无限押注者** / **C 主权参与方友好自取**。

---

## 1. 支柱 A — 找零核弹焊死(强共识)

**风险根**: 普通转账走 Kaspa `Generator`(changeAddress=sender, 找零自动、烧不了)→ 相对安全。但**手工 P2SH TX(settle/refund/dispute)无 Generator 兜底, balance 手算** → 静默烧钱 / 超发 / fee 不够 / KIP-9 mass 拒(今晚 layer-19/20 全是这块)。

**焊死 3+1 不变量**:
1. **动态矿工费(J2)**: settler 在 `prediction_settle_build_preimage` / `buildSettleTxPreimage` 内估 mass(storage_mass + compute_mass)→ `fee = mass × 100 sompi/mass × 1.2 margin`。**取代今晚静态 5M hack**。估算必为**上界**(少估即整笔被拒)。
2. **`Σinputs == Σoutputs + fee`(J2 + NWT)**: `unlockPoolSpineP2SH` 顶部 assert `sum(matched UTXO) === sum(outputs) + fee`,mismatch 抛 error **在 submit 前停**(不让 kaspad 拒、防 silent overspend)。NWT verifier 加 `mode=settle-precheck`: submit 前模拟 mass×100+margin + 三轴 balance,防 layer-19/20 复刻。
3. **最小 output ≥ dust(J1 SS 焊死)**: PoolSpine_v06 已有 `require(value >= oracleBondAmount)`;加 `require(value >= MIN_DUST_SOMPI)` per output(Kaspa post-KIP-9 dust ~600 sompi,J2 实测确认)+ pot 太小拒开市。
4. **合并零钱(转账侧)**: 钱包 UTXO 定期 consolidate(`utxo-split.mjs` 基建),转账永远从干净大 UTXO 出 → 不触 KIP-9 小找零拒。

**⚠ J2 自曝雷(纪律)**: **全程 BigInt**——JS Number ≤ 9e15,90 万 KAS 级市场 sompi 算术会溢出。所有 sompi 计算绝不用 Number。

---

## 2. 支柱 B — ~无限押注者 + 并行(主方案: 动态滚动分片 / 备选: depth-20)

> **Owner 钦定方向(2026-06-01)**: 主方案=【动态滚动分片】,depth-20 降备选。
> **对抗 review 收敛(4/4 倾分片)**: J1/J2/KANet-UI/NWT 一致。核心理由: **0 新 SS 风险**=复用今晚已链上证的 depth-6 64-人合约(46f8a/xfu62 19/19 PASS)。
> **MAX_SCRIPT 实数(J1 r232 查 kaspad rust 源)**: `MAX_SCRIPTS_SIZE=10,000B` / `MAX_SCRIPT_ELEMENT=520`(post-Toccata 可绕,今晚 1942B 实证)/ `MAX_STACK=244` / `MAX_OPS=201`。→ depth-6 单片 ~1942B 离 10000 宽;depth-20 ~3-5KB 若 testnet-12 element 实只 ~2KB 则悬 = 分片优于 depth-20 的硬证。

### 2.A 主方案 — 动态滚动分片("填满即挂钩")
**机制(Owner)**: 一个合约**装满 64 人**(= 今晚已链上证的 depth-6 64-人合约,46f8a/xfu62 那个)→ **快满时挂钩 → 下一片合约** → 循环。每片填满即可**独立并行结算**,各付各的 ≤64 赢家。
**一举解两题**: ① 无限(用满才长下一片,要多少长多少); ② 并行/速度(N 片并发结,不互等)。
**优于 depth-20**: **复用已证 64-人合约、零新 SS 风险**(绕开 depth-20 bytecode/MAX_SCRIPT_SIZE/多字节 index 全部雷)+ 每片恒 ~2KB 离上限远 + 每片一笔自动结(无需人人自取, 自取退回做 trustless 安全兜底)。
**① 挂钩**: 片合约**独立**, 链用 `market_id` + `chain_event(shard_i→shard_{i+1})` off-chain 串(链上可审计, 各片独立可并行结); 片内**不**硬记下一片地址(先有鸡先有蛋)。
**② 全局赔率(唯一真难点, 来不得马虎)**: 赢家分成取决于**全局 YES/NO 总池(跨所有片)**, 非局部。**算错全局数 = 那片赢家分错钱**, 严格攻+焊死在此。

**② 焊死公式(r258 架构定 + J1 r234/J2 r225 对抗收敛)**:
- `global_commit_id = blake2b(globalYesTotal_sompi ‖ globalNoTotal_sompi ‖ market_id ‖ shard_count)`,关池算一次,写进 `commit_v2` chain_event 当链上锚(序列号防 split-brain,KANet-UI r427)。
- **双锁绑定**: (a) 每片 `settle_aggregate` 收 `globalYes`/`globalNo` arg,委员签的 preimage 含这俩 → **委员签名本身 attest 全局数跨片一致**(forge → 委员没签那组 → 验签 fail);(b) SS `require(重算 blake2b == 入参 commit_v2)` 双保险。
- **攻击链失败证(J1 r234/J2 r225 收敛)**: 攻击者 forge global → blake2b 变 → commit 变 → 与其他片 `commit_v2` 不一致 → settler off-chain 协调拒(所有片必须同一 `commit_v2`)→ 攻击失败。SS 只验 blake2b 公式,不阻止 caller 塞别 commit;跨片一致性靠 settler 喂同一 commit_v2。
- **SS 落地(J1 r234)**: 新 `PoolSpine_v07.sil` shard variant(v0.6 保留 backward compat 46f8a/xfu62),ctor 加 `shard_id`(int 0..N-1)/ `shard_count`(int)/ `market_id`(raw byte[32] 非 hash)。+ **min-bet/min-pot require**(Bettor r259 forensic: 防最小赢家份额 < dust 1000 拦整笔 settle)。
- **待对抗剩**: @J2 挂钩 TX 结构 + **并行结算调度**(r221 自曝雷: parallel 撞 chainReader 并发 / sequential 100 片 ×5min=8h); @NWT 部分结算原子性 + 伪造全局总量 attack-static rerun。

### 2.B 备选 — depth-20 单大合约
- 可行(J1): depth 6→20 线性 scale, 单 bettor 自证 20 blake2b。但**新 SS 代码 + 没测** + 以下两雷:
- **多字节 int 编码 spec(J1)**: sign-magnitude, `128-255` `0x02[byte]0x00`(补 0x00 防读负)…index 2-3 字节按此, 错一位整笔失败(0x76 教训)。
- **⚠ bytecode size(J1 待确认)**: ~3-5KB, 必验 < MAX_SCRIPT_SIZE。**分片方案绕开此雷**(每片恒 ~2KB), 这也是分片优于 depth-20 的主因。

---

## 3. 支柱 C — 主权参与方友好自取(KANet-UI 解矛盾 + 分层)

**矛盾(KANet-UI catch)**: "零门槛 + trustless + 钥匙安全经手" 三 want 自相矛盾。
**化解约束(Bettor)**: 合约 `require(claim output == 用户自己地址)` → "信任"窄到"谁持钥匙签 TX",不是"能否偷"(偷不走,去向焊死)。

**分层定案**:
- **(ii) 主路径 = KANet 智能体自有 relay 自动领(trustless + 零门槛)**: 用户=智能体(跑自己 relay/adapter、持自己钥匙),其 relay 加 `claimAutoDispatch` tick(扫 chain_events 自家地址 → 自动构建+签+广播 claim/refund)。扣 KANet 定位("Agent 连所有市场,全自动全可审计")。"门槛"=跑 relay 入会,本就是 KANet 模型。
- **(i) 强制过渡桥 = 普通 web2 用户(bot 构造 + 钱包签)**: 现实 testnet **~90% 用户不跑 relay**(J2+NWT 实证),**(i) 必落地、非可选规划**。流程: bot 用公开链上数据(settle_txid + output_index + redeem,无钥匙)构造 **unsigned claim TX hex** → 用户自己钱包签。trustless(用户钥匙)+ 低门槛(bot 干构造)。
- **(iii) 托管 bot 代领 = 否**: 偷不走(去向焊死)但能 **griefing**(拒签/不及时领 → 用户 KAS 卡 settle UTXO)+ 持用户钥匙=能签任意 TX=破 trustless。

**(i) 必焊死(KANet-UI + NWT)**: unsigned TX 必带 `expected_amount` + explorer 双验链接(用户签前自核,防 bot 误构造 → 烧钱/广播失败)。

---

## 4. 未决点(需 Owner 终裁 / 追查)

1. **(i) 钱包兼容性(最大未知)**: Kasware / KDX 是否支持粘 raw unsigned TX 签? 不支持 → "用户自签" UX 断、需换签名流。**@KANet-UI 待查。**
2. **depth-20 SS bytecode < MAX_SCRIPT_SIZE**: **@J1 待确认**(~3-5KB)。
3. **大池子全程未真测**(J2 自曝): depth-8 bettor merkle 没 stress;depth-20 上生产前必 stress test。
4. **协作 settle 批量 vs 人人自取 的切换阈值**: 多少 bettor 以上转纯自取,未定。

---

## 5. 分工(认领 + 进度)

- **@J1**: ✅ commit-anchor 设计 ack(r234)+ 新 `PoolSpine_v07.sil` shard variant(ctor `shard_id`/`shard_count`/`market_id` raw)+ per-shard `settle_aggregate` 收 `globalYes/No` + `global_commit_id` require + min-output dust + **min-bet/min-pot require**(r259 forensic:防赢家份额<dust 拦整笔)。ETA review 中。
- **@J2**: **批1 ✅ ship `ef3f39c`+`d649f16`**(`Σin==Σout+fee` assert + dust 1000 + BigInt audit;现网 v0.6 立享)。批2(下午,需 J1 mass 公式):动态 mass→上界 fee。批3(等 G6 拍板+J1 SS spec):滚动分片分配 + 跨片原子 `commit_v2` + **并行 settler 调度**(解 chainReader 并发,避 sequential 100 片 ×5min=8h)+ 多片 BigInt refactor + (ii) claimAutoDispatch tick。
- **@KANet-UI**: 部署+验证(批1 ✅)+ (1) 跨片 routing 透明(`bettor_pk hash mod N`,用户见 1 market)+ (2) 全局赔率显示(`globalYes/No`)+ (i) bot 构造 unsigned TX + `expected_amount` + explorer 双验 + **先查钱包兼容性**。
- **@NWT**: verifier settle-precheck(mass/balance 模拟)+ 分片 commit invariant attack-static(`globalYes/No` + `global_commit_id` require,J1 ship 后 rerun)+ 攻部分结算原子性 + 持续攻 (i) bot-unsigned-TX。
- **@Bettor(我)**: facilitate 收敛 + 审每个 commit DB/链实证(批1 ✅ PASS)+ 守 6 不变量红线 + 守 G5(不报经济闭环)。

---

## 5bis. 测试 bar(必过才算成,禁 echo-PASS)

1. **多片市场真链 settle**: ≥2 片 ~130 bettor → 全片**并行**结 → 全局赔率正确 + 所有赢家分到 + `Σin==Σout+fee` 公链 `is_accepted` 实证(基准 = 46f8a/xfu62 单片 19/19 PASS)。
2. **找零雷回归 4 case**: ① fee-adequacy(mass→fee 够,不被拒)② dust-floor(小 output 拦对、min-pot 不误拦合法大池)③ BigInt 大额边界(90 万 KAS 级不溢出)④ Σ balance(零超发零烧)。
3. **大池 stress**(J2 自曝未测):depth-6 bettor merkle 满 64 + 多片挂钩链 stress。

---

## 6. 不变量红线(任何实现违反即退回)

1. `Σinputs == Σoutputs + fee`(零静默烧、零超发),submit 前 assert。
2. fee = per-TX 实际 mass × rate × margin 上界,**不准静态常数**。
3. 每 output ≥ KIP-9 dust 下限(SS require 焊)。
4. 所有 sompi 算术 BigInt,不用 Number。
5. depth-N index 多字节编码逐字节同 SS climb spec。
6. 自取 = 用户自己钥匙(ii 自有 relay / i 钱包签),**绝不托管代持钥匙**;claim output 合约焊死进用户地址。
7. **submit 前 assert `fee >= mass × mempool_floor_rate`**(不只 `fee>0`)。qlfpv 实证:fee=50000 过了批1 assert,但 mempool 要 442000(mass 4420)→ 非标准永拒。批1 的 fee>0 不够,要加 mass-floor 下限。
8. **SS 不焊死 fee**:用 `output <= 本金 - MIN_FEE`(+ 上界防宰)让 fee 按 mass 动态,**禁 `output == 本金 - 固定fee`**(= qlfpv brick 根因)。
9. **手工 P2SH entry 放开 `inputs >= 必需数`**:允许追加 fee-UTXO 当永不锁死的手动补救阀(Owner 2026-06-01,与红线 8 互补:8 管正常自动、9 管兜底手动)。

---

## 7. qlfpv 实战案例 — 找零核弹第三面 (fee-too-low) + 真链分层 debug 方法论

> **性质**: 2026-06-01 testnet 0 元市场 qlfpv(maker 100 KAS, 0 bettor)的 auto-refund 实测,一笔 1-in-1-out 退款连炸 **5 层**,每层 review+单测全绿、真链才现。**Owner: "钱不值钱, 方法和思路无价"** —— 故立此案例存底。

**5 层 bug(全在 kaspad/共识/mempool 边界,JS 逻辑层不可见)**:
1. minerFee 5M floor vs ctor 50000 不符 → SS value require 挂(`47ff13d`:refund 用 `market.miner_fee` 原值)
2. IPC 命令 `pool_refund_maker_unjoined_tx` 未注册 relay 白名单 → unknown command(`8307024`;= ANTI-PATTERNS "命令注册漏")
3. sighash lockTime 不匹:unsignedTx(算 sig)lockTime=0 ≠ signedTx(交)deadline×1000(`93c54c0`)
4. sighash sigOpCount 不匹:unsignedTx=5(preimage 默认)≠ signedTx=1(`2df010c`)
5. **fee-too-low**:fee 焊死 50000 < mempool 要求 442000(mass 4420)→ 非标准被拒(= **第三面**,forward fix = 红线 7/8/9)

**方法论(无价 #1)**: 花钱/上链动作必须真链跑到 `is_accepted`;error message 是爬下一层的指南针;**同类 bug(sighash 各 field:lockTime/sigOpCount/sequence/utxo amount+scriptPK)一次性 audit 对齐,别 whack-a-mole**;Kaspa txid 不含 scriptSig → **同 txid 反复失败 = TX body 没变 = sighash 输入端某 field 不匹**(本案靠这条快速定位 3/4 层)。

**设计洞察(无价 #2)**: 凡合约创建时硬编码"花费时才知道"的链上参数(fee/mass/lockTime 语义)必脆 → fee 该 mass 动态 + floor + top-up 阀。

**Owner 钦定恢复路(testnet)**: 操作方矿机**直接打包**这笔共识合法、仅 mempool 策略拒的 below-floor-fee TX(绕标准性门)→ 救回 + 实证"共识合法 vs 策略拒"之分。**但 mainnet 真用户无矿机 → forward fix(红线 7/8/9)一条都不可省**,否则同雷炸真用户没人救。

---

*Bettor-tn 自决存底 — 5-agent 对抗共识收敛,Owner 终裁。来不得半点马虎: 找零/fee/index/BigInt + fee-too-low 五个核弹点每个都有 owner + 不变量焊死。qlfpv 案例 = 找零核弹真实引爆铁证。*
