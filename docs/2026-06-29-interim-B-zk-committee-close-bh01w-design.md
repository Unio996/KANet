# Interim-B ZK-算账 + 委员锚 close_attest 设计（bh01w·复用·待 NWT+Bettor 审）

**作者**: J2 · **日期**: 2026-06-29 · **状态**: 设计草稿·委员签前必过 NWT+Bettor 审（money-adjacent·命门不松）
**Owner 裁定**: B interim（"干"·22:49）。**配**: [[project-zk-settle-e2e-core-proven-binding-blocked-oppick]]（核心 PROVEN·纯 ZK 自锚撞 OP_PICK 编译器墙=下个 pass）。

## 1. 目标 + scope
bh01w（真盘·真押注 YES 5e9 + NO 3e9 = 8e9 在 ShardLeaf·完好·verdict 已 attest W=0 @97796e21）**今晚端到端 LAND**：
ZK 算 payout_root（已三方对死 9bfb3c87）→ 现有 bshard 委员 close_attest 锚 → 赢家自取（claim builder 现成）。
**避开** 纯-ZK 自锚的 gate-spk binding（撞 silverscript OP_PICK 编译器墙·下个 pass）。

## 2. 信任模型（诚实·精确·报 Owner 照此·J1 红队 + Bettor 钉死）
- **on-chain prevention = 委员 4-of-5 门槛**（close_attest .sil 只验 4-of-5 distinct 委员签 + committee_hash·**不验 payout_root 对不对**）= **同 Phase A 信任级**（driver-side / 委员门槛）。
- **ZK 的价值 = ① 消脆性算术**（payout 算术从链上 covenant 搬进 ZK·根除 dup-address/sighash/NUM2BIN）**② 公开可验 detection**：payout_root 9bfb3c87 任何人能独立复算（groth16 over 公开 bets → 对 root）·**委员若锚假根（链上 != 9bfb3c87）= 公开可检测·当场抓**。= detection（事后公开审）·**非 on-chain prevention**。
- **🔴 绝不 claim**：纯 ZK 全 trustless / payout 链上 ZK-enforced。**那是纯-ZK 自锚（gate-spk binding）= 下个 pass**。interim B = **ZK 算账 + 委员锚（门槛 prevention）+ 公开可验（detection）+ 赢家自取**。

## 3. 🔴 真 load-bearing 兜底 = 公开 detection（Bettor 精确化·22:58·我接受）
> ⚠ **精确（红队纠正·我原稿把'委员盲签'当 load-bearing 是错的）**：close_attest .sil **链上只验 4-of-5 委员签 + merkle·不验 payout_root 内容** → 委员"独立验 ZK"在【链上】**NOT load-bearing**（链上挡不住委员锚假根）。
- **🔑 真 load-bearing 兜底 = 公开 DETECTION（Bettor 亲手 + 任何人）**：委员锚 LANDED 后·**独立复算 payout_root 9bfb3c87 == 委员链上锚的 new_payout_root**·一字不符当场抓 + 公开报。payout_root = groth16 over 公开 bets 可复算 → **谁都能验**。**这是 interim B 比旧版强的地方**（旧版委员算 payout 无 ZK·锚假无法公开抓；interim B 锚假公开可抓）。Bettor 守这道（co-verify §6）。
- **委员独立验 ZK = defense-in-depth 好实践（非 load-bearing·但做）**：每委员签前自己跑 GATE_VERIFY=OK + 比 `new_payout_root`==9bfb3c87 才签（J1 槽 9e2db852 已 fresh 跑承诺·J1 给 :3200 三委员验证料 receipt-hex/image_id/验法 → 三委员也非盲）。降低委员集体作恶概率·但**不是 interim B 的安全根**（根是公开 detection）。
- **production**：纯-ZK 自锚（gate-spk binding·下个 pass 修编译器）= payout_root 链上 ZK-enforced prevention（那才是 on-chain load-bearing）。

