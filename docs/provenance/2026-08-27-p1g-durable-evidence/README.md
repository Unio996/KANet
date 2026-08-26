# P1(g) durable evidence — Codex MSG-269/270 闭合链逐环入仓

> **Status**: 证据制品 · J2 2026-08-27 · Bettor 派工 (10) · **只搬证据, 不改码, 不重跑**(除 03b 是对入仓文件现算的逐字节比对)
> Codex 闭合规则原文(RESPONSE-20260826-MSG269-MSG270): *durably publish the exact chain `ctor bytes -> A output bytes/hash == C output bytes/hash == script bytes actually submitted on TN12 -> raw V0/V5c PASS txids + raw V1..V5b REJECT submissions/reasons -> 0 inconclusive`*
> 每件 sha256 见同目录 `MANIFEST.sha256`(`sha256sum *` 生成;复核: `cd docs/provenance/2026-08-27-p1g-durable-evidence && sha256sum -c MANIFEST.sha256`)。

## 链(按 Codex 顺序)

| 环 | 文件 | 内容 | 关键值 |
|---|---|---|---|
| **① ctor bytes** | `01-ctor-20260820.json` | 8/20 上链那次用的 ctor(`[pkBaked]`, 879B), 来源 `scratch/e2e/_0820_backup/_ctor.json`(2026-08-20 18:01, 今日运行前备份) | sha256 `83c022b3…` |
| **② A output** | `02a-probe-from-0820ctor-compiled-by-A-7213455b.json` | 用 ① 由 **A**(fresh rebuild `scratch/_p1g_verify/target/release/silverc.exe`, exe sha256 `7213455b6953cfdb8ce946cacf68bb98fd58e4b63861ca72c4ad1e99e83ee71a`)编出的 probe | 文件 sha256 `d119d5d5…`;script 40B sha256(hex) `21fa272f…` |
| **② C output** | `02c-probe-from-0820ctor-compiled-by-C-9de7f2f6.json` | 用 ① 由 **C**(权威 `versioned-builds/silverc-zk-8065184.exe`, exe sha256 `9de7f2f682bc9e50a4b922e1c811335f1b1cd67c175f2e01df6fa6efc9015fc4`)编出的 probe | 文件 sha256 `d119d5d5…`(与 A **整文件相同**) |
| **③ submitted on TN12** | `03-onchain_probe-20260820-script-submitted-on-tn12.json` | 8/20 19:22 上链跑手实际用的编译产物(来源 `scratch/e2e/_0820_backup/onchain_probe.json`) | 文件 sha256 `d119d5d5…`(与 A、C **整文件相同**) |
| **③ 比对** | `03b-bytewise-compare-A-C-onchain.json` | 对 02a/02c/03 三份文件**现算**: script hex 逐字节 `A == C == onchain`, 40B, sha256 `21fa272f00ed96d9b37ab5e925d8fb961611131942bca39adea2537d94e0d50f` | `A_eq_C: true, A_eq_onchain: true, C_eq_onchain: true` |
| **④ raw outcomes(8/20)** | `04-run-evidence-20260820.json` | 8/20 上链腿原始记录: V0-final PASS txid `b5306edd…`、V5c PASS txid `e0515f3f…`;V1/V2/V3/V5a/V5b REJECT `not all signatures empty on failed checkmultisig`(各带被拒 txid)、V4 REJECT `script ran, but verification failed`;每窗前 `v0Before: PASS` | 8 窗, 0 inconclusive |
| ④ 向量 | `04b-vectors-20260820.json` | 8/20 那批向量(sig/digest/expect), pkBaked 与 ① 一致 | |
| **⑤ 今日离线腿** | `05-offline-leg-result-20260827.json` | A/C exe sha 硬断言 + ① 下 A≡C≡onchain + 新 ctor 下 A≡C + 8 向量离线自验全符合, `inconclusive: 0` | verdict `OFFLINE-LEG PASS` |
| ⑤ 运行原文 | `05b-offline-leg-A-run-20260827.log` | 向量脚本用 A 跑的完整 stdout(判据对照臂 / 编译坐标对照臂 / 八格) | |
| ⑤ 新 ctor 组 | `05c-vectors-20260827-newctor-A.json` · `05d-probe-newctor-compiled-by-A.json` · `05e-probe-newctor-compiled-by-C.json` | 新随机钥下 A/C 产出(sha256 `1f7ecd08…` 同) | |
| ⑤ 跑手 | `05f-offline-leg-runner.mjs` | 生成 ⑤ 的脚本原文(含对 A/C sha 的硬断言) | |

## 🔴 如实标:④ 的 REJECT 【提交体】不可恢复

8/20 的 `run-evidence.json` 每条 REJECT 只记了 `window / expect / v0Before / result / reason`;**被拒交易的原始序列化提交体没有落盘**(txid 只以文本形式嵌在 kaspad 拒因原文里)。⇒ Codex 链里 "raw V1..V5b REJECT **submissions**/reasons" 这一格, 本包只能提供 **reasons + txids**, 提供不了 submissions。
- 能重建的部分: 被拒 tx 花的是 ③ 那段 script 对应的 P2SH, witness 入参 = `04b-vectors-20260820.json` 里对应向量的 (sig, digest) —— **witness 可从向量重建, 但 tx 其余字段(输入 outpoint / 输出 / fee / lockTime)8/20 未留**。
- ⇒ **按 Bettor 规则: 该格标"不可恢复", 上链腿(读法乙)排在节点同步之后**, 到时用 A 编出的 probe(= 本包 02a)现场再跑一遍并把**每笔提交体**原样落盘, 补齐这一格。

## 复核命令(只读)
```bash
cd docs/provenance/2026-08-27-p1g-durable-evidence && sha256sum -c MANIFEST.sha256
node -e "const f=require('fs');const c=require('crypto');for(const n of ['02a-probe-from-0820ctor-compiled-by-A-7213455b.json','02c-probe-from-0820ctor-compiled-by-C-9de7f2f6.json','03-onchain_probe-20260820-script-submitted-on-tn12.json']){const h=Buffer.from(JSON.parse(f.readFileSync(n,'utf8')).script).toString('hex');console.log(n.slice(0,3),h.length/2+'B',c.createHash('sha256').update(h).digest('hex'))}"
sha256sum scratch/_p1g_verify/target/release/silverc.exe /d/silverscript/versioned-builds/silverc-zk-8065184.exe   # A / C exe(仓外)
```
