# P1(g) 离线腿：用【重建出的】编译器 A 跑冻结向量 — 逐向量记录

> **Status**: 证据制品 · J2 2026-08-27 · Bettor 派工(Owner 令: 主线第一位 = §6-3, 不停)· 对应 Codex 8/22 窄 MUST-FIX(`RESPONSE-20260822-UNSYNCED-P1G-H-B-CODEX-REVIEW.md:18`, origin/coord/codex-bridge)· **待 NWT diff 审(脚本一处参数化)+ 复核**
> **性质**: 只读编译 + 字节比对 + 离线自验。**不需节点、不上链、不花币。** 改动 = `kasia-console/scripts/checksigfromstack-e2e-vectors.mjs` 一处 env 覆盖(默认 C 语义不变)+ 输出打印编译器/script sha256。
> **原始结果**: `scratch/e2e/offline-leg-result-20260827.json` + `scratch/e2e/offline-leg-A-<ts>.log`;跑法 `node scratch/_j2_p1g_offline_20260827.mjs`。8/20 那份上链证据原样备份在 `scratch/e2e/_0820_backup/`。

## §0 一句话

**重建产物 A(sha256 `7213455b…`)编出的 CheckSigFromStackProbe script 与权威 C(`9de7f2f6…`)逐字节相同, 且与 8/20 真正上过 TN12 链的那段 script 逐字节相同**(同一 ctor 下 40B, sha256 `21fa272f…`);用 A 跑冻结向量 V0–V5c 八格离线自验全部与应然一致, inconclusive = 0。OP_PICK 敏感路径(PayoutShardV2, 27 参 ctor)今日重跑:A≡C(8282B `6f784a7b…`)、A≠legacy(8181B)仍成立。**⇒ 8/20 在 Toccata 路径上跑过的那份字节, 就是 A 的产出。** 上链腿(用 A 的产出现场再花一遍)是否仍需独立执行, 归 Codex/Bettor 裁定(§4)。

## §1 前置:重建产物崩机后没丢 `[MEASURED 2026-08-27]`

| 件 | 路径 | sha256 | 与记录 |
|---|---|---|---|
| **A** fresh rebuild(base d25bd342 + patch) | `scratch/_p1g_verify/target/release/silverc.exe`(mtime 2026-08-23 02:06) | `7213455b6953cfdb8ce946cacf68bb98fd58e4b63861ca72c4ad1e99e83ee71a` | = item5 §4 |
| **C** 权威 | `D:/silverscript/versioned-builds/silverc-zk-8065184.exe` | `9de7f2f682bc9e50a4b922e1c811335f1b1cd67c175f2e01df6fa6efc9015fc4` | = MANIFEST / 2a012116 |
| B base 对照 | `scratch/_p1g_base/target/release/silverc.exe` | `cb315980…` | 在, 本腿未用 |
| legacy | `versioned-builds/silverc-legacy-2c46231.exe` = `target/release/silverc.exe` | `e0e9b62c…` | 在, 作对照臂 |
脚本内对 A/C 的 sha256 硬断言(不等即 throw), 不是肉眼比。**没有重建**(重建 = provenance 事件, 归 Bettor)。

## §2 逐向量记录(A 为被测编译器)

probe 合约 `kasia-console/src/lib/CheckSigFromStackProbe.sil`;向量 = witness 入参, 同一 ctor 下 script 字节不随向量变。

