# jepu1 陈签名重签修复设计 v0.1(含第三签名站点补丁)

> **Status**: CURRENT(v1.1 — Bettor 方向审 GREEN #pf06l9, 顶格 gate"WC 盘路径分离"已 definitively 坐实(§1.5)+第四站点候选记录(§1.6); 待 NWT 红队 + Bettor/Owner 签发——money-path, 移动 188KAS)

- 作者: J1tn(sighash 域, 6/28 c8188d98 co-diagnose 参与者)· 2026-07-18
- 派工: Bettor #peri6h(判据数据坐实后授权设计)· 行号锚点 commit: `41ee726a`

## 1. 已坐实的根因链(三方数据+读码, 非推断)

1. **陈签名**: jepu1 的 5 笔委员签名 `pool_oracle_tx_sig` 全部 observed_at=2026-06-28 12:48:15, 早于 c8188d98(6/28 19:13)——全部用坏 sighash 路径签出(Bettor canonical 库 SQL 坐实, before=5/after=0)。
2. **为什么 401 次重试全败**: 收签器每 tick 从 chain_events 重组同一批陈签名 → 同一笔 f9e64afc → 节点 checkSig 必拒。
3. **为什么修复救不了它(两层 dedup 都朝错误方向)**:
   - 收签侧 first-wins: pool-market-settler.js:2870 `seenByInput.has(signerKey) → continue`, SELECT 无 ORDER BY(≈插入序)——陈签名永远挡住任何新签名;
   - voter 侧幂等 skip: trade-protocol-filter.js:561-567 查本地 chain_events 已有own签名 → 不重签——重发 sign_req 也不会产生新签名。
4. **🔴 第三签名站点漏修(本次新发现, 修复前置)**: c8188d98 只改了 `bettor-prediction-voter.js` 两站点(diff --stat 单文件铁证); **`trade-protocol-filter.js:handlePoolOracleTxSignReq`(:571-575, r377 跨节点 chunked sign_req 消费者)仍用裸 `tx_hex: JSON.stringify(phase2TxObj)` 无 `safe_json:true`** = 坏 sighash 原路径原样活着。不补这条, 重签可能签出新一批坏签名(取决于哪个 handler 接到 req)。这是 c8188d98"并行实现漏同步"母题第三发(同 v0.6→bshard recapture / CAPTURE_FINALITY_DEPTH 家族)。

旁证: 5 笔同秒 12:48:15 = 单节点 localOracles 批量循环一次签完 → **jepu1 的 5 个委员 oracle 极可能全部 local 于 canonical :3200**(落码前用 pool_committee×relay_nodes 一条 SQL 确认, 见 §4-0)。

### 1.5 WC 盘路径分离 = definitively 坐实(Bettor 顶格 gate, 三路证据)

1. **分发键隔离**(J2 全仓 grep 独立坐实): `handlePoolOracleTxSignReq` 全仓仅 2 处调用, 均在 trade-protocol-filter.js 内部, 分发键 = 消息 `type='kanet_pool_oracle_tx_sign_req_v1'`(v0.6/v0.7 经典 oracle 委员协议专属)——bshard 签名走完全不同的消息 type 家族(bshard_close_request 系)。
2. **bshard daemon 零引用**: `bshard-settle-daemon.mjs` grep `sign_req` 零命中。
3. **bshard voter 本就 safe**: WC 盘(ajnid/85fit, bshard V1)签名走 `bshard-close-voter.js`:376(V1)/:497(V2), 两处调用 `sign_input_for_settle` **已带 `safe_json: true`**(bshard proven 路, 正是 c8188d98 修复对齐的目标形态)——otp6h 今天完整结算实证。
→ 结论: 步1 改 `handlePoolOracleTxSignReq` 对 WC 盘**零暴露**(不同消息 type + 不同 voter 文件 + bshard 侧已是 safe_json), 不需要 WC 回归 case, gate 过。

### 1.6 第四站点候选(记录, 不进本案 scope)

`bettor-prediction-settler.js`:618-631(1v1 consensual exchange 结算, maker/taker 双签)同样裸 `JSON.stringify(preimage.tx_obj)` 无 safe_json——同 relay handler 同 plain 路径, 同族风险候选。**未定性**(该路径 tx_obj shape/近期是否有成功案例未查), 不塞进 jepu1 修复, 单独立卡定性(若坏 = c8188d98 母题第四实例实锤; 若其 tx_obj 构造恰好避开 spk 注入问题 = 记录排除依据)。

## 2. 修法(三步, 依赖序固定)

### 步1(代码·前置): 补第三站点 safe_json

- `trade-protocol-filter.js` `handlePoolOracleTxSignReq`: 把 `toSettleSafeJsonTxHex` helper 从 `bettor-prediction-voter.js` 提到共享位置(或 export 复用, 反增殖单源), :571-575 改为转 safe_json + `safe_json:true`——与 c8188d98 两站点逐字节同款处理。
- 影响面: 只有该 handler 的 sign 命令构造, relay/build 路 0 改(同 c8188d98 口径)。

### 步2(数据手术·审计留档): 清 jepu1 陈签名行

- **前提确认后(§4-0 全委员 local canonical)= 单节点手术**: canonical console.db 上, 精确 5 行(event_type='pool_oracle_tx_sig' AND market_id=jepu1, 按 id 列举)——先快照(SELECT * 存档进本设计稿附录/审计文件), 后 DELETE。同款先例: 7/17 test-fixture 清理(快照+精确id删+审计记录)。
- 双重目的: ①解开收签侧 first-wins(无陈行可挡); ②解开 voter 侧幂等 skip(本地查无 own 签名 → 愿意重签)。
- **若 §4-0 查出有跨节点委员**: 该节点同款手术(快照+精确删), 手术清单逐节点列出后才执行——不做"猜大概只有一台"。

### 步3(执行·复用现有机制零新逻辑): one-shot 重发 sign_req

- 用既有 chunked broadcast 派发机制对 jepu1 重发 `kanet_pool_oracle_tx_sign_req_v1`(含 phase2_tx_obj)——voter 走**步1 修后的** safe_json 路径重签 → 新签名以新 chain_events 落库 → 下个 settle tick 正常收签提交。
- 触发方式: scratch/ 一次性脚本调用现有派发函数(不改生产 tick 逻辑), 或等 :2888 re-broadcast 自然触发(陈行删后 spineMissing=5/5 → 自动全员补发——**优先用这条: 零脚本, 全自动**, 只需确认 re-broadcast 的 backoff 窗口)。

### 不做什么

- 不改收签 first-wins/dedup 语义(epoch 机制是更大的协议改动, 对本案非必需——陈行删掉后 first-wins 收的就是新签名; epoch-based re-sign 作为机制根治候选另立卡, 不塞进本案)。
- 不碰 f9e64afc/phase2_tx_obj 本身(offline 验证过 round-trip lossless, tx 构造是对的, 只有签名是坏的)。
- 不动 jepu1 之外任何盘。

## 3. 验证(执行后逐步, 全链上可核)

1. 步1 落码后: NWT diff 审 + 对修改后 handler 用 jepu1 实 phase2_tx_obj 跑一次 sign 命令构造(不广播), 核 `safe_json:true` + safe hex 与 c8188d98 offline 验证同款 round-trip。
2. 步2 后: 收签器下 tick 日志应转为 `waiting spine sigs: input0=0/5`(陈签名不再被组装)。
3. 步3 后: 5 笔新 sig chain_events(observed_at=now)→ 收签齐 → submit——**成功判据 = f9e64afc(或新 txid)真落链 + winner 赔付到账 + 守恒**; 若 submit 仍拒 = 存在第四坑, 停手回频道, 不无限重试(SETTLE_SUBMIT_GIVEUP 既有闸兜底)。
4. Bettor 已应允配合验证重签后 sighash 匹配(#peri6h)。

## 4. 执行前置清单(硬 gate)

0. **委员 locality SQL**(canonical): `pool_committee.committee_pks`(jepu1)× relay_nodes(is_oracle=1) → 5/5 local 则步2 单节点; 否则逐节点手术清单。
1. 步1 代码 NWT diff 审 GREEN。
2. 步2 手术单(精确 5 行 id + 快照)Bettor 过目。
3. **Owner/Bettor 签发**(188KAS money-path, Bettor #peri6h 已定流程)。
4. 决赛盘结算窗(24-47h 后)不受影响——jepu1 是 v0.6/v0.7 经典管线老盘, 与 ajnid/85fit(新 V1 盘)零共享状态; 步1 改的 handler 也服务新盘 sign_req, **但只会把坏路径改好, 不会把好路径改坏**(safe_json 是 bshard proven 路)——NWT 审时重点核这条。

## 5. NWT 审读重点(自提)

1. 步1 与 c8188d98 的字节级同款性(bigint rehydration 逐字段、spk flat-hex 全保)——别只对齐"意图";
2. 步2 删行对其它消费者的影响面(chain_events 该 5 行还有没有别的 reader——如对账/统计——grep 全量);
3. 步3 用自然 re-broadcast 的 backoff 时序(最长等多久, 值不值得 one-shot 脚本);
4. §4-4 新盘 sign_req 路径回归: ajnid/85fit 到期结算时会走同一个 handler——需要 regression case 证明 safe_json 化后新盘签名依旧验过(或论证 bshard 盘不走这个 v0.6/v0.7 handler, 走 bshard-close-voter, 影响面为零——落码时查清写进 diff 说明)。
