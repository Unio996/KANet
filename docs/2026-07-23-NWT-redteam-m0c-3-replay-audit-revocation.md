# M0c-3 设计稿（防重放+审计+吊销）— NWT 红队 verdict

> **Status**: DRAFT（2026-07-23 · NWT）
> **审对象**：`docs/2026-07-23-m0c-3-replay-audit-revocation-design.md`（J2，commit `2648f296`）——⑤防重放+⑥审计+⑦吊销。
> **立场**：红队默认 refute。⑤防重放是钱路语义核心（防重复结算），我尤其打 reserve 状态机在崩溃/重试/并发下会不会双执行或卡资金。
> **verdict**：**GREEN-with-2-MUST-FIX + 1-note**。durable+atomic-reserve 方向对/审计绑身份 TCB 诚实/吊销免代码+operator 写面——都对。MUST-FIX：①reserve 状态机缺崩溃恢复（"reserved 但未终结"记录的 chain 对账，J2 自己点名的 NO-TX-NO-STATE 硬点，我深化）②replay 去重键设计（"可选 nonce"错——合法重复命令会跟重放撞）。

---

## 打不穿的（挣的 GREEN）

- **durable 存储（§2）**：replay 落 DB 非内存（Codex note③ 焊死，进程重启/多 worker 一致）。✅
- **幂等回执非报错拒（§2）**：重放返首次缓存回执（不是断掉报错），合法网络抖动重试不被误当攻击。✅ 方向对（区分 legit-retry vs replay 的意识在）。
- **审计绑身份 TCB 诚实（§3）**：callerId+grantId+intentDigest+origin+decision，不记 secret；明标乙期审计表在 Console 域=场景 B 可篡改（conceded 残留），真 tamper-proof append-only sink 归 R。✅ 不 overclaim。
- **吊销免代码+operator 写面（§4）**：吊销=数据写入（免重启），写入走 operator 离线/专道通道（零应用可达，应用不能自吊销他人/撤自己吊销）。✅ 与 provision 同信任面。
- **接缝解耦（§5）**：M0c-3 只在 M0c-1/M0c-2 钩子点插，不改判定逻辑。✅

## 🔴 MUST-FIX-1：reserve 状态机缺崩溃恢复（NO-TX-NO-STATE 硬点·J2 点名深化）

**打穿链**：§2 reserve 状态机 = reserved(副作用前占位)→committed(上链)→或 failed(可重试)。但**没写 reserve 与 outcome-marking 之间崩溃怎么办**：
- **崩在 reserve 后、广播前**：记录卡 "reserved", 无结果。重试撞 reserved → 幂等返缓存回执——**但没有缓存结果**(广播从没发生)=命令**永久卡死**(reserve 说占了、没结果、重试进不来)=资金/结算卡。
- **崩在广播成功后、标 committed 前**：tx 已上链, 但记录卡 "reserved"。app 拿不到成功回执(以为失败), 重试撞 reserved 挡住(好, 不双花)但拿不到 txid=状态悬空。

这正是 Codex MF9 / "链上已生效 DB 未确认崩溃场景"的核心——**dual-write(DB reserve + 链上广播)本质不原子**。设计 §2 有状态机但漏了终结前崩溃的恢复。**修法**：加"reserved 但未终结"的**对账恢复路径**——按 intentDigest 查链上该 tx 落没落(covenant/txid 可查)→ 落了标 committed(返 txid)/超时未落标 failed(放重试)。这条对账是 durable-reserve 用于钱路的必备件, 缺了=要么卡资金(不敢重试)要么双执行(乱重试)。落码 diff 审我重点核这个恢复路径 + 它自己不能引入双执行(对账也要原子)。

## 🔴 MUST-FIX-2：replay 去重键=强制 nonce，不是"可选"（合法重复会撞重放）

**打穿链**：§2 键 = "intentDigest + app key-id + **可选** nonce/request-id"。**"可选" nonce 是错的**：若某命令只按 intentDigest(命令+参数摘要)去重、无强制 nonce，则**两笔合法但同参数的命令会撞**——operator/app 先 transfer 100 给 X，之后又要 transfer 100 给 X(合法第二笔)→ intentDigest 相同 → 第二笔被当"重放"拒。=要么过度拦(合法重复被挡)、要么根本没法区分重放 vs 合法重复。

**修法**：去重键 = **强制的 client 提供的 nonce/request-id(每逻辑请求唯一)**——这是幂等键的标准设计: 同 nonce=同一逻辑请求(幂等), 不同 nonce=不同请求(即使参数相同, 合法第二笔)。intentDigest 的作用是**绑定 nonce↔intent**(同一 nonce 重发但参数不同=攻击, 拒), 不是当去重键本身。设计把 intentDigest 当键+nonce 可选=反了。改成: nonce 强制且是去重键, intentDigest 绑定 nonce 到 intent(防 nonce 复用于不同命令)。可重复的钱路命令(transfer)尤其必须强制 nonce。

## note（落码前收）

- **吊销读一致性（§4）**：gate step1 吊销查若走缓存, 吊销写入后有 staleness 窗(被吊销 caller 短暂仍放行)。"immediate 生效"要求吊销查**直读 DB 或写时失效缓存**——设计写明无缓存/写失效, 落码核。

## 判据

GREEN-with-2-MUST-FIX+1-note：⑤⑥⑦架构方向成立，但 reserve 崩溃恢复 + nonce 键两条是防重放立身之本(缺了钱路双执行/卡资金/合法重复被挡)，必须设计写死。连修进修订送 Bettor 方向审→Owner 签发。落码后我 diff 审(reserve 对账原子性 + nonce 强制 + 吊销读一致)+ 实战 harness(§6 重放/并发/崩溃重试/吊销真发)。

**关联**：`docs/2026-07-23-m0c-3-replay-audit-revocation-design.md`（审对象）、Codex note③（durable+atomic）、`docs/2026-07-22-NWT-redteam-m1-2-threat-model.md`（C-3）、M0c-1 §4.1（intentDigest/frozen canonical）。
