# NWT 红队 — VB-4 §6-1 ⑥ 生产挑战签发口设计

> 作者 NWT · 2026-08-27 · 派工 Bettor · 被审 = `docs/2026-08-27-kanet-ui-s61-challenge-issuance-endpoint-design-v0.1.md`（**41a8edb1**·只设计·给 Owner 批材料）
> Bettor 点名：筛两"死结"真伪（① 幂等粒度是否触 §6-1 冻结 / ② `.immediate` CAS 跨连接是否硬约束共 handle）。
> **总评：稿扎实（边界钉死不触冻结 / 列利弊不拍 / 每条 file:line）。两死结【都是伪死结】——都在 impl/policy 层可解、不触冻结 ⇒ 从 Owner 决策点里筛掉。= GREEN（Owner 材料），附两筛。**

## 1 · 死结① 幂等粒度 —— 🟢 **伪死结**（issuance-policy 层可解，不触冻结）
- 稿 §3 论证："per-requester 幂等需 challenge 绑 requester = 触冻结 ⇒ 死结"。**这是假二分。**
- 🔴 **冻结的是 challenge 语义**（纯 nonce、消费 CAS、isStoreBoundTo、⑦ 边界——§0 钉），**不是"签发速率/幂等策略"**。现"全表级一次一条活挑战"是**脚本为 Track-A 单注册的行为**（稿 §3 自证"为 Track-A 单注册设计"），**不是冻结语义**（D-012 冻的是 nonce+消费+绑定，不含"一次一条"）。
- **可解法（不触冻结）**：per-requester 幂等/限速用一张**独立 issuance-side 记录**（requester→challenge-id+ts，可复用 §6 审计表或新限速表）实现——**不给 `u1_identity_challenge` 加 relay_id 列**、**不改消费路径**。challenge 本体仍纯 nonce（谁持有+有效 PoP 谁消费），只是**签发侧多一个 per-requester 速率维度**。⇒ 生产化"发新 challenge per request + per-requester 限速侧记" 完全在签发策略层，冻结不动。
- ⇒ **筛掉**：① 不是 Owner 的冻结-blocker，是 impl 的限速设计。Owner 只需决"要不要 per-requester 限速"（策略），不涉冻结。

## 2 · 死结② `.immediate` CAS 跨连接 —— 🟢 **伪死结**（BEGIN IMMEDIATE 文件级写锁跨连接序列化）
- 稿 §4 + store.mjs:6-7 注："`.immediate` 只序列化持身份表的那个连接；签发口用另一连接 INSERT ⇒ 跨连接不序列化 ⇒ 必须共 handle 否则 CAS 塌"。**这条【过强/不精确】。**
- 🔴 **SQLite 事实**：`.immediate` = `BEGIN IMMEDIATE` 取**数据库文件级写锁**（rollback 的 RESERVED / WAL 的 write-lock）⇒ **同一 DB 文件的所有 writer 跨连接互斥序列化**（第二个 BEGIN IMMEDIATE 阻塞/SQLITE_BUSY 到第一个 commit）。⇒ 签发口用**另一连接**对**同一 console.db** INSERT，与注册侧 consume-CAS **经文件写锁序列化**，不丢更新。
- 🔴 **且推荐的 A 形态根本无跨连接**：A = "复用 fastify（同 identities.js:263 端点位）" ⇒ 端点**在 console 进程内**、用**console 同一个 better-sqlite3 handle**；better-sqlite3 调用**同步**⇒ 天然序列化、就是同 handle。**只有 B 形态（独立 daemon 另进程另 handle）才谈跨连接，而那也被文件写锁序列化。**
- 🔵 **store-binding 是【表身份】不是【序列化】**：(370) 洞 + isStoreBoundTo(sqlite∧table) 解的是"store 指向攻击者自己的表"（表身份），**不是连接序列化**；且绑定在 **consume 侧**（注册），签发口**只 INSERT 不 consume**、不需要绑定 store。⇒ 稿把"必须共 handle 做序列化"（假）与"consume store 须绑规范表"（真、但那是 consume 侧）**混了**。
- ⇒ **筛掉**：② 不是硬约束。**可用 BEGIN IMMEDIATE 解**（Bettor 猜对）；A 形态更是同 handle 同步天然无此问题。稿"必须共 handle"是**安全冗余建议**（低风险、可采），但**不是死结、不上 Owner**。

## 3 · 稿其余核（PASS）
- 🟢 §0 边界钉死：不改冻结 / 不解 ⑦ / 不触 CAS 授权语义 / (527)(528) 现裁——诚实，且"不得写'抢注已挡'"自律对。
- 🟢 §3 枚举不适用（`randomBytes(32)`=256bit 不可枚举）对；真风险=防刷孤儿（现清理是签发时非主动 GC，刷爆期膨胀）——准。
- 🟢 §7 失败面分层对：**当前无签发 key**（纯 nonce 不签名）⇒ "签发 key 泄露"N/A；**若加签则独立托管、不复用 CONSOLE_ENCRYPTION_KEY 域**（接 32/32 relay key 同 db 同 key 同故障域事实，我 §6-1/watchtower 域一致）；**challenge 单独泄露不足以盗注册**（需配对 identity PoP 签名）——真失败面 = identity key + challenge，对。
- 🟢 §6 审计只记 challenge **前缀不记全值**（活 bearer）——同 E2E 纪律，对。
- 🟢 §5 S10 envelope 预留位不阻断未来、不定义内容（待 §10）——对。

## 4 · 交付判词
- **VB-4 设计稿（41a8edb1）= GREEN（Owner 批材料层，零落码）。** 边界钉死不触冻结、利弊列全、每条 file:line、失败面分层准。
- **两死结【都筛掉】**：① 幂等粒度 = issuance-policy 层可解（侧记录，不给冻结表加列、不改消费）⇒ 非冻结-blocker；② `.immediate` 跨连接 = BEGIN IMMEDIATE 文件写锁序列化（A 形态同 handle 同步更无此问题）⇒ 非硬约束、可解。**两条都不该作"触冻结的死结"上报 Owner。**
- **真 Owner 决策点收敛到两条**（§8 的 1+2）：**(a) ⑥ 属哪条 Track**（D-012 §0：Track-A → 形态 C 手工已 GREEN 够；Track-B → 需 §10 抢注先解）；**(b) 是否推翻/放宽 (527)"自动签发口不部署"**。**只有放宽后**才谈 §8.3 的下游（鉴权档/限速/签发 key 托管）——那些是 impl 设计非冻结问题。
- 🔵 **给 Bettor 精炼上报**：Owner 面前只放 (a)(b) 两问；两死结注明"NWT 核=impl/policy 层可解、不触冻结、不阻决策"。冻结安全无恙。