| 向量 | 内容 | 期望 | 编译器 sha256(A) | probe script sha256 · 字节 | 离线自验(BIP340 裸验 = 链上规则) | 8/20 链上原文(C 产出, 同字节, 参考) |
|---|---|---|---|---|---|---|
| V0 | 合法 (sigA@D1, D1) | PASS | `7213455b…` | `1f7ecd08…` · 40B(新 ctor)| **PASS** ✅ | PASS, txid `b5306edd…`(V0-final) |
| V1 | sig 翻一位 | REJECT | 同 | 同 | **REJECT** ✅ | `not all signatures empty on failed checkmultisig`(tx `e098f4b1…`) |
| V2 | digest 翻一位 | REJECT | 同 | 同 | **REJECT** ✅ | 同上(tx `6c1aa057…`) |
| V3 | 另一把钥的合法签名 | REJECT | 同 | 同 | **REJECT** ✅ | 同上(tx `0cb56deb…`) |
| V4 | 全零 sig | REJECT | 同 | 同 | **REJECT** ✅ | `script ran, but verification failed`(tx `6a34068a…`) |
| V5a | 交叉配对 (sigA@D1, D2) | REJECT | 同 | 同 | **REJECT** ✅ | `not all signatures empty…`(tx `31f07877…`) |
| V5b | 交叉配对 (sigA@D2, D1) | REJECT | 同 | 同 | **REJECT** ✅ | 同上(tx `c817433e…`) |
| V5c | V5 阳性对照 (sigA@D2, D2) | PASS | 同 | 同 | **PASS** ✅ | PASS, txid `e0515f3f…` |
- **判据自身的对照臂先过**(脚本 :117-132):旧口径 `signMessage` 签名 → REJECT(必须)、裸 BIP340 → PASS(必须)⇒ 这把尺会红也会绿, 八格读数才有意义。
- **编译坐标对照臂**:legacy 编译 probe 报 `unknown function call: checkSigFromStack`(非 file-not-found)⇒ 默认路径确实没有本内建, 被测的是 zk 家族。
- **mismatch = 0, inconclusive = 0。**

## §3 字节等价(三方)`[MEASURED]`

| ctor | A 产出 | C 产出 | 8/20 上链 `onchain_probe.json` | 结论 |
|---|---|---|---|---|
| 8/20 上链那份 `_0820_backup/_ctor.json` | `21fa272f…` 40B | `21fa272f…` | `21fa272f…` | **A ≡ C ≡ 已上链字节** |
| 今日新 ctor(新随机钥) | `1f7ecd08…` 40B | `1f7ecd08…` | — | **A ≡ C** |
| PayoutShardV2 27 参(OP_PICK 敏感, item5 同款 ctor) | `6f784a7b…` 8282B | `6f784a7b…` | — | **A ≡ C, A ≠ legacy(`e52e5beb…` 8181B)** |

## §4 这算不算把 Codex 那条"窄 runtime-probe"关了 —— 不替 Codex 答, 只把两种读法摆出来

Codex 原句:"run the rebuilt compiler through the already-frozen primitive/runtime vectors … and preserve raw outcomes with zero inconclusive"。
- **读法甲(字节等价即闭)**:链上执行的是 script 字节, 不是编译器进程;A 的产出与 8/20 在 TN12 上被 kaspad 逐笔判定过的字节逐字节相同(§3 第一行), 因此 8/20 的 8 条原始结果(`run-evidence.json`, V0/V5c PASS 带 txid、V1–V5b REJECT 带拒因原文)**就是 A 产出的 runtime 结果**;加上今日 A 的离线八格 = 零 inconclusive。
- **读法乙(须现场再花一遍)**:Codex 措辞是"rebuilt artifact itself running … on the relevant Toccata path", 可读成要用 A 编出的 script **现场**充值并按 §4 纪律(V0 与 V1–V4 同窗交替、抓 kaspad 拒因)再跑一遍。**这条需要节点同步 + 写路径 isSynced 闸开 + 几 KAS 测试币**, 排在 `run.cjs all` 之后, 动前报 Bettor 批。
- 🔵 本文交付的是**甲的全部证据 + 乙的就绪状态**(A 在、脚本已参数化、向量已用 A 生成且自验过), 不宣布 gate (g) CLOSED。

## §5 改动与边界
- 脚本改动(单文件, NWT diff):`P1G_SILVERC` env 覆盖(不设 = 原默认 C, `assertPinnedCompiler` 语义不变);增加"用被测编译器真编一次 probe + 记录 compiler sha256 / script sha256 到输出与 `vectors.json`"。lint 0 error。
- 未碰 `/d/silverscript`、未写任何 `versioned-builds/*`、未重建;`scratch/e2e/_ctor.json` 与 `vectors.json` 被今日运行覆盖前已备份到 `_0820_backup/`。
- 未上链、未花币、未动节点。