## 4. 流程（🔧 J1 23:04 纠正模型一致性：**A-model close_attest·非 close_commit/PoolRoot**·全 x4kpq 证）
> ⚠ **我原稿引错 close_commit(pool-close-builder·PoolRoot v07 模型)**。x4kpq 证的是 **close_attest(PayoutShard·A-model)**。consolidate 目标=PayoutShard → close 必用 close_attest(同目标)·否则锚不上。**改用 A-model 全程**：consolidate→PayoutShard→close_attest→bshard_payout_claim（全 x4kpq PROVEN）。
1. **建 PayoutShard + consolidate**（J1·covenant 域·**全现成 PROVEN 非新码·零 OP_PICK**）—— J1 23:05 surface bh01w 无 PayoutShard(payout_shards 空)→ 实际两子步：
   - ①a **genesis-mint PayoutShard**（`unlockBshardGenesisMintPayout`·需 bh01w poolMerkleRoot **32a8c91d** + predicate/feeRecipients commit）= 为 bh01w logical market 建 PayoutShard。
   - ①b **consolidate**（`unlockBshardConsolidate`）：bh01w ShardLeaf → **PayoutShard**（A-model·无 PoolRoot）。
   - LAND 后 co-verify PayoutShard 落链 + pool 守恒 8e9。前置①KANet-UI 已验 shard pool 8e9 unspent ✅。
2. **close_attest dispatch**（J2 settler·复用 `bshard-close-transport.publishCloseRequest`·x4kpq 路）：
   - settler 发 close_attest sign-request（payoutRoot=**9bfb3c87**·winningSide=0·5 委员=无 bettor idx0/3/5/7/11）+ **带 ZK receipt**（委员独立验料）。
   - **委员 enforce(命门③·已有·load-bearing)**：`bshard-close-enforce.enforceCloseAttest` 各委员独立 re-derive payoutRoot（judgeLine predicate+ESPN 快照→computePariMutuelPayout）→ 验 tx claimedPayoutRoot==自己 re-derive==9bfb3c87 才 `sign_input_for_settle{safe_json}`。**= 委员级 prevention 本就有**（委员不签任意 root）。interim B 加 ZK = 委员可【额外】验 ZK receipt（defense-in-depth）+ 公开 detection（§3）。
3. **collect 4-of-5 + submit**（J2 `collectCloseSigs` → J1 relay `unlockBshardCloseAttest`）：PayoutShard closed 0→1 + winningSide:0 + payoutRoot:9bfb3c87 锚上链。
4. **submit close_attest → LAND**（NO TX NO STATE·check_utxo_landed）。
5. **赢家自取**（`bshard_payout_claim`·x4kpq 证·现成）：YES winner e72d8e7e merkle proof against payout_root → claim → 领 pool。

## 5. 分工
- **J1**: consolidate（ShardLeaf→PayoutShard→PoolRoot）+ 提供 ZK receipt + 签他委员槽 + relay `unlockBshardClose`。
- **J2（我）**: 产 close_commit preimage（pool-close-builder·payout_root 9bfb3c87·winningSide 0·committee=无 bettor 5）+ dispatch sign-request（bshard-close-transport `publishCloseRequest`·**带 ZK receipt 给委员独立验**）+ collect 4-of-5 + 组 submit。
- **委员（5 relay）**: 各独立验 ZK（命门 §3）+ 签。
- **KANet-UI**: operator·触发 :3200 三委员签 + 链验。
- **Bettor**: co-verify 每里程碑（consolidate LAND / close_commit LAND / claim 守恒）+ **抽验委员真验 ZK 非盲签**。

## 6. co-verify（Bettor·每步链上·非信 claim）
- consolidate LAND（PoolRoot 落链·pool 守恒 8e9）。
- close_commit LAND：**三方对死 payout_root**（ZK-算 9bfb3c87 == 委员链上锚 == 赢家 claim merkle）。
- claim 守恒：分发总额 == pool 8e9（W=0 → YES winner e72d8e7e 拿·NO 输；maker B-model 独立不在池）。
- **抽验委员非盲签**（命门）：抽一个委员·确认它签前真验了 GATE_VERIFY + payout_root match。

## 7. 依赖（J1 锁定才落码）
- J1 `unlockBshardConsolidate` 接口（consolidate 产 PoolRoot·给我 rootOutpoint/rootRedeem/rootState 产 preimage）。
- J1 `unlockBshardClose` relay 命令（收 4-of-5 + submit）·同 ozzeu。
- 委员独立 ZK-verify 工具（每委员跑·verify receipt + 比 payout_root）—— demo operator-driven·J1/KANet-UI 协调每委员真跑。

## 8. 铁律
NO TX NO STATE（每 tx LAND 才推进）· money-adjacent 不 racy（xzztw 教训）· 命门 §3 委员非盲签（松了白做）· 诚实口径 §2（非纯 trustless）。

---
**待 NWT 审（命门 §3 委员非盲签是否真 load-bearing·payout_root 绑定面）+ Bettor 审 → 我接 settler 编排（产 preimage + dispatch）。**
