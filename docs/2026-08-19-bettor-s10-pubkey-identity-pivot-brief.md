# §10 下一步设计 brief — 从 relay-attestation 转向 pubkey 跨节点身份(Bettor 定方向, J2 据此设计)

> **Status**: CURRENT · Bettor 2026-08-19 · 报备层, 零生产改动 · **这是 coordinator 定的方向+需求, 不是设计本体**(设计本体 J2 主笔 × NWT 红队 × Bettor 裁)。
> 出处: COORD-LEDGER §6-1 签发口线 + Codex RESPONSE-20260819(3017ff3e)+ §10 现稿 `docs/2026-08-18-j2-s10-relay-id-cryptographic-anchoring-design.md` §3.2/§4。

## §1 为什么转向(把已定的三条锁死, 免得再走回头路)

1. **§10 现稿 §4 的 relay-attestation 路 = 已被否**(Codex 3017ff3e + Bettor + NWT + §10 自己 §3):
   任何"Console 令 relay X 签"的证明, 对**同机调用方恒真**——发起 IPC 的就是 Console 自己, 攻击者驱动 Console 即得, 不证独立所有权(authority-collapse)。**submit-time 还是 issuance-time 都一样**, 移位置不改谁持签名能力。
2. **§10 现稿 §3.2 的方向 = 采纳为正路**(此前"待定", 现 Bettor 拍板转正):
   **跨节点身份的锚 = relay 公钥(协议 payload 里携带), `relay_id` 降为本地便利键。**
3. **本仓已有正确先例**(非新发明): 跨节点市场协议携带 `maker_relay_pk`(公钥), 消费侧
   `kaspa.verifyMessage(…, maker_relay_pk from payload, **NOT relay_nodes lookup**)`(`trade-protocol-filter.js:714-720`)。
   注释原话:「protocol membership lives in protocol fields not local relay_nodes infra」。**§10 身份照抄这个形状。**

## §2 设计必须满足(需求, 非设计)

- **N1 身份 = 协议 payload 里的公钥**: 跨节点可比、每节点独立验签、不查任何本地表当权威。
- **N2 不依赖 Console 侧任何"令 relay 签"的证明**(同机恒真=空)。控制权由**协议消费侧验 payload 自带签名**确立, 不由本机 Console 中介。
- **N3 relay_id 只作本地便利键**: 不作跨节点身份主键; 以 relay_id 为 PK 的注册表**不得**升为开放测试网跨节点身份注册表(Codex 明令)。
- **N4 服务端派生不透传**: 任何该服务端算的值(fingerprint 等)必须重算, 不收提交方字段(N4-bis/364/366/368/374/376 族; §10 现稿 §4.1 回填只写 live-derived 亦属此)。
- **N5 域分隔签名 + fail-closed**: 签的字节带协议版本/网络/身份命名空间; 不可达/验失败 fail-closed, 禁 try/catch→skip(Codex 北极星 spec)。
- **N6 与 §0 墙不冲突**: 这是 Track B 协议能力设计, **不授权 Owner 实例对外开放**; 部署随北极星、非现在。

## §3 明确【不在】本 brief 范围(免 scope 漂)

- 不设计签发口(那是 §6-1 分支, 已单独 scope + 定"北极星前不部署")。
- 不改任何生产码(报备层)。
- 不解决"旧 relay_id 记录迁移到 pubkey 身份"的迁移路径(单列, J2 设计时如遇再提, 本 brief 不预判)。

## §4 交接

J2 据 §2 需求设计 pubkey 跨节点身份机制(可复用 maker_relay_pk 的验签形状)→ NWT 红队(重点撞 N2: 有没有又滑回某种 Console 中介的证明)→ Bettor 裁。**现在开工**, 非"有空再做"。

## §5 J1 供数整合(COORD-LEDGER (535), Bettor 核过 pool.js:4054-4057 属实)

- **premise 更正(烤进设计前必知)**: `ecdsa_pubkey_xonly` 的"零填充/零写入方"是 **console 节点局部事实**——J1 独立节点上是 11 行 3 填(其 2026-07-03 oracle 实验所写, 脚本已不在树)。⇒ **该列历史上有写入方, 跨节点填充不一**; 设计不得把"0 行"当全局前提。
- **列的既有语义**: 该列生于 migrate.js **v130**(:3927-3929)= SS oracle ctor 参数(escrow oracle 用), **非身份**。挪用当身份锚 = 背一个已有别的语义的列 ⇒ **建议身份用独立表/字段, 不复用该列**。
- **N1/N4 的仓内先例(非新发明)**: `pool.js:4054-4057` 钱路已落"**不查** `relay_nodes.ecdsa_pubkey_xonly`(常 NULL、ccvr9 实测对不上), 改 `deriveXOnlyPubkey(address)` 活派生"。设计引它为先例。
- **N7(新增, 由 J1 设计输入)**: P2PK 下 relay **address 本身即 pubkey 承诺**(可互转)——「payload 携带 pubkey」与「relay address」是同一信息两种编码。**N7: 身份规范编码必须钉死一种**(address 还是 x-only pubkey), 防同一身份出两个字符串的歧义。
- **权威判据强化 N2**: J1 实测 3 行 stored==address-derived 3/3 MATCH, 但无 trigger/CHECK 守一致 + ccvr9 在册失配 ⇒ **库列最多做便利缓存, 权威只能是活钥/payload 自带 pubkey**(强化 N2)。
