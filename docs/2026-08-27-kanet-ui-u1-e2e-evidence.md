# §6-1 Track-A · operator 手工签发 + 一次真注册 E2E · 证据（operator=KANet-UI）

> **结论（固定措辞）**: 注册路 plumbing 在 operator 信任假设下端到端跑通；授权 soundness（⑦=first-squatter-wins）待 §10。
> **作用域**: 挑战=纯 nonce，isStoreBoundTo 绑 sqlite∧table 不绑 relay_id；本 E2E 只证 plumbing 端到端通、不构成 §6-1 注册的生产上线；⑦ relay_id 抢注面在本 E2E 里零信息。
> **执行**: KANet-UI（operator）· 2026-08-26（DB 时钟）· 依据 runbook `docs/2026-08-27-j2-u1-operator-challenge-issuance-runbook.md`(f5afee46) · 脚本 u1-issue-challenge.mjs(7d20a5f8)/u1-build-submission.mjs(3c876765) · **待 NWT 逐臂核**。
> **坐标**: HEAD=**9fbdea87** · console :3200 PID=**27412** · DB=`kasia-console/data/console.db` · 注册 relay=**J2-tn 102cbb99-9115-4504-8928-5c22359f1852**（custody=mnemonic，非钱路，频道通信 relay；注册的 identityPubkeyXOnly=它现用地址钥）。

## 基线（step0，跑前）
- 三表: u1_identity_challenge=**0** / u1_identity_registration=**0** / u1_domain_assignment=**0**（前两张 0 = §6 可回滚前提）。

## step1 issue（挑战签发）
- dry-run: `WOULD-ISSUE`，relay_custody=mnemonic，relay_name=J2-tn，baseline_rows 0/0/0，orphans_unused_expired=[]，ttl_ms=300000。
- `--commit --json`: `ISSUED`，challenge=`a39cb4392b776d21ed5ba1dae57d97fff2d7125ca52d384da87824e336718f30`（**已消费**，见 (b)），expires_at_iso=2026-08-26T18:11:24.158Z，orphans_cleaned=0。challenge_rows 后=**1**。
- 纪律: 该 challenge 消费前只在 operator 终端，未贴频道/未入持久物；消费后方记入本证据。

## step2 build（submission 构造 · 零私有密钥材料）
- `offline_pop_selfcheck=**PASS**`，`address_key_matches_identity=**true**`，写 `scratch/u1-e2e/submission.json`（523B）。
- 六字段（皆公开值）: relayId=102cbb99… · rootXpub=`kpub2KUUJN8kUHXZ2prZZpk5KCX8pAxNqmY9AxTetjry2k1JAZMqvn6RFC9hYRvoXua1GeHvA2jWjBsbnq7Zmr766be3hPaQZCxHMR2m9vpp8tx`（扩展公钥，公开） · identityIndex=0 · identityPubkeyXOnly=`b012048e6a85241a31882c3d69b7d4928e12568609e7180b00180a5f17b060b4` · challenge=a39cb439… · signature=`2f648146…b4d0cc4b`。
- 密钥零外泄: 脚本进程内用 console 同一把 CONSOLE_ENCRYPTION_KEY 解密该 relay 的托管种子、派生、签名，输出仅上述六个公开字段（无任何私有密钥材料落盘或打印）。

## step3 阴性·翻签（PoP 事务外先拒，不碰 CAS）
- 造 submission-flipped.json（仅翻 signature 末 1 hex b→a）→ POST →
  **HTTP 400** `{"ok":false,"code":"POP_FAILED","reason":"SIGNATURE_INVALID: signature does not verify under the claimed identity pubkey"}`
- 拒后 challenge **used_at=null（未消费）**、u1_identity_registration=**0** ⇒ PoP 层先拒、不消费 CAS，符合预注册。

