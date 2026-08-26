# NWT 红队 — §10 pubkey 身份实施计划 v0.1

> 作者 NWT · 2026-08-27 · 派工 Bettor · 被审 = `docs/2026-08-27-j2-s10-impl-plan-v0.1.md`（599399a7·报备层零落码）
> **总评：设计层站得住，N2 干净、⑦ 跨节点关得住。PASS-WITH-NOTES**——我主攻的 N2 过了；Bettor ①② 我核过是【正确处理】;③ local_relay_id 是**真残余**（doc-note 非机制）;另 ⑦-closure **作用域措辞须收紧**（别读成同机也挡了）。Owner 决闸正确标了。

## 主攻 · N2 authority-collapse（滑回 Console 中介"令 relay 签"?）—— 🟢 **干净**
- 控制权证明 = submission 附**由 relay 地址钥签的 S10 信封**,`verifyS10Envelope` 用 **payload 里的 `relayPubkeyXOnly`** 验签(P1)。**这是"提交里【携带】了一份由 relay B 私钥出的签名"= 密码学 proof-of-possession,不是"Console 令 relay B 签"(那种 = 同机 IPC 恒真,被否的 relay-attestation)。** 证明在 payload 里、独立验,非 Console 动作 ⇒ **N2 干净。**
- 绑定 `s10.relayPubkeyXOnly === xonly(relay_nodes[relayId].address)` 读 DB —— 但那是**本地绑定(L5,判"claim 的 relay_id ↔ 哪把钥")**,验签权威仍取 payload(P1)。plan 显式分清了两者。DB 读不是密码学权威 ⇒ 不构成 N2 滑回。✅
- 🔴 **但 ⑦-closure 的【作用域】必须收紧(#9 DECISIONS 注记现写"作用域=本地A2注册"= 含糊)**:
  - **关得住的**:**远程/跨节点** squatter —— 他提交到本 Console HTTP,签不出本机 relay-B 的地址钥(B 的钥在本机 console.db,他没有)⇒ `RELAY_NOT_OWNED`。这是 §10 真正的价值。
  - **关不住的(且 plan §6 已诚实认)**:**同机** squatter —— 任何有 console.db + CONSOLE_ENCRYPTION_KEY 的本地 actor 能解密 B 的助记词、签出 B 的 S10 ⇒ 同机 ⑦ 仍在 loopback 信任内(同 transfer/mnemonic-reveal,528)。
  - ⇒ **注记措辞改为**:"⑦ 关闭作用域 = **跨节点/远程**抢注(S10 须签得出目标 relay 地址钥);**同机**抢注仍在 loopback 信任内(本地可解密任一 relay 助记词自签),非本 v1 关闭项。" **别让"⑦ 关闭"被读成同机也挡了。**

## Bettor ① · 预筛↔事务内重验之间 relay_nodes.address 被换钥的窗口 —— 🟢 **正确处理**
- plan (d):事务内(`.immediate` 内、A2 INSERT 之后、挑战重读之前)**重做绑定 + S10 验签**;T1 臂:预筛后事务前换钥 ⇒ 事务内重验拒、整笔回滚、`u1_relay_identity` 0 行。✅
- 🔵 **我补一层确认**:事务内那次读 `relay_nodes.address` **在同一 `.immediate` 写锁下**(relay_nodes 与身份表同一 console.db/连接)⇒ 持锁期间别的连接改不了 relay_nodes(写会阻塞)⇒ **in-tx 读是一致的、不存在事务内二次 TOCTOU**。这点 plan 没显式写,建议补一句(同 :253 CAS 的"同事务域 + .immediate"前提论证)。
- **承重那半 = 绑定(relay_nodes.address 可变),不是 S10 签(信封字段全 immutable、in-tx 重签得同结果)**:plan 说"重做绑定与验签",其中**验签是冗余-无害,绑定才是必须 in-tx 的**。建议措辞点明,免得读的人以为签也会变。
- 残余(loopback attacker 改 relay_nodes.address 成自己钥)= loopback 信任内(需 console.db 写),同上作用域,acknowledged。

## Bettor ② · 共用 challenge 时 S10 签失败 / A2 已通过的回滚形状 —— 🟢 **原子,正确**
- 序:预筛(A2 PoP 外 + S10 外)→ in-tx:A2 INSERT → S10 重验+绑定 → `u1_relay_identity` INSERT → 挑战重读(:253)→ 消费。
- **S10 in-tx 失败(S10_INVALID/绑定不过)⇒ throw ⇒ 整笔回滚(含 A2 INSERT)**。挑战消费在 :253 **之后**、即在 S10 之后 ⇒ **S10 失败则挑战【未消费】(used_at 仍 null)**。⇒ **A2 与 S10 原子:要么都成、要么都回滚 + 挑战不消费**,operator 可用同 challenge 带正确 S10 重试。✅ "一次消费绑两签"成立。
- 🔵 **红队点(无洞,记明)**:A2 INSERT 在 S10 验之【前】的代码顺序**不产生半态** —— 事务原子,S10 throw 回滚连 A2 INSERT 一起撤,不存在"A2 落库但 S10 没验"的 committed 态。ORDER 在 tx 内对原子性无影响。
- 🔵 对称注:A2 PoP 签**不**在 in-tx 重验(现状 :253 只重读挑战 use-state,不重验 PoP 签)——因 PoP 签的被签量(fingerprint/index/relayId/challenge)全 immutable、重验同结果;S10 同理签 immutable。**两者 in-tx 该重做的都只是【可变量】(挑战 use-state / relay_nodes.address),签本身不必**。plan 对 S10 多做了一次签重验(冗余无害),口径统一即可。

## Bettor ③ · local_relay_id 非权威映射被下游当权威读(一名多物）—— 🔴 **真残余,doc-note 非机制**
- plan:`u1_relay_identity.local_relay_id TEXT UNIQUE NULL` = L5 可选映射,DATABASE.md #8 记"陷阱:非权威"。UNIQUE 防"一个本地 relay 挂两把钥",**但 UNIQUE 挡不住【下游按 local_relay_id 查并当权威身份用】**。
- 🔴 **这正是 §10 要否的形状**:身份权威=pubkey,不是 relay_id。一旦 `local_relay_id` 这列**存在**,它就是"现成工具"(同 u1-issue-challenge 入库=可发现那条):某下游 `SELECT ... WHERE local_relay_id=?` 当权威 = relay_id 又变身份 = 滑回。**DATABASE.md 一句陷阱注 = 约定非机制**(同"seed 说别花钱"荣誉制族,我反复 flag 的病)。
- **修法(二选一,建议 a)**:
  - **(a) 不存 local_relay_id**:pubkey 是唯一键;任何 relay_id→pubkey 的本地便利映射**活算**(`XOnlyPublicKey.fromAddress(relay_nodes.address)` 现推,同 feedback.js:18 先例),不落列。列不存在 = 结构上无法被当权威读。
  - **(b) 若必须存**(routing/UI 便利):加 **ANTI-PATTERNS 规则 + lint**——"身份-权威读必须按 `relay_pubkey_xonly`;任何 `WHERE local_relay_id` 出现在身份决策上下文 = flag"。DATABASE.md 注保留但不作唯一防线。
- 我倾向 (a):L5 说"可选",可选的便利不值一个结构性滑回面。

## 其余完备核（PASS）
- 🟢 **纯函数验证器**(零 DB/IPC/relay,P4)+ DB 绑定在 registration 流不在 verifier ⇒ 干净分层。
- 🟢 **network 取本地配置不收 payload 外层**(MUST-FIX A / N13);operation `===register` 硬白名单(N10);`verifyMessage` throw==false 同拒(fail-closed,N5)。
- 🟢 **跨协议重放(N12)**:S10 域分隔前缀 `domain-vversion|network|...` 与 A2 PoP 消息空间不相交 ⇒ 共用 challenge 不致签复用。测试臂在。
- 🟢 **golden vectors 逐字节 + J1 第二实现跨节点复算**(N7 canonical / 独立算力),签名非锚(BIP340 aux-rand 非确定,只验 verify=true)—— 对。
- 🟢 **R7 = 今晚 scratch first-squatter 翻成必 REJECT** —— 我 flag 的那条 gap 变成正向测试臂,好。
- 🟢 三份既有夹具补 s10(规则 69 自列 C3 审点);CAS 三判据不动(S10 INSERT 排 A2 INSERT 后、挑战重读前,不改相对序)。
- 🟢 **Owner 决闸**正确标(协议身份 + 新表 = 重大功能,铁律 0);报备层零码。

## 交付判词
- **§10 实施计划 v0.1 = PASS-WITH-NOTES(设计层)**,方向对、N2 干净、⑦ 跨节点关得住、分层/域分隔/fail-closed/测试分层都对。
- **两条须改**:① **⑦-closure 作用域措辞收紧**(跨节点关/同机 loopback 内,别读成全关);② **local_relay_id 建议不存(活算)或加 lint 机制**(doc-note 非机制,Bettor ③ 成立)。
- **两条补注(非阻塞)**:in-tx relay_nodes 读的"同 .immediate 写锁一致性"显式写一句(Bettor ①);in-tx 重验"承重是绑定、签是冗余"口径点明(Bettor ②)。
- **实施轮(Owner 批后)逐 commit NWT 红队**:C1 验证器(纯函数/网络注入/白名单/throw==拒)→ C2 v198(PK=pubkey/无 legacy 回退)→ C3 registration(绑定用DB钥/验签用payload钥分清 + in-tx 重验 + R7 红臂 + CAS 三判据不动)→ C4 builder(密钥区纪律不退,同我上轮 grep 那套)→ C5 注记。**C4 builder 碰钥,我按上轮 3c876765 那套 grep 零片段再卡一遍。**
- Owner 决:批的是**方向**(§10 v1 落地),逐 commit 内部双审;跨节点身份 = 协议层,部署仍随北极星、不现在开放(§0 墙不动)。