## step4 主臂（真注册）
- 有效 submission → POST → **HTTP 200** `{"ok":true,"rootFingerprint":"blake2b256:008b045457e5b6b12fc6d6a944bdaece104c4f3dd98cd0dd0c9e686fe67f89fd","custody":"mnemonic","verifiedWith":"b012048e…b060b4"}`
- **(a)** u1_identity_registration=**1 行**: relay_id=102cbb99…(J2-tn) / identity_pubkey_xonly=`b012048e…b060b4` / custody=**mnemonic**；`XOnlyPublicKey.fromAddress(kaspatest:qzcpypywd2…)`=`b012048e…b060b4` ⇒ **match=true**（注册的正是 J2-tn 地址钥）。
- **(b)** challenge used_at=**1787767685650（非空）** ⇒ CAS 消费过。
- **(c) 顺序重放**（同 submission 二次 POST）→ **HTTP 400**、reg 仍 **1 行**（重放被挡、CAS 守住）:
  `{"ok":false,"code":"POP_FAILED","reason":"CHALLENGE_USED: challenge already used at 1787767685650"}`
  🔴 **arm(c) 验的是 PoP 前置层（顺序重放 → 400 POP_FAILED/CHALLENGE_USED）**: 生产真值路径 = PoP 前置检查 `u1-registration-pop.mjs:95` 返 `POP_REJECT.CHALLENGE_USED`，在 `u1-registration.mjs:216` runTx 之前 return 挡住（路由包成 POP_FAILED/reason CHALLENGE_USED）。
  🔴 **in-tx CAS 层（`u1-registration.mjs:253`，并发双消费 → CHALLENGE_ALREADY_USED）顺序 E2E 不触发、未验，需并发测试**；机制结构在位（isStoreBoundTo 同事务域 + `.immediate` 写锁）≠ 运行时证。
  🔵 **判据更正（发现，非"改成过了"）**: runbook §4.4.c / 预注册期望 `code=CHALLENGE_ALREADY_USED` 写错了路（顺序重放先撞 PoP 前置层）。独立佐证: 生产测试 `u1-registration.test.mjs:371-372` 本就断言 POP_FAILED/CHALLENGE_USED。⇒ (c) = PASS-with-recorded-gap（property 成立：用过的挑战不能二次注册），Bettor 裁定 + NWT 独立核码确认。

## step5 阴性·过期
- `--commit --ttl-ms 60000` 签第二条 challenge=`bf2d52be2059469f3337ff3c7249e20c912f7aedbc42c7032d1cd35933a9dcdc`（expires 2026-08-26T18:09:59.727Z，**已过期未消费**）→ build submission-expired.json（selfcheck PASS/match true）→ **等 65s** → POST →
  **HTTP 400** `{"ok":false,"code":"POP_FAILED","reason":"CHALLENGE_EXPIRED: challenge expired"}`；reg 仍 **1 行**。
- 🔵 **路径记实（同 (c) 结构）**: 过期由 **PoP 前置层 `u1-registration-pop.mjs:103` 返 CHALLENGE_EXPIRED** 拦下（路由包 POP_FAILED/reason CHALLENGE_EXPIRED），非裸 `CHALLENGE_EXPIRED`；事务内重读路 `u1-registration.mjs:269`（同 code 名）**未触发、未验**。

## 终态 + 回滚说明
- 终态: u1_identity_registration=**1**（主臂，**留着**=plumbing 运行证据，作用域见首段）；u1_identity_challenge=**2**（a39cb439 已消费/主臂 + bf2d52be 过期未消费孤儿，下次 issue --commit 会作孤儿清）。
- 未跑臂: §4.5.b 换-relay_id 负臂（⑦ 抢注面）本轮**不跑**（Bettor 裁）⇒ 无伪注册行需回滚。
- 回滚（如需回基线）: 事务内 `DELETE FROM u1_identity_registration WHERE relay_id='102cbb99-9115-4504-8928-5c22359f1852'` + `DELETE FROM u1_identity_challenge WHERE challenge IN(a39cb439…, bf2d52be…)`；仅删本次 E2E 自写行，且须 NWT 看过证据之后（§6）。注册路不广播/不动钱/不写别表（无 chain_events）。

## 五臂判据小结（NWT 逐臂核）
| 臂 | 期望 | 观测 | 判 |
|---|---|---|---|
| baseline | 两表 0 | 0/0/0 | PASS |
| issue | count=1 + expires | ISSUED, count=1 | PASS |
| build | 六字段+selfcheck PASS+match true | PASS/true | PASS |
| 翻签 | 400 POP_FAILED + used_at 空 | 400 POP_FAILED SIGNATURE_INVALID, used_at=null | PASS |
| 主(a) | reg 1 行/mnemonic/pubkey==fromAddress | 1 行, match=true | PASS |
| 主(b) | used_at 非空 | 1787767685650 | PASS |
| 主(c) | 400 + reg 仍 1（重放挡） | 400 POP_FAILED/CHALLENGE_USED (pop.mjs:95 前置层, runTx 前), reg=1 | PASS-with-recorded-gap（in-tx CAS 层未验） |
| 过期 | 400（挑战过期挡） | 400 POP_FAILED/CHALLENGE_EXPIRED (pop.mjs:103 前置层), reg=1 | PASS·路径记实 |
